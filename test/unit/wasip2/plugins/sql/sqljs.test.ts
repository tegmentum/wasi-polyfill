/**
 * Tests for the real SQLite (sql.js) wasi:sql backend (REMEDIATION-PLAN 3.9).
 *
 * Exercises capabilities the regex `memory` engine cannot do: JOINs, real
 * transactions (commit/rollback), prepared statements, constraints, PRAGMA.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import {
  createSqlJsSql,
  sqljsSqlImplementation,
  DatabaseDriver,
  SqlErrorCode,
  sqlText,
  sqlInteger,
  type ConnectionOptions,
  type QueryParams,
} from '../../../../../src/wasip2/plugins/sql/index.js'

let SQL: SqlJsStatic

beforeAll(async () => {
  SQL = await initSqlJs()
})

type Ok<T> = { ok: true; value: T }
type Res<T> = Ok<T> | { ok: false; error: { code: SqlErrorCode; message: string } }

interface SqlImports {
  open(o: ConnectionOptions): Res<number>
  execute(h: number, sql: string, p?: QueryParams): Res<{ rowsAffected: number; lastInsertId?: number }>
  query(h: number, sql: string, p?: QueryParams): Res<number>
  prepare(h: number, sql: string): Res<number>
  'query-statement'(h: number, p?: QueryParams): Res<number>
  'fetch-all'(h: number): Res<Array<Record<string, unknown>>>
  'begin-transaction'(h: number): Res<number>
  commit(h: number): Res<void>
  rollback(h: number): Res<void>
  'list-tables'(h: number): string[] | null
  'describe-table'(h: number, t: string): unknown
  [k: string]: unknown
}

const SQLITE: ConnectionOptions = {
  driver: DatabaseDriver.SQLITE,
  connectionString: ':memory:',
}

function unwrap<T>(r: Res<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`)
  return r.value
}

describe('sqljs SQL backend', () => {
  let imports: SqlImports
  let conn: number

  beforeEach(() => {
    const { instance } = createSqlJsSql({ sqlJs: SQL })
    imports = instance.getImports() as unknown as SqlImports
    conn = unwrap(imports.open(SQLITE))
    unwrap(
      imports.execute(
        conn,
        'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER)'
      )
    )
  })

  it('reports CONNECTION_FAILED when no sql.js module is provided', () => {
    const { instance } = createSqlJsSql({})
    const imp = instance.getImports() as unknown as SqlImports
    const r = imp.open(SQLITE)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe(SqlErrorCode.CONNECTION_FAILED)
  })

  it('executes inserts and reports rowsAffected + lastInsertId', () => {
    const r = unwrap(
      imports.execute(conn, 'INSERT INTO users (name, age) VALUES (?, ?)', [
        sqlText('Alice'),
        sqlInteger(30),
      ])
    )
    expect(r.rowsAffected).toBe(1)
    expect(r.lastInsertId).toBe(1)
  })

  it('runs a real JOIN (impossible in the regex engine)', () => {
    unwrap(imports.execute(conn, 'CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, total INTEGER)'))
    unwrap(imports.execute(conn, "INSERT INTO users (name, age) VALUES ('Alice', 30)"))
    unwrap(imports.execute(conn, 'INSERT INTO orders (user_id, total) VALUES (1, 99)'))

    const rs = unwrap(
      imports.query(
        conn,
        'SELECT u.name AS name, o.total AS total FROM users u JOIN orders o ON o.user_id = u.id'
      )
    )
    const rows = unwrap(imports['fetch-all'](rs))
    expect(rows).toEqual([{ name: 'Alice', total: 99 }])
  })

  it('enforces NOT NULL constraints', () => {
    const r = imports.execute(conn, 'INSERT INTO users (name) VALUES (NULL)')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe(SqlErrorCode.CONSTRAINT_VIOLATION)
  })

  it('rolls back a transaction (real BEGIN/ROLLBACK)', () => {
    const tx = unwrap(imports['begin-transaction'](conn))
    unwrap(imports.execute(conn, "INSERT INTO users (name) VALUES ('Temp')"))
    unwrap(imports.rollback(tx))

    const rs = unwrap(imports.query(conn, 'SELECT COUNT(*) AS n FROM users'))
    const rows = unwrap(imports['fetch-all'](rs))
    expect(rows[0]!.n).toBe(0)
  })

  it('commits a transaction', () => {
    const tx = unwrap(imports['begin-transaction'](conn))
    unwrap(imports.execute(conn, "INSERT INTO users (name) VALUES ('Keep')"))
    unwrap(imports.commit(tx))

    const rs = unwrap(imports.query(conn, 'SELECT COUNT(*) AS n FROM users'))
    expect(unwrap(imports['fetch-all'](rs))[0]!.n).toBe(1)
  })

  it('supports prepared statements with named params', () => {
    unwrap(imports.execute(conn, "INSERT INTO users (name, age) VALUES ('Bob', 40)"))
    const stmt = unwrap(imports.prepare(conn, 'SELECT name FROM users WHERE age > :min'))
    const params = new Map([['min', sqlInteger(35)]])
    const rs = unwrap(imports['query-statement'](stmt, params))
    expect(unwrap(imports['fetch-all'](rs))).toEqual([{ name: 'Bob' }])
  })

  it('lists tables and describes columns', () => {
    expect(imports['list-tables'](conn)).toContain('users')
    const cols = imports['describe-table'](conn, 'users') as Array<{
      name: string
      primaryKey: boolean
      nullable: boolean
    }>
    const id = cols.find((c) => c.name === 'id')!
    const name = cols.find((c) => c.name === 'name')!
    expect(id.primaryKey).toBe(true)
    expect(name.nullable).toBe(false)
  })

  it('shares connections across separately-created plugin instances', () => {
    // The five wasi:sql interfaces are separate instances; a connection opened
    // on one must resolve on another (shared backend).
    const a = sqljsSqlImplementation.create({ sqlJs: SQL })
    const b = sqljsSqlImplementation.create({ sqlJs: SQL })
    const ia = a.getImports() as unknown as SqlImports
    const ib = b.getImports() as unknown as SqlImports

    const c = unwrap(ia.open({ driver: DatabaseDriver.SQLITE, connectionString: 'shared-db' }))
    unwrap(ia.execute(c, 'CREATE TABLE t (x INTEGER)'))
    unwrap(ib.execute(c, 'INSERT INTO t (x) VALUES (7)'))
    const rs = unwrap(ib.query(c, 'SELECT x FROM t'))
    expect(unwrap(ib['fetch-all'](rs))).toEqual([{ x: 7 }])
  })
})
