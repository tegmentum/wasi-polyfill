/**
 * Tests for the real ONNX-Runtime-backed wasi:nn backend (REMEDIATION-PLAN 3.x).
 *
 * The ONNX Runtime is an optional, host-provided peer dependency, so these
 * tests inject a small fake `ort` module (a "double the input" model). This
 * verifies the wasi:nn bridge — model load, input/output name discovery,
 * Tensor<->ort.Tensor marshalling, the set-input/compute/get-output flow, and
 * cross-interface state sharing — without a real runtime or model file.
 */

import { describe, it, expect } from 'vitest'
import {
  createOnnxNn,
  onnxNnImplementation,
  TensorType,
  GraphEncoding,
  ExecutionTarget,
  NnErrorCode,
  type Tensor,
  type OnnxNnConfig,
} from '../../../../../src/wasip2/plugins/nn/index.js'
import { ResourceContext } from '../../../../../src/wasip2/core/resource-context.js'

// --- Fake ONNX Runtime ------------------------------------------------------

class FakeOrtTensor {
  constructor(
    public readonly type: string,
    public readonly data: ArrayBufferView,
    public readonly dims: readonly number[]
  ) {}
}

interface FakeOrtOptions {
  inputNames?: string[]
  outputNames?: string[]
  /** Maps feeds -> results. Defaults to doubling 'input' into 'output'. */
  run?: (feeds: Record<string, FakeOrtTensor>) => Record<string, FakeOrtTensor>
}

function makeFakeOrt(opts: FakeOrtOptions = {}) {
  const inputNames = opts.inputNames ?? ['input']
  const outputNames = opts.outputNames ?? ['output']
  const run =
    opts.run ??
    ((feeds: Record<string, FakeOrtTensor>) => {
      const input = feeds[inputNames[0]!]!
      const src = input.data as Float32Array
      const doubled = Float32Array.from(src, (v) => v * 2)
      return {
        [outputNames[0]!]: new FakeOrtTensor('float32', doubled, input.dims),
      }
    })
  let lastCreateArg: Uint8Array | undefined
  const ort = {
    Tensor: FakeOrtTensor,
    InferenceSession: {
      create: async (data: Uint8Array) => {
        lastCreateArg = data
        return {
          inputNames,
          outputNames,
          run: async (feeds: Record<string, FakeOrtTensor>) => run(feeds),
        }
      },
    },
  }
  return { ort: ort as unknown as OnnxNnConfig['ort'], getLastCreateArg: () => lastCreateArg }
}

// --- Tensor helpers ---------------------------------------------------------

function f32Tensor(values: number[], dims: number[]): Tensor {
  const arr = Float32Array.from(values)
  return {
    type: TensorType.FP32,
    dimensions: dims,
    data: new Uint8Array(arr.buffer.slice(0)),
  }
}

function readF32(t: Tensor): number[] {
  return Array.from(
    new Float32Array(t.data.buffer, t.data.byteOffset, t.data.byteLength / 4)
  )
}

type Res<T> = { ok: true; value: T } | { ok: false; error: { code: NnErrorCode; message: string } }

interface NnImports {
  'get-backend-info'(): { name: string; encodings: GraphEncoding[]; targets: ExecutionTarget[] }
  'is-supported'(): boolean
  load(builder: Uint8Array[], encoding: GraphEncoding, target: ExecutionTarget): Promise<Res<number>>
  'load-by-name'(name: string, target: ExecutionTarget): Res<number>
  'init-execution-context'(graph: number): Res<number>
  'set-input'(ctx: number, index: number, tensor: Tensor): Res<void>
  'set-input-named'(ctx: number, name: string, tensor: Tensor): Res<void>
  compute(ctx: number): Promise<Res<void>>
  'get-output'(ctx: number, index: number): Res<Tensor>
  'get-output-named'(ctx: number, name: string): Res<Tensor>
  'drop-graph'(graph: number): void
  'drop-execution-context'(ctx: number): void
  'get-input-names'(graph: number): string[] | null
  'get-output-names'(graph: number): string[] | null
  'get-last-inference-stats'(ctx: number): { computeTimeMs: number } | null
  [k: string]: unknown
}

