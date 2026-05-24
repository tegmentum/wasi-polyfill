/**
 * Main Polyfill orchestrator class
 *
 * This is the primary entry point for using the WASIP2 polyfill.
 * It manages plugin loading, policy enforcement, and import generation.
 */

import type {
  Policy,
  PluginInstance,
  PolyfillConfig,
  WasiInterface,
  WasiPlugin,
} from './types.js'
import { formatInterfaceString, parseInterfaceString } from './types.js'
import { PluginRegistry, globalRegistry } from './plugin-registry.js'
import { AllowAllPolicy, createSafePolicy } from './policy.js'
import type { ComponentManifest } from './manifest.js'
import { loadManifestForComponent } from './manifest.js'
import { PluginNotFoundError, PolicyDeniedError } from '../../shared/errors.js'

/**
 * Options for getting imports
 */
export interface GetImportsOptions {
  /** Whether to throw on missing plugins (default: true) */
  throwOnMissing?: boolean
  /** Whether to throw on policy denial (default: true) */
  throwOnDenied?: boolean
  /**
   * Enable jco compatibility mode (default: false)
   * When true:
   * - Import keys omit version suffix ("wasi:cli/environment" not "wasi:cli/environment@0.2.0")
   * - Function names are converted to camelCase ("getEnvironment" not "get-environment")
   * This is required when using components transpiled with jco.
   */
  jcoCompat?: boolean
}

/**
 * Result of getting imports for a component
 */
export interface ImportResult {
  /** The imports object for WebAssembly instantiation */
  imports: Record<string, Record<string, unknown>>
  /** Interfaces that were loaded */
  loaded: WasiInterface[]
  /** Interfaces that were denied by policy */
  denied: WasiInterface[]
  /** Interfaces that had no plugin available */
  missing: WasiInterface[]
}

/**
 * WASIP2 Polyfill orchestrator
 *
 * Usage:
 * ```typescript
 * const polyfill = new Polyfill({
 *   policy: createCliPolicy({ env: { FOO: 'bar' } })
 * })
 *
 * // Get imports for a list of interfaces
 * const { imports } = await polyfill.getImports([
 *   { package: 'wasi:random', name: 'random', version: '0.2.0' }
 * ])
 *
 * // Or from a manifest
 * const result = await polyfill.forManifest(manifest)
 *
 * // Use imports with WebAssembly instantiation
 * const instance = await WebAssembly.instantiate(wasmBytes, result.imports)
 * ```
 */
export class Polyfill {
  private readonly registry: PluginRegistry
  private readonly policy: Policy
  private readonly instances: Map<string, PluginInstance> = new Map()
  private readonly defaultJcoCompat: boolean
  private destroyed = false

  constructor(config?: PolyfillConfig) {
    this.registry = globalRegistry
    this.policy = config?.policy ?? createSafePolicy()
    this.defaultJcoCompat = config?.jcoCompat ?? false

    // Plugin overrides are handled by the policy
    // The policy.configure() method returns per-interface configuration
  }

  /**
   * Get imports for a list of required interfaces
   */
  async getImports(
    required: WasiInterface[],
    options?: GetImportsOptions
  ): Promise<ImportResult> {
    this.checkDestroyed()

    const throwOnMissing = options?.throwOnMissing ?? true
    const throwOnDenied = options?.throwOnDenied ?? true
    const jcoCompat = options?.jcoCompat ?? this.defaultJcoCompat

    const imports: Record<string, Record<string, unknown>> = {}
    const loaded: WasiInterface[] = []
    const denied: WasiInterface[] = []
    const missing: WasiInterface[] = []

    // In jco mode, collect raw imports first for post-processing
    const rawJcoImports = jcoCompat
      ? new Map<string, Record<string, unknown>>()
      : null

    for (const iface of required) {
      // Check policy
      if (!this.policy.allow(iface)) {
        denied.push(iface)
        if (throwOnDenied) {
          throw new PolicyDeniedError(formatInterfaceString(iface))
        }
        continue
      }

      // Get plugin
      const plugin = await this.registry.get(iface)
      if (!plugin) {
        missing.push(iface)
        if (throwOnMissing) {
          throw new PluginNotFoundError(formatInterfaceString(iface))
        }
        continue
      }

      // Get or create instance
      const instance = await this.getOrCreateInstance(iface, plugin)

      // Merge imports
      const pluginImports = instance.getImports()

      // Use import key without version in jco mode
      const importKey = this.makeImportKey(iface, !jcoCompat)

      if (rawJcoImports) {
        const existing = rawJcoImports.get(importKey) ?? {}
        rawJcoImports.set(importKey, { ...existing, ...pluginImports })
      } else {
        if (!imports[importKey]) {
          imports[importKey] = {}
        }
        Object.assign(imports[importKey], pluginImports)
      }

      loaded.push(iface)
    }

    if (rawJcoImports) {
      return { imports: buildJcoImports(rawJcoImports), loaded, denied, missing }
    }

    return { imports, loaded, denied, missing }
  }

