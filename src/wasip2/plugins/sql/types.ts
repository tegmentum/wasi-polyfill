/**
 * wasi:sql type definitions
 *
 * Types for database access operations supporting:
 * - Connection management
 * - Query execution (SELECT, INSERT, UPDATE, DELETE)
 * - Prepared statements with parameter binding
 * - Transactions with savepoints
 * - Result set iteration
 */

import { type Result, ok, err } from '../../../shared/result.js'

// =============================================================================
// Handle Types
// =============================================================================

/**
 * Handle to a database connection.
 */
export type ConnectionHandle = number

/**
 * Handle to a prepared statement.
 */
export type StatementHandle = number

/**
 * Handle to a result set from a query.
 */
export type ResultSetHandle = number

/**
 * Handle to a transaction.
 */
export type TransactionHandle = number

// =============================================================================
// Value Types
// =============================================================================

/**
 * SQL value types.
 */
export enum SqlType {
  /** NULL value */
  NULL = 'null',
  /** Boolean value */
  BOOLEAN = 'boolean',
  /** 32-bit integer */
  INTEGER = 'integer',
  /** 64-bit integer */
  BIGINT = 'bigint',
  /** 64-bit floating point */
  REAL = 'real',
  /** Text/string value */
  TEXT = 'text',
  /** Binary data (BLOB) */
  BLOB = 'blob',
  /** Date value (ISO 8601 string) */
  DATE = 'date',
  /** Time value (ISO 8601 string) */
  TIME = 'time',
  /** Timestamp value (ISO 8601 string) */
  TIMESTAMP = 'timestamp',
  /** JSON value (stored as text) */
  JSON = 'json',
}

/**
 * A SQL value with type information.
 */
export type SqlValue =
  | { type: SqlType.NULL }
  | { type: SqlType.BOOLEAN; value: boolean }
  | { type: SqlType.INTEGER; value: number }
  | { type: SqlType.BIGINT; value: bigint }
  | { type: SqlType.REAL; value: number }
  | { type: SqlType.TEXT; value: string }
  | { type: SqlType.BLOB; value: Uint8Array }
  | { type: SqlType.DATE; value: string }
  | { type: SqlType.TIME; value: string }
  | { type: SqlType.TIMESTAMP; value: string }
  | { type: SqlType.JSON; value: string }

/**
 * Create a NULL value.
 */
export function sqlNull(): SqlValue {
  return { type: SqlType.NULL }
}

/**
 * Create a boolean value.
 */
export function sqlBoolean(value: boolean): SqlValue {
  return { type: SqlType.BOOLEAN, value }
}

/**
 * Create an integer value.
 */
export function sqlInteger(value: number): SqlValue {
  return { type: SqlType.INTEGER, value: Math.trunc(value) }
}

/**
 * Create a bigint value.
 */
export function sqlBigint(value: bigint): SqlValue {
  return { type: SqlType.BIGINT, value }
}

/**
 * Create a real (float) value.
 */
export function sqlReal(value: number): SqlValue {
  return { type: SqlType.REAL, value }
}

/**
 * Create a text value.
 */
export function sqlText(value: string): SqlValue {
  return { type: SqlType.TEXT, value }
}

/**
 * Create a blob value.
 */
export function sqlBlob(value: Uint8Array): SqlValue {
  return { type: SqlType.BLOB, value }
}

/**
 * Create a JSON value.
 */
export function sqlJson(value: unknown): SqlValue {
  return { type: SqlType.JSON, value: JSON.stringify(value) }
}

/**
 * Extract the raw value from a SqlValue.
 */
export function extractValue(sqlValue: SqlValue): unknown {
  if (sqlValue.type === SqlType.NULL) {
    return null
  }
  if (sqlValue.type === SqlType.JSON) {
    try {
      return JSON.parse(sqlValue.value)
    } catch {
      return sqlValue.value
    }
  }
  return sqlValue.value
}

// =============================================================================
// Column Types
// =============================================================================

/**
 * Column metadata.
 */
export interface ColumnInfo {
  /** Column name */
  name: string
  /** Column type */
  type: SqlType
  /** Whether the column is nullable */
  nullable: boolean
  /** Whether this is a primary key column */
  primaryKey: boolean
  /** Default value (as string) */
  defaultValue?: string
}

/**
 * A row of data.
 */
export interface Row {
  /** Column values indexed by column name */
  columns: Map<string, SqlValue>
}

/**
 * Create a row from an object.
 */
export function rowFromObject(obj: Record<string, unknown>): Row {
  const columns = new Map<string, SqlValue>()
  for (const [key, value] of Object.entries(obj)) {
    columns.set(key, valueToSqlValue(value))
  }
  return { columns }
}

/**
 * Convert a row to a plain object.
 */
export function rowToObject(row: Row): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  row.columns.forEach((value, key) => {
    obj[key] = extractValue(value)
  })
  return obj
}

/**
 * Convert a JavaScript value to SqlValue.
 */
export function valueToSqlValue(value: unknown): SqlValue {
  if (value === null || value === undefined) {
    return sqlNull()
  }
  if (typeof value === 'boolean') {
    return sqlBoolean(value)
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return sqlInteger(value)
    }
    return sqlReal(value)
  }
  if (typeof value === 'bigint') {
    return sqlBigint(value)
  }
  if (typeof value === 'string') {
    return sqlText(value)
  }
  if (value instanceof Uint8Array) {
    return sqlBlob(value)
  }
  if (value instanceof Date) {
    return { type: SqlType.TIMESTAMP, value: value.toISOString() }
  }
  // Default to JSON for complex objects
  return sqlJson(value)
}

