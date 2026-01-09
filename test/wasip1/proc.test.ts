/**
 * WASI Preview 1 Process Tests
 */

import { describe, it, expect, vi } from 'vitest'
import { createProcFunctions, WasiExitError } from '../../src/wasip1/proc.js'
import { Errno } from '../../src/wasip1/types.js'

describe('WASIP1 Process', () => {
  describe('WasiExitError', () => {
    it('extends Error', () => {
      const error = new WasiExitError(0)
      expect(error instanceof Error).toBe(true)
      expect(error instanceof WasiExitError).toBe(true)
    })

    it('has correct name', () => {
      const error = new WasiExitError(0)
      expect(error.name).toBe('WasiExitError')
    })

    it('stores exit code', () => {
      const error = new WasiExitError(42)
      expect(error.code).toBe(42)
    })

    it('has descriptive message', () => {
      const error = new WasiExitError(1)
      expect(error.message).toBe('WASI exit with code 1')
    })

    it('handles zero exit code', () => {
      const error = new WasiExitError(0)
      expect(error.code).toBe(0)
      expect(error.message).toBe('WASI exit with code 0')
    })

    it('handles negative exit codes', () => {
      const error = new WasiExitError(-1)
      expect(error.code).toBe(-1)
    })

    it('handles large exit codes', () => {
      const error = new WasiExitError(255)
      expect(error.code).toBe(255)
    })
  })

  describe('proc_exit', () => {
    it('throws WasiExitError', () => {
      const fns = createProcFunctions()

      expect(() => fns.proc_exit(0)).toThrow(WasiExitError)
    })

    it('throws with correct exit code', () => {
      const fns = createProcFunctions()

      try {
        fns.proc_exit(42)
      } catch (e) {
        expect(e).toBeInstanceOf(WasiExitError)
        expect((e as WasiExitError).code).toBe(42)
      }
    })

    it('throws even with returnOnExit true', () => {
      const fns = createProcFunctions({ returnOnExit: true })

      expect(() => fns.proc_exit(0)).toThrow(WasiExitError)
    })

    it('calls onExit callback before throwing', () => {
      const onExit = vi.fn()
      const fns = createProcFunctions({ onExit })

      try {
        fns.proc_exit(123)
      } catch {
        // Expected
      }

      expect(onExit).toHaveBeenCalledWith(123)
    })

    it('updates exit code before throwing', () => {
      const fns = createProcFunctions()

      expect(fns.getExitCode()).toBeNull()

      try {
        fns.proc_exit(99)
      } catch {
        // Expected
      }

      expect(fns.getExitCode()).toBe(99)
    })

    it('can exit with code 0', () => {
      const fns = createProcFunctions()

      try {
        fns.proc_exit(0)
      } catch (e) {
        expect((e as WasiExitError).code).toBe(0)
      }

      expect(fns.getExitCode()).toBe(0)
    })
  })

  describe('proc_raise', () => {
    it('returns ENOSYS (signals not supported)', () => {
      const fns = createProcFunctions()

      const result = fns.proc_raise(9) // SIGKILL

      expect(result).toBe(Errno.ENOSYS)
    })

    it('returns ENOSYS for any signal', () => {
      const fns = createProcFunctions()

      for (const sig of [1, 2, 9, 15, 0]) {
        expect(fns.proc_raise(sig)).toBe(Errno.ENOSYS)
      }
    })

    it('does not affect exit code', () => {
      const fns = createProcFunctions()

      fns.proc_raise(15)

      expect(fns.getExitCode()).toBeNull()
    })
  })

  describe('sched_yield', () => {
    it('returns SUCCESS', () => {
      const fns = createProcFunctions()

      const result = fns.sched_yield()

      expect(result).toBe(Errno.SUCCESS)
    })

    it('is a no-op in JavaScript', () => {
      const fns = createProcFunctions()

      // Can be called multiple times without issue
      for (let i = 0; i < 100; i++) {
        expect(fns.sched_yield()).toBe(Errno.SUCCESS)
      }
    })

    it('does not affect exit code', () => {
      const fns = createProcFunctions()

      fns.sched_yield()

      expect(fns.getExitCode()).toBeNull()
    })
  })

  describe('getExitCode', () => {
    it('returns null initially', () => {
      const fns = createProcFunctions()

      expect(fns.getExitCode()).toBeNull()
    })

    it('returns exit code after proc_exit', () => {
      const fns = createProcFunctions()

      try {
        fns.proc_exit(5)
      } catch {
        // Expected
      }

      expect(fns.getExitCode()).toBe(5)
    })

    it('preserves exit code after multiple calls', () => {
      const fns = createProcFunctions()

      try {
        fns.proc_exit(1)
      } catch {
        // Expected
      }

      // Multiple getExitCode calls should return same value
      expect(fns.getExitCode()).toBe(1)
      expect(fns.getExitCode()).toBe(1)
      expect(fns.getExitCode()).toBe(1)
    })
  })

  describe('options', () => {
    it('onExit is called with exit code', () => {
      const onExit = vi.fn()
      const fns = createProcFunctions({ onExit })

      try {
        fns.proc_exit(42)
      } catch {
        // Expected
      }

      expect(onExit).toHaveBeenCalledTimes(1)
      expect(onExit).toHaveBeenCalledWith(42)
    })

    it('onExit is called before throw', () => {
      const events: string[] = []
      const onExit = vi.fn(() => events.push('onExit'))

      const fns = createProcFunctions({ onExit })

      try {
        fns.proc_exit(0)
      } catch {
        events.push('catch')
      }

      expect(events).toEqual(['onExit', 'catch'])
    })

    it('defaults work without options', () => {
      const fns = createProcFunctions()

      expect(fns.sched_yield()).toBe(Errno.SUCCESS)
      expect(fns.proc_raise(1)).toBe(Errno.ENOSYS)
      expect(fns.getExitCode()).toBeNull()
    })

    it('empty options object works', () => {
      const fns = createProcFunctions({})

      expect(fns.sched_yield()).toBe(Errno.SUCCESS)
    })
  })

  describe('error handling', () => {
    it('WasiExitError can be caught and inspected', () => {
      const fns = createProcFunctions()

      let caught: WasiExitError | null = null
      try {
        fns.proc_exit(127)
      } catch (e) {
        if (e instanceof WasiExitError) {
          caught = e
        }
      }

      expect(caught).not.toBeNull()
      expect(caught!.code).toBe(127)
      expect(caught!.message).toBe('WASI exit with code 127')
    })

    it('WasiExitError has stack trace', () => {
      const fns = createProcFunctions()

      try {
        fns.proc_exit(1)
      } catch (e) {
        expect((e as Error).stack).toBeDefined()
        expect((e as Error).stack).toContain('WasiExitError')
      }
    })
  })
})