  /**
   * Get imports for a component manifest
   */
  async forManifest(
    manifest: ComponentManifest,
    options?: GetImportsOptions
  ): Promise<ImportResult> {
    return this.getImports(manifest.imports, options)
  }

  /**
   * Get imports for a component by loading its manifest
   *
   * Expects a .manifest.json file alongside the .wasm file.
   */
  async forComponent(
    componentUrl: string,
    options?: GetImportsOptions
  ): Promise<ImportResult> {
    const manifest = await loadManifestForComponent(componentUrl)
    return this.forManifest(manifest, options)
  }

  /**
   * Get imports for a list of interface strings
   */
  async forInterfaces(
    interfaces: string[],
    options?: GetImportsOptions
  ): Promise<ImportResult> {
    const parsed = interfaces.map(parseInterfaceString)
    return this.getImports(parsed, options)
  }

  /**
   * Check if an interface is allowed by the current policy
   */
  isAllowed(iface: WasiInterface | string): boolean {
    const parsed =
      typeof iface === 'string' ? parseInterfaceString(iface) : iface
    return this.policy.allow(parsed)
  }

  /**
   * Check if a plugin is available for an interface
   */
  hasPlugin(iface: WasiInterface | string): boolean {
    const parsed =
      typeof iface === 'string' ? parseInterfaceString(iface) : iface
    return this.registry.has(parsed)
  }

  /**
   * Register a plugin
   */
  registerPlugin(plugin: WasiPlugin): void {
    this.registry.register(plugin)
  }

  /**
   * Clean up all plugin instances
   */
  destroy(): void {
    if (this.destroyed) {
      return
    }

    for (const instance of this.instances.values()) {
      try {
        instance.destroy()
      } catch {
        // Ignore cleanup errors
      }
    }

    this.instances.clear()
    this.destroyed = true
  }

  /**
   * Get the current policy
   */
  getPolicy(): Policy {
    return this.policy
  }

  /**
   * Get the plugin registry
   */
  getRegistry(): PluginRegistry {
    return this.registry
  }

  private async getOrCreateInstance(
    iface: WasiInterface,
    plugin: WasiPlugin
  ): Promise<PluginInstance> {
    const key = `${iface.package}/${iface.name}`

    let instance = this.instances.get(key)
    if (instance) {
      return instance
    }

    // Get configuration from policy
    const config = this.policy.configure(iface)

    // Create instance
    instance = plugin.create(config)
    this.instances.set(key, instance)

    return instance
  }

  private makeImportKey(iface: WasiInterface, includeVersion = true): string {
    // Format: "wasi:package/interface" or "wasi:package/interface@version"
    // jco transpilation expects keys WITHOUT version suffix
    if (includeVersion) {
      return formatInterfaceString(iface)
    }
    return `${iface.package}/${iface.name}`
  }

  private checkDestroyed(): void {
    if (this.destroyed) {
      throw new Error('Polyfill has been destroyed')
    }
  }
}

/**
 * Create a new Polyfill instance with default configuration
 */
export function createPolyfill(config?: PolyfillConfig): Polyfill {
  return new Polyfill(config)
}

/**
 * Create a Polyfill that allows all interfaces (for development/testing)
 */
export function createDevPolyfill(): Polyfill {
  return new Polyfill({
    policy: new AllowAllPolicy(),
  })
}

/**
 * Create a Polyfill pre-configured for jco-transpiled components
 *
 * This is a convenience function that:
 * - Creates a polyfill with the AllowAllPolicy (for development)
 * - Sets up jcoCompat mode by default
 *
 * Usage:
 * ```typescript
 * import { createJcoPolyfill, registerCorePlugins } from '@tegmentum/wasi-polyfill'
 *
 * // Register plugins first
 * registerCorePlugins()
 *
 * const polyfill = createJcoPolyfill()
 * const { imports } = await polyfill.getImports(interfaces)
 * ```
 */
export function createJcoPolyfill(config?: Omit<PolyfillConfig, 'policy'>): Polyfill {
  return new Polyfill({
    ...config,
    policy: new AllowAllPolicy(),
    jcoCompat: config?.jcoCompat ?? true,
  })
}

