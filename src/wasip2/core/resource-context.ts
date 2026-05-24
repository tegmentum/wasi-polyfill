/**
 * Per-polyfill resource context.
 *
 * Many plugins keep handle tables / backing stores in module-level singletons,
 * which means two `Polyfill` instances would share that state (handle
 * collisions, cross-tenant data leakage). A `ResourceContext` is a per-polyfill
 * bag of such state: each `Polyfill` owns one and injects it into every plugin
 * `create(config)` call, so a plugin scopes its state to the context rather than
 * a process global.
 *
 * The context is a generic keyed lazy-cache so each plugin defines and owns its
 * own resource key (no central coupling): plugins that need to *share* a
 * resource across interfaces (e.g. the three wasi:keyvalue interfaces) simply
 * use the same exported key.
 *
 * Standalone plugin usage that passes no context falls back to
 * {@link globalResourceContext}, preserving the historical shared-singleton
 * behavior.
 */
export class ResourceContext {
  private readonly resources = new Map<symbol, unknown>()

  /**
   * Get the resource for `key`, creating it with `factory` on first access.
   */
  get<T>(key: symbol, factory: () => T): T {
    let value = this.resources.get(key)
    if (value === undefined) {
      value = factory()
      this.resources.set(key, value)
    }
    return value as T
  }

  /** Whether a resource has been created for `key`. */
  has(key: symbol): boolean {
    return this.resources.has(key)
  }

  /** Remove the resource for `key`, if any. */
  delete(key: symbol): void {
    this.resources.delete(key)
  }

  /** Remove all resources (e.g. on polyfill teardown). */
  clear(): void {
    this.resources.clear()
  }
}

/**
 * Process-global resource context used when no per-polyfill context is supplied
 * (standalone plugin instantiation). Mirrors the previous module-singleton
 * behavior.
 */
export const globalResourceContext = new ResourceContext()

/**
 * Resolve the resource context from a plugin config, falling back to the global
 * context when none was injected.
 */
export function contextFromConfig(config: {
  context?: ResourceContext
}): ResourceContext {
  return config.context ?? globalResourceContext
}