// =============================================================================
// Query Types
// =============================================================================

/**
 * Query parameters - can be positional or named.
 */
export type QueryParams = SqlValue[] | Map<string, SqlValue>

/**
 * Query result with affected rows count.
 */
export interface QueryResult {
  /** Number of rows affected (for INSERT/UPDATE/DELETE) */
  rowsAffected: number
  /** Last inserted row ID (if applicable) */
  lastInsertId?: number | bigint
}

/**
 * Result set metadata.
 */
export interface ResultSetInfo {
  /** Column information */
  columns: ColumnInfo[]
  /** Total row count (if known) */
  rowCount?: number
}

// =============================================================================
// Connection Types
// =============================================================================

/**
 * Database driver type.
 */
export enum DatabaseDriver {
  /** SQLite (in-memory or file-based) */
  SQLITE = 'sqlite',
  /** PostgreSQL */
  POSTGRESQL = 'postgresql',
  /** MySQL/MariaDB */
  MYSQL = 'mysql',
  /** Generic SQL (for mock/testing) */
  GENERIC = 'generic',
}

/**
 * Connection options.
 */
export interface ConnectionOptions {
  /** Database driver */
  driver: DatabaseDriver
  /** Connection string or database path */
  connectionString: string
  /** Database name (if not in connection string) */
  database?: string
  /** Username (if not in connection string) */
  username?: string
  /** Password (if not in connection string) */
  password?: string
  /** Connection timeout in milliseconds */
  timeout?: number
  /** Read-only mode */
  readOnly?: boolean
  /** Maximum number of connections in pool */
  poolSize?: number
}

/**
 * Connection information.
 */
export interface ConnectionInfo {
  /** Connection handle */
  handle: ConnectionHandle
  /** Database driver */
  driver: DatabaseDriver
  /** Database name */
  database: string
  /** Whether connection is read-only */
  readOnly: boolean
  /** Whether connection is in a transaction */
  inTransaction: boolean
}

// =============================================================================
// Transaction Types
// =============================================================================

/**
 * Transaction isolation level.
 */
export enum IsolationLevel {
  /** Read uncommitted (dirty reads allowed) */
  READ_UNCOMMITTED = 'read-uncommitted',
  /** Read committed (no dirty reads) */
  READ_COMMITTED = 'read-committed',
  /** Repeatable read (no non-repeatable reads) */
  REPEATABLE_READ = 'repeatable-read',
  /** Serializable (strongest isolation) */
  SERIALIZABLE = 'serializable',
}

/**
 * Transaction options.
 */
export interface TransactionOptions {
  /** Isolation level */
  isolationLevel?: IsolationLevel
  /** Read-only transaction */
  readOnly?: boolean
  /** Transaction timeout in milliseconds */
  timeout?: number
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * wasi:sql error codes.
 */
export enum SqlErrorCode {
  /** Successful operation */
  SUCCESS = 'success',
  /** Connection failed */
  CONNECTION_FAILED = 'connection-failed',
  /** Connection closed */
  CONNECTION_CLOSED = 'connection-closed',
  /** Syntax error in SQL */
  SYNTAX_ERROR = 'syntax-error',
  /** Constraint violation (unique, foreign key, etc.) */
  CONSTRAINT_VIOLATION = 'constraint-violation',
  /** Table or column not found */
  NOT_FOUND = 'not-found',
  /** Permission denied */
  PERMISSION_DENIED = 'permission-denied',
  /** Transaction error */
  TRANSACTION_ERROR = 'transaction-error',
  /** Type mismatch */
  TYPE_ERROR = 'type-error',
  /** Operation timeout */
  TIMEOUT = 'timeout',
  /** Invalid argument */
  INVALID_ARGUMENT = 'invalid-argument',
  /** Resource busy */
  BUSY = 'busy',
  /** Unknown error */
  UNKNOWN = 'unknown',
}

/**
 * SQL error with details.
 */
export interface SqlError {
  code: SqlErrorCode
  message: string
  /** SQL state (if available) */
  sqlState?: string
  /** Vendor-specific error code */
  vendorCode?: number
}

/**
 * Create a SqlError.
 */
export function createSqlError(code: SqlErrorCode, message: string): SqlError {
  return { code, message }
}

// =============================================================================
// Result Type
// =============================================================================

/**
 * Result type for operations that can fail.
 */
export type SqlResult<T> = Result<T, SqlError>

/**
 * Create a successful result. Thin wrapper over the shared {@link ok}.
 */
export function sqlOk<T>(value: T): SqlResult<T> {
  return ok(value)
}

/**
 * Create an error result (bundles error construction over the shared {@link err}).
 */
export function sqlErr<T>(code: SqlErrorCode, message: string): SqlResult<T> {
  return err(createSqlError(code, message))
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * SQL plugin configuration.
 */
export interface SqlPluginConfig {
  /** Default connection options */
  defaultConnection?: ConnectionOptions
  /** Maximum number of connections */
  maxConnections?: number
  /** Maximum number of statements per connection */
  maxStatements?: number
  /** Query timeout in milliseconds */
  queryTimeout?: number
  /** Enable query logging */
  enableLogging?: boolean
}
