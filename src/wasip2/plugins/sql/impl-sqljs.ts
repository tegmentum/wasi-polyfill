/**
 * Real SQLite backend for wasi:sql, built on sql.js (SQLite compiled to WASM).
 *
 * Unlike the in-memory `memory` backend (a regex-based toy engine), this runs an
 * actual SQLite database: full SQL parsing, JOINs, indexes, constraints, and
 * real transactions.
 *
 * sql.js is an OPTIONAL peer dependency. Loading its WASM is asynchronous, but
 * the plugin import surface must be synchronous (jco trampolines), and sql.js
 * queries are synchronous once loaded. The host therefore initializes sql.js and
 * passes the module in via config:
 *
 * ```ts
 * import initSqlJs from 'sql.js'
 * const SQL = await initSqlJs({ locateFile: f => `/sql-wasm.wasm` })
 * polyfill.registerPlugin(sqlConnectionPlugin)
 * // select the 'sqljs' implementation and provide the module:
 * createPolicy({ overrides: { 'wasi:sql/connection': { implementation: 'sqljs', config: { sqlJs: SQL } } } })
 * ```
 *
 * If the module is not provided, operations return CONNECTION_FAILED.
 */

import type {
  Implementation,
  PluginConfig,
  PluginInstance,
} from '../../core/types.js'
import { contextFromConfig } from '../../core/resource-context.js'
import type {
  Database,
  SqlJsStatic,
  BindParams,
  ParamsObject,
} from 'sql.js'
import {
  type ColumnInfo,
  type ConnectionHandle,
  type ConnectionInfo,
  type ConnectionOptions,
  type QueryParams,
  type ResultSetHandle,
  type ResultSetInfo,
  type SqlValue,
  type StatementHandle,
  type TransactionHandle,
  type TransactionOptions,
  DatabaseDriver,
  SqlErrorCode,
  SqlType,
  extractValue,
  sqlErr,
  sqlOk,
} from './types.js'

/** Config recognized by the sqljs backend (host-provided SQL.js module). */
export interface SqlJsConfig extends PluginConfig {
  /** A `SqlJsStatic` from `await initSqlJs(...)`. Required for any operation. */
  sqlJs?: SqlJsStatic
}

interface SqlJsConnection {
  handle: ConnectionHandle
  dbName: string
  db: Database
  options: ConnectionOptions
  inTransaction: boolean
}

interface SqlJsResultSet {
  handle: ResultSetHandle
  connectionHandle: ConnectionHandle
  columns: ColumnInfo[]
  rows: Array<Record<string, unknown>>
  cursor: number
}

interface SqlJsStatementInfo {
  handle: StatementHandle
  connectionHandle: ConnectionHandle
  sql: string
}

interface SqlJsTransaction {
  handle: TransactionHandle
  connectionHandle: ConnectionHandle
}

/** Map a sql.js error message to a wasi:sql error code. */
function mapSqlError(message: string): SqlErrorCode {
  const m = message.toLowerCase()
  if (m.includes('constraint')) return SqlErrorCode.CONSTRAINT_VIOLATION
  if (m.includes('no such table') || m.includes('no such column')) {
    return SqlErrorCode.NOT_FOUND
  }
  if (m.includes('syntax error') || m.includes('near ')) {
    return SqlErrorCode.SYNTAX_ERROR
  }
  return SqlErrorCode.UNKNOWN
}

/** Map a SQLite declared type string to our SqlType enum. */
function mapSqliteType(declared: string): SqlType {
  const t = declared.toUpperCase()
  if (t.includes('INT')) return SqlType.INTEGER
  if (t.includes('CHAR') || t.includes('CLOB') || t.includes('TEXT')) {
    return SqlType.TEXT
  }
  if (t.includes('BLOB')) return SqlType.BLOB
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) {
    return SqlType.REAL
  }
  if (t.includes('BOOL')) return SqlType.BOOLEAN
  return SqlType.TEXT
}

