/**
 * wasi:nn plugin tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mockNnImplementation,
  TensorType,
  GraphEncoding,
  ExecutionTarget,
  NnErrorCode,
  type Tensor,
  type NnPluginConfig,
} from '../../../../../src/wasip2/plugins/nn/index.js'

describe('wasi:nn', () => {
  describe('mockNnImplementation', () => {
    let instance: ReturnType<typeof mockNnImplementation.create>
    let imports: Record<string, unknown>

    beforeEach(() => {
      instance = mockNnImplementation.create({} as NnPluginConfig)
      imports = instance.getImports()
    })

    afterEach(() => {
      instance.destroy()
    })

    describe('backend info', () => {
      it('should report backend info', () => {
        const getBackendInfo = imports['get-backend-info'] as () => { name: string; encodings: string[] }
        const info = getBackendInfo()

        expect(info.name).toBe('mock')
        expect(info.encodings).toContain(GraphEncoding.ONNX)
      })

      it('should report supported', () => {
        const isSupported = imports['is-supported'] as () => boolean
        expect(isSupported()).toBe(true)
      })
    })

    describe('graph loading', () => {
      it('should load model by name', () => {
        const loadByName = imports['load-by-name'] as (name: string, target: ExecutionTarget) => { ok: boolean; value?: number; error?: { code: string } }

        const result = loadByName('identity', ExecutionTarget.CPU)
        expect(result.ok).toBe(true)
        expect(result.value).toBeGreaterThan(0)
      })

      it('should fail for unknown model', () => {
        const loadByName = imports['load-by-name'] as (name: string, target: ExecutionTarget) => { ok: boolean; error?: { code: string } }

        const result = loadByName('nonexistent', ExecutionTarget.CPU)
        expect(result.ok).toBe(false)
        expect(result.error?.code).toBe(NnErrorCode.INVALID_ARGUMENT)
      })

      it('should get input names', () => {
        const loadByName = imports['load-by-name'] as (name: string, target: ExecutionTarget) => { ok: boolean; value?: number }
        const getInputNames = imports['get-input-names'] as (handle: number) => string[] | null

        const result = loadByName('add', ExecutionTarget.CPU)
        expect(result.ok).toBe(true)

        const names = getInputNames(result.value!)
        expect(names).toEqual(['a', 'b'])
      })

      it('should get output names', () => {
        const loadByName = imports['load-by-name'] as (name: string, target: ExecutionTarget) => { ok: boolean; value?: number }
        const getOutputNames = imports['get-output-names'] as (handle: number) => string[] | null

        const result = loadByName('add', ExecutionTarget.CPU)
        expect(result.ok).toBe(true)

        const names = getOutputNames(result.value!)
        expect(names).toEqual(['sum'])
      })

      it('should drop graph', () => {
        const loadByName = imports['load-by-name'] as (name: string, target: ExecutionTarget) => { ok: boolean; value?: number }
        const dropGraph = imports['drop-graph'] as (handle: number) => void
        const getInputNames = imports['get-input-names'] as (handle: number) => string[] | null

        const result = loadByName('identity', ExecutionTarget.CPU)
        expect(result.ok).toBe(true)

        dropGraph(result.value!)
        const names = getInputNames(result.value!)
        expect(names).toBeNull()
      })
    })

    describe('execution context', () => {
      it('should create execution context', () => {
        const loadByName = imports['load-by-name'] as (name: string, target: ExecutionTarget) => { ok: boolean; value?: number }
        const initContext = imports['init-execution-context'] as (graphHandle: number) => { ok: boolean; value?: number }

        const loadResult = loadByName('identity', ExecutionTarget.CPU)
        expect(loadResult.ok).toBe(true)

        const ctxResult = initContext(loadResult.value!)
        expect(ctxResult.ok).toBe(true)
        expect(ctxResult.value).toBeGreaterThan(0)
      })

      it('should fail for invalid graph', () => {
        const initContext = imports['init-execution-context'] as (graphHandle: number) => { ok: boolean; error?: { code: string } }

        const result = initContext(9999)
        expect(result.ok).toBe(false)
        expect(result.error?.code).toBe(NnErrorCode.INVALID_ARGUMENT)
      })
    })

    describe('inference', () => {
      it('should run identity inference', () => {
        const loadByName = imports['load-by-name'] as (name: string, target: ExecutionTarget) => { ok: boolean; value?: number }
        const initContext = imports['init-execution-context'] as (graphHandle: number) => { ok: boolean; value?: number }
        const setInputNamed = imports['set-input-named'] as (handle: number, name: string, tensor: Tensor) => { ok: boolean }
        const compute = imports['compute'] as (handle: number) => { ok: boolean }
        const getOutputNamed = imports['get-output-named'] as (handle: number, name: string) => { ok: boolean; value?: Tensor }

        // Load model
        const loadResult = loadByName('identity', ExecutionTarget.CPU)
        expect(loadResult.ok).toBe(true)

        // Create context
        const ctxResult = initContext(loadResult.value!)
        expect(ctxResult.ok).toBe(true)

        // Create input tensor
        const inputData = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0])
        const inputTensor: Tensor = {
          type: TensorType.FP32,
          dimensions: [1, 10],
          data: new Uint8Array(inputData.buffer),
        }

        // Set input
        const setResult = setInputNamed(ctxResult.value!, 'input', inputTensor)
        expect(setResult.ok).toBe(true)

        // Compute
        const computeResult = compute(ctxResult.value!)
        expect(computeResult.ok).toBe(true)

        // Get output
        const outputResult = getOutputNamed(ctxResult.value!, 'output')
        expect(outputResult.ok).toBe(true)
        expect(outputResult.value).toBeDefined()

        // Verify output matches input (identity model)
        const outputData = new Float32Array(
          outputResult.value!.data.buffer,
          outputResult.value!.data.byteOffset,
          outputResult.value!.data.byteLength / 4
        )
        expect(Array.from(outputData)).toEqual(Array.from(inputData))
      })

      it('should run add inference', () => {
        const loadByName = imports['load-by-name'] as (name: string, target: ExecutionTarget) => { ok: boolean; value?: number }
        const initContext = imports['init-execution-context'] as (graphHandle: number) => { ok: boolean; value?: number }
        const setInputNamed = imports['set-input-named'] as (handle: number, name: string, tensor: Tensor) => { ok: boolean }
        const compute = imports['compute'] as (handle: number) => { ok: boolean }
        const getOutputNamed = imports['get-output-named'] as (handle: number, name: string) => { ok: boolean; value?: Tensor }

        // Load model
        const loadResult = loadByName('add', ExecutionTarget.CPU)
        expect(loadResult.ok).toBe(true)

        // Create context
        const ctxResult = initContext(loadResult.value!)
        expect(ctxResult.ok).toBe(true)

        // Create input tensors
        const aData = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        const bData = new Float32Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])

        const tensorA: Tensor = {
          type: TensorType.FP32,
          dimensions: [1, 10],
          data: new Uint8Array(aData.buffer),
        }

        const tensorB: Tensor = {
          type: TensorType.FP32,
          dimensions: [1, 10],
          data: new Uint8Array(bData.buffer),
        }

        // Set inputs
        setInputNamed(ctxResult.value!, 'a', tensorA)
        setInputNamed(ctxResult.value!, 'b', tensorB)

        // Compute
        const computeResult = compute(ctxResult.value!)
        expect(computeResult.ok).toBe(true)

        // Get output
        const outputResult = getOutputNamed(ctxResult.value!, 'sum')
        expect(outputResult.ok).toBe(true)

        // Verify output is sum
        const outputData = new Float32Array(
          outputResult.value!.data.buffer,
          outputResult.value!.data.byteOffset,
          outputResult.value!.data.byteLength / 4
        )

        const expected = [11, 22, 33, 44, 55, 66, 77, 88, 99, 110]
        expect(Array.from(outputData)).toEqual(expected)
      })

      it('should run softmax inference', () => {
        const loadByName = imports['load-by-name'] as (name: string, target: ExecutionTarget) => { ok: boolean; value?: number }
        const initContext = imports['init-execution-context'] as (graphHandle: number) => { ok: boolean; value?: number }
        const setInputNamed = imports['set-input-named'] as (handle: number, name: string, tensor: Tensor) => { ok: boolean }
        const compute = imports['compute'] as (handle: number) => { ok: boolean }
        const getOutputNamed = imports['get-output-named'] as (handle: number, name: string) => { ok: boolean; value?: Tensor }

        // Load model
        const loadResult = loadByName('softmax', ExecutionTarget.CPU)
        expect(loadResult.ok).toBe(true)

        // Create context
        const ctxResult = initContext(loadResult.value!)
        expect(ctxResult.ok).toBe(true)

        // Create input tensor (logits)
        const logits = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0, 0.0, 0.0, 0.0, 0.0, 0.0])
        const inputTensor: Tensor = {
          type: TensorType.FP32,
          dimensions: [1, 10],
          data: new Uint8Array(logits.buffer),
        }

        // Set input
        setInputNamed(ctxResult.value!, 'logits', inputTensor)

        // Compute
        compute(ctxResult.value!)

        // Get output
        const outputResult = getOutputNamed(ctxResult.value!, 'probabilities')
        expect(outputResult.ok).toBe(true)

        // Verify output is probabilities (sum to 1)
        const probs = new Float32Array(
          outputResult.value!.data.buffer,
          outputResult.value!.data.byteOffset,
          outputResult.value!.data.byteLength / 4
        )

        const sum = Array.from(probs).reduce((a, b) => a + b, 0)
        expect(sum).toBeCloseTo(1.0, 5)

        // Verify probabilities are in expected order (element 4 should be highest)
        expect(probs[4]).toBeGreaterThan(probs[3]!)
        expect(probs[3]).toBeGreaterThan(probs[2]!)
      })
    })

    describe('inference stats', () => {
      it('should return inference stats after compute', () => {
        const loadByName = imports['load-by-name'] as (name: string, target: ExecutionTarget) => { ok: boolean; value?: number }
        const initContext = imports['init-execution-context'] as (graphHandle: number) => { ok: boolean; value?: number }
        const setInputNamed = imports['set-input-named'] as (handle: number, name: string, tensor: Tensor) => { ok: boolean }
        const compute = imports['compute'] as (handle: number) => { ok: boolean }
        const getStats = imports['get-last-inference-stats'] as (handle: number) => { computeTimeMs: number } | null

        // Load and run
        const loadResult = loadByName('identity', ExecutionTarget.CPU)
        const ctxResult = initContext(loadResult.value!)

        const inputData = new Float32Array(10)
        setInputNamed(ctxResult.value!, 'input', {
          type: TensorType.FP32,
          dimensions: [1, 10],
          data: new Uint8Array(inputData.buffer),
        })

        compute(ctxResult.value!)

        // Get stats
        const stats = getStats(ctxResult.value!)
        expect(stats).not.toBeNull()
        expect(stats!.computeTimeMs).toBeGreaterThanOrEqual(0)
      })
    })

    describe('cleanup', () => {
      it('should drop execution context', () => {
        const loadByName = imports['load-by-name'] as (name: string, target: ExecutionTarget) => { ok: boolean; value?: number }
        const initContext = imports['init-execution-context'] as (graphHandle: number) => { ok: boolean; value?: number }
        const dropContext = imports['drop-execution-context'] as (handle: number) => void
        const getOutputNamed = imports['get-output-named'] as (handle: number, name: string) => { ok: boolean; error?: { code: string } }

        const loadResult = loadByName('identity', ExecutionTarget.CPU)
        const ctxResult = initContext(loadResult.value!)

        dropContext(ctxResult.value!)

        // Accessing dropped context should fail
        const result = getOutputNamed(ctxResult.value!, 'output')
        expect(result.ok).toBe(false)
      })
    })
  })
})
