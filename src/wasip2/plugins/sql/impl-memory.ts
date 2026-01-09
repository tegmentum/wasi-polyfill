/**
 * In-memory SQL implementation
 *
 * Provides a simple in-memory database with SQL-like operations.
 * Supports basic CREATE TABLE, INSERT, SELECT, UPDATE, DELETE operations.
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import {
  type ConnectionHandle,
  type StatementHandle,
  type ResultSetHandle,
  type TransactionHandle,
  type SqlValue,
  type Row,
  type ColumnInfo,
  type QueryParams,
  type QueryResult,
  type ResultSetInfo,
  type ConnectionOptions,
  type ConnectionInfo,
  type TransactionOptions,
  type SqlPluginConfig,
  type SqlResult,
  SqlType,
  DatabaseDriver,
  IsolationLevel,
  SqlErrorCode,
  sqlOk,
  sqlErr,
  extractValue,
  valueToSqlValue,
  rowToObject,
} from './types.js'

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Table schema definition.
 */
interface TableSchema {
  name: string
  columns: ColumnInfo[]
  primaryKey?: string[]
}

/**
 * Internal table storage.
 */
interface InternalTable {
  schema: TableSchema
  rows: Map<string, SqlValue>[]
  autoIncrement: number
}

/**
 * Internal database.
 */
interface InternalDatabase {
  name: string
  tables: Map<string, InternalTable>
}

/**
 * Internal connection state.
 */
interface InternalConnection {
  handle: ConnectionHandle
  database: InternalDatabase
  options: ConnectionOptions
  inTransaction: boolean
  transactionSavepoint?: InternalDatabase
}

/**
 * Prepared statement.
 */
interface InternalStatement {
  handle: StatementHandle
  connectionHandle: ConnectionHandle
  sql: string
  parameterNames: string[]
}

/**
 * Result set with cursor.
 */
interface InternalResultSet {
  handle: ResultSetHandle
  connectionHandle: ConnectionHandle
  columns: ColumnInfo[]
  rows: Row[]
  cursor: number
}

/**
 * Active transaction.
 */
interface InternalTransaction {
  handle: TransactionHandle
  connectionHandle: ConnectionHandle
  options: TransactionOptions
  savepoint: InternalDatabase
}

// =============================================================================
// SQL Parser (Simple)
// =============================================================================

interface ParsedQuery {
  type: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE_TABLE' | 'DROP_TABLE' | 'UNKNOWN'
  tableName?: string
  columns?: string[]
  values?: SqlValue[][]
  where?: (row: Row) => boolean
  set?: Map<string, SqlValue>
  schema?: TableSchema
  limit?: number
  offset?: number
}

/**
 * Simple SQL parser for basic operations.
 */