/** Infer a column type from a sample raw value (SQLite is dynamically typed). */
function inferType(value: unknown): SqlType {
  if (value === null || value === undefined) return SqlType.TEXT
  if (typeof value === 'number') {
    return Number.isInteger(value) ? SqlType.INTEGER : SqlType.REAL
  }
  if (typeof value === 'bigint') return SqlType.BIGINT
  if (value instanceof Uint8Array) return SqlType.BLOB
  return SqlType.TEXT
}

/** Convert WASI QueryParams into sql.js BindParams. */
function toBindParams(params?: QueryParams): BindParams | undefined {
  if (!params) return undefined
  const coerce = (v: SqlValue): unknown => {
    const raw = extractValue(v)
    // sql.js binds JS numbers; map bigint to number (64-bit ids fit until 2^53).
    return typeof raw === 'bigint' ? Number(raw) : raw
  }
  if (Array.isArray(params)) {
    return params.map(coerce) as BindParams
  }
  const obj: ParamsObject = {}
  for (const [key, value] of params) {
    const named = /^[:@$]/.test(key) ? key : `:${key}`
    obj[named] = coerce(value) as ParamsObject[string]
  }
  return obj
}

/**
 * Shared backing state for the sqljs SQL backend.
 *
 * Like the keyvalue backend, the five wasi:sql interfaces are instantiated
 * separately by the polyfill but share resources (a connection opened via
 * `connection` must be usable from `query`), so they point at one backend.
 */
export class SqlJsBackend {
  sqlJs: SqlJsStatic | undefined
  private readonly databases = new Map<string, Database>()
  private readonly connections = new Map<ConnectionHandle, SqlJsConnection>()
  private readonly statements = new Map<StatementHandle, SqlJsStatementInfo>()
  private readonly resultSets = new Map<ResultSetHandle, SqlJsResultSet>()
  private readonly transactions = new Map<TransactionHandle, SqlJsTransaction>()
  private nextHandle = 1

  constructor(sqlJs?: SqlJsStatic) {
    this.sqlJs = sqlJs
  }

  // --- connection management ------------------------------------------------

  open(options: ConnectionOptions) {
    if (!this.sqlJs) {
      return sqlErr<ConnectionHandle>(
        SqlErrorCode.CONNECTION_FAILED,
        'sql.js module not provided; pass { sqlJs } in the plugin config'
      )
    }
    const dbName = options.database || options.connectionString || ':memory:'
    let db = this.databases.get(dbName)
    if (!db) {
      db = new this.sqlJs.Database()
      this.databases.set(dbName, db)
    }
    const handle = this.nextHandle++
    this.connections.set(handle, {
      handle,
      dbName,
      db,
      options,
      inTransaction: false,
    })
    return sqlOk(handle)
  }

  close(handle: ConnectionHandle) {
    const connection = this.connections.get(handle)
    if (!connection) {
      return sqlErr(SqlErrorCode.INVALID_ARGUMENT, `Connection ${handle} not found`)
    }
    for (const [h, s] of this.statements) {
      if (s.connectionHandle === handle) this.statements.delete(h)
    }
    for (const [h, r] of this.resultSets) {
      if (r.connectionHandle === handle) this.resultSets.delete(h)
    }
    if (connection.inTransaction) {
      try {
        connection.db.run('ROLLBACK')
      } catch {
        // best effort
      }
    }
    this.connections.delete(handle)
    return sqlOk(undefined)
  }

  getConnectionInfo(handle: ConnectionHandle): ConnectionInfo | null {
    const connection = this.connections.get(handle)
    if (!connection) return null
    return {
      handle,
      driver: connection.options.driver || DatabaseDriver.SQLITE,
      database: connection.dbName,
      readOnly: connection.options.readOnly || false,
      inTransaction: connection.inTransaction,
    }
  }

  // --- query execution ------------------------------------------------------

