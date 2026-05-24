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

/** Options for the poll functions. */
export interface PollOptions {
  /**
   * When true and no subscription is ready, block until the earliest clock
   * deadline (so a guest `nanosleep`/`poll` timeout actually waits instead of
   * busy-looping). Default false, preserving the non-blocking behavior.
   *
   * Blocking is synchronous: it uses `Atomics.wait` on a private
   * SharedArrayBuffer when available (efficient, no spinning), falling back to
   * a busy-wait only where `Atomics.wait` is disallowed (e.g. the main browser
   * thread). Note: FD readiness is still evaluated synchronously and is not
   * re-checked during the wait — only clock deadlines drive blocking.
   */
  blocking?: boolean
}

/**
 * Block the current thread for up to `ms` milliseconds. Prefers `Atomics.wait`
 * (which truly suspends the thread) and falls back to a busy-wait where it is
 * unavailable or disallowed.
 */
function blockFor(ms: number): void {
  if (ms <= 0) return
  try {
    // No notify is ever sent, so this returns after the timeout elapses.
    const signal = new Int32Array(new SharedArrayBuffer(4))
    Atomics.wait(signal, 0, 0, ms)
  } catch {
    const end = performance.now() + ms
    while (performance.now() < end) {
      // busy-wait: Atomics.wait unavailable (e.g. main browser thread)
    }
  }
}

/**
 * Creates WASI poll functions.
 */
export function createPollFunctions(
  memory: WasiMemory,
  fdTable: FileDescriptorTable,
  options: PollOptions = {}
): {
  poll_oneoff: (inPtr: number, outPtr: number, nsubscriptions: number, neventsPtr: number) => number
} {
  const blocking = options.blocking ?? false
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

      // Clock subscriptions whose deadline has not yet passed, recorded so we
      // can block on the earliest of them when nothing is ready (blocking mode).
      const pendingClocks: Array<{ userdata: bigint; targetNs: bigint; realtime: boolean }> = []

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
            } else {
              // Not yet expired — remember it so blocking mode can wait for it.
              pendingClocks.push({
                userdata: sub.userdata,
                targetNs,
                realtime: clockId === ClockId.REALTIME,
              })
            }
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

      // If nothing is ready but there are clock subscriptions, block until the
      // earliest deadline (opt-in). Otherwise the relative-clock case never
      // fires — its deadline is recomputed against `now` on every call — so a
      // guest sleep would busy-loop forever. With blocking off we return 0
      // events and let the caller retry (the documented limitation).
      if (blocking && events.length === 0 && pendingClocks.length > 0) {
        const earliest = pendingClocks.reduce((a, b) => (b.targetNs < a.targetNs ? b : a))
        const currentNs = earliest.realtime ? realtimeNs : nowNs
        blockFor(Number((earliest.targetNs - currentNs) / 1_000_000n))

        // Time has advanced; emit every clock whose deadline has now passed.
        const afterMonoNs = BigInt(Math.floor((performance.now() - monotonicStart) * 1_000_000))
        const afterRealNs = BigInt(Date.now()) * 1_000_000n
        for (const clock of pendingClocks) {
          const after = clock.realtime ? afterRealNs : afterMonoNs
          if (after >= clock.targetNs) {
            events.push({ userdata: clock.userdata, error: Errno.SUCCESS, type: EventType.CLOCK })
          }
        }
      }

      // Write events to output buffer
      for (let i = 0; i < events.length; i++) {
        memory.writeEvent(outPtr + i * EVENT_SIZE, events[i]!)
      }

      memory.writeU32(neventsPtr, events.length)
      return Errno.SUCCESS
    },
  }
}