// ---------------------------------------------------------------------------
// jco resource bridge
//
// jco-transpiled components expect JavaScript resource classes (Descriptor,
// InputStream, …) with prototype methods.  The polyfill plugins provide flat
// functions keyed with WIT conventions ([method]descriptor.read-via-stream,
// [resource-drop]descriptor, etc.).  The code below bridges between the two.
// ---------------------------------------------------------------------------

/** Well-known jco symbols (global via Symbol.for, accessible cross-module) */
const symbolCabiRep = Symbol.for('cabiRep')
const symbolCabiDispose = Symbol.for('cabiDispose')

/** Convert kebab-case to camelCase: "read-via-stream" → "readViaStream" */
function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

/** Convert kebab-case to PascalCase: "input-stream" → "InputStream" */
function kebabToPascal(str: string): string {
  return str.replace(/(^|-)([a-z])/g, (_, _sep: string, letter: string) =>
    letter.toUpperCase()
  )
}

/**
 * Describes how a function/method return value should be wrapped.
 *
 * - `resource`            – single resource handle → class instance
 * - `option-resource`     – handle | undefined → instance | undefined
 * - `list-tuple-resource` – [[handle, …], …] → [[instance, …], …]
 *   (wraps the element at `tupleIndex` in each tuple)
 */
type WrapDescriptor =
  | { kind: 'resource'; classRef: string }
  | { kind: 'option-resource'; classRef: string }
  | { kind: 'list-tuple-resource'; classRef: string; tupleIndex: number }

/**
 * Static map of WASI standard functions whose return values contain resource
 * handles that must be wrapped in class instances for jco.
 *
 * Key format: "interfaceKey:originalFlatFnKey" (kebab-case, before camelCase)
 * classRef format: "interfaceKey:PascalClassName"
 */
const WASI_RETURN_WRAPS: Record<string, WrapDescriptor> = {
  // filesystem/types  → io/streams
  'wasi:filesystem/types:[method]descriptor.open-at':
    { kind: 'resource', classRef: 'wasi:filesystem/types:Descriptor' },
  'wasi:filesystem/types:[method]descriptor.read-via-stream':
    { kind: 'resource', classRef: 'wasi:io/streams:InputStream' },
  'wasi:filesystem/types:[method]descriptor.write-via-stream':
    { kind: 'resource', classRef: 'wasi:io/streams:OutputStream' },
  'wasi:filesystem/types:[method]descriptor.append-via-stream':
    { kind: 'resource', classRef: 'wasi:io/streams:OutputStream' },
  'wasi:filesystem/types:[method]descriptor.read-directory':
    { kind: 'resource', classRef: 'wasi:filesystem/types:DirectoryEntryStream' },

  // io/streams  → io/poll
  'wasi:io/streams:[method]input-stream.subscribe':
    { kind: 'resource', classRef: 'wasi:io/poll:Pollable' },
  'wasi:io/streams:[method]output-stream.subscribe':
    { kind: 'resource', classRef: 'wasi:io/poll:Pollable' },

  // cli  → io/streams
  'wasi:cli/stdin:get-stdin':
    { kind: 'resource', classRef: 'wasi:io/streams:InputStream' },
  'wasi:cli/stdout:get-stdout':
    { kind: 'resource', classRef: 'wasi:io/streams:OutputStream' },
  'wasi:cli/stderr:get-stderr':
    { kind: 'resource', classRef: 'wasi:io/streams:OutputStream' },

  // cli/terminal  → terminal resources (option types)
  'wasi:cli/terminal-stdin:get-terminal-stdin':
    { kind: 'option-resource', classRef: 'wasi:cli/terminal-input:TerminalInput' },
  'wasi:cli/terminal-stdout:get-terminal-stdout':
    { kind: 'option-resource', classRef: 'wasi:cli/terminal-output:TerminalOutput' },
  'wasi:cli/terminal-stderr:get-terminal-stderr':
    { kind: 'option-resource', classRef: 'wasi:cli/terminal-output:TerminalOutput' },

  // filesystem/preopens  → filesystem/types (list of tuples)
  'wasi:filesystem/preopens:get-directories':
    { kind: 'list-tuple-resource', classRef: 'wasi:filesystem/types:Descriptor', tupleIndex: 0 },

  // clocks  → io/poll
  'wasi:clocks/monotonic-clock:subscribe-instant':
    { kind: 'resource', classRef: 'wasi:io/poll:Pollable' },
  'wasi:clocks/monotonic-clock:subscribe-duration':
    { kind: 'resource', classRef: 'wasi:io/poll:Pollable' },

  // sockets  → various
  'wasi:sockets/ip-name-lookup:resolve-addresses':
    { kind: 'resource', classRef: 'wasi:sockets/ip-name-lookup:ResolveAddressStream' },
  'wasi:sockets/tcp-create-socket:create-tcp-socket':
    { kind: 'resource', classRef: 'wasi:sockets/tcp:TcpSocket' },
  'wasi:sockets/udp-create-socket:create-udp-socket':
    { kind: 'resource', classRef: 'wasi:sockets/udp:UdpSocket' },
  'wasi:sockets/instance-network:instance-network':
    { kind: 'resource', classRef: 'wasi:sockets/network:Network' },
}

