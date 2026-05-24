/**
 * Component manifest types and loading
 *
 * Manifests describe the WASI interface requirements of a component.
 * They are generated at build time to avoid runtime parsing overhead.
 */

import type { WasiInterface } from './types.js'
import { parseInterfaceString } from './types.js'
import { ManifestError } from '../../shared/errors.js'

/**
 * Capability requirements for a component
 */
export interface CapabilityRequirements {
  /** Filesystem paths the component needs access to */
  preopens?: string[]
  /** Whether the component needs environment variables */
  env?: boolean
  /** Whether the component needs command line arguments */
  args?: boolean
  /** Network hosts the component needs to connect to */
  network?: string[]
}

/**
 * Component manifest describing WASI requirements
 *
 * This is generated at build time by introspecting the component.
 */
export interface ComponentManifest {
  /** Schema version for forward compatibility */
  version: 1
  /** Name of the component (optional) */
  name?: string
  /** Required WASI interfaces (imports) */
  imports: WasiInterface[]
  /** Provided WASI interfaces (exports) */
  exports: WasiInterface[]
  /** WASI subsystems required (convenience grouping) */
  wasiSubsystems: string[]
  /** Capability requirements */
  capabilities?: CapabilityRequirements
  /** Hash of the component binary for validation */
  componentHash?: string
}

/**
 * Raw manifest format (before parsing)
 */
interface RawManifest {
  version?: number
  name?: string
  imports?: Array<string | WasiInterface>
  exports?: Array<string | WasiInterface>
  wasiSubsystems?: string[]
  capabilities?: CapabilityRequirements
  componentHash?: string
}

/**
 * Parse a list of interface entries (strings or objects) into WasiInterfaces.
 *
 * @param items - The raw entries (imports or exports), may be undefined
 * @param kind - 'import' | 'export', used only in error messages
 */
function parseInterfaceList(
  items: Array<string | WasiInterface> | undefined,
  kind: 'import' | 'export'
): WasiInterface[] {
  const result: WasiInterface[] = []
  for (const item of items ?? []) {
    if (typeof item === 'string') {
      result.push(parseInterfaceString(item))
    } else if (isWasiInterface(item)) {
      result.push(item)
    } else {
      throw new ManifestError(`Invalid ${kind} entry: ${JSON.stringify(item)}`)
    }
  }
  return result
}

/**
 * Parse a manifest from JSON
 */
export function parseManifest(json: unknown): ComponentManifest {
  if (typeof json !== 'object' || json === null) {
    throw new ManifestError('Manifest must be an object')
  }

  const raw = json as RawManifest

  // Validate version
  if (raw.version !== undefined && raw.version !== 1) {
    throw new ManifestError(`Unsupported manifest version: ${raw.version}`)
  }

  const imports = parseInterfaceList(raw.imports, 'import')
  const exports = parseInterfaceList(raw.exports, 'export')

  // Extract WASI subsystems from imports if not provided
  const wasiSubsystems =
    raw.wasiSubsystems ?? extractSubsystems(imports)

  const manifest: ComponentManifest = {
    version: 1,
    imports,
    exports,
    wasiSubsystems,
  }

  if (raw.name !== undefined) {
    manifest.name = raw.name
  }
  if (raw.capabilities !== undefined) {
    manifest.capabilities = raw.capabilities
  }
  if (raw.componentHash !== undefined) {
    manifest.componentHash = raw.componentHash
  }

  return manifest
}

/**
 * Load a manifest from a URL
 */
export async function loadManifest(url: string): Promise<ComponentManifest> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new ManifestError(`Failed to load manifest from ${url}: ${response.status}`)
  }
  const json = await response.json()
  return parseManifest(json)
}

/**
 * Load a manifest from alongside a component URL
 *
 * Looks for a .manifest.json file next to the .wasm file.
 */
export async function loadManifestForComponent(
  componentUrl: string
): Promise<ComponentManifest> {
  const manifestUrl = componentUrl.replace(/\.wasm$/, '.manifest.json')
  return loadManifest(manifestUrl)
}

/**
 * Create a manifest from a list of interface strings
 */
export function createManifest(
  imports: string[],
  options?: {
    name?: string
    exports?: string[]
    capabilities?: CapabilityRequirements
  }
): ComponentManifest {
  const parsedImports = imports.map(parseInterfaceString)
  const parsedExports = (options?.exports ?? []).map(parseInterfaceString)

  const manifest: ComponentManifest = {
    version: 1,
    imports: parsedImports,
    exports: parsedExports,
    wasiSubsystems: extractSubsystems(parsedImports),
  }

  if (options?.name !== undefined) {
    manifest.name = options.name
  }
  if (options?.capabilities !== undefined) {
    manifest.capabilities = options.capabilities
  }

  return manifest
}

/**
 * Serialize a manifest to JSON
 */
export function serializeManifest(manifest: ComponentManifest): string {
  return JSON.stringify(manifest, null, 2)
}

/**
 * Extract unique WASI subsystems from a list of interfaces
 */
function extractSubsystems(interfaces: WasiInterface[]): string[] {
  const subsystems = new Set<string>()
  for (const iface of interfaces) {
    if (iface.package.startsWith('wasi:')) {
      // Extract the subsystem name (e.g., "filesystem" from "wasi:filesystem")
      const subsystem = iface.package.slice(5)
      subsystems.add(subsystem)
    }
  }
  return Array.from(subsystems).sort()
}

/**
 * Type guard for WasiInterface
 */
function isWasiInterface(value: unknown): value is WasiInterface {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const obj = value as Record<string, unknown>
  return (
    typeof obj['package'] === 'string' &&
    typeof obj['name'] === 'string' &&
    typeof obj['version'] === 'string'
  )
}

/**
 * Validate that a manifest has all required interfaces for a set of requirements
 */
export function validateManifest(
  manifest: ComponentManifest,
  availableInterfaces: WasiInterface[]
): { valid: boolean; missing: WasiInterface[] } {
  const available = new Set(
    availableInterfaces.map((i) => `${i.package}/${i.name}`)
  )

  const missing: WasiInterface[] = []
  for (const required of manifest.imports) {
    const key = `${required.package}/${required.name}`
    if (!available.has(key)) {
      missing.push(required)
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  }
}