  execute(handle: ConnectionHandle, sql: string, params?: QueryParams) {
    const connection = this.connections.get(handle)
    if (!connection) {
      return sqlErr(SqlErrorCode.CONNECTION_CLOSED, `Connection ${handle} not found`)
    }
    try {
      const bind = toBindParams(params)
      if (bind === undefined) {
        connection.db.run(sql)
      } else {
        connection.db.run(sql, bind)
      }
      const rowsAffected = connection.db.getRowsModified()
      let lastInsertId: number | undefined
      const res = connection.db.exec('SELECT last_insert_rowid()')
      const id = res[0]?.values[0]?.[0]
      if (typeof id === 'number') lastInsertId = id
      return sqlOk(
        lastInsertId !== undefined
          ? { rowsAffected, lastInsertId }
          : { rowsAffected }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return sqlErr(mapSqlError(message), message)
    }
  }

  query(handle: ConnectionHandle, sql: string, params?: QueryParams) {
    const connection = this.connections.get(handle)
    if (!connection) {
      return sqlErr(SqlErrorCode.CONNECTION_CLOSED, `Connection ${handle} not found`)
    }
    let stmt
    try {
      stmt = connection.db.prepare(sql)
      const bind = toBindParams(params)
      if (bind !== undefined) stmt.bind(bind)

      const columnNames = stmt.getColumnNames()
      const rows: Array<Record<string, unknown>> = []
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as Record<string, unknown>)
      }
      stmt.free()

      const sample = rows[0]
      const columns: ColumnInfo[] = columnNames.map((name) => ({
        name,
        type: sample ? inferType(sample[name]) : SqlType.TEXT,
        nullable: true,
        primaryKey: false,
      }))

      const rsHandle = this.nextHandle++
      this.resultSets.set(rsHandle, {
        handle: rsHandle,
        connectionHandle: handle,
        columns,
        rows,
        cursor: 0,
      })
      return sqlOk(rsHandle)
    } catch (error) {
      try {
        stmt?.free()
      } catch {
        // ignore
      }
      const message = error instanceof Error ? error.message : String(error)
      return sqlErr(mapSqlError(message), message)
    }
  }

  // --- prepared statements --------------------------------------------------

  prepare(handle: ConnectionHandle, sql: string) {
    const connection = this.connections.get(handle)
    if (!connection) {
      return sqlErr(SqlErrorCode.CONNECTION_CLOSED, `Connection ${handle} not found`)
    }
    const stmtHandle = this.nextHandle++
    this.statements.set(stmtHandle, {
      handle: stmtHandle,
      connectionHandle: handle,
      sql,
    })
    return sqlOk(stmtHandle)
  }

  executeStatement(handle: StatementHandle, params?: QueryParams) {
    const statement = this.statements.get(handle)
    if (!statement) {
      return sqlErr(SqlErrorCode.INVALID_ARGUMENT, `Statement ${handle} not found`)
    }
    return this.execute(statement.connectionHandle, statement.sql, params)
  }

  queryStatement(handle: StatementHandle, params?: QueryParams) {
    const statement = this.statements.get(handle)
    if (!statement) {
      return sqlErr(SqlErrorCode.INVALID_ARGUMENT, `Statement ${handle} not found`)
    }
    return this.query(statement.connectionHandle, statement.sql, params)
  }

  closeStatement(handle: StatementHandle) {
    if (!this.statements.has(handle)) {
      return sqlErr(SqlErrorCode.INVALID_ARGUMENT, `Statement ${handle} not found`)
    }
    this.statements.delete(handle)
    return sqlOk(undefined)
  }

  // --- result set -----------------------------------------------------------

  getResultInfo(handle: ResultSetHandle): ResultSetInfo | null {
    const rs = this.resultSets.get(handle)
    if (!rs) return null
    return { columns: rs.columns, rowCount: rs.rows.length }
  }

  fetchRow(handle: ResultSetHandle) {
    const rs = this.resultSets.get(handle)
    if (!rs) {
      return sqlErr(SqlErrorCode.INVALID_ARGUMENT, `Result set ${handle} not found`)
    }
    if (rs.cursor >= rs.rows.length) return sqlOk(null)
    const row = rs.rows[rs.cursor]!
    rs.cursor++
    return sqlOk(row)
  }

  fetchAll(handle: ResultSetHandle) {
    const rs = this.resultSets.get(handle)
    if (!rs) {
      return sqlErr(SqlErrorCode.INVALID_ARGUMENT, `Result set ${handle} not found`)
    }
    const remaining = rs.rows.slice(rs.cursor)
    rs.cursor = rs.rows.length
    return sqlOk(remaining)
  }

  closeResult(handle: ResultSetHandle) {
    if (!this.resultSets.has(handle)) {
      return sqlErr(SqlErrorCode.INVALID_ARGUMENT, `Result set ${handle} not found`)
    }
    this.resultSets.delete(handle)
    return sqlOk(undefined)
  }

  // --- transactions (real BEGIN/COMMIT/ROLLBACK) ----------------------------

  beginTransaction(handle: ConnectionHandle, _options?: TransactionOptions) {
    const connection = this.connections.get(handle)
    if (!connection) {
      return sqlErr(SqlErrorCode.CONNECTION_CLOSED, `Connection ${handle} not found`)
    }
    if (connection.inTransaction) {
      return sqlErr(SqlErrorCode.TRANSACTION_ERROR, 'Already in a transaction')
    }
    try {
      connection.db.run('BEGIN')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return sqlErr(SqlErrorCode.TRANSACTION_ERROR, message)
    }
    connection.inTransaction = true
    const txHandle = this.nextHandle++
    this.transactions.set(txHandle, { handle: txHandle, connectionHandle: handle })
    return sqlOk(txHandle)
  }

  commit(handle: TransactionHandle) {
    return this.endTransaction(handle, 'COMMIT')
  }

  rollback(handle: TransactionHandle) {
    return this.endTransaction(handle, 'ROLLBACK')
  }

  private endTransaction(handle: TransactionHandle, verb: 'COMMIT' | 'ROLLBACK') {
    const transaction = this.transactions.get(handle)
    if (!transaction) {
      return sqlErr(SqlErrorCode.INVALID_ARGUMENT, `Transaction ${handle} not found`)
    }
    const connection = this.connections.get(transaction.connectionHandle)
    if (!connection) {
      return sqlErr(SqlErrorCode.CONNECTION_CLOSED, 'Connection closed')
    }
    try {
      connection.db.run(verb)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return sqlErr(SqlErrorCode.TRANSACTION_ERROR, message)
    }
    connection.inTransaction = false
    this.transactions.delete(handle)
    return sqlOk(undefined)
  }

  // --- utilities ------------------------------------------------------------

  listTables(handle: ConnectionHandle): string[] | null {
    const connection = this.connections.get(handle)
    if (!connection) return null
    const res = connection.db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    return (res[0]?.values ?? []).map((row) => String(row[0]))
  }

  describeTable(handle: ConnectionHandle, tableName: string): ColumnInfo[] | null {
    const connection = this.connections.get(handle)
    if (!connection) return null
    // PRAGMA doesn't accept bind params; quote the identifier defensively.
    const quoted = tableName.replace(/"/g, '""')
    let res
    try {
      res = connection.db.exec(`PRAGMA table_info("${quoted}")`)
    } catch {
      return null
    }
    const table = res[0]
    if (!table || table.values.length === 0) return null
    const col = (name: string) => table.columns.indexOf(name)
    const iName = col('name')
    const iType = col('type')
    const iNotNull = col('notnull')
    const iDflt = col('dflt_value')
    const iPk = col('pk')
    return table.values.map((row) => {
      const info: ColumnInfo = {
        name: String(row[iName]),
        type: mapSqliteType(String(row[iType] ?? '')),
        nullable: Number(row[iNotNull]) === 0,
        primaryKey: Number(row[iPk]) > 0,
      }
      const dflt = row[iDflt]
      if (dflt !== null && dflt !== undefined) info.defaultValue = String(dflt)
      return info
    })
  }

  destroy(): void {
    for (const db of this.databases.values()) {
      try {
        db.close()
      } catch {
        // ignore
      }
    }
    this.connections.clear()
    this.statements.clear()
    this.resultSets.clear()
    this.transactions.clear()
    this.databases.clear()
  }
}

