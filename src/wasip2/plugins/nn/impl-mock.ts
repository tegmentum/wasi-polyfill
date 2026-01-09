/**
 * Mock neural network implementation for testing
 *
 * Provides a simple mock implementation that can be used for testing
 * without requiring an actual ML backend.
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
// Mock Graph Types
// =============================================================================

/**
 * Mock graph definition for testing.
 */
interface MockGraphDef {
  inputNames: string[]
  outputNames: string[]
  inputShapes: Map<string, TensorDimensions>
  outputShapes: Map<string, TensorDimensions>
  computeFn?: (inputs: Map<string, Tensor>) => Map<string, Tensor>
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

// =============================================================================
// Mock Instance
// =============================================================================

/**
 * Mock nn plugin instance for testing.
 */
class MockNnInstance implements PluginInstance {
  private graphs = new Map<GraphHandle, MockGraphDef>()
  private contexts = new Map<GraphExecutionContextHandle, ContextEntry>()
  private nextGraphHandle = 1
  private nextContextHandle = 1
  private registeredModels = new Map<string, MockGraphDef>()

  constructor(_config: NnPluginConfig) {
    this.registerDefaultModels()
  }

  /**
   * Register default mock models for testing.
   */
  private registerDefaultModels(): void {
    // Simple identity model
    this.registeredModels.set('identity', {
      inputNames: ['input'],
      outputNames: ['output'],
      inputShapes: new Map([['input', [1, 10]]]),
      outputShapes: new Map([['output', [1, 10]]]),
      computeFn: (inputs) => {
        const output = new Map<string, Tensor>()
        const input = inputs.get('input')
        if (input) {
          output.set('output', { ...input })
        }
        return output
      },
    })

    // Simple add model: output = input1 + input2
    this.registeredModels.set('add', {
      inputNames: ['a', 'b'],
      outputNames: ['sum'],
      inputShapes: new Map([['a', [1, 10]], ['b', [1, 10]]]),
      outputShapes: new Map([['sum', [1, 10]]]),
      computeFn: (inputs) => {
        const a = inputs.get('a')
        const b = inputs.get('b')
        const output = new Map<string, Tensor>()

        if (a && b) {
          const aData = new Float32Array(a.data.buffer, a.data.byteOffset, a.data.byteLength / 4)
          const bData = new Float32Array(b.data.buffer, b.data.byteOffset, b.data.byteLength / 4)
          const sumData = new Float32Array(aData.length)

          for (let i = 0; i < aData.length; i++) {
            sumData[i] = aData[i]! + bData[i]!
          }

          output.set('sum', {
            type: TensorType.FP32,
            dimensions: a.dimensions,
            data: new Uint8Array(sumData.buffer),
          })
        }

        return output
      },
    })

    // Simple matmul model
    this.registeredModels.set('matmul', {
      inputNames: ['a', 'b'],
      outputNames: ['result'],
      inputShapes: new Map([['a', [2, 3]], ['b', [3, 2]]]),
      outputShapes: new Map([['result', [2, 2]]]),
      computeFn: (inputs) => {
        const a = inputs.get('a')
        const b = inputs.get('b')
        const output = new Map<string, Tensor>()

        if (a && b) {
          const aData = new Float32Array(a.data.buffer, a.data.byteOffset, a.data.byteLength / 4)
          const bData = new Float32Array(b.data.buffer, b.data.byteOffset, b.data.byteLength / 4)

          // Simple 2x3 @ 3x2 = 2x2 matmul
          const M = 2, K = 3, N = 2
          const resultData = new Float32Array(M * N)

          for (let i = 0; i < M; i++) {
            for (let j = 0; j < N; j++) {
              let sum = 0
              for (let k = 0; k < K; k++) {
                sum += aData[i * K + k]! * bData[k * N + j]!
              }
              resultData[i * N + j] = sum
            }
          }

          output.set('result', {
            type: TensorType.FP32,
            dimensions: [M, N],
            data: new Uint8Array(resultData.buffer),
          })
        }

        return output
      },
    })

    // Softmax model
    this.registeredModels.set('softmax', {
      inputNames: ['logits'],
      outputNames: ['probabilities'],
      inputShapes: new Map([['logits', [1, 10]]]),
      outputShapes: new Map([['probabilities', [1, 10]]]),
      computeFn: (inputs) => {
        const logits = inputs.get('logits')
        const output = new Map<string, Tensor>()

        if (logits) {
          const data = new Float32Array(logits.data.buffer, logits.data.byteOffset, logits.data.byteLength / 4)
          const probs = new Float32Array(data.length)

          // Find max for numerical stability
          let max = -Infinity
          for (let i = 0; i < data.length; i++) {
            if (data[i]! > max) max = data[i]!
          }

          // Compute exp(x - max)
          let sum = 0
          for (let i = 0; i < data.length; i++) {
            probs[i] = Math.exp(data[i]! - max)
            sum += probs[i]!
          }

          // Normalize
          for (let i = 0; i < probs.length; i++) {
            probs[i]! /= sum
          }

          output.set('probabilities', {
            type: TensorType.FP32,
            dimensions: logits.dimensions,
            data: new Uint8Array(probs.buffer),
          })
        }

        return output
      },
    })
  }

