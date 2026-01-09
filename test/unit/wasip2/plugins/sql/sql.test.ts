/**
 * wasi:sql plugin tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  memorySqlImplementation,
  DatabaseDriver,
  SqlType,
  SqlErrorCode,
  IsolationLevel,
  sqlText,
  sqlInteger,
  sqlNull,
  type SqlPluginConfig,
  type ConnectionOptions,
  type SqlValue,
  type QueryResult,
  type ColumnInfo,
} from '../../../../../src/wasip2/plugins/sql/index.js'

describe('wasi:sql', () => {
  describe('memorySqlImplementation', () => {
    let instance: ReturnType<typeof memorySqlImplementation.create>
    let imports: Record<string, unknown>

    beforeEach(() => {
      instance = memorySqlImplementation.create({} as SqlPluginConfig)
      imports = instance.getImports()
    })

    afterEach(() => {
      instance.destroy()
    })

    describe('connection management', () => {
      it('should open a connection', () => {
        const open = imports['open'] as (options: ConnectionOptions) => { ok: boolean; value?: number }

        const result = open({
          driver: DatabaseDriver.SQLITE,
          connectionString: ':memory:',
        })

        expect(result.ok).toBe(true)
        expect(result.value).toBeGreaterThan(0)
      })

      it('should get connection info', () => {
        const open = imports['open'] as (options: ConnectionOptions) => { ok: boolean; value?: number }
        const getInfo = imports['get-connection-info'] as (handle: number) => { database: string; inTransaction: boolean } | null

        const result = open({
          driver: DatabaseDriver.SQLITE,
          connectionString: ':memory:',
          database: 'test-db',
        })

        const info = getInfo(result.value!)
        expect(info).not.toBeNull()
        expect(info!.database).toBe('test-db')
        expect(info!.inTransaction).toBe(false)
      })

      it('should close a connection', () => {
        const open = imports['open'] as (options: ConnectionOptions) => { ok: boolean; value?: number }
        const close = imports['close'] as (handle: number) => { ok: boolean }
        const getInfo = imports['get-connection-info'] as (handle: number) => null | object

        const result = open({ driver: DatabaseDriver.SQLITE, connectionString: ':memory:' })
        const closeResult = close(result.value!)

        expect(closeResult.ok).toBe(true)
        expect(getInfo(result.value!)).toBeNull()
      })
    })

    describe('DDL operations', () => {
      let conn: number

      beforeEach(() => {
        const open = imports['open'] as (options: ConnectionOptions) => { ok: boolean; value?: number }
        conn = open({ driver: DatabaseDriver.SQLITE, connectionString: ':memory:' }).value!
      })

      afterEach(() => {
        const close = imports['close'] as (handle: number) => void
        close(conn)
      })

      it('should create a table', () => {
        const execute = imports['execute'] as (handle: number, sql: string) => { ok: boolean; value?: QueryResult }

        const result = execute(conn, `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT
          )
        `)

        expect(result.ok).toBe(true)
        expect(result.value!.rowsAffected).toBe(0)
      })

      it('should list tables', () => {
        const execute = imports['execute'] as (handle: number, sql: string) => { ok: boolean }
        const listTables = imports['list-tables'] as (handle: number) => string[] | null

        execute(conn, 'CREATE TABLE users (id INTEGER PRIMARY KEY)')
        execute(conn, 'CREATE TABLE posts (id INTEGER PRIMARY KEY)')

        const tables = listTables(conn)
        expect(tables).toContain('users')
        expect(tables).toContain('posts')
      })

      it('should describe a table', () => {
        const execute = imports['execute'] as (handle: number, sql: string) => { ok: boolean }
        const describeTable = imports['describe-table'] as (handle: number, name: string) => ColumnInfo[] | null

        execute(conn, 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')

        const columns = describeTable(conn, 'users')
        expect(columns).not.toBeNull()
        expect(columns!.length).toBe(2)
        expect(columns![0]!.name).toBe('id')
        expect(columns![0]!.type).toBe(SqlType.INTEGER)
        expect(columns![1]!.name).toBe('name')
        expect(columns![1]!.type).toBe(SqlType.TEXT)
      })

      it('should drop a table', () => {
        const execute = imports['execute'] as (handle: number, sql: string) => { ok: boolean }
        const listTables = imports['list-tables'] as (handle: number) => string[]

        execute(conn, 'CREATE TABLE temp_table (id INTEGER)')
        expect(listTables(conn)).toContain('temp_table')

        execute(conn, 'DROP TABLE temp_table')
        expect(listTables(conn)).not.toContain('temp_table')
      })

      it('should fail to create duplicate table', () => {
        const execute = imports['execute'] as (handle: number, sql: string) => { ok: boolean; error?: { code: string } }

        execute(conn, 'CREATE TABLE dup (id INTEGER)')
        const result = execute(conn, 'CREATE TABLE dup (id INTEGER)')

        expect(result.ok).toBe(false)
        expect(result.error?.code).toBe(SqlErrorCode.CONSTRAINT_VIOLATION)
      })
    })

    describe('INSERT operations', () => {
      let conn: number

      beforeEach(() => {
        const open = imports['open'] as (options: ConnectionOptions) => { ok: boolean; value?: number }
        const execute = imports['execute'] as (handle: number, sql: string) => void
        conn = open({ driver: DatabaseDriver.SQLITE, connectionString: ':memory:' }).value!
        execute(conn, 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
      })

      it('should insert a row', () => {
        const execute = imports['execute'] as (handle: number, sql: string) => { ok: boolean; value?: QueryResult }

        const result = execute(conn, "INSERT INTO users (name, age) VALUES ('Alice', 30)")

        expect(result.ok).toBe(true)
        expect(result.value!.rowsAffected).toBe(1)
      })

      it('should insert multiple rows', () => {
        const execute = imports['execute'] as (handle: number, sql: string) => { ok: boolean; value?: QueryResult }

        const result = execute(conn, "INSERT INTO users (name, age) VALUES ('Alice', 30), ('Bob', 25)")

        expect(result.ok).toBe(true)
        expect(result.value!.rowsAffected).toBe(2)
      })

      it('should insert with parameters', () => {
        const execute = imports['execute'] as (handle: number, sql: string, params?: SqlValue[]) => { ok: boolean; value?: QueryResult }

        const result = execute(conn, 'INSERT INTO users (name, age) VALUES (?, ?)', [
          sqlText('Charlie'),
          sqlInteger(35),
        ])

        expect(result.ok).toBe(true)
        expect(result.value!.rowsAffected).toBe(1)
      })

      it('should auto-increment primary key', () => {
        const execute = imports['execute'] as (handle: number, sql: string) => { ok: boolean; value?: QueryResult }

        const result1 = execute(conn, "INSERT INTO users (name, age) VALUES ('Alice', 30)")
        const result2 = execute(conn, "INSERT INTO users (name, age) VALUES ('Bob', 25)")

        expect(result1.value!.lastInsertId).toBe(1)
        expect(result2.value!.lastInsertId).toBe(2)
      })
    })

    describe('SELECT operations', () => {
      let conn: number

      beforeEach(() => {
        const open = imports['open'] as (options: ConnectionOptions) => { ok: boolean; value?: number }
        const execute = imports['execute'] as (handle: number, sql: string) => void
        conn = open({ driver: DatabaseDriver.SQLITE, connectionString: ':memory:' }).value!
        execute(conn, 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
        execute(conn, "INSERT INTO users (name, age) VALUES ('Alice', 30), ('Bob', 25), ('Charlie', 35)")
      })

      it('should select all rows', () => {
        const query = imports['query'] as (handle: number, sql: string) => { ok: boolean; value?: number }
        const fetchAll = imports['fetch-all'] as (handle: number) => { ok: boolean; value?: Record<string, unknown>[] }

        const result = query(conn, 'SELECT * FROM users')
        expect(result.ok).toBe(true)

        const rows = fetchAll(result.value!)
        expect(rows.ok).toBe(true)
        expect(rows.value!.length).toBe(3)
      })

      it('should select specific columns', () => {
        const query = imports['query'] as (handle: number, sql: string) => { ok: boolean; value?: number }
        const fetchAll = imports['fetch-all'] as (handle: number) => { ok: boolean; value?: Record<string, unknown>[] }

        const result = query(conn, 'SELECT name, age FROM users')
        const rows = fetchAll(result.value!)

        expect(rows.value![0]).toHaveProperty('name')
        expect(rows.value![0]).toHaveProperty('age')
        expect(rows.value![0]).not.toHaveProperty('id')
      })

      it('should filter with WHERE clause', () => {
        const query = imports['query'] as (handle: number, sql: string) => { ok: boolean; value?: number }
        const fetchAll = imports['fetch-all'] as (handle: number) => { ok: boolean; value?: Record<string, unknown>[] }

        const result = query(conn, 'SELECT * FROM users WHERE age > 25')
        const rows = fetchAll(result.value!)

        expect(rows.value!.length).toBe(2)
        expect(rows.value!.every((r) => (r.age as number) > 25)).toBe(true)
      })

      it('should filter with equality', () => {
        const query = imports['query'] as (handle: number, sql: string) => { ok: boolean; value?: number }
        const fetchAll = imports['fetch-all'] as (handle: number) => { ok: boolean; value?: Record<string, unknown>[] }

        const result = query(conn, "SELECT * FROM users WHERE name = 'Alice'")
        const rows = fetchAll(result.value!)

        expect(rows.value!.length).toBe(1)
        expect(rows.value![0]!.name).toBe('Alice')
      })

      it('should support LIMIT', () => {
        const query = imports['query'] as (handle: number, sql: string) => { ok: boolean; value?: number }
        const fetchAll = imports['fetch-all'] as (handle: number) => { ok: boolean; value?: Record<string, unknown>[] }

        const result = query(conn, 'SELECT * FROM users LIMIT 2')
        const rows = fetchAll(result.value!)

        expect(rows.value!.length).toBe(2)
      })

      it('should fetch row by row', () => {
        const query = imports['query'] as (handle: number, sql: string) => { ok: boolean; value?: number }
        const fetchRow = imports['fetch-row'] as (handle: number) => { ok: boolean; value?: Record<string, unknown> | null }

        const result = query(conn, 'SELECT * FROM users')

        const row1 = fetchRow(result.value!)
        expect(row1.ok).toBe(true)
        expect(row1.value).not.toBeNull()

        const row2 = fetchRow(result.value!)
        expect(row2.ok).toBe(true)
        expect(row2.value).not.toBeNull()

        const row3 = fetchRow(result.value!)
        expect(row3.ok).toBe(true)
        expect(row3.value).not.toBeNull()

        const row4 = fetchRow(result.value!)
        expect(row4.ok).toBe(true)
        expect(row4.value).toBeNull() // No more rows
      })

      it('should get result info', () => {
        const query = imports['query'] as (handle: number, sql: string) => { ok: boolean; value?: number }
        const getResultInfo = imports['get-result-info'] as (handle: number) => { columns: ColumnInfo[]; rowCount?: number } | null

        const result = query(conn, 'SELECT * FROM users')
        const info = getResultInfo(result.value!)

        expect(info).not.toBeNull()
        expect(info!.columns.length).toBe(3)
        expect(info!.rowCount).toBe(3)
      })

      it('should close result set', () => {
        const query = imports['query'] as (handle: number, sql: string) => { ok: boolean; value?: number }
        const closeResult = imports['close-result'] as (handle: number) => { ok: boolean }
        const getResultInfo = imports['get-result-info'] as (handle: number) => null | object

        const result = query(conn, 'SELECT * FROM users')
        closeResult(result.value!)

        expect(getResultInfo(result.value!)).toBeNull()
      })
    })

    describe('UPDATE operations', () => {
      let conn: number

      beforeEach(() => {
        const open = imports['open'] as (options: ConnectionOptions) => { ok: boolean; value?: number }
        const execute = imports['execute'] as (handle: number, sql: string) => void
        conn = open({ driver: DatabaseDriver.SQLITE, connectionString: ':memory:' }).value!
        execute(conn, 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
        execute(conn, "INSERT INTO users (name, age) VALUES ('Alice', 30), ('Bob', 25)")
      })

      it('should update all rows', () => {
        const execute = imports['execute'] as (handle: number, sql: string) => { ok: boolean; value?: QueryResult }
        const query = imports['query'] as (handle: number, sql: string) => { ok: boolean; value?: number }
        const fetchAll = imports['fetch-all'] as (handle: number) => { ok: boolean; value?: Record<string, unknown>[] }

        const result = execute(conn, 'UPDATE users SET age = 40')
        expect(result.ok).toBe(true)
        expect(result.value!.rowsAffected).toBe(2)

        const rows = fetchAll(query(conn, 'SELECT * FROM users').value!)
        expect(rows.value!.every((r) => r.age === 40)).toBe(true)
      })

      it('should update with WHERE clause', () => {
        const execute = imports['execute'] as (handle: number, sql: string) => { ok: boolean; value?: QueryResult }
        const query = imports['query'] as (handle: number, sql: string) => { ok: boolean; value?: number }
        const fetchAll = imports['fetch-all'] as (handle: number) => { ok: boolean; value?: Record<string, unknown>[] }

        const result = execute(conn, "UPDATE users SET age = 35 WHERE name = 'Alice'")
        expect(result.value!.rowsAffected).toBe(1)

        const rows = fetchAll(query(conn, "SELECT * FROM users WHERE name = 'Alice'").value!)
        expect(rows.value![0]!.age).toBe(35)
      })
    })

    describe('DELETE operations', () => {
      let conn: number

      beforeEach(() => {
        const open = imports['open'] as (options: ConnectionOptions) => { ok: boolean; value?: number }
        const execute = imports['execute'] as (handle: number, sql: string) => void
        conn = open({ driver: DatabaseDriver.SQLITE, connectionString: ':memory:' }).value!
        execute(conn, 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
        execute(conn, "INSERT INTO users (name) VALUES ('Alice'), ('Bob'), ('Charlie')")
      })

      it('should delete all rows', () => {
        const execute = imports['execute'] as (handle: number, sql: string) => { ok: boolean; value?: QueryResult }
        const query = imports['query'] as (handle: number, sql: string) => { ok: boolean; value?: number }
        const fetchAll = imports['fetch-all'] as (handle: number) => { ok: boolean; value?: Record<string, unknown>[] }

        const result = execute(conn, 'DELETE FROM users')
        expect(result.value!.rowsAffected).toBe(3)

        const rows = fetchAll(query(conn, 'SELECT * FROM users').value!)
        expect(rows.value!.length).toBe(0)
      })

      it('should delete with WHERE clause', () => {
        const execute = imports['execute'] as (handle: number, sql: string) => { ok: boolean; value?: QueryResult }
        const query = imports['query'] as (handle: number, sql: string) => { ok: boolean; value?: number }
        const fetchAll = imports['fetch-all'] as (handle: number) => { ok: boolean; value?: Record<string, unknown>[] }

        const result = execute(conn, "DELETE FROM users WHERE name = 'Bob'")
        expect(result.value!.rowsAffected).toBe(1)

        const rows = fetchAll(query(conn, 'SELECT * FROM users').value!)
        expect(rows.value!.length).toBe(2)
        expect(rows.value!.some((r) => r.name === 'Bob')).toBe(false)
      })
    })

    describe('prepared statements', () => {
      let conn: number

      beforeEach(() => {
        const open = imports['open'] as (options: ConnectionOptions) => { ok: boolean; value?: number }
        const execute = imports['execute'] as (handle: number, sql: string) => void
        conn = open({ driver: DatabaseDriver.SQLITE, connectionString: ':memory:' }).value!
        execute(conn, 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
      })

      it('should prepare a statement', () => {
        const prepare = imports['prepare'] as (handle: number, sql: string) => { ok: boolean; value?: number }

        const result = prepare(conn, 'INSERT INTO users (name, age) VALUES (?, ?)')
        expect(result.ok).toBe(true)
        expect(result.value).toBeGreaterThan(0)
      })

      it('should execute prepared statement', () => {
        const prepare = imports['prepare'] as (handle: number, sql: string) => { ok: boolean; value?: number }
        const executeStatement = imports['execute-statement'] as (handle: number, params?: SqlValue[]) => { ok: boolean; value?: QueryResult }

        const stmt = prepare(conn, 'INSERT INTO users (name, age) VALUES (?, ?)').value!

        executeStatement(stmt, [sqlText('Alice'), sqlInteger(30)])
        executeStatement(stmt, [sqlText('Bob'), sqlInteger(25)])

        const query = imports['query'] as (handle: number, sql: string) => { ok: boolean; value?: number }
        const fetchAll = imports['fetch-all'] as (handle: number) => { ok: boolean; value?: Record<string, unknown>[] }

        const rows = fetchAll(query(conn, 'SELECT * FROM users').value!)
        expect(rows.value!.length).toBe(2)
      })

      it('should query with prepared statement', () => {
        const execute = imports['execute'] as (handle: number, sql: string) => void
        const prepare = imports['prepare'] as (handle: number, sql: string) => { ok: boolean; value?: number }
        const queryStatement = imports['query-statement'] as (handle: number, params?: SqlValue[]) => { ok: boolean; value?: number }
        const fetchAll = imports['fetch-all'] as (handle: number) => { ok: boolean; value?: Record<string, unknown>[] }

        execute(conn, "INSERT INTO users (name, age) VALUES ('Alice', 30), ('Bob', 25)")

        const stmt = prepare(conn, 'SELECT * FROM users WHERE age > ?').value!
        const result = queryStatement(stmt, [sqlInteger(27)])

        const rows = fetchAll(result.value!)
        expect(rows.value!.length).toBe(1)
        expect(rows.value![0]!.name).toBe('Alice')
      })

      it('should close statement', () => {
        const prepare = imports['prepare'] as (handle: number, sql: string) => { ok: boolean; value?: number }
        const closeStatement = imports['close-statement'] as (handle: number) => { ok: boolean }
        const executeStatement = imports['execute-statement'] as (handle: number, params?: SqlValue[]) => { ok: boolean; error?: { code: string } }

        const stmt = prepare(conn, 'INSERT INTO users (name, age) VALUES (?, ?)').value!
        closeStatement(stmt)

        const result = executeStatement(stmt, [sqlText('Test'), sqlInteger(1)])
        expect(result.ok).toBe(false)
        expect(result.error?.code).toBe(SqlErrorCode.INVALID_ARGUMENT)
      })
    })

    describe('transactions', () => {
      let conn: number

      beforeEach(() => {
        const open = imports['open'] as (options: ConnectionOptions) => { ok: boolean; value?: number }
        const execute = imports['execute'] as (handle: number, sql: string) => void
        conn = open({ driver: DatabaseDriver.SQLITE, connectionString: ':memory:' }).value!
        execute(conn, 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      })

      it('should begin and commit transaction', () => {
        const beginTransaction = imports['begin-transaction'] as (handle: number) => { ok: boolean; value?: number }
        const commit = imports['commit'] as (handle: number) => { ok: boolean }
        const execute = imports['execute'] as (handle: number, sql: string) => void
        const getInfo = imports['get-connection-info'] as (handle: number) => { inTransaction: boolean }

        const tx = beginTransaction(conn)
        expect(tx.ok).toBe(true)
        expect(getInfo(conn).inTransaction).toBe(true)

        execute(conn, "INSERT INTO users (name) VALUES ('Alice')")

        const commitResult = commit(tx.value!)
        expect(commitResult.ok).toBe(true)
        expect(getInfo(conn).inTransaction).toBe(false)
      })

      it('should rollback transaction', () => {
        const beginTransaction = imports['begin-transaction'] as (handle: number) => { ok: boolean; value?: number }
        const rollback = imports['rollback'] as (handle: number) => { ok: boolean }
        const execute = imports['execute'] as (handle: number, sql: string) => void
        const query = imports['query'] as (handle: number, sql: string) => { ok: boolean; value?: number }
        const fetchAll = imports['fetch-all'] as (handle: number) => { ok: boolean; value?: Record<string, unknown>[] }

        execute(conn, "INSERT INTO users (name) VALUES ('Before')")

        const tx = beginTransaction(conn)
        execute(conn, "INSERT INTO users (name) VALUES ('During')")

        // Check that data is there before rollback
        let rows = fetchAll(query(conn, 'SELECT * FROM users').value!)
        expect(rows.value!.length).toBe(2)

        rollback(tx.value!)

        // After rollback, only the first insert should remain
        rows = fetchAll(query(conn, 'SELECT * FROM users').value!)
        expect(rows.value!.length).toBe(1)
        expect(rows.value![0]!.name).toBe('Before')
      })

      it('should fail to begin nested transaction', () => {
        const beginTransaction = imports['begin-transaction'] as (handle: number) => { ok: boolean; error?: { code: string } }
        const commit = imports['commit'] as (handle: number) => void

        const tx1 = beginTransaction(conn)
        expect(tx1.ok).toBe(true)

        const tx2 = beginTransaction(conn)
        expect(tx2.ok).toBe(false)
        expect(tx2.error?.code).toBe(SqlErrorCode.TRANSACTION_ERROR)

        commit(tx1.value!)
      })
    })
  })
})