/** Thin PluginInstance facade exposing a {@link SqlJsBackend}'s imports. */
class SqlJsInstance implements PluginInstance {
  constructor(
    private readonly backend: SqlJsBackend,
    private readonly ownsBackend: boolean
  ) {}

  getImports(): Record<string, unknown> {
    const b = this.backend
    return {
      open: (options: ConnectionOptions) => b.open(options),
      close: (handle: ConnectionHandle) => b.close(handle),
      'get-connection-info': (handle: ConnectionHandle) =>
        b.getConnectionInfo(handle),
      execute: (handle: ConnectionHandle, sql: string, params?: QueryParams) =>
        b.execute(handle, sql, params),
      query: (handle: ConnectionHandle, sql: string, params?: QueryParams) =>
        b.query(handle, sql, params),
      prepare: (handle: ConnectionHandle, sql: string) => b.prepare(handle, sql),
      'execute-statement': (handle: StatementHandle, params?: QueryParams) =>
        b.executeStatement(handle, params),
      'query-statement': (handle: StatementHandle, params?: QueryParams) =>
        b.queryStatement(handle, params),
      'close-statement': (handle: StatementHandle) => b.closeStatement(handle),
      'get-result-info': (handle: ResultSetHandle) => b.getResultInfo(handle),
      'fetch-row': (handle: ResultSetHandle) => b.fetchRow(handle),
      'fetch-all': (handle: ResultSetHandle) => b.fetchAll(handle),
      'close-result': (handle: ResultSetHandle) => b.closeResult(handle),
      'begin-transaction': (
        handle: ConnectionHandle,
        options?: TransactionOptions
      ) => b.beginTransaction(handle, options),
      commit: (handle: TransactionHandle) => b.commit(handle),
      rollback: (handle: TransactionHandle) => b.rollback(handle),
      'list-tables': (handle: ConnectionHandle) => b.listTables(handle),
      'describe-table': (handle: ConnectionHandle, tableName: string) =>
        b.describeTable(handle, tableName),
    }
  }

