/**
 * WASI Preview 1 poll functions
 *
 * Implements poll_oneoff for async I/O.
 *
 * @packageDocumentation
 */

import { Errno, EventType, ClockId, Rights, SubclockFlags, EVENT_SIZE, SUBSCRIPTION_SIZE } from './types.js'
import { WasiMemory } from './memory.js'
import { FileDescriptorTable } from './fd-table.js'

/**
 * Creates WASI poll functions.
 */
export function createPollFunctions(
  memory: WasiMemory,
  fdTable: FileDescriptorTable
): {
  poll_oneoff: (inPtr: number, outPtr: number, nsubscriptions: number, neventsPtr: number) => number
} {
  // Track monotonic start for clock calculations
  const monotonicStart = performance.now()

  return {
    /**
     * poll_oneoff(in, out, nsubscriptions, nevents) -> errno
     *
     * Poll for events on a set of subscriptions.
     *
     * This is a synchronous implementation that handles:
     * - Clock subscriptions (immediate if deadline passed)
     * - FD read/write readiness (immediate check only)
     *
     * Note: True blocking poll is not possible in synchronous JavaScript.
     * For blocking behavior, use SharedArrayBuffer + Atomics or async patterns.
     */
    poll_oneoff(inPtr: number, outPtr: number, nsubscriptions: number, neventsPtr: number): number {
      if (nsubscriptions === 0) {
        memory.writeU32(neventsPtr, 0)
        return Errno.SUCCESS
      }

      const events: Array<{
        userdata: bigint
        error: number
        type: EventType
        nbytes?: bigint
        flags?: number
      }> = []

      // Get current time for clock comparisons
      const nowMs = performance.now() - monotonicStart
      const nowNs = BigInt(Math.floor(nowMs * 1_000_000))
      const realtimeNs = BigInt(Date.now()) * 1_000_000n

      // Process each subscription
      for (let i = 0; i < nsubscriptions; i++) {
        const subPtr = inPtr + i * SUBSCRIPTION_SIZE
        const sub = memory.readSubscription(subPtr)

        switch (sub.type) {
          case EventType.CLOCK: {
            // Clock subscription
            const clockId = sub.clockId!
            const timeout = sub.timeout!
            const flags = sub.clockFlags!

            let targetNs: bigint
            if (flags & SubclockFlags.SUBSCRIPTION_CLOCK_ABSTIME) {
              // Absolute time
              targetNs = timeout
            } else {
              // Relative time (duration from now)
              if (clockId === ClockId.REALTIME) {
                targetNs = realtimeNs + timeout
              } else {
                targetNs = nowNs + timeout
              }
            }

            // Check if clock has expired
            const currentNs = clockId === ClockId.REALTIME ? realtimeNs : nowNs
            if (currentNs >= targetNs) {
              // Clock event ready
              events.push({
                userdata: sub.userdata,
                error: Errno.SUCCESS,
                type: EventType.CLOCK,
              })
            }
            // Note: If clock hasn't expired, we don't add an event
            // A true implementation would block until the clock expires
            break
          }

          case EventType.FD_READ: {
            // FD read readiness
            const fd = sub.fd!
            const entry = fdTable.get(fd)

            if (!entry) {
              events.push({
                userdata: sub.userdata,
                error: Errno.EBADF,
                type: EventType.FD_READ,
              })
            } else if (!fdTable.hasRights(fd, Rights.POLL_FD_READWRITE)) {
              events.push({
                userdata: sub.userdata,
                error: Errno.ENOTCAPABLE,
                type: EventType.FD_READ,
              })
            } else {
              // For stdin, check if data might be available
              // For files, assume always ready (synchronous reads)
              let ready = true
              let nbytes = 0n

              if (entry.type === 'stdin') {
                // Stdin might not be ready
                // Without proper async support, assume ready
                ready = true
                nbytes = 1n // Unknown amount
              } else if (entry.type === 'file') {
                // Files are always ready
                const resource = entry.resource as { size?: () => bigint } | undefined
                if (resource?.size) {
                  const size = resource.size()
                  const remaining = size - entry.position
                  nbytes = remaining > 0n ? remaining : 0n
                }
              }

              if (ready) {
                events.push({
                  userdata: sub.userdata,
                  error: Errno.SUCCESS,
                  type: EventType.FD_READ,
                  nbytes,
                  flags: 0,
                })
              }
            }
            break
          }

          case EventType.FD_WRITE: {
            // FD write readiness
            const fd = sub.fd!
            const entry = fdTable.get(fd)

            if (!entry) {
              events.push({
                userdata: sub.userdata,
                error: Errno.EBADF,
                type: EventType.FD_WRITE,
              })
            } else if (!fdTable.hasRights(fd, Rights.POLL_FD_READWRITE)) {
              events.push({
                userdata: sub.userdata,
                error: Errno.ENOTCAPABLE,
                type: EventType.FD_WRITE,
              })
            } else {
              // Stdout/stderr are always writable
              // Files are always writable (in our implementation)
              events.push({
                userdata: sub.userdata,
                error: Errno.SUCCESS,
                type: EventType.FD_WRITE,
                nbytes: BigInt(Number.MAX_SAFE_INTEGER), // Can write a lot
                flags: 0,
              })
            }
            break
          }

          default:
            // Unknown subscription type
            events.push({
              userdata: sub.userdata,
              error: Errno.EINVAL,
              type: sub.type,
            })
        }
      }

      // If no events are ready and there are clock subscriptions,
      // we should ideally block until the earliest clock expires.
      // Since we can't block in sync JS, we return with 0 events
      // and let the caller retry.

      // Write events to output buffer
      for (let i = 0; i < events.length; i++) {
        memory.writeEvent(outPtr + i * EVENT_SIZE, events[i]!)
      }

      memory.writeU32(neventsPtr, events.length)
      return Errno.SUCCESS
    },
  }
}
