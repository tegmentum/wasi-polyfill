/**
 * wasi:sql plugin definitions
 *
 * Defines the plugin interfaces for database access.
 *
 * Interfaces:
 * - wasi:sql/types - Type definitions
 * - wasi:sql/connection - Connection management
 * - wasi:sql/query - Query execution
 * - wasi:sql/statement - Prepared statements
 * - wasi:sql/transaction - Transaction management
 *
 * Implementations:
 * - memory: In-memory toy engine (dev/testing; limited SQL subset)
 * - sqljs: Real SQLite via sql.js (host provides the initialized module)
 */

import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import { memorySqlImplementation } from './impl-memory.js'
import { sqljsSqlImplementation } from './impl-sqljs.js'

/**
 * WASI sql types interface definition
 */
export const SQL_TYPES_INTERFACE: WasiInterface = {
  package: 'wasi:sql',
  name: 'types',
  version: '0.2.0-draft',
}

/**
 * WASI sql connection interface definition
 */
export const SQL_CONNECTION_INTERFACE: WasiInterface = {
  package: 'wasi:sql',
  name: 'connection',
  version: '0.2.0-draft',
}

/**
 * WASI sql query interface definition
 */
export const SQL_QUERY_INTERFACE: WasiInterface = {
  package: 'wasi:sql',
  name: 'query',
  version: '0.2.0-draft',
}

/**
 * WASI sql statement interface definition
 */
export const SQL_STATEMENT_INTERFACE: WasiInterface = {
  package: 'wasi:sql',
  name: 'statement',
  version: '0.2.0-draft',
}

/**
 * WASI sql transaction interface definition
 */
export const SQL_TRANSACTION_INTERFACE: WasiInterface = {
  package: 'wasi:sql',
  name: 'transaction',
  version: '0.2.0-draft',
}

/**
 * wasi:sql/types plugin
 *
 * Provides type definitions for SQL operations.
 */
export const sqlTypesPlugin: WasiPlugin = createPlugin(
  SQL_TYPES_INTERFACE,
  {
    memory: memorySqlImplementation,
    sqljs: sqljsSqlImplementation,
  },
  'memory'
)

/**
 * wasi:sql/connection plugin
 *
 * Provides database connection management.
 *
 * Implementations:
 * - memory: In-memory database (default)
 */
export const sqlConnectionPlugin: WasiPlugin = createPlugin(
  SQL_CONNECTION_INTERFACE,
  {
    memory: memorySqlImplementation,
    sqljs: sqljsSqlImplementation,
  },
  'memory'
)

/**
 * wasi:sql/query plugin
 *
 * Provides query execution capabilities.
 *
 * Implementations:
 * - memory: In-memory database (default)
 */
export const sqlQueryPlugin: WasiPlugin = createPlugin(
  SQL_QUERY_INTERFACE,
  {
    memory: memorySqlImplementation,
    sqljs: sqljsSqlImplementation,
  },
  'memory'
)

/**
 * wasi:sql/statement plugin
 *
 * Provides prepared statement support.
 *
 * Implementations:
 * - memory: In-memory database (default)
 */
export const sqlStatementPlugin: WasiPlugin = createPlugin(
  SQL_STATEMENT_INTERFACE,
  {
    memory: memorySqlImplementation,
    sqljs: sqljsSqlImplementation,
  },
  'memory'
)

/**
 * wasi:sql/transaction plugin
 *
 * Provides transaction management.
 *
 * Implementations:
 * - memory: In-memory database (default)
 */
export const sqlTransactionPlugin: WasiPlugin = createPlugin(
  SQL_TRANSACTION_INTERFACE,
  {
    memory: memorySqlImplementation,
    sqljs: sqljsSqlImplementation,
  },
  'memory'
)

/**
 * All sql plugins for convenient registration
 */
export const sqlPlugins: WasiPlugin[] = [
  sqlTypesPlugin,
  sqlConnectionPlugin,
  sqlQueryPlugin,
  sqlStatementPlugin,
  sqlTransactionPlugin,
]