/**
 * Functions that are legitimately async in the WASI specification.
 * These are handled specially by jco and should not be guarded.
 */
const ASYNC_ALLOWED: ReadonlySet<string> = new Set([
  'wasi:io/poll:poll',
])

/**
 * Guard against async return values in jco-compatible wrappers.
 *
 * jco trampolines are synchronous — if a polyfill implementation accidentally
 * returns a Promise the transpiled component will silently receive `undefined`
 * for things like `.byteLength`, causing hard-to-diagnose data corruption.
 * This guard makes the failure loud and immediate.
 */
function guardSyncReturn(value: unknown, ifaceKey: string, fnKey: string): unknown {
  if (value instanceof Promise && !ASYNC_ALLOWED.has(`${ifaceKey}:${fnKey}`)) {
    throw new Error(
      `jco-compat: ${fnKey} returned a Promise. ` +
      `jco trampolines are synchronous; the underlying implementation must not be async.`
    )
  }
  return value
}

/**
 * Unwrap a polyfill result object into jco convention.
 * Polyfill returns { tag: 'ok', val } | { tag: 'err', val } for WIT result types.
 * jco expects the function to return the ok value directly or throw the err value.
 */
function unwrapResult(value: unknown): unknown {
  if (value != null && typeof value === 'object' && 'tag' in value) {
    const result = value as { tag: string; val: unknown }
    if (result.tag === 'err') throw result.val
    if (result.tag === 'ok') return result.val
  }
  return value
}

/**
 * If `arg` is a resource instance (has cabiRep), extract the handle.
 * Recurse into arrays so that e.g. poll([Pollable, …]) works.
 */
function unwrapArg(arg: unknown): unknown {
  if (arg != null && typeof arg === 'object') {
    if (symbolCabiRep in arg) return (arg as Record<symbol, unknown>)[symbolCabiRep]
    if (Array.isArray(arg)) return arg.map(unwrapArg)
  }
  return arg
}

/** Create a resource instance with the correct prototype and cabiRep. */
function makeResourceInstance(
  TargetClass: { prototype: object },
  rep: unknown
): object {
  const inst = Object.create(TargetClass.prototype) as Record<symbol, unknown>
  inst[symbolCabiRep] = rep
  return inst
}

/** Wrap a raw return value according to a WrapDescriptor. */
function wrapReturn(
  value: unknown,
  desc: WrapDescriptor,
  registry: Map<string, { prototype: object }>
): unknown {
  const TargetClass = registry.get(desc.classRef)
  if (!TargetClass) return value // class not loaded, pass through

  switch (desc.kind) {
    case 'resource':
      return value == null ? value : makeResourceInstance(TargetClass, value)
    case 'option-resource':
      return value == null ? undefined : makeResourceInstance(TargetClass, value)
    case 'list-tuple-resource': {
      if (!Array.isArray(value)) return value
      const idx = desc.tupleIndex
      return (value as unknown[][]).map((tuple) => {
        const wrapped = [...tuple]
        wrapped[idx] = makeResourceInstance(TargetClass, tuple[idx])
        return wrapped
      })
    }
  }
}

/**
 * Build jco-compatible imports from raw plugin imports.
 *
 * Transforms flat WIT-keyed functions ([method]descriptor.read-via-stream,
 * [resource-drop]descriptor, etc.) into JavaScript resource classes with
 * prototype methods, as expected by jco-transpiled components.
 */
