/**
 * Real neural-network inference backend for wasi:nn, built on an ONNX Runtime.
 *
 * Unlike the `webnn` backend (which can't load a serialized model) and the
 * `mock` backend (a few toy graphs), this runs actual ONNX models through the
 * standard wasi:nn flow: load(model-bytes) → init-execution-context →
 * set-input → compute → get-output.
 *
 * The ONNX Runtime is an OPTIONAL peer dependency and is provided by the host
 * via `config.ort` — `onnxruntime-web` in browsers, `onnxruntime-node` under
 * Node — so the polyfill bundles neither and stays runtime-agnostic. Only the
 * small structural surface used here is typed (below), which also makes the
 * backend straightforward to unit-test with a fake runtime.
 *
 * ```ts
 * import * as ort from 'onnxruntime-web'
 * // select the 'onnx' implementation and pass the runtime:
 * createPolicy({ overrides: { 'wasi:nn/graph': { implementation: 'onnx', config: { ort } } } })
 * ```
 */

import type {
  Implementation,
  PluginConfig,
  PluginInstance,
} from '../../core/types.js'
import { contextFromConfig } from '../../core/resource-context.js'
import {
  type BackendInfo,
  type GraphExecutionContextHandle,
  type GraphHandle,
  type NnPluginConfig,
  type Tensor,
  ExecutionTarget,
  GraphEncoding,
  NnErrorCode,
  TensorType,
  nnErr,
  nnOk,
} from './types.js'

// --- Minimal structural ONNX Runtime surface (works for -web and -node) -----

interface OrtTensorLike {
  readonly type: string
  readonly data: ArrayBufferView
  readonly dims: readonly number[]
}

interface OrtSessionLike {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  run(feeds: Record<string, OrtTensorLike>): Promise<Record<string, OrtTensorLike>>
  release?(): void | Promise<void>
}

interface OrtModuleLike {
  InferenceSession: {
    create(data: Uint8Array, options?: unknown): Promise<OrtSessionLike>
  }
  Tensor: new (
    type: string,
    data: ArrayBufferView,
    dims: readonly number[]
  ) => OrtTensorLike
}

/** Config recognized by the onnx backend (host-provided ONNX Runtime). */
export interface OnnxNnConfig extends NnPluginConfig {
  /** An ONNX Runtime module (`onnxruntime-web` / `onnxruntime-node`). */
  ort?: OrtModuleLike
}

// --- Tensor type mapping ----------------------------------------------------

/** wasi:nn tensor type -> [ort type string, typed-array view of raw bytes]. */
function toOrtData(tensor: Tensor): { type: string; data: ArrayBufferView } | null {
  const { data, type } = tensor
  // Views over the same bytes (no copy); element count derived from byteLength.
  const ab = data.buffer
  const off = data.byteOffset
  const len = data.byteLength
  switch (type) {
    case TensorType.FP32:
      return { type: 'float32', data: new Float32Array(ab, off, len / 4) }
    case TensorType.FP16:
    case TensorType.BF16:
      return { type: 'float16', data: new Uint16Array(ab, off, len / 2) }
    case TensorType.U8:
      return { type: 'uint8', data: new Uint8Array(ab, off, len) }
    case TensorType.I32:
      return { type: 'int32', data: new Int32Array(ab, off, len / 4) }
    case TensorType.I64:
      return { type: 'int64', data: new BigInt64Array(ab, off, len / 8) }
    default:
      return null // fp8 variants etc. not representable
  }
}

/** ort tensor type string -> wasi:nn tensor type. */
function fromOrtType(ortType: string): TensorType | null {
  switch (ortType) {
    case 'float32':
      return TensorType.FP32
    case 'float16':
      return TensorType.FP16
    case 'uint8':
      return TensorType.U8
    case 'int32':
      return TensorType.I32
    case 'int64':
      return TensorType.I64
    default:
      return null
  }
}

/** Convert an ort output tensor into a wasi:nn Tensor (raw bytes). */
function fromOrtTensor(t: OrtTensorLike): Tensor | null {
  const type = fromOrtType(t.type)
  if (type === null) return null
  const view = t.data
  const bytes = new Uint8Array(
    view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
  )
  return { type, dimensions: [...t.dims], data: bytes }
}

interface OnnxGraph {
  session: OrtSessionLike
  inputNames: string[]
  outputNames: string[]
}

interface OnnxContext {
  graphHandle: GraphHandle
  feeds: Map<string, OrtTensorLike>
  outputs: Map<string, Tensor>
  computeTimeMs: number
}

/**
 * Shared onnx backend state. Scoped to the polyfill's ResourceContext so the
 * four wasi:nn interfaces (tensor/graph/inference/errors) operate on the same
 * graphs and contexts within a polyfill.
 */
export class OnnxNnBackend {
  ort: OrtModuleLike | undefined
  private readonly graphs = new Map<GraphHandle, OnnxGraph>()
  private readonly contexts = new Map<GraphExecutionContextHandle, OnnxContext>()
  private nextHandle = 1

