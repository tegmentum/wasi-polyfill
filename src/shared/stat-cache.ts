/**
 * Filesystem stat caching utility
 *
 * Provides a TTL-based cache for filesystem metadata to reduce
 * repeated stat calls on the same paths.
 *
 * @example
 * ```typescript
 * import { StatCache } from '@aspect/wasi-polyfill/shared'
 *
 * const cache = new StatCache<{ size: number }>({ ttl: 1000 })
 * cache.set('/file.txt', { size: 1024 })
 * const cached = cache.get('/file.txt') // { size: 1024 } or undefined
 * ```
 *
 * @packageDocumentation
 */

/**
 * Cached stat entry
 */
export interface CachedStat<T> {
  /** The cached stat data */
  stat: T
  /** When this entry was cached (ms since epoch) */
  timestamp: number
}

/**
 * Options for the stat cache
 */
export interface StatCacheOptions {
  /**
   * Time-to-live for cached entries in milliseconds
   * @default 1000 (1 second)
   */
  ttl?: number

  /**
   * Maximum number of entries to cache
   * @default 1000
   */
  maxEntries?: number
}

/**
 * A TTL-based cache for filesystem stat information.
 *
 * Caches stat results for a configurable duration to avoid
 * repeated expensive stat operations on the same paths.
 *
 * @example
 * ```typescript
 * const cache = new StatCache<FileStat>({ ttl: 1000 })
 *
 * // Check cache first
 * const cached = cache.get('/path/to/file')
 * if (cached) {
 *   return cached
 * }
 *
 * // Perform actual stat and cache result
 * const stat = await doActualStat('/path/to/file')
 * cache.set('/path/to/file', stat)
 * return stat
 * ```
 */
export class StatCache<T> {
  private readonly cache: Map<string, CachedStat<T>> = new Map()
  private readonly ttl: number
  private readonly maxEntries: number

  constructor(options: StatCacheOptions = {}) {
    this.ttl = options.ttl ?? 1000
    this.maxEntries = options.maxEntries ?? 1000
  }

  /**
   * Get a cached stat if it exists and hasn't expired.
   *
   * @param path - The path to look up
   * @returns The cached stat data or undefined if not found or expired
   */
  get(path: string): T | undefined {
    const entry = this.cache.get(path)
    if (!entry) {
      return undefined
    }

    // Check if entry has expired
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(path)
      return undefined
    }

    return entry.stat
  }

  /**
   * Cache a stat result.
   *
   * @param path - The path to cache
   * @param stat - The stat data to cache
   */
  set(path: string, stat: T): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxEntries) {
      this.evictOldest()
    }

    this.cache.set(path, {
      stat,
      timestamp: Date.now(),
    })
  }

  /**
   * Invalidate a cached entry.
   *
   * Call this when a file is modified, deleted, or created.
   *
   * @param path - The path to invalidate
   */
  invalidate(path: string): void {
    this.cache.delete(path)
  }

  /**
   * Invalidate all entries under a directory.
   *
   * Useful when a directory structure changes.
   *
   * @param dirPath - The directory path prefix to invalidate
   */
  invalidateDirectory(dirPath: string): void {
    const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`
    for (const key of this.cache.keys()) {
      if (key === dirPath || key.startsWith(prefix)) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get the current number of cached entries.
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Evict expired entries.
   *
   * This is called automatically but can be called manually
   * for more aggressive cleanup.
   */
  evictExpired(): void {
    const now = Date.now()
    for (const [path, entry] of this.cache) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(path)
      }
    }
  }

  /**
   * Evict the oldest entries to make room for new ones.
   */
  private evictOldest(): void {
    // Find and remove the oldest 10% of entries
    const entriesToRemove = Math.max(1, Math.floor(this.maxEntries * 0.1))
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)

    for (let i = 0; i < entriesToRemove && i < entries.length; i++) {
      this.cache.delete(entries[i]![0])
    }
  }
}

/**
 * Create a stat cache with a specific getter function.
 *
 * This is a convenience wrapper that combines cache lookup
 * with a fallback stat function.
 *
 * @param options - Cache options
 * @param statFn - Function to call when cache misses
 * @returns A function that returns cached or fresh stat data
 */
export function createCachedStatFn<T>(
  options: StatCacheOptions,
  statFn: (path: string) => T | Promise<T>
): {
  stat: (path: string) => T | Promise<T>
  invalidate: (path: string) => void
  invalidateDirectory: (dirPath: string) => void
  clear: () => void
} {
  const cache = new StatCache<T>(options)

  return {
    stat: (path: string) => {
      const cached = cache.get(path)
      if (cached !== undefined) {
        return cached
      }

      const result = statFn(path)
      if (result instanceof Promise) {
        return result.then((stat) => {
          cache.set(path, stat)
          return stat
        })
      }

      cache.set(path, result)
      return result
    },
    invalidate: (path) => cache.invalidate(path),
    invalidateDirectory: (dirPath) => cache.invalidateDirectory(dirPath),
    clear: () => cache.clear(),
  }
}