function buildJcoImports(
  rawImports: Map<string, Record<string, unknown>>
): Record<string, Record<string, unknown>> {
  // --- Phase 1: discover resource types and create classes ----------------
  type ResourceClass = { new (): object; prototype: object; [k: string | symbol]: unknown }
  const classRegistry = new Map<string, ResourceClass>()

  for (const [ifaceKey, fns] of rawImports) {
    const resourceNames = new Set<string>()
    for (const key of Object.keys(fns)) {
      const rn = parseResourceName(key)
      if (rn) resourceNames.add(rn)
    }

    for (const rn of resourceNames) {
      const className = kebabToPascal(rn)
      const classRef = `${ifaceKey}:${className}`

      // Dynamically-named class
      const ResourceClass = { [className]: class {} }[className] as ResourceClass

      // Static dispose for jco resource cleanup
      const dropFn = fns[`[resource-drop]${rn}`] as
        | ((...a: unknown[]) => void)
        | undefined
      if (dropFn) {
        (ResourceClass as Record<symbol, unknown>)[symbolCabiDispose] = (rep: unknown) =>
          dropFn(rep)
      }

      classRegistry.set(classRef, ResourceClass)
    }
  }

  // --- Phase 2: populate methods & plain functions -----------------------
  const result: Record<string, Record<string, unknown>> = {}

  for (const [ifaceKey, fns] of rawImports) {
    const out: Record<string, unknown> = {}

    for (const [key, fn] of Object.entries(fns)) {
      // [resource-drop]resource-name  →  add class to interface exports
      const dropMatch = key.match(/^\[resource-drop\](.+)$/)
      if (dropMatch) {
        const cn = kebabToPascal(dropMatch[1]!)
        out[cn] = classRegistry.get(`${ifaceKey}:${cn}`)
        continue
      }

      // [method]resource-name.method-name  →  prototype method
      const methodMatch = key.match(/^\[method\]([^.]+)\.(.+)$/)
      if (methodMatch) {
        const cn = kebabToPascal(methodMatch[1]!)
        const cls = classRegistry.get(`${ifaceKey}:${cn}`)
        if (!cls) continue
        const methodName = kebabToCamel(methodMatch[2]!)
        const flatFn = fn as (...a: unknown[]) => unknown
        const wrapDesc = WASI_RETURN_WRAPS[`${ifaceKey}:${key}`]

        ;(cls.prototype as Record<string, unknown>)[methodName] = wrapDesc
          ? function (this: Record<symbol, unknown>, ...args: unknown[]) {
              return guardSyncReturn(
                wrapReturn(
                  unwrapResult(flatFn(this[symbolCabiRep], ...args.map(unwrapArg))),
                  wrapDesc,
                  classRegistry
                ),
                ifaceKey, key
              )
            }
          : function (this: Record<symbol, unknown>, ...args: unknown[]) {
              return guardSyncReturn(
                unwrapResult(flatFn(this[symbolCabiRep], ...args.map(unwrapArg))),
                ifaceKey, key
              )
            }

        out[cn] = cls
        continue
      }

      // [static]resource-name.method-name  →  static method
      const staticMatch = key.match(/^\[static\]([^.]+)\.(.+)$/)
      if (staticMatch) {
        const cn = kebabToPascal(staticMatch[1]!)
        const cls = classRegistry.get(`${ifaceKey}:${cn}`)
        if (!cls) continue
        const methodName = kebabToCamel(staticMatch[2]!)
        const flatFn = fn as (...a: unknown[]) => unknown
        cls[methodName] = (...args: unknown[]) => unwrapResult(flatFn(...args.map(unwrapArg)))
        out[cn] = cls
        continue
      }

      // [constructor]resource-name  →  skip (handled by class creation)
      if (key.startsWith('[constructor]')) continue

      // Plain function  →  camelCase export
      const fnName = kebabToCamel(key)
      const flatFn = fn as (...a: unknown[]) => unknown
      const wrapDesc = WASI_RETURN_WRAPS[`${ifaceKey}:${key}`]

      out[fnName] = wrapDesc
        ? (...args: unknown[]) =>
            guardSyncReturn(
              wrapReturn(unwrapResult(flatFn(...args.map(unwrapArg))), wrapDesc, classRegistry),
              ifaceKey, key
            )
        : (...args: unknown[]) =>
            guardSyncReturn(
              unwrapResult(flatFn(...args.map(unwrapArg))),
              ifaceKey, key
            )
    }

    result[ifaceKey] = out
  }

  return result
}

/** Extract the resource name from a WIT import key, or undefined. */
function parseResourceName(key: string): string | undefined {
  let m = key.match(/^\[resource-drop\](.+)$/)
  if (m) return m[1]
  m = key.match(/^\[method\]([^.]+)\./)
  if (m) return m[1]
  m = key.match(/^\[static\]([^.]+)\./)
  if (m) return m[1]
  m = key.match(/^\[constructor\](.+)$/)
  if (m) return m[1]
  return undefined
}
