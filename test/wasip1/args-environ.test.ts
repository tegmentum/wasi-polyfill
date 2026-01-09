/**
 * WASI Preview 1 Args and Environ Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createArgsEnvironFunctions } from '../../src/wasip1/args-environ.js'
import { WasiMemory } from '../../src/wasip1/memory.js'
import { Errno } from '../../src/wasip1/types.js'

describe('WASIP1 Args and Environ', () => {
  let memory: WasiMemory
  let wasmMemory: WebAssembly.Memory

  beforeEach(() => {
    wasmMemory = new WebAssembly.Memory({ initial: 1 })
    memory = new WasiMemory()
    memory.attach(wasmMemory)
  })

  describe('args_sizes_get', () => {
    it('returns zero counts with no args', () => {
      const fns = createArgsEnvironFunctions(memory, { args: [] })

      const result = fns.args_sizes_get(0, 4)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(0)).toBe(0) // argc
      expect(memory.readU32(4)).toBe(0) // argv_buf_size
    })

    it('returns correct counts with args', () => {
      const fns = createArgsEnvironFunctions(memory, { args: ['prog', 'arg1', 'arg2'] })

      const result = fns.args_sizes_get(0, 4)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(0)).toBe(3) // argc
      // argv_buf_size = 'prog\0' + 'arg1\0' + 'arg2\0' = 5 + 5 + 5 = 15
      expect(memory.readU32(4)).toBe(15)
    })

    it('handles unicode args', () => {
      const fns = createArgsEnvironFunctions(memory, { args: ['你好', '🌍'] })

      const result = fns.args_sizes_get(0, 4)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(0)).toBe(2) // argc
      // UTF-8: '你好' = 6 bytes + '\0', '🌍' = 4 bytes + '\0' = 7 + 5 = 12
      expect(memory.readU32(4)).toBe(12)
    })

    it('defaults to empty args', () => {
      const fns = createArgsEnvironFunctions(memory, {})

      const result = fns.args_sizes_get(0, 4)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(0)).toBe(0)
      expect(memory.readU32(4)).toBe(0)
    })
  })

  describe('args_get', () => {
    it('returns SUCCESS with no args', () => {
      const fns = createArgsEnvironFunctions(memory, { args: [] })

      const result = fns.args_get(0, 100)

      expect(result).toBe(Errno.SUCCESS)
    })

    it('writes args to memory', () => {
      const fns = createArgsEnvironFunctions(memory, { args: ['prog', 'arg1'] })

      // argv array starts at 0, buf starts at 100
      const result = fns.args_get(0, 100)

      expect(result).toBe(Errno.SUCCESS)

      // Check argv pointers
      const ptr0 = memory.readU32(0)
      const ptr1 = memory.readU32(4)
      expect(ptr0).toBe(100)
      expect(ptr1).toBe(105) // 100 + 5 ('prog\0')

      // Check arg strings
      expect(memory.readString(ptr0, 4)).toBe('prog')
      expect(memory.readString(ptr1, 4)).toBe('arg1')
    })

    it('null-terminates strings', () => {
      const fns = createArgsEnvironFunctions(memory, { args: ['test'] })

      fns.args_get(0, 100)

      // Read the null terminator
      expect(memory.readU8(104)).toBe(0) // 'test' + '\0'
    })

    it('handles multiple args correctly', () => {
      const args = ['a', 'bb', 'ccc', 'dddd']
      const fns = createArgsEnvironFunctions(memory, { args })

      fns.args_get(0, 100)

      // Check all pointers
      expect(memory.readU32(0)).toBe(100)
      expect(memory.readU32(4)).toBe(102) // 100 + 2 ('a\0')
      expect(memory.readU32(8)).toBe(105) // 102 + 3 ('bb\0')
      expect(memory.readU32(12)).toBe(109) // 105 + 4 ('ccc\0')

      // Check all strings
      expect(memory.readString(100, 1)).toBe('a')
      expect(memory.readString(102, 2)).toBe('bb')
      expect(memory.readString(105, 3)).toBe('ccc')
      expect(memory.readString(109, 4)).toBe('dddd')
    })
  })

  describe('environ_sizes_get', () => {
    it('returns zero counts with no env', () => {
      const fns = createArgsEnvironFunctions(memory, { env: {} })

      const result = fns.environ_sizes_get(0, 4)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(0)).toBe(0) // environc
      expect(memory.readU32(4)).toBe(0) // environ_buf_size
    })

    it('returns correct counts with env vars', () => {
      const fns = createArgsEnvironFunctions(memory, {
        env: { HOME: '/home', PATH: '/bin' }
      })

      const result = fns.environ_sizes_get(0, 4)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(0)).toBe(2) // environc
      // 'HOME=/home\0' = 11, 'PATH=/bin\0' = 10 = 21
      expect(memory.readU32(4)).toBe(21)
    })

    it('defaults to empty env', () => {
      const fns = createArgsEnvironFunctions(memory, {})

      const result = fns.environ_sizes_get(0, 4)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(0)).toBe(0)
      expect(memory.readU32(4)).toBe(0)
    })

    it('handles env with special characters', () => {
      const fns = createArgsEnvironFunctions(memory, {
        env: { VAR: 'value=with=equals' }
      })

      const result = fns.environ_sizes_get(0, 4)

      expect(result).toBe(Errno.SUCCESS)
      expect(memory.readU32(0)).toBe(1)
      // 'VAR=value=with=equals\0' = 22
      expect(memory.readU32(4)).toBe(22)
    })
  })

  describe('environ_get', () => {
    it('returns SUCCESS with no env', () => {
      const fns = createArgsEnvironFunctions(memory, { env: {} })

      const result = fns.environ_get(0, 100)

      expect(result).toBe(Errno.SUCCESS)
    })

    it('writes env vars to memory', () => {
      const fns = createArgsEnvironFunctions(memory, {
        env: { A: '1', B: '2' }
      })

      const result = fns.environ_get(0, 100)

      expect(result).toBe(Errno.SUCCESS)

      // Check pointers
      const ptr0 = memory.readU32(0)
      const ptr1 = memory.readU32(4)
      expect(ptr0).toBe(100)
      expect(ptr1).toBe(104) // 100 + 4 ('A=1\0')

      // Check strings
      expect(memory.readString(ptr0, 3)).toBe('A=1')
      expect(memory.readString(ptr1, 3)).toBe('B=2')
    })

    it('formats as KEY=VALUE', () => {
      const fns = createArgsEnvironFunctions(memory, {
        env: { MYVAR: 'myvalue' }
      })

      fns.environ_get(0, 100)

      expect(memory.readString(100, 13)).toBe('MYVAR=myvalue')
    })

    it('null-terminates strings', () => {
      const fns = createArgsEnvironFunctions(memory, {
        env: { X: 'Y' }
      })

      fns.environ_get(0, 100)

      // 'X=Y\0' - null at position 103
      expect(memory.readU8(103)).toBe(0)
    })

    it('handles empty value', () => {
      const fns = createArgsEnvironFunctions(memory, {
        env: { EMPTY: '' }
      })

      fns.environ_get(0, 100)

      expect(memory.readString(100, 6)).toBe('EMPTY=')
    })
  })

  describe('integration', () => {
    it('args and environ work together', () => {
      const fns = createArgsEnvironFunctions(memory, {
        args: ['prog', '--flag'],
        env: { HOME: '/home/user' }
      })

      // Get sizes
      fns.args_sizes_get(0, 4)
      fns.environ_sizes_get(8, 12)

      const argc = memory.readU32(0)
      const argvBufSize = memory.readU32(4)
      const environc = memory.readU32(8)
      const environBufSize = memory.readU32(12)

      expect(argc).toBe(2)
      expect(environc).toBe(1)

      // Get data
      const argvPtr = 100
      const argvBufPtr = argvPtr + argc * 4
      const environPtr = argvBufPtr + argvBufSize
      const environBufPtr = environPtr + environc * 4

      fns.args_get(argvPtr, argvBufPtr)
      fns.environ_get(environPtr, environBufPtr)

      // Verify args
      const arg0Ptr = memory.readU32(argvPtr)
      const arg1Ptr = memory.readU32(argvPtr + 4)
      expect(memory.readString(arg0Ptr, 4)).toBe('prog')
      expect(memory.readString(arg1Ptr, 6)).toBe('--flag')

      // Verify environ
      const env0Ptr = memory.readU32(environPtr)
      expect(memory.readString(env0Ptr, 15)).toBe('HOME=/home/user')
    })

    it('handles large number of args', () => {
      const args = Array.from({ length: 100 }, (_, i) => `arg${i}`)
      const fns = createArgsEnvironFunctions(memory, { args })

      fns.args_sizes_get(0, 4)

      expect(memory.readU32(0)).toBe(100)
    })

    it('handles large number of env vars', () => {
      const env: Record<string, string> = {}
      for (let i = 0; i < 50; i++) {
        env[`VAR${i}`] = `value${i}`
      }
      const fns = createArgsEnvironFunctions(memory, { env })

      fns.environ_sizes_get(0, 4)

      expect(memory.readU32(0)).toBe(50)
    })
  })
})
