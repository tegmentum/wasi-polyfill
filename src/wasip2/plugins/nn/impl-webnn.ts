/**
 * WebNN-based neural network implementation
 *
 * Uses the W3C WebNN API for hardware-accelerated ML inference.
 * Supported in Chrome 113+ with experimental flags.
 *
 * @see https://www.w3.org/TR/webnn/
 */

import type { Implementation, PluginConfig, PluginInstance } from '../../core/types.js'
import {
  type GraphHandle,
  type GraphExecutionContextHandle,
  type Tensor,
  type TensorDimensions,
  type NnPluginConfig,
  type BackendInfo,
  type InferenceStats,
  TensorType,
  GraphEncoding,
  ExecutionTarget,
  NnErrorCode,
  nnOk,
  nnErr,
} from './types.js'

// =============================================================================
// WebNN Type Declarations
// =============================================================================

// WebNN types (not yet in lib.dom.d.ts)
interface MLContext {
  compute(graph: MLGraph, inputs: Record<string, MLTensor>, outputs: Record<string, MLTensor>): Promise<void>
  createTensor(descriptor: MLTensorDescriptor, data?: ArrayBufferView): Promise<MLTensor>
  readTensor(tensor: MLTensor): Promise<ArrayBuffer>
}

interface MLTensor {
  dataType: string
  shape: readonly number[]
  destroy(): void
}

interface MLTensorDescriptor {
  dataType: string
  shape: readonly number[]
  readable?: boolean
  writable?: boolean
}

interface MLGraph {
  // Opaque graph handle
}

// MLGraphBuilder is defined for documentation/future use
// WebNN graph building requires MLGraphBuilder when implemented
export type MLGraphBuilder = {
  build(outputs: Record<string, MLOperand>): Promise<MLGraph>
  input(name: string, descriptor: MLOperandDescriptor): MLOperand
  constant(value: ArrayBufferView, type: MLOperandDescriptor): MLOperand
  // Operators
  add(a: MLOperand, b: MLOperand): MLOperand
  mul(a: MLOperand, b: MLOperand): MLOperand
  matmul(a: MLOperand, b: MLOperand): MLOperand
  relu(input: MLOperand): MLOperand
  sigmoid(input: MLOperand): MLOperand
  tanh(input: MLOperand): MLOperand
  softmax(input: MLOperand): MLOperand
  reshape(input: MLOperand, newShape: readonly number[]): MLOperand
  transpose(input: MLOperand, permutation?: readonly number[]): MLOperand
  conv2d(input: MLOperand, filter: MLOperand, options?: object): MLOperand
  averagePool2d(input: MLOperand, options?: object): MLOperand
  maxPool2d(input: MLOperand, options?: object): MLOperand
  gemm(a: MLOperand, b: MLOperand, options?: object): MLOperand
}

interface MLOperand {
  // Opaque operand handle
}

interface MLOperandDescriptor {
  dataType: string
  shape: readonly number[]
}

interface MLContextOptions {
  deviceType?: 'cpu' | 'gpu' | 'npu'
  powerPreference?: 'default' | 'high-performance' | 'low-power'
}

interface ML {
  createContext(options?: MLContextOptions): Promise<MLContext>
}