function unwrap<T>(r: Res<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`)
  return r.value
}

function makeImports(config: OnnxNnConfig = {}): NnImports {
  const { instance } = createOnnxNn(config)
  return instance.getImports() as unknown as NnImports
}

const MODEL = new Uint8Array([1, 2, 3, 4])

describe('onnx wasi:nn backend', () => {
  it('reports unsupported and errors on load without a runtime', async () => {
    const imp = makeImports({})
    expect(imp['is-supported']()).toBe(false)
    const r = await imp.load([MODEL], GraphEncoding.ONNX, ExecutionTarget.CPU)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe(NnErrorCode.MISSING_IMPLEMENTATION)
  })

  it('reports backend info and support when a runtime is present', () => {
    const { ort } = makeFakeOrt()
    const imp = makeImports({ ort })
    expect(imp['is-supported']()).toBe(true)
    const info = imp['get-backend-info']()
    expect(info.name).toBe('onnx')
    expect(info.encodings).toContain(GraphEncoding.ONNX)
  })

  it('loads a model and exposes its input/output names', async () => {
    const { ort, getLastCreateArg } = makeFakeOrt({
      inputNames: ['a', 'b'],
      outputNames: ['y'],
    })
    const imp = makeImports({ ort })
    const graph = unwrap(await imp.load([MODEL], GraphEncoding.ONNX, ExecutionTarget.CPU))
    expect(getLastCreateArg()).toEqual(MODEL)
    expect(imp['get-input-names'](graph)).toEqual(['a', 'b'])
    expect(imp['get-output-names'](graph)).toEqual(['y'])
  })

  it('concatenates multi-part model builders', async () => {
    const { ort, getLastCreateArg } = makeFakeOrt()
    const imp = makeImports({ ort })
    unwrap(
      await imp.load(
        [new Uint8Array([1, 2]), new Uint8Array([3, 4])],
        GraphEncoding.ONNX,
        ExecutionTarget.CPU
      )
    )
    expect(getLastCreateArg()).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('runs the full set-input / compute / get-output flow (by index)', async () => {
    const { ort } = makeFakeOrt()
    const imp = makeImports({ ort })
    const graph = unwrap(await imp.load([MODEL], GraphEncoding.ONNX, ExecutionTarget.CPU))
    const ctx = unwrap(imp['init-execution-context'](graph))

    unwrap(imp['set-input'](ctx, 0, f32Tensor([1, 2, 3, 4], [1, 4])))
    unwrap(await imp.compute(ctx))

    const out = unwrap(imp['get-output'](ctx, 0))
    expect(out.type).toBe(TensorType.FP32)
    expect(out.dimensions).toEqual([1, 4])
    expect(readF32(out)).toEqual([2, 4, 6, 8])
  })

  it('supports set-input-named and get-output-named', async () => {
    const { ort } = makeFakeOrt({ inputNames: ['x'], outputNames: ['z'] })
    const imp = makeImports({ ort })
    const graph = unwrap(await imp.load([MODEL], GraphEncoding.ONNX, ExecutionTarget.CPU))
    const ctx = unwrap(imp['init-execution-context'](graph))

    // The fake doubles whatever it finds at the first input name.
    unwrap(imp['set-input-named'](ctx, 'x', f32Tensor([5, 10], [2])))
    unwrap(await imp.compute(ctx))

    const out = unwrap(imp['get-output-named'](ctx, 'z'))
    expect(readF32(out)).toEqual([10, 20])
  })

  it('records inference stats after compute', async () => {
    const { ort } = makeFakeOrt()
    const imp = makeImports({ ort })
    const graph = unwrap(await imp.load([MODEL], GraphEncoding.ONNX, ExecutionTarget.CPU))
    const ctx = unwrap(imp['init-execution-context'](graph))
    unwrap(imp['set-input'](ctx, 0, f32Tensor([1], [1])))
    unwrap(await imp.compute(ctx))
    const stats = imp['get-last-inference-stats'](ctx)
    expect(stats).not.toBeNull()
    expect(typeof stats!.computeTimeMs).toBe('number')
  })

  it('rejects non-ONNX encodings', async () => {
    const { ort } = makeFakeOrt()
    const imp = makeImports({ ort })
    const r = await imp.load([MODEL], GraphEncoding.OPENVINO, ExecutionTarget.CPU)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe(NnErrorCode.INVALID_ENCODING)
  })

  it('rejects unsupported tensor element types', async () => {
    const { ort } = makeFakeOrt()
    const imp = makeImports({ ort })
    const graph = unwrap(await imp.load([MODEL], GraphEncoding.ONNX, ExecutionTarget.CPU))
    const ctx = unwrap(imp['init-execution-context'](graph))
    const r = imp['set-input'](ctx, 0, {
      type: TensorType.FP8_E4M3,
      dimensions: [1],
      data: new Uint8Array([0]),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe(NnErrorCode.INVALID_ENCODING)
  })

  it('errors on unknown handles and indices', async () => {
    const { ort } = makeFakeOrt()
    const imp = makeImports({ ort })
    const graph = unwrap(await imp.load([MODEL], GraphEncoding.ONNX, ExecutionTarget.CPU))
    const ctx = unwrap(imp['init-execution-context'](graph))

    expect(imp['init-execution-context'](999).ok).toBe(false)
    expect(imp['set-input'](999, 0, f32Tensor([1], [1])).ok).toBe(false)
    expect(imp['set-input'](ctx, 99, f32Tensor([1], [1])).ok).toBe(false)

    unwrap(imp['set-input'](ctx, 0, f32Tensor([1], [1])))
    unwrap(await imp.compute(ctx))
    const bad = imp['get-output'](ctx, 99)
    expect(bad.ok).toBe(false)
  })

  it('surfaces runtime errors from the session', async () => {
    const { ort } = makeFakeOrt({
      run: () => {
        throw new Error('kernel exploded')
      },
    })
    const imp = makeImports({ ort })
    const graph = unwrap(await imp.load([MODEL], GraphEncoding.ONNX, ExecutionTarget.CPU))
    const ctx = unwrap(imp['init-execution-context'](graph))
    unwrap(imp['set-input'](ctx, 0, f32Tensor([1], [1])))
    const r = await imp.compute(ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe(NnErrorCode.RUNTIME_ERROR)
      expect(r.error.message).toContain('kernel exploded')
    }
  })

  it('does not support load-by-name', () => {
    const { ort } = makeFakeOrt()
    const imp = makeImports({ ort })
    const r = imp['load-by-name']('resnet', ExecutionTarget.CPU)
    expect(r.ok).toBe(false)
  })

  it('shares graphs across interfaces via a common ResourceContext', async () => {
    const { ort } = makeFakeOrt()
    const context = new ResourceContext()
    // Two separate plugin instances (e.g. nn/graph and nn/inference) sharing
    // the polyfill's context must operate on the same backend state.
    const grapher = onnxNnImplementation
      .create({ context, ort } as OnnxNnConfig)
      .getImports() as unknown as NnImports
    const runner = onnxNnImplementation
      .create({ context, ort } as OnnxNnConfig)
      .getImports() as unknown as NnImports

    const graph = unwrap(await grapher.load([MODEL], GraphEncoding.ONNX, ExecutionTarget.CPU))
    const ctx = unwrap(runner['init-execution-context'](graph))
    unwrap(runner['set-input'](ctx, 0, f32Tensor([3, 6], [2])))
    unwrap(await runner.compute(ctx))
    expect(readF32(unwrap(runner['get-output'](ctx, 0)))).toEqual([6, 12])
  })

  it('isolates state between independent contexts', async () => {
    const { ort } = makeFakeOrt()
    const a = makeImports({ ort })
    const b = makeImports({ ort })
    const graphA = unwrap(await a.load([MODEL], GraphEncoding.ONNX, ExecutionTarget.CPU))
    // b never loaded graphA's handle.
    expect(b['get-input-names'](graphA)).toBeNull()
  })
})