  destroy(): void {
    if (this.ownsBackend) this.backend.destroy()
  }
}

/**
 * Resource-context key for the backend shared by the five wasi:sql interfaces
 * (so a connection opened via one resolves on the others). Scoped to the
 * polyfill's ResourceContext: shared within a polyfill, isolated between them.
 */
const SQLJS_BACKEND = Symbol('wasi:sql/sqljs-backend')

/**
 * Real SQLite implementation of wasi:sql, backed by sql.js.
 *
 * The host must provide an initialized sql.js module via `config.sqlJs`.
 */
export const sqljsSqlImplementation: Implementation = {
  name: 'sqljs',
  description: 'SQLite database via sql.js (real SQL engine)',
  create(config: PluginConfig): PluginInstance {
    const sqlJs = (config as SqlJsConfig).sqlJs
    const backend = contextFromConfig(config).get(
      SQLJS_BACKEND,
      () => new SqlJsBackend(sqlJs)
    )
    // A later interface may be the one that supplies the module.
    if (sqlJs && !backend.sqlJs) {
      backend.sqlJs = sqlJs
    }
    return new SqlJsInstance(backend, false)
  },
}

/**
 * Create an isolated sqljs SQL instance + backend (for tests).
 */
export function createSqlJsSql(
  config: SqlJsConfig
): { instance: PluginInstance; backend: SqlJsBackend } {
  const backend = new SqlJsBackend(config.sqlJs)
  return { instance: new SqlJsInstance(backend, true), backend }
}
