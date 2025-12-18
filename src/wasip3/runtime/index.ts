/**
 * WASI Preview 3 runtime components
 *
 * @packageDocumentation
 */

export {
  AsyncExecutor,
  runAsync,
  eventLoop,
  type AsyncExecutorConfig,
  type AsyncCaller,
  type ExecuteResult,
} from './async-executor.js'

export {
  Wasip3ComponentLoader,
  runComponent,
  runComponentFromUrl,
  type Wasip3LoaderConfig,
  type Wasip3ComponentInstance,
} from './component-loader.js'
