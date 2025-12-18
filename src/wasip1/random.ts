/**
 * WASI Preview 1 random functions
 *
 * Implements random_get.
 *
 * @packageDocumentation
 */

import { Errno } from './types.js'
import { WasiMemory } from './memory.js'

/**
 * Creates WASI random functions.
 */
export function createRandomFunctions(memory: WasiMemory): {
  random_get: (bufPtr: number, bufLen: number) => number
} {
  return {
    /**
     * random_get(buf: i32, buf_len: size) -> errno
     *
     * Write high-quality random data into a buffer.
     * This function blocks when the implementation is unable to immediately
     * provide sufficient high-quality random data.
     */
    random_get(bufPtr: number, bufLen: number): number {
      if (bufLen === 0) {
        return Errno.SUCCESS
      }

      try {
        // Use crypto.getRandomValues for cryptographically secure random data
        const randomBytes = new Uint8Array(bufLen)

        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
          // Browser or Node.js with crypto
          // getRandomValues has a limit of 65536 bytes per call
          const maxChunk = 65536
          for (let offset = 0; offset < bufLen; offset += maxChunk) {
            const chunkSize = Math.min(maxChunk, bufLen - offset)
            const chunk = new Uint8Array(chunkSize)
            crypto.getRandomValues(chunk)
            randomBytes.set(chunk, offset)
          }
        } else {
          // Fallback: Math.random (NOT cryptographically secure)
          // This should only happen in very old environments
          for (let i = 0; i < bufLen; i++) {
            randomBytes[i] = Math.floor(Math.random() * 256)
          }
        }

        memory.writeBytes(bufPtr, randomBytes)
        return Errno.SUCCESS
      } catch {
        // If random generation fails for any reason
        return Errno.EIO
      }
    },
  }
}
