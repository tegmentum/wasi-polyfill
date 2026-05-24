/**
 * Regression test for WebGPU resource-drops (REMEDIATION-PLAN Phase 3.5).
 *
 * The plugin previously omitted [resource-drop] handlers for several leaf GPU
 * resource types (texture-view, sampler, bind-group(-layout), pipeline-layout,
 * shader-module, render/compute-pipeline, command-buffer), so their handle
 * tables grew without bound. These should now be present and safe to call.
 */

import { describe, it, expect } from 'vitest'
import { browserWebGPUImplementation } from '../../../../src/wasip2/plugins/webgpu/index.js'

function gpuImports(): Record<string, unknown> {
  const instance = browserWebGPUImplementation.create({})
  const outer = instance.getImports()
  return outer['wasi:webgpu/webgpu@0.0.1'] as Record<string, unknown>
}

describe('webgpu plugin resource-drops', () => {
  const REQUIRED_DROPS = [
    '[resource-drop]gpu-texture-view',
    '[resource-drop]gpu-sampler',
    '[resource-drop]gpu-bind-group',
    '[resource-drop]gpu-bind-group-layout',
    '[resource-drop]gpu-pipeline-layout',
    '[resource-drop]gpu-shader-module',
    '[resource-drop]gpu-render-pipeline',
    '[resource-drop]gpu-compute-pipeline',
    '[resource-drop]gpu-command-buffer',
  ]

  it('exposes a drop handler for every leaf GPU resource', () => {
    const imports = gpuImports()
    for (const key of REQUIRED_DROPS) {
      expect(typeof imports[key], key).toBe('function')
    }
  })

  it('drops are safe no-ops on unknown handles', () => {
    const imports = gpuImports()
    for (const key of REQUIRED_DROPS) {
      const drop = imports[key] as (h: number) => void
      expect(() => drop(999999)).not.toThrow()
    }
  })

  it('create-query-set reports an error instead of a fake handle', () => {
    const imports = gpuImports()
    const createQuerySet = imports['[method]gpu-device.create-query-set'] as (
      handle: number,
      descriptor: Record<string, unknown>
    ) => { tag: string }
    const result = createQuerySet(1, {})
    expect(result.tag).toBe('err')
  })
})