  constructor(ort?: OrtModuleLike) {
    this.ort = ort
  }

  getBackendInfo(): BackendInfo {
    return {
      name: 'onnx',
      encodings: [GraphEncoding.ONNX, GraphEncoding.AUTO],
      targets: [ExecutionTarget.CPU, ExecutionTarget.GPU],
      version: 'onnxruntime',
    }
  }

  isSupported(): boolean {
    return this.ort !== undefined
  }

  async load(builder: Uint8Array[], encoding: GraphEncoding, _target: ExecutionTarget) {
    if (!this.ort) {
      return nnErr<GraphHandle>(
        NnErrorCode.MISSING_IMPLEMENTATION,
        'ONNX Runtime not provided; pass { ort } in the plugin config'
      )
    }
    if (encoding !== GraphEncoding.ONNX && encoding !== GraphEncoding.AUTO) {
      return nnErr<GraphHandle>(
        NnErrorCode.INVALID_ENCODING,
        `onnx backend only supports ONNX encoding, got ${encoding}`
      )
    }
    try {
      const model = concatBytes(builder)
      const session = await this.ort.InferenceSession.create(model)
      const handle = this.nextHandle++
      this.graphs.set(handle, {
        session,
        inputNames: [...session.inputNames],
        outputNames: [...session.outputNames],
      })
      return nnOk(handle)
    } catch (error) {
      return nnErr<GraphHandle>(
        NnErrorCode.RUNTIME_ERROR,
        `Failed to load model: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  loadByName(name: string, _target: ExecutionTarget) {
    // No model registry for the onnx backend; load by bytes via load().
    return nnErr<GraphHandle>(
      NnErrorCode.INVALID_ARGUMENT,
      `load-by-name is not supported by the onnx backend (model '${name}')`
    )
  }

  dropGraph(handle: GraphHandle): void {
    const graph = this.graphs.get(handle)
    void graph?.session.release?.()
    this.graphs.delete(handle)
  }

  getInputNames(handle: GraphHandle): string[] | null {
    return this.graphs.get(handle)?.inputNames ?? null
  }

  getOutputNames(handle: GraphHandle): string[] | null {
    return this.graphs.get(handle)?.outputNames ?? null
  }

  initExecutionContext(graphHandle: GraphHandle) {
    if (!this.graphs.has(graphHandle)) {
      return nnErr<GraphExecutionContextHandle>(
        NnErrorCode.INVALID_ARGUMENT,
        `Graph ${graphHandle} not found`
      )
    }
    const handle = this.nextHandle++
    this.contexts.set(handle, {
      graphHandle,
      feeds: new Map(),
      outputs: new Map(),
      computeTimeMs: 0,
    })
    return nnOk(handle)
  }

  setInput(handle: GraphExecutionContextHandle, index: number, tensor: Tensor) {
    const ctx = this.contexts.get(handle)
    if (!ctx) return this.noContext(handle)
    const graph = this.graphs.get(ctx.graphHandle)
    const name = graph?.inputNames[index]
    if (!name) {
      return nnErr<void>(NnErrorCode.INVALID_ARGUMENT, `Invalid input index ${index}`)
    }
    return this.bindInput(ctx, name, tensor)
  }

  setInputNamed(handle: GraphExecutionContextHandle, name: string, tensor: Tensor) {
    const ctx = this.contexts.get(handle)
    if (!ctx) return this.noContext(handle)
    return this.bindInput(ctx, name, tensor)
  }

  private bindInput(ctx: OnnxContext, name: string, tensor: Tensor) {
    const ort = this.ort
    if (!ort) {
      return nnErr<void>(NnErrorCode.MISSING_IMPLEMENTATION, 'ONNX Runtime not provided')
    }
    const mapped = toOrtData(tensor)
    if (!mapped) {
      return nnErr<void>(
        NnErrorCode.INVALID_ENCODING,
        `Unsupported tensor type for onnx: ${tensor.type}`
      )
    }
    ctx.feeds.set(name, new ort.Tensor(mapped.type, mapped.data, tensor.dimensions))
    return nnOk(undefined)
  }

  async compute(handle: GraphExecutionContextHandle) {
    const ctx = this.contexts.get(handle)
    if (!ctx) return this.noContext(handle)
    const graph = this.graphs.get(ctx.graphHandle)
    if (!graph) {
      return nnErr<void>(NnErrorCode.INVALID_ARGUMENT, `Graph ${ctx.graphHandle} not found`)
    }
    try {
      const start = Date.now()
      const results = await graph.session.run(Object.fromEntries(ctx.feeds))
      ctx.computeTimeMs = Date.now() - start
      ctx.outputs.clear()
      for (const [name, ortTensor] of Object.entries(results)) {
        const tensor = fromOrtTensor(ortTensor)
        if (!tensor) {
          return nnErr<void>(
            NnErrorCode.RUNTIME_ERROR,
            `Unsupported output tensor type '${ortTensor.type}' for output '${name}'`
          )
        }
        ctx.outputs.set(name, tensor)
      }
      return nnOk(undefined)
    } catch (error) {
      return nnErr<void>(
        NnErrorCode.RUNTIME_ERROR,
        `Inference failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  getOutput(handle: GraphExecutionContextHandle, index: number) {
    const ctx = this.contexts.get(handle)
    if (!ctx) return this.noContext<Tensor>(handle)
    const graph = this.graphs.get(ctx.graphHandle)
    const name = graph?.outputNames[index]
    if (!name) {
      return nnErr<Tensor>(NnErrorCode.INVALID_ARGUMENT, `Invalid output index ${index}`)
    }
    return this.readOutput(ctx, name)
  }

  getOutputNamed(handle: GraphExecutionContextHandle, name: string) {
    const ctx = this.contexts.get(handle)
    if (!ctx) return this.noContext<Tensor>(handle)
    return this.readOutput(ctx, name)
  }

  private readOutput(ctx: OnnxContext, name: string) {
    const tensor = ctx.outputs.get(name)
    if (!tensor) {
      return nnErr<Tensor>(NnErrorCode.RUNTIME_ERROR, `Output '${name}' not computed`)
    }
    return nnOk(tensor)
  }

  dropExecutionContext(handle: GraphExecutionContextHandle): void {
    this.contexts.delete(handle)
  }

  getLastInferenceStats(handle: GraphExecutionContextHandle) {
    const ctx = this.contexts.get(handle)
    return ctx ? { computeTimeMs: ctx.computeTimeMs } : null
  }

  private noContext<T = void>(handle: number) {
    return nnErr<T>(NnErrorCode.INVALID_ARGUMENT, `Execution context ${handle} not found`)
  }
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]!
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const p of parts) {
    out.set(p, pos)
    pos += p.length
  }
  return out
}

/** Thin PluginInstance facade exposing an {@link OnnxNnBackend}'s imports. */
class OnnxNnInstance implements PluginInstance {
  constructor(private readonly backend: OnnxNnBackend) {}