  /**
   * Register a custom mock model for testing.
   */
  registerModel(name: string, def: MockGraphDef): void {
    this.registeredModels.set(name, def)
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
    this.graphs.clear()
    this.contexts.clear()
  }

  // ===========================================================================
  // Backend Info
  // ===========================================================================

  private getBackendInfo(): BackendInfo {
    return {
      name: 'mock',
      encodings: [GraphEncoding.ONNX, GraphEncoding.AUTO],
      targets: [ExecutionTarget.CPU],
      version: '1.0.0-mock',
    }
  }

  private isSupported(): boolean {
    return true // Mock is always supported
  }

  // ===========================================================================
  // Graph Operations
  // ===========================================================================

  private load(
    _builder: Uint8Array[],
    _encoding: GraphEncoding,
    _target: ExecutionTarget
  ) {
    // For mock, we just create an identity graph
    const handle = this.nextGraphHandle++

    const def: MockGraphDef = {
      inputNames: ['input'],
      outputNames: ['output'],
      inputShapes: new Map([['input', [1, 10]]]),
      outputShapes: new Map([['output', [1, 10]]]),
      computeFn: (inputs) => {
        const output = new Map<string, Tensor>()
        const input = inputs.get('input')
        if (input) {
          output.set('output', { ...input })
        }
        return output
      },
    }

    this.graphs.set(handle, def)
    return nnOk(handle)
  }

  private loadByName(name: string, _target: ExecutionTarget) {
    const def = this.registeredModels.get(name)
    if (!def) {
      return nnErr(NnErrorCode.INVALID_ARGUMENT, `Model '${name}' not found`)
    }

    const handle = this.nextGraphHandle++
    this.graphs.set(handle, { ...def })
    return nnOk(handle)
  }

  private dropGraph(handle: GraphHandle): void {
    this.graphs.delete(handle)
  }

  private getInputNames(handle: GraphHandle): string[] | null {
    const def = this.graphs.get(handle)
    return def?.inputNames ?? null
  }

  private getOutputNames(handle: GraphHandle): string[] | null {
    const def = this.graphs.get(handle)
    return def?.outputNames ?? null
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

  private compute(handle: GraphExecutionContextHandle) {
    const ctx = this.contexts.get(handle)
    if (!ctx) {
      return nnErr(NnErrorCode.INVALID_ARGUMENT, `Execution context ${handle} not found`)
    }

    const graphDef = this.graphs.get(ctx.graphHandle)
    if (!graphDef) {
      return nnErr(NnErrorCode.INVALID_ARGUMENT, `Graph ${ctx.graphHandle} not found`)
    }

    const startTime = performance.now()

    try {
      if (graphDef.computeFn) {
        ctx.outputs = graphDef.computeFn(ctx.inputs)
      } else {
        // Default: copy inputs to outputs
        Array.from(ctx.inputs.entries()).forEach(([name, tensor]) => {
          ctx.outputs.set(name, { ...tensor })
        })
      }

      ctx.lastStats = {
        computeTimeMs: performance.now() - startTime,
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

    const graphDef = this.graphs.get(ctx.graphHandle)
    if (!graphDef) {
      return nnErr(NnErrorCode.INVALID_ARGUMENT, `Graph ${ctx.graphHandle} not found`)
    }

    const name = graphDef.outputNames[index]
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
 * Mock nn implementation for testing.
 */
export const mockNnImplementation: Implementation = {
  name: 'mock',
  description: 'Mock neural network implementation for testing',
  create(config: PluginConfig): PluginInstance {
    return new MockNnInstance(config as NnPluginConfig)
  },
}
