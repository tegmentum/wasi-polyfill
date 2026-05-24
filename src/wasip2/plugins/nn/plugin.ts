/**
 * wasi:nn plugin definitions
 *
 * Defines the plugin interfaces for neural network inference.
 *
 * Interfaces:
 * - wasi:nn/tensor - Tensor type definitions
 * - wasi:nn/graph - Graph loading and management
 * - wasi:nn/inference - Inference execution
 * - wasi:nn/errors - Error handling
 *
 * Implementations:
 * - webnn: WebNN API (browser, Chrome 113+)
 * - onnx: ONNX Runtime Web (browser/Node.js)
 * - mock: Mock implementation for testing
 */

import type { WasiPlugin, WasiInterface } from '../../core/types.js'
import { createPlugin } from '../plugin-base.js'
import { webnnImplementation } from './impl-webnn.js'
import { onnxNnImplementation } from './impl-onnx.js'
import { mockNnImplementation } from './impl-mock.js'

/**
 * WASI nn tensor interface definition
 */
export const NN_TENSOR_INTERFACE: WasiInterface = {
  package: 'wasi:nn',
  name: 'tensor',
  version: '0.2.0-draft',
}

/**
 * WASI nn graph interface definition
 */
export const NN_GRAPH_INTERFACE: WasiInterface = {
  package: 'wasi:nn',
  name: 'graph',
  version: '0.2.0-draft',
}

/**
 * WASI nn inference interface definition
 */
export const NN_INFERENCE_INTERFACE: WasiInterface = {
  package: 'wasi:nn',
  name: 'inference',
  version: '0.2.0-draft',
}

/**
 * WASI nn errors interface definition
 */
export const NN_ERRORS_INTERFACE: WasiInterface = {
  package: 'wasi:nn',
  name: 'errors',
  version: '0.2.0-draft',
}

/**
 * wasi:nn/tensor plugin
 *
 * Provides tensor type definitions and utilities.
 */
export const nnTensorPlugin: WasiPlugin = createPlugin(
  NN_TENSOR_INTERFACE,
  {
    webnn: webnnImplementation,
    onnx: onnxNnImplementation,
    mock: mockNnImplementation,
  },
  'webnn'
)

/**
 * wasi:nn/graph plugin
 *
 * Provides graph loading and management.
 *
 * Implementations:
 * - webnn: WebNN API (default for browsers)
 * - mock: Mock implementation for testing
 */
export const nnGraphPlugin: WasiPlugin = createPlugin(
  NN_GRAPH_INTERFACE,
  {
    webnn: webnnImplementation,
    onnx: onnxNnImplementation,
    mock: mockNnImplementation,
  },
  'webnn'
)

/**
 * wasi:nn/inference plugin
 *
 * Provides inference execution.
 *
 * Implementations:
 * - webnn: WebNN API (default for browsers)
 * - mock: Mock implementation for testing
 */
export const nnInferencePlugin: WasiPlugin = createPlugin(
  NN_INFERENCE_INTERFACE,
  {
    webnn: webnnImplementation,
    onnx: onnxNnImplementation,
    mock: mockNnImplementation,
  },
  'webnn'
)

/**
 * wasi:nn/errors plugin
 *
 * Provides error type definitions.
 */
export const nnErrorsPlugin: WasiPlugin = createPlugin(
  NN_ERRORS_INTERFACE,
  {
    webnn: webnnImplementation,
    onnx: onnxNnImplementation,
    mock: mockNnImplementation,
  },
  'webnn'
)

/**
 * All nn plugins for convenient registration
 */
export const nnPlugins: WasiPlugin[] = [
  nnTensorPlugin,
  nnGraphPlugin,
  nnInferencePlugin,
  nnErrorsPlugin,
]