declare global {
  interface Navigator {
    ml?: ML
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Map TensorType to WebNN data type string.
 */
function tensorTypeToWebnn(type: TensorType): string {
  switch (type) {
    case TensorType.FP32: return 'float32'
    case TensorType.FP16: return 'float16'
    case TensorType.U8: return 'uint8'
    case TensorType.I32: return 'int32'
    case TensorType.I64: return 'int64'
    default: return 'float32'
  }
}

/**
 * Map WebNN data type to TensorType.
 */
function webnnToTensorType(type: string): TensorType {
  switch (type) {
    case 'float32': return TensorType.FP32
    case 'float16': return TensorType.FP16
    case 'uint8': return TensorType.U8
    case 'int32': return TensorType.I32
    case 'int64': return TensorType.I64
    default: return TensorType.FP32
  }
}

/**
 * Map ExecutionTarget to WebNN device type.
 */
function targetToDeviceType(target: ExecutionTarget): 'cpu' | 'gpu' | 'npu' {
  switch (target) {
    case ExecutionTarget.CPU: return 'cpu'
    case ExecutionTarget.GPU: return 'gpu'
    case ExecutionTarget.NPU:
    case ExecutionTarget.TPU: return 'npu'
    case ExecutionTarget.AUTO:
    default: return 'cpu'
  }
}

/**
 * Get typed array constructor for tensor type.
 */
function getTypedArrayConstructor(type: TensorType): Float32ArrayConstructor | Float64ArrayConstructor | Uint8ArrayConstructor | Int32ArrayConstructor | BigInt64ArrayConstructor {
  switch (type) {
    case TensorType.FP32: return Float32Array
    case TensorType.U8: return Uint8Array
    case TensorType.I32: return Int32Array
    case TensorType.I64: return BigInt64Array
    default: return Float32Array
  }
}

// =============================================================================
// WebNN Instance
// =============================================================================

/**
 * Graph storage structure.
 */
interface GraphEntry {
  graph: MLGraph
  inputNames: string[]
  outputNames: string[]
  inputShapes: Map<string, TensorDimensions>
  outputShapes: Map<string, TensorDimensions>
}

/**
 * Execution context storage.
 */
interface ContextEntry {
  graphHandle: GraphHandle
  inputs: Map<string, Tensor>
  outputs: Map<string, Tensor>
  lastStats?: InferenceStats
}

/**
 * WebNN plugin instance.
 */
class WebNNInstance implements PluginInstance {
  private context: MLContext | null = null
  private graphs = new Map<GraphHandle, GraphEntry>()
  private contexts = new Map<GraphExecutionContextHandle, ContextEntry>()
  private nextContextHandle = 1
  private config: NnPluginConfig
  private initPromise: Promise<void> | null = null

  constructor(config: NnPluginConfig) {
    this.config = config
  }

  private async ensureContext(): Promise<MLContext> {
    if (this.context) {
      return this.context
    }

    if (!this.initPromise) {
      this.initPromise = this.initContext()
    }

    await this.initPromise
    if (!this.context) {
      throw new Error('Failed to initialize WebNN context')
    }
    return this.context
  }

  private async initContext(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.ml) {
      throw new Error('WebNN is not supported in this environment')
    }

    const options: MLContextOptions = {
      deviceType: targetToDeviceType(this.config.defaultTarget ?? ExecutionTarget.AUTO),
    }

    this.context = await navigator.ml.createContext(options)
  }

  getImports(): Record<string, unknown> {
    return {
      // Backend info
      'get-backend-info': this.getBackendInfo.bind(this),
      'is-supported': this.isSupported.bind(this),

      // Graph operations
      'load': this.load.bind(this),
      'load-by-name': this.loadByName.bind(this),

      // Execution context operations
      'init-execution-context': this.initExecutionContext.bind(this),
      'set-input': this.setInput.bind(this),
      'set-input-named': this.setInputNamed.bind(this),
      'compute': this.compute.bind(this),
      'get-output': this.getOutput.bind(this),
      'get-output-named': this.getOutputNamed.bind(this),

      // Cleanup
      'drop-graph': this.dropGraph.bind(this),
      'drop-execution-context': this.dropExecutionContext.bind(this),

      // Utilities
      'get-input-names': this.getInputNames.bind(this),
      'get-output-names': this.getOutputNames.bind(this),
      'get-last-inference-stats': this.getLastInferenceStats.bind(this),
    }
  }

  destroy(): void {
    // Clean up all graphs and contexts
    this.graphs.clear()
    this.contexts.clear()
    this.context = null
  }

  // ===========================================================================
  // Backend Info
  // ===========================================================================

  private getBackendInfo(): BackendInfo {
    const supported = typeof navigator !== 'undefined' && !!navigator.ml

    return {
      name: 'webnn',
      encodings: supported ? [GraphEncoding.ONNX] : [],
      targets: supported
        ? [ExecutionTarget.CPU, ExecutionTarget.GPU, ExecutionTarget.NPU]
        : [],
      version: '1.0',
    }
  }

  private isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.ml
  }

  // ===========================================================================
  // Graph Operations
  // ===========================================================================

  private async load(
    _builder: Uint8Array[],
    encoding: GraphEncoding,
    _target: ExecutionTarget
  ) {
    try {
      // WebNN doesn't support loading arbitrary model files directly
      // It requires building graphs programmatically or using ONNX Runtime
      // For now, return an error indicating this limitation
      if (encoding !== GraphEncoding.ONNX) {
        return nnErr(NnErrorCode.INVALID_ENCODING, `Encoding ${encoding} not supported by WebNN backend`)
      }

      // In a real implementation, we would:
      // 1. Parse the ONNX model
      // 2. Build the graph using MLGraphBuilder
      // 3. Store the compiled graph

      // For now, return not implemented
      return nnErr(
        NnErrorCode.MISSING_IMPLEMENTATION,
        'Direct model loading not yet implemented. Use ONNX Runtime Web for full model support.'
      )
    } catch (error) {
      return nnErr(
        NnErrorCode.RUNTIME_ERROR,
        `Failed to load graph: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private async loadByName(name: string, target: ExecutionTarget) {
    try {
      // Load from model registry
      if (!this.config.modelRegistry) {
        return nnErr(NnErrorCode.INVALID_ARGUMENT, 'No model registry configured')
      }

      // Fetch model from registry
      const url = `${this.config.modelRegistry}/${name}`
      const response = await fetch(url)

      if (!response.ok) {
        return nnErr(NnErrorCode.INVALID_ARGUMENT, `Model '${name}' not found in registry`)
      }

      const modelData = await response.arrayBuffer()
      return this.load([new Uint8Array(modelData)], GraphEncoding.ONNX, target)
    } catch (error) {
      return nnErr(
        NnErrorCode.RUNTIME_ERROR,
        `Failed to load model by name: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private dropGraph(handle: GraphHandle): void {
    this.graphs.delete(handle)
  }

  private getInputNames(handle: GraphHandle): string[] | null {
    const entry = this.graphs.get(handle)
    return entry?.inputNames ?? null
  }

  private getOutputNames(handle: GraphHandle): string[] | null {
    const entry = this.graphs.get(handle)
    return entry?.outputNames ?? null
  }

  // ===========================================================================
  // Execution Context Operations
  // ===========================================================================

  private initExecutionContext(graphHandle: GraphHandle) {
    const graph = this.graphs.get(graphHandle)
    if (!graph) {
      return nnErr(NnErrorCode.INVALID_ARGUMENT, `Graph ${graphHandle} not found`)
    }

    const handle = this.nextContextHandle++
    const entry: ContextEntry = {
      graphHandle,
      inputs: new Map(),
      outputs: new Map(),
    }

    this.contexts.set(handle, entry)
    return nnOk(handle)
  }

  private setInput(handle: GraphExecutionContextHandle, index: number, tensor: Tensor) {
    const ctx = this.contexts.get(handle)
    if (!ctx) {
      return nnErr(NnErrorCode.INVALID_ARGUMENT, `Execution context ${handle} not found`)
    }

    const graph = this.graphs.get(ctx.graphHandle)
    if (!graph) {
      return nnErr(NnErrorCode.INVALID_ARGUMENT, `Graph ${ctx.graphHandle} not found`)
    }

    const name = graph.inputNames[index]
    if (!name) {
      return nnErr(NnErrorCode.INVALID_ARGUMENT, `Invalid input index ${index}`)
    }

    ctx.inputs.set(name, tensor)
    return nnOk(undefined)
  }

  private setInputNamed(handle: GraphExecutionContextHandle, name: string, tensor: Tensor) {
    const ctx = this.contexts.get(handle)
    if (!ctx) {
      return nnErr(NnErrorCode.INVALID_ARGUMENT, `Execution context ${handle} not found`)
    }

    ctx.inputs.set(name, tensor)
    return nnOk(undefined)
  }

  private async compute(handle: GraphExecutionContextHandle) {
    const ctx = this.contexts.get(handle)
    if (!ctx) {
      return nnErr(NnErrorCode.INVALID_ARGUMENT, `Execution context ${handle} not found`)
    }

    const graphEntry = this.graphs.get(ctx.graphHandle)
    if (!graphEntry) {
      return nnErr(NnErrorCode.INVALID_ARGUMENT, `Graph ${ctx.graphHandle} not found`)
    }

    try {
      const mlContext = await this.ensureContext()

      // Create input tensors
      const inputCopyStart = performance.now()
      const inputs: Record<string, MLTensor> = {}

      const inputEntries = Array.from(ctx.inputs.entries())
      for (let i = 0; i < inputEntries.length; i++) {
        const [name, tensor] = inputEntries[i]!
        const TypedArray = getTypedArrayConstructor(tensor.type)
        // Create a copy as ArrayBuffer (not SharedArrayBuffer) for WebNN compatibility
        const dataCopy = new Uint8Array(tensor.data)
        const typedData = new TypedArray(dataCopy.buffer, 0, dataCopy.byteLength / TypedArray.BYTES_PER_ELEMENT)

        const mlTensor = await mlContext.createTensor({
          dataType: tensorTypeToWebnn(tensor.type),
          shape: tensor.dimensions,
          readable: true,
          writable: true,
        }, typedData as ArrayBufferView)

        inputs[name] = mlTensor
      }
      const inputCopyEnd = performance.now()

      // Create output tensors
      const outputs: Record<string, MLTensor> = {}
      for (const name of graphEntry.outputNames) {
        const shape = graphEntry.outputShapes.get(name) ?? []
        outputs[name] = await mlContext.createTensor({
          dataType: 'float32',
          shape,
          readable: true,
          writable: true,
        })
      }

      // Run inference
      const computeStart = performance.now()
      await mlContext.compute(graphEntry.graph, inputs, outputs)
      const computeEnd = performance.now()

      // Read outputs
      const outputCopyStart = performance.now()
      for (const [name, mlTensor] of Object.entries(outputs)) {
        const buffer = await mlContext.readTensor(mlTensor)
        const tensor: Tensor = {
          type: webnnToTensorType(mlTensor.dataType),
          dimensions: [...mlTensor.shape],
          data: new Uint8Array(buffer),
        }
        ctx.outputs.set(name, tensor)
        mlTensor.destroy()
      }
      const outputCopyEnd = performance.now()

      // Clean up input tensors
      for (const mlTensor of Object.values(inputs)) {
        mlTensor.destroy()
      }

      // Store stats
      ctx.lastStats = {
        computeTimeMs: computeEnd - computeStart,
        inputCopyTimeMs: inputCopyEnd - inputCopyStart,
        outputCopyTimeMs: outputCopyEnd - outputCopyStart,
      }

      return nnOk(undefined)
    } catch (error) {
      return nnErr(
        NnErrorCode.RUNTIME_ERROR,
        `Compute failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private getOutput(handle: GraphExecutionContextHandle, index: number) {
    const ctx = this.contexts.get(handle)
    if (!ctx) {
      return nnErr(NnErrorCode.INVALID_ARGUMENT, `Execution context ${handle} not found`)
    }

    const graphEntry = this.graphs.get(ctx.graphHandle)
    if (!graphEntry) {
      return nnErr(NnErrorCode.INVALID_ARGUMENT, `Graph ${ctx.graphHandle} not found`)
    }

    const name = graphEntry.outputNames[index]
    if (!name) {
      return nnErr(NnErrorCode.INVALID_ARGUMENT, `Invalid output index ${index}`)
    }

    const tensor = ctx.outputs.get(name)
    if (!tensor) {
      return nnErr(NnErrorCode.RUNTIME_ERROR, `Output '${name}' not computed`)
    }

    return nnOk(tensor)
  }

  private getOutputNamed(handle: GraphExecutionContextHandle, name: string) {
    const ctx = this.contexts.get(handle)
    if (!ctx) {
      return nnErr(NnErrorCode.INVALID_ARGUMENT, `Execution context ${handle} not found`)
    }

    const tensor = ctx.outputs.get(name)
    if (!tensor) {
      return nnErr(NnErrorCode.RUNTIME_ERROR, `Output '${name}' not computed`)
    }

    return nnOk(tensor)
  }

  private dropExecutionContext(handle: GraphExecutionContextHandle): void {
    this.contexts.delete(handle)
  }

  private getLastInferenceStats(handle: GraphExecutionContextHandle): InferenceStats | null {
    const ctx = this.contexts.get(handle)
    return ctx?.lastStats ?? null
  }
}

// =============================================================================
// Implementation Export
// =============================================================================

/**
 * WebNN neural network implementation.
 */
export const webnnImplementation: Implementation = {
  name: 'webnn',
  description: 'Neural network inference using W3C WebNN API',
  create(config: PluginConfig): PluginInstance {
    return new WebNNInstance(config as NnPluginConfig)
  },
}