function parseQuery(sql: string, params?: QueryParams): ParsedQuery {
  const normalized = sql.trim().toUpperCase()
  const originalSql = sql.trim()

  // Replace parameters with values
  let paramIndex = 0
  const paramArray = Array.isArray(params) ? params : []
  const paramMap = params instanceof Map ? params : new Map<string, SqlValue>()

  const getParam = (name?: string): SqlValue => {
    if (name && paramMap.has(name)) {
      return paramMap.get(name)!
    }
    if (paramIndex < paramArray.length) {
      return paramArray[paramIndex++]!
    }
    return { type: SqlType.NULL }
  }

  // CREATE TABLE
  if (normalized.startsWith('CREATE TABLE')) {
    const match = originalSql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s*\(([\s\S]+)\)/i)
    if (match) {
      const tableName = match[1]!
      const columnDefs = match[2]!
      const columns: ColumnInfo[] = []
      let primaryKey: string[] = []

      const parts = columnDefs.split(',').map((p) => p.trim())
      for (const part of parts) {
        if (part.toUpperCase().startsWith('PRIMARY KEY')) {
          const pkMatch = part.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i)
          if (pkMatch) {
            primaryKey = pkMatch[1]!.split(',').map((c) => c.trim().replace(/["'`]/g, ''))
          }
          continue
        }

        const colMatch = part.match(/["'`]?(\w+)["'`]?\s+(\w+)(.*)/)
        if (colMatch) {
          const colName = colMatch[1]!
          const colType = colMatch[2]!.toUpperCase()
          const rest = colMatch[3] || ''

          let sqlType = SqlType.TEXT
          if (colType.includes('INT')) sqlType = SqlType.INTEGER
          else if (colType.includes('REAL') || colType.includes('FLOAT') || colType.includes('DOUBLE')) sqlType = SqlType.REAL
          else if (colType.includes('BOOL')) sqlType = SqlType.BOOLEAN
          else if (colType.includes('BLOB')) sqlType = SqlType.BLOB
          else if (colType.includes('DATE')) sqlType = SqlType.DATE
          else if (colType.includes('TIME')) sqlType = SqlType.TIMESTAMP
          else if (colType.includes('JSON')) sqlType = SqlType.JSON

          const isPrimaryKey = rest.toUpperCase().includes('PRIMARY KEY')
          if (isPrimaryKey) {
            primaryKey = [colName]
          }

          columns.push({
            name: colName,
            type: sqlType,
            nullable: !rest.toUpperCase().includes('NOT NULL'),
            primaryKey: isPrimaryKey,
          })
        }
      }

      return {
        type: 'CREATE_TABLE',
        tableName,
        schema: { name: tableName, columns, primaryKey },
      }
    }
  }

  // DROP TABLE
  if (normalized.startsWith('DROP TABLE')) {
    const match = originalSql.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["'`]?(\w+)["'`]?/i)
    if (match) {
      return { type: 'DROP_TABLE', tableName: match[1] }
    }
  }

  // INSERT
  if (normalized.startsWith('INSERT')) {
    const match = originalSql.match(/INSERT\s+INTO\s+["'`]?(\w+)["'`]?\s*\(([^)]+)\)\s*VALUES\s*(.+)/i)
    if (match) {
      const tableName = match[1]!
      const columns = match[2]!.split(',').map((c) => c.trim().replace(/["'`]/g, ''))
      const valuesStr = match[3]!

      // Parse values - support multiple rows
      const valueRows: SqlValue[][] = []
      const rowMatches = Array.from(valuesStr.matchAll(/\(([^)]+)\)/g))
      for (const rowMatch of rowMatches) {
        const values: SqlValue[] = []
        const valueParts = rowMatch[1]!.split(',').map((v) => v.trim())
        for (const val of valueParts) {
          if (val === '?' || val.startsWith(':') || val.startsWith('@') || val.startsWith('$')) {
            values.push(getParam(val.slice(1)))
          } else if (val.toUpperCase() === 'NULL') {
            values.push({ type: SqlType.NULL })
          } else if (val.match(/^['"].*['"]$/)) {
            values.push({ type: SqlType.TEXT, value: val.slice(1, -1) })
          } else if (val.match(/^-?\d+$/)) {
            values.push({ type: SqlType.INTEGER, value: parseInt(val, 10) })
          } else if (val.match(/^-?\d+\.?\d*$/)) {
            values.push({ type: SqlType.REAL, value: parseFloat(val) })
          } else if (val.toUpperCase() === 'TRUE') {
            values.push({ type: SqlType.BOOLEAN, value: true })
          } else if (val.toUpperCase() === 'FALSE') {
            values.push({ type: SqlType.BOOLEAN, value: false })
          } else {
            values.push({ type: SqlType.TEXT, value: val })
          }
        }
        valueRows.push(values)
      }

      return { type: 'INSERT', tableName, columns, values: valueRows }
    }
  }

  // SELECT
  if (normalized.startsWith('SELECT')) {
    const match = originalSql.match(/SELECT\s+(.+?)\s+FROM\s+["'`]?(\w+)["'`]?(?:\s+WHERE\s+(.+?))?(?:\s+LIMIT\s+(\d+))?(?:\s+OFFSET\s+(\d+))?$/i)
    if (match) {
      const columnsStr = match[1]!.trim()
      const tableName = match[2]!
      const whereClause = match[3]
      const limit = match[4] ? parseInt(match[4], 10) : undefined
      const offset = match[5] ? parseInt(match[5], 10) : undefined

      const columns = columnsStr === '*' ? [] : columnsStr.split(',').map((c) => c.trim().replace(/["'`]/g, ''))

      let where: ((row: Row) => boolean) | undefined
      if (whereClause) {
        where = createWhereFunction(whereClause, getParam)
      }

      return { type: 'SELECT', tableName, columns, where, limit, offset }
    }
  }

  // UPDATE
  if (normalized.startsWith('UPDATE')) {
    const match = originalSql.match(/UPDATE\s+["'`]?(\w+)["'`]?\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i)
    if (match) {
      const tableName = match[1]!
      const setClause = match[2]!
      const whereClause = match[3]

      const set = new Map<string, SqlValue>()
      const setParts = setClause.split(',').map((s) => s.trim())
      for (const part of setParts) {
        const [col, val] = part.split('=').map((s) => s.trim())
        if (col && val) {
          const colName = col.replace(/["'`]/g, '')
          if (val === '?' || val.startsWith(':')) {
            set.set(colName, getParam(val.slice(1)))
          } else if (val.toUpperCase() === 'NULL') {
            set.set(colName, { type: SqlType.NULL })
          } else if (val.match(/^['"].*['"]$/)) {
            set.set(colName, { type: SqlType.TEXT, value: val.slice(1, -1) })
          } else if (val.match(/^-?\d+$/)) {
            set.set(colName, { type: SqlType.INTEGER, value: parseInt(val, 10) })
          } else if (val.match(/^-?\d+\.?\d*$/)) {
            set.set(colName, { type: SqlType.REAL, value: parseFloat(val) })
          } else {
            set.set(colName, { type: SqlType.TEXT, value: val })
          }
        }
      }

      let where: ((row: Row) => boolean) | undefined
      if (whereClause) {
        where = createWhereFunction(whereClause, getParam)
      }

      return { type: 'UPDATE', tableName, set, where }
    }
  }

  // DELETE
  if (normalized.startsWith('DELETE')) {
    const match = originalSql.match(/DELETE\s+FROM\s+["'`]?(\w+)["'`]?(?:\s+WHERE\s+(.+))?$/i)
    if (match) {
      const tableName = match[1]!
      const whereClause = match[2]

      let where: ((row: Row) => boolean) | undefined
      if (whereClause) {
        where = createWhereFunction(whereClause, getParam)
      }

      return { type: 'DELETE', tableName, where }
    }
  }

  return { type: 'UNKNOWN' }
}

/**
 * Parsed condition with pre-resolved compare value.
 */
interface ParsedCondition {
  colName: string
  op: string
  compareValue: SqlValue | null // null for IS NULL / IS NOT NULL
}

/**
 * Parse a single condition and resolve parameters at parse time.
 */
function parseCondition(condition: string, getParam: (name?: string) => SqlValue): ParsedCondition | null {
  const match = condition.match(/["'`]?(\w+)["'`]?\s*(=|!=|<>|>=|<=|>|<|LIKE|IS NULL|IS NOT NULL)\s*(.*)$/i)
  if (!match) return null

  const colName = match[1]!
  const op = match[2]!.toUpperCase()
  const valueStr = (match[3] || '').trim()

  if (op === 'IS NULL' || op === 'IS NOT NULL') {
    return { colName, op, compareValue: null }
  }

  let compareValue: SqlValue
  if (valueStr === '?' || valueStr.startsWith(':') || valueStr.startsWith('@') || valueStr.startsWith('$')) {
    compareValue = getParam(valueStr.startsWith('?') ? undefined : valueStr.slice(1))
  } else if (valueStr.toUpperCase() === 'NULL') {
    compareValue = { type: SqlType.NULL }
  } else if (valueStr.match(/^['"].*['"]$/)) {
    compareValue = { type: SqlType.TEXT, value: valueStr.slice(1, -1) }
  } else if (valueStr.match(/^-?\d+$/)) {
    compareValue = { type: SqlType.INTEGER, value: parseInt(valueStr, 10) }
  } else if (valueStr.match(/^-?\d+\.?\d*$/)) {
    compareValue = { type: SqlType.REAL, value: parseFloat(valueStr) }
  } else {
    compareValue = { type: SqlType.TEXT, value: valueStr }
  }

  return { colName, op, compareValue }
}

/**
 * Create a where filter function from a simple WHERE clause.
 * Parameters are resolved at creation time, not evaluation time.
 */
function createWhereFunction(whereClause: string, getParam: (name?: string) => SqlValue): (row: Row) => boolean {
  // Parse all conditions upfront and resolve parameters
  const andParts = whereClause.split(/\s+AND\s+/i)
  const parsedAndConditions: ParsedCondition[][] = []

  for (const part of andParts) {
    const orParts = part.split(/\s+OR\s+/i)
    const parsedOrConditions: ParsedCondition[] = []

    for (const orPart of orParts) {
      const parsed = parseCondition(orPart.trim(), getParam)
      if (parsed) {
        parsedOrConditions.push(parsed)
      }
    }
    parsedAndConditions.push(parsedOrConditions)
  }

  // Return filter function that uses pre-parsed conditions
  return (row: Row) => {
    return parsedAndConditions.every((orConditions) => {
      return orConditions.some((cond) => evaluateParsedCondition(cond, row))
    })
  }
}

function evaluateParsedCondition(cond: ParsedCondition, row: Row): boolean {
  const colValue = row.columns.get(cond.colName)
  if (!colValue) return false

  if (cond.op === 'IS NULL') {
    return colValue.type === SqlType.NULL
  }
  if (cond.op === 'IS NOT NULL') {
    return colValue.type !== SqlType.NULL
  }

  if (!cond.compareValue) return false

  const a = extractValue(colValue)
  const b = extractValue(cond.compareValue)

  switch (cond.op) {
    case '=': return a === b
    case '!=':
    case '<>': return a !== b
    case '>': return (a as number) > (b as number)
    case '>=': return (a as number) >= (b as number)
    case '<': return (a as number) < (b as number)
    case '<=': return (a as number) <= (b as number)
    case 'LIKE':
      // Simple LIKE with % wildcards
      const pattern = String(b).replace(/%/g, '.*').replace(/_/g, '.')
      return new RegExp(`^${pattern}$`, 'i').test(String(a))
    default:
      return false
  }
}

// =============================================================================
// Memory SQL Instance
// =============================================================================

/**
 * In-memory SQL plugin instance.
 */
class MemorySqlInstance implements PluginInstance {
  private databases = new Map<string, InternalDatabase>()
  private connections = new Map<ConnectionHandle, InternalConnection>()
  private statements = new Map<StatementHandle, InternalStatement>()
  private resultSets = new Map<ResultSetHandle, InternalResultSet>()
  private transactions = new Map<TransactionHandle, InternalTransaction>()
  private nextConnectionHandle = 1
  private nextStatementHandle = 1
  private nextResultSetHandle = 1
  private nextTransactionHandle = 1
  private config: SqlPluginConfig

  constructor(config: SqlPluginConfig) {
    this.config = config
  }

  getImports(): Record<string, unknown> {
    return {
      // Connection management
      'open': this.open.bind(this),
      'close': this.close.bind(this),
      'get-connection-info': this.getConnectionInfo.bind(this),

      // Query execution
      'execute': this.execute.bind(this),
      'query': this.query.bind(this),

      // Prepared statements
      'prepare': this.prepare.bind(this),
      'execute-statement': this.executeStatement.bind(this),
      'query-statement': this.queryStatement.bind(this),
      'close-statement': this.closeStatement.bind(this),

      // Result set
      'get-result-info': this.getResultInfo.bind(this),
      'fetch-row': this.fetchRow.bind(this),
      'fetch-all': this.fetchAll.bind(this),
      'close-result': this.closeResult.bind(this),

      // Transaction management
      'begin-transaction': this.beginTransaction.bind(this),
      'commit': this.commit.bind(this),
      'rollback': this.rollback.bind(this),

      // Utilities
      'list-tables': this.listTables.bind(this),
      'describe-table': this.describeTable.bind(this),
    }
  }

  destroy(): void {
    this.connections.clear()
    this.statements.clear()
    this.resultSets.clear()
    this.transactions.clear()
    this.databases.clear()
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  private open(options: ConnectionOptions) {
    const dbName = options.database || options.connectionString || ':memory:'

    // Get or create database
    let database = this.databases.get(dbName)
    if (!database) {
      database = { name: dbName, tables: new Map() }
      this.databases.set(dbName, database)
    }

    const handle = this.nextConnectionHandle++
    const connection: InternalConnection = {
      handle,
      database,
      options,
      inTransaction: false,
    }

    this.connections.set(handle, connection)
    return sqlOk(handle)
  }

  private close(handle: ConnectionHandle) {
    const connection = this.connections.get(handle)
    if (!connection) {
      return sqlErr(SqlErrorCode.INVALID_ARGUMENT, `Connection ${handle} not found`)
    }

    // Close all statements for this connection
    Array.from(this.statements.entries())
      .filter(([_, stmt]) => stmt.connectionHandle === handle)
      .forEach(([stmtHandle]) => this.statements.delete(stmtHandle))

    // Close all result sets for this connection
    Array.from(this.resultSets.entries())
      .filter(([_, rs]) => rs.connectionHandle === handle)
      .forEach(([rsHandle]) => this.resultSets.delete(rsHandle))

    // Rollback any active transaction
    if (connection.inTransaction && connection.transactionSavepoint) {
      // Restore database state
      connection.database.tables = connection.transactionSavepoint.tables
    }

    this.connections.delete(handle)
    return sqlOk(undefined)
  }

  private getConnectionInfo(handle: ConnectionHandle): ConnectionInfo | null {
    const connection = this.connections.get(handle)
    if (!connection) {
      return null
    }

    return {
      handle,
      driver: connection.options.driver || DatabaseDriver.GENERIC,
      database: connection.database.name,
      readOnly: connection.options.readOnly || false,
      inTransaction: connection.inTransaction,
    }
  }

  // ===========================================================================
  // Query Execution
  // ===========================================================================

  private execute(handle: ConnectionHandle, sql: string, params?: QueryParams) {
    const connection = this.connections.get(handle)
    if (!connection) {
      return sqlErr(SqlErrorCode.CONNECTION_CLOSED, `Connection ${handle} not found`)
    }

    try {
      const parsed = parseQuery(sql, params)
      return this.executeQuery(connection, parsed)
    } catch (error) {
      return sqlErr(SqlErrorCode.SYNTAX_ERROR, `Query error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private query(handle: ConnectionHandle, sql: string, params?: QueryParams) {
    const connection = this.connections.get(handle)
    if (!connection) {
      return sqlErr(SqlErrorCode.CONNECTION_CLOSED, `Connection ${handle} not found`)
    }

    try {
      const parsed = parseQuery(sql, params)
      if (parsed.type !== 'SELECT') {
        return sqlErr(SqlErrorCode.SYNTAX_ERROR, 'query() is for SELECT statements. Use execute() for other statements.')
      }

      return this.executeSelectQuery(connection, parsed)
    } catch (error) {
      return sqlErr(SqlErrorCode.SYNTAX_ERROR, `Query error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private executeQuery(connection: InternalConnection, parsed: ParsedQuery): SqlResult<QueryResult> {
    switch (parsed.type) {
      case 'CREATE_TABLE':
        return this.executeCreateTable(connection, parsed)
      case 'DROP_TABLE':
        return this.executeDropTable(connection, parsed)
      case 'INSERT':
        return this.executeInsert(connection, parsed)
      case 'UPDATE':
        return this.executeUpdate(connection, parsed)
      case 'DELETE':
        return this.executeDelete(connection, parsed)
      case 'SELECT':
        // For SELECT in execute(), return rows affected = 0
        return sqlOk({ rowsAffected: 0 })
      default:
        return sqlErr(SqlErrorCode.SYNTAX_ERROR, 'Unsupported SQL statement')
    }
  }

  private executeCreateTable(connection: InternalConnection, parsed: ParsedQuery): SqlResult<QueryResult> {
    if (!parsed.schema || !parsed.tableName) {
      return sqlErr(SqlErrorCode.SYNTAX_ERROR, 'Invalid CREATE TABLE syntax')
    }

    if (connection.database.tables.has(parsed.tableName)) {
      return sqlErr(SqlErrorCode.CONSTRAINT_VIOLATION, `Table '${parsed.tableName}' already exists`)
    }

    connection.database.tables.set(parsed.tableName, {
      schema: parsed.schema,
      rows: [],
      autoIncrement: 1,
    })

    return sqlOk({ rowsAffected: 0 })
  }

  private executeDropTable(connection: InternalConnection, parsed: ParsedQuery): SqlResult<QueryResult> {
    if (!parsed.tableName) {
      return sqlErr(SqlErrorCode.SYNTAX_ERROR, 'Invalid DROP TABLE syntax')
    }

    if (!connection.database.tables.has(parsed.tableName)) {
      return sqlErr(SqlErrorCode.NOT_FOUND, `Table '${parsed.tableName}' not found`)
    }

    connection.database.tables.delete(parsed.tableName)
    return sqlOk({ rowsAffected: 0 })
  }

  private executeInsert(connection: InternalConnection, parsed: ParsedQuery): SqlResult<QueryResult> {
    if (!parsed.tableName || !parsed.columns || !parsed.values) {
      return sqlErr(SqlErrorCode.SYNTAX_ERROR, 'Invalid INSERT syntax')
    }

    const table = connection.database.tables.get(parsed.tableName)
    if (!table) {
      return sqlErr(SqlErrorCode.NOT_FOUND, `Table '${parsed.tableName}' not found`)
    }

    let lastInsertId: number | undefined

    for (const valueRow of parsed.values) {
      const row = new Map<string, SqlValue>()

      for (let i = 0; i < parsed.columns.length; i++) {
        const colName = parsed.columns[i]!
        const value = valueRow[i] || { type: SqlType.NULL }
        row.set(colName, value)
      }

      // Handle auto-increment for missing primary key
      const pkCols = table.schema.primaryKey || []
      for (const pkCol of pkCols) {
        if (!row.has(pkCol) || row.get(pkCol)?.type === SqlType.NULL) {
          const id = table.autoIncrement++
          row.set(pkCol, { type: SqlType.INTEGER, value: id })
          lastInsertId = id
        }
      }

      table.rows.push(row)
    }

    return sqlOk({
      rowsAffected: parsed.values.length,
      lastInsertId,
    })
  }

  private executeUpdate(connection: InternalConnection, parsed: ParsedQuery): SqlResult<QueryResult> {
    if (!parsed.tableName || !parsed.set) {
      return sqlErr(SqlErrorCode.SYNTAX_ERROR, 'Invalid UPDATE syntax')
    }

    const table = connection.database.tables.get(parsed.tableName)
    if (!table) {
      return sqlErr(SqlErrorCode.NOT_FOUND, `Table '${parsed.tableName}' not found`)
    }

    let rowsAffected = 0

    for (const row of table.rows) {
      const rowObj: Row = { columns: row }
      if (!parsed.where || parsed.where(rowObj)) {
        parsed.set.forEach((value, colName) => {
          row.set(colName, value)
        })
        rowsAffected++
      }
    }

    return sqlOk({ rowsAffected })
  }

  private executeDelete(connection: InternalConnection, parsed: ParsedQuery): SqlResult<QueryResult> {
    if (!parsed.tableName) {
      return sqlErr(SqlErrorCode.SYNTAX_ERROR, 'Invalid DELETE syntax')
    }

    const table = connection.database.tables.get(parsed.tableName)
    if (!table) {
      return sqlErr(SqlErrorCode.NOT_FOUND, `Table '${parsed.tableName}' not found`)
    }

    const originalLength = table.rows.length
    if (parsed.where) {
      table.rows = table.rows.filter((row) => {
        const rowObj: Row = { columns: row }
        return !parsed.where!(rowObj)
      })
    } else {
      table.rows = []
    }

    return sqlOk({ rowsAffected: originalLength - table.rows.length })
  }

  private executeSelectQuery(connection: InternalConnection, parsed: ParsedQuery) {
    if (!parsed.tableName) {
      return sqlErr(SqlErrorCode.SYNTAX_ERROR, 'Invalid SELECT syntax')
    }

    const table = connection.database.tables.get(parsed.tableName)
    if (!table) {
      return sqlErr(SqlErrorCode.NOT_FOUND, `Table '${parsed.tableName}' not found`)
    }

    // Determine columns to return
    const selectColumns = parsed.columns && parsed.columns.length > 0
      ? parsed.columns
      : table.schema.columns.map((c) => c.name)

    const columns: ColumnInfo[] = selectColumns.map((colName) => {
      const schemaCol = table.schema.columns.find((c) => c.name === colName)
      return schemaCol || { name: colName, type: SqlType.TEXT, nullable: true, primaryKey: false }
    })

    // Filter rows
    let rows: Row[] = table.rows
      .filter((row) => {
        const rowObj: Row = { columns: row }
        return !parsed.where || parsed.where(rowObj)
      })
      .map((row) => {
        const filteredColumns = new Map<string, SqlValue>()
        for (const colName of selectColumns) {
          const value = row.get(colName)
          if (value) {
            filteredColumns.set(colName, value)
          }
        }
        return { columns: filteredColumns }
      })

    // Apply OFFSET
    if (parsed.offset) {
      rows = rows.slice(parsed.offset)
    }

    // Apply LIMIT
    if (parsed.limit) {
      rows = rows.slice(0, parsed.limit)
    }

    // Create result set
    const rsHandle = this.nextResultSetHandle++
    const resultSet: InternalResultSet = {
      handle: rsHandle,
      connectionHandle: connection.handle,
      columns,
      rows,
      cursor: 0,
    }

    this.resultSets.set(rsHandle, resultSet)
    return sqlOk(rsHandle)
  }

  // ===========================================================================
  // Prepared Statements
  // ===========================================================================

  private prepare(handle: ConnectionHandle, sql: string) {
    const connection = this.connections.get(handle)
    if (!connection) {
      return sqlErr(SqlErrorCode.CONNECTION_CLOSED, `Connection ${handle} not found`)
    }

    // Extract parameter names
    const parameterNames: string[] = []
    const matches = Array.from(sql.matchAll(/[:@$](\w+)|\?/g))
    for (const match of matches) {
      parameterNames.push(match[1] || `$${parameterNames.length + 1}`)
    }

    const stmtHandle = this.nextStatementHandle++
    const statement: InternalStatement = {
      handle: stmtHandle,
      connectionHandle: handle,
      sql,
      parameterNames,
    }

    this.statements.set(stmtHandle, statement)
    return sqlOk(stmtHandle)
  }

  private executeStatement(handle: StatementHandle, params?: QueryParams) {
    const statement = this.statements.get(handle)
    if (!statement) {
      return sqlErr(SqlErrorCode.INVALID_ARGUMENT, `Statement ${handle} not found`)
    }

    return this.execute(statement.connectionHandle, statement.sql, params)
  }

  private queryStatement(handle: StatementHandle, params?: QueryParams) {
    const statement = this.statements.get(handle)
    if (!statement) {
      return sqlErr(SqlErrorCode.INVALID_ARGUMENT, `Statement ${handle} not found`)
    }

    return this.query(statement.connectionHandle, statement.sql, params)
  }

  private closeStatement(handle: StatementHandle) {
    if (!this.statements.has(handle)) {
      return sqlErr(SqlErrorCode.INVALID_ARGUMENT, `Statement ${handle} not found`)
    }

    this.statements.delete(handle)
    return sqlOk(undefined)
  }

  // ===========================================================================
  // Result Set
  // ===========================================================================

  private getResultInfo(handle: ResultSetHandle): ResultSetInfo | null {
    const resultSet = this.resultSets.get(handle)
    if (!resultSet) {
      return null
    }

    return {
      columns: resultSet.columns,
      rowCount: resultSet.rows.length,
    }
  }

  private fetchRow(handle: ResultSetHandle) {
    const resultSet = this.resultSets.get(handle)
    if (!resultSet) {
      return sqlErr(SqlErrorCode.INVALID_ARGUMENT, `Result set ${handle} not found`)
    }

    if (resultSet.cursor >= resultSet.rows.length) {
      return sqlOk(null) // No more rows
    }

    const row = resultSet.rows[resultSet.cursor]!
    resultSet.cursor++
    return sqlOk(rowToObject(row))
  }

  private fetchAll(handle: ResultSetHandle) {
    const resultSet = this.resultSets.get(handle)
    if (!resultSet) {
      return sqlErr(SqlErrorCode.INVALID_ARGUMENT, `Result set ${handle} not found`)
    }

    const remaining = resultSet.rows.slice(resultSet.cursor)
    resultSet.cursor = resultSet.rows.length
    return sqlOk(remaining.map(rowToObject))
  }

  private closeResult(handle: ResultSetHandle) {
    if (!this.resultSets.has(handle)) {
      return sqlErr(SqlErrorCode.INVALID_ARGUMENT, `Result set ${handle} not found`)
    }

    this.resultSets.delete(handle)
    return sqlOk(undefined)
  }

  // ===========================================================================
  // Transaction Management
  // ===========================================================================

  private beginTransaction(handle: ConnectionHandle, options?: TransactionOptions) {
    const connection = this.connections.get(handle)
    if (!connection) {
      return sqlErr(SqlErrorCode.CONNECTION_CLOSED, `Connection ${handle} not found`)
    }

    if (connection.inTransaction) {
      return sqlErr(SqlErrorCode.TRANSACTION_ERROR, 'Already in a transaction')
    }

    // Create savepoint (deep copy of tables)
    const savepoint: InternalDatabase = {
      name: connection.database.name,
      tables: new Map(),
    }

    connection.database.tables.forEach((table, name) => {
      savepoint.tables.set(name, {
        schema: { ...table.schema },
        rows: table.rows.map((row) => new Map(row)),
        autoIncrement: table.autoIncrement,
      })
    })

    connection.inTransaction = true
    connection.transactionSavepoint = savepoint

    const txHandle = this.nextTransactionHandle++
    const transaction: InternalTransaction = {
      handle: txHandle,
      connectionHandle: handle,
      options: options || {},
      savepoint,
    }

    this.transactions.set(txHandle, transaction)
    return sqlOk(txHandle)
  }

  private commit(handle: TransactionHandle) {
    const transaction = this.transactions.get(handle)
    if (!transaction) {
      return sqlErr(SqlErrorCode.INVALID_ARGUMENT, `Transaction ${handle} not found`)
    }

    const connection = this.connections.get(transaction.connectionHandle)
    if (!connection) {
      return sqlErr(SqlErrorCode.CONNECTION_CLOSED, 'Connection closed')
    }

    connection.inTransaction = false
    connection.transactionSavepoint = undefined

    this.transactions.delete(handle)
    return sqlOk(undefined)
  }

  private rollback(handle: TransactionHandle) {
    const transaction = this.transactions.get(handle)
    if (!transaction) {
      return sqlErr(SqlErrorCode.INVALID_ARGUMENT, `Transaction ${handle} not found`)
    }

    const connection = this.connections.get(transaction.connectionHandle)
    if (!connection) {
      return sqlErr(SqlErrorCode.CONNECTION_CLOSED, 'Connection closed')
    }

    // Restore database state from savepoint
    connection.database.tables = transaction.savepoint.tables

    connection.inTransaction = false
    connection.transactionSavepoint = undefined

    this.transactions.delete(handle)
    return sqlOk(undefined)
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  private listTables(handle: ConnectionHandle): string[] | null {
    const connection = this.connections.get(handle)
    if (!connection) {
      return null
    }

    return Array.from(connection.database.tables.keys())
  }

  private describeTable(handle: ConnectionHandle, tableName: string): ColumnInfo[] | null {
    const connection = this.connections.get(handle)
    if (!connection) {
      return null
    }

    const table = connection.database.tables.get(tableName)
    if (!table) {
      return null
    }

    return table.schema.columns
  }
}

// =============================================================================
// Implementation Export
// =============================================================================

/**
 * In-memory SQL implementation.
 */
export const memorySqlImplementation: Implementation = {
  name: 'memory',
  description: 'In-memory SQL database with basic SQL support',
  create(config: PluginConfig): PluginInstance {
    return new MemorySqlInstance(config as SqlPluginConfig)
  },
}
