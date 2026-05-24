/**
 * wasi:sql plugin
 *
 * Provides SQL database access for WebAssembly components.
 *
 * Interfaces:
 * - wasi:sql/types - Type definitions
 * - wasi:sql/connection - Connection management
 * - wasi:sql/query - Query execution
 * - wasi:sql/statement - Prepared statements
 * - wasi:sql/transaction - Transaction management
 *
 * Implementations:
 * - memory: In-memory toy engine (default; dev/testing, limited SQL subset)
 * - sqljs: Real SQLite via sql.js (host provides the initialized module)
 *
 * @example
 * ```typescript
 * import { sqlPlugins, DatabaseDriver } from '@tegmentum/wasi-polyfill/wasip2/plugins/sql'
 *
 * // Register plugins
 * for (const plugin of sqlPlugins) {
 *   registry.register(plugin)
 * }
 *
 * // Create instance and use
 * const instance = sqlConnectionPlugin.create({ implementation: 'memory' })
 * const imports = instance.getImports()
 *
 * // Open connection
 * const conn = imports['open']({ driver: DatabaseDriver.SQLITE, connectionString: ':memory:' })
 *
 * // Execute queries
 * imports['execute'](conn.value, 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
 * imports['execute'](conn.value, 'INSERT INTO users (name) VALUES (?)', [sqlText('Alice')])
 * ```
 */

// Type exports
export {
  // Handle types
  type ConnectionHandle,
  type StatementHandle,
  type ResultSetHandle,
  type TransactionHandle,

  // Value types
  SqlType,
  type SqlValue,
  sqlNull,
  sqlBoolean,
  sqlInteger,
  sqlBigint,
  sqlReal,
  sqlText,
  sqlBlob,
  sqlJson,
  extractValue,
  valueToSqlValue,

  // Column/Row types
  type ColumnInfo,
  type Row,
  rowFromObject,
  rowToObject,

  // Query types
  type QueryParams,
  type QueryResult,
  type ResultSetInfo,

  // Connection types
  DatabaseDriver,
  type ConnectionOptions,
  type ConnectionInfo,

  // Transaction types
  IsolationLevel,
  type TransactionOptions,

  // Error types
  SqlErrorCode,
  type SqlError,
  createSqlError,

  // Result types
  type SqlResult,
  sqlOk,
  sqlErr,

  // Config types
  type SqlPluginConfig,
} from './types.js'

// Plugin definitions and interfaces
export {
  sqlTypesPlugin,
  sqlConnectionPlugin,
  sqlQueryPlugin,
  sqlStatementPlugin,
  sqlTransactionPlugin,
  sqlPlugins,
  SQL_TYPES_INTERFACE,
  SQL_CONNECTION_INTERFACE,
  SQL_QUERY_INTERFACE,
  SQL_STATEMENT_INTERFACE,
  SQL_TRANSACTION_INTERFACE,
} from './plugin.js'

// Memory implementation
export { memorySqlImplementation } from './impl-memory.js'

// Real SQLite implementation (sql.js)
export {
  sqljsSqlImplementation,
  SqlJsBackend,
  createSqlJsSql,
  type SqlJsConfig,
} from './impl-sqljs.js'