  getImports(): Record<string, unknown> {
    const b = this.backend
    return {
      'get-backend-info': () => b.getBackendInfo(),
      'is-supported': () => b.isSupported(),
      load: (builder: Uint8Array[], encoding: GraphEncoding, target: ExecutionTarget) =>
        b.load(builder, encoding, target),
      'load-by-name': (name: string, target: ExecutionTarget) =>
        b.loadByName(name, target),
      'init-execution-context': (graph: GraphHandle) => b.initExecutionContext(graph),
      'set-input': (h: GraphExecutionContextHandle, index: number, tensor: Tensor) =>
        b.setInput(h, index, tensor),
      'set-input-named': (h: GraphExecutionContextHandle, name: string, tensor: Tensor) =>
        b.setInputNamed(h, name, tensor),
      compute: (h: GraphExecutionContextHandle) => b.compute(h),
      'get-output': (h: GraphExecutionContextHandle, index: number) => b.getOutput(h, index),
      'get-output-named': (h: GraphExecutionContextHandle, name: string) =>
        b.getOutputNamed(h, name),
      'drop-graph': (h: GraphHandle) => b.dropGraph(h),
      'drop-execution-context': (h: GraphExecutionContextHandle) =>
        b.dropExecutionContext(h),
      'get-input-names': (h: GraphHandle) => b.getInputNames(h),
      'get-output-names': (h: GraphHandle) => b.getOutputNames(h),
      'get-last-inference-stats': (h: GraphExecutionContextHandle) =>
        b.getLastInferenceStats(h),
    }
  }

  destroy(): void {
    // Sessions are released when graphs are dropped.
  }
}

/** ResourceContext key for the per-polyfill onnx backend. */
const ONNX_BACKEND_KEY = Symbol('wasi:nn/onnx-backend')

/**
 * Real ONNX-Runtime-backed implementation of wasi:nn.
 * Host must provide an ONNX Runtime module via `config.ort`.
 */
export const onnxNnImplementation: Implementation = {
  name: 'onnx',
  description: 'Neural network inference via ONNX Runtime (onnxruntime-web/node)',
  create(config: PluginConfig): PluginInstance {
    const ort = (config as OnnxNnConfig).ort
    const backend = contextFromConfig(config).get(
      ONNX_BACKEND_KEY,
      () => new OnnxNnBackend(ort)
    )
    if (ort && !backend.ort) {
      backend.ort = ort
    }
    return new OnnxNnInstance(backend)
  },
}

/** Create an isolated onnx nn instance + backend (for tests). */
export function createOnnxNn(
  config: OnnxNnConfig = {}
): { instance: PluginInstance; backend: OnnxNnBackend } {
  const backend = new OnnxNnBackend(config.ort)
  return { instance: new OnnxNnInstance(backend), backend }
}
