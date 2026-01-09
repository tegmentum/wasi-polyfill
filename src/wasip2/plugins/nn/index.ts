/**
 * wasi:nn plugin
 *
 * Provides neural network inference capabilities for WebAssembly components.
 *
 * Interfaces:
 * - wasi:nn/tensor - Tensor type definitions
 * - wasi:nn/graph - Graph loading and management
 * - wasi:nn/inference - Inference execution
 * - wasi:nn/errors - Error handling
 *
 * Implementations:
 * - webnn: W3C WebNN API (Chrome 113+, experimental)
 * - mock: Mock implementation for testing
 *
 * @example
 * ```typescript
 * import { nnPlugins, NnPluginConfig } from '@tegmentum/wasi-polyfill/wasip2/plugins/nn'
 *
 * // Register plugins with registry
 * for (const plugin of nnPlugins) {
 *   registry.register(plugin)
 * }
 *
 * // Create instance with config
 * const instance = nnGraphPlugin.create({
 *   implementation: 'mock',
 *   defaultTarget: ExecutionTarget.CPU,
 * })
 * ```
 */

// Type exports
export {
  // Handle types
  type GraphHandle,
  type GraphExecutionContextHandle,

  // Tensor types
  TensorType,
  type TensorDimensions,
  type TensorData,
  type Tensor,
  type NamedTensor,

  // Graph types
  GraphEncoding,
  ExecutionTarget,
  type GraphBuilder,

  // Error types
  NnErrorCode,
  type NnError,
  createNnError,

  // Result types
  type NnResult,
  nnOk,
  nnErr,

  // Config types
  type NnPluginConfig,
  type BackendInfo,
  type InferenceStats,
} from './types.js'

// Plugin definitions and interfaces
export {
  nnTensorPlugin,
  nnGraphPlugin,
  nnInferencePlugin,
  nnErrorsPlugin,
  nnPlugins,
  NN_TENSOR_INTERFACE,
  NN_GRAPH_INTERFACE,
  NN_INFERENCE_INTERFACE,
  NN_ERRORS_INTERFACE,
} from './plugin.js'

// WebNN implementation
export { webnnImplementation } from './impl-webnn.js'

// Mock implementation (for testing)
export { mockNnImplementation } from './impl-mock.js'
