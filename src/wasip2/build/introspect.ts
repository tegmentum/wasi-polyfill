/**
 * Component introspection for WASIP2 polyfill
 *
 * Uses @bytecodealliance/jco to parse WASM components and extract
 * their WASI interface requirements.
 */

import type { WasiInterface } from '../core/types.js'
import type { ComponentManifest } from '../core/manifest.js'

/**
 * Options for component introspection
 */
export interface IntrospectOptions {
  /** Include all imports, not just WASI ones */
  includeNonWasi?: boolean
  /** Parse capability hints from custom sections */
  parseCapabilities?: boolean
}

/**
 * Result of component introspection
 */
export interface IntrospectResult {
  /** Required WASI interfaces */
  imports: WasiInterface[]
  /** Exported interfaces */
  exports: WasiInterface[]
  /** WASI subsystems required (convenience grouping) */
  wasiSubsystems: string[]
  /** Detected capability requirements */
  capabilities?: {
    /** Required preopens */
    preopens?: string[]
    /** Needs environment access */
    env?: boolean
    /** Needs command-line arguments */
    args?: boolean
    /** Network origins (for future http support) */
    network?: string[]
  }
}

/**
 * Parse a WIT interface string into components
 *
 * Format: "namespace:package/interface@version"
 * Examples: "wasi:filesystem/types@0.2.0", "openmct:platform/event-bus@0.1.0"
 *
 * Any namespace is accepted, not just `wasi:`.
 */
export function parseInterfaceString(str: string): WasiInterface | null {
  // Match patterns like:
  // - wasi:cli/environment@0.2.0
  // - wasi:filesystem/types@0.2.0
  // - openmct:platform/event-bus@0.1.0
  const match = str.match(/^([^/@:]+:[^/]+)\/([^@]+)@(.+)$/)
  if (!match) {
    // Try without version
    const noVersionMatch = str.match(/^([^/@:]+:[^/]+)\/([^@]+)$/)
    if (!noVersionMatch) {
      return null
    }
    return {
      package: noVersionMatch[1]!,
      name: noVersionMatch[2]!,
      version: '0.2.0', // Default version
    }
  }

  return {
    package: match[1]!,
    name: match[2]!,
    version: match[3]!,
  }
}

/**
 * Format a WasiInterface back to string
 */
export function formatInterfaceString(iface: WasiInterface): string {
  return `${iface.package}/${iface.name}@${iface.version}`
}

/**
 * Extract WASI subsystem from interface
 *
 * Example: "wasi:filesystem" -> "filesystem"
 */
export function getSubsystem(iface: WasiInterface): string {
  return iface.package.replace('wasi:', '')
}

/**
 * Deduplicate interfaces by their string representation
 */
function deduplicateInterfaces(interfaces: WasiInterface[]): WasiInterface[] {
  const seen = new Set<string>()
  const result: WasiInterface[] = []

  for (const iface of interfaces) {
    const key = formatInterfaceString(iface)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(iface)
    }
  }

  return result
}

/**
 * Introspect a WebAssembly component to extract WASI requirements
 *
 * This function uses jco to parse the component and extract its imports.
 * It identifies WASI interfaces and categorizes them by subsystem.
 *
 * @param component - The component bytes (ArrayBuffer or Uint8Array)
 * @param options - Introspection options
 * @returns The introspection result
 */
export async function introspect(
  component: ArrayBuffer | Uint8Array,
  options: IntrospectOptions = {}
): Promise<IntrospectResult> {
  // Dynamic import jco to avoid bundling issues
  const { componentWit } = await import('@bytecodealliance/jco')

  // Get WIT from component
  const wit = await componentWit(component instanceof Uint8Array ? component : new Uint8Array(component))

  // Parse the WIT output to extract interfaces
  const imports: WasiInterface[] = []
  const exports: WasiInterface[] = []
  const subsystems = new Set<string>()

  // Parse WIT text to find imports and exports
  // WIT format contains lines like:
  //   import wasi:cli/environment@0.2.0;
  //   export run: func();
  const lines = wit.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // Check for import statements
    if (trimmed.startsWith('import ')) {
      const importMatch = trimmed.match(/^import\s+([\w:-]+\/[\w-]+(?:@[\d.]+)?);?$/)
      if (importMatch) {
        const parsed = parseInterfaceString(importMatch[1]!)
        if (parsed) {
          if (parsed.package.startsWith('wasi:') || options.includeNonWasi) {
            imports.push(parsed)
            if (parsed.package.startsWith('wasi:')) {
              subsystems.add(getSubsystem(parsed))
            }
          }
        }
      }
    }

    // Check for export statements (interface exports)
    if (trimmed.startsWith('export ')) {
      const exportMatch = trimmed.match(/^export\s+([\w:-]+\/[\w-]+(?:@[\d.]+)?);?$/)
      if (exportMatch) {
        const parsed = parseInterfaceString(exportMatch[1]!)
        if (parsed) {
          exports.push(parsed)
        }
      }
    }
  }

  // Build result
  const result: IntrospectResult = {
    imports: deduplicateInterfaces(imports),
    exports: deduplicateInterfaces(exports),
    wasiSubsystems: Array.from(subsystems).sort(),
  }

  // Detect capabilities if requested
  if (options.parseCapabilities) {
    const capabilities = detectCapabilities(result.imports)
    if (Object.keys(capabilities).length > 0) {
      result.capabilities = capabilities
    }
  }

  return result
}

/**
 * Capabilities type (non-optional version)
 */
type Capabilities = {
  preopens?: string[]
  env?: boolean
  args?: boolean
  network?: string[]
}

/**
 * Detect capability requirements from imports
 */
function detectCapabilities(imports: WasiInterface[]): Capabilities {
  const capabilities: Capabilities = {}

  for (const iface of imports) {
    const subsystem = getSubsystem(iface)

    switch (subsystem) {
      case 'filesystem':
        // Filesystem access implies preopens needed
        if (!capabilities.preopens) {
          capabilities.preopens = []
        }
        break

      case 'cli':
        if (iface.name === 'environment') {
          capabilities.env = true
          capabilities.args = true
        }
        break

      case 'http':
        // Future: detect network requirements
        if (!capabilities.network) {
          capabilities.network = []
        }
        break
    }
  }

  return capabilities
}

/**
 * Generate a ComponentManifest from introspection result
 */
export function toManifest(result: IntrospectResult): ComponentManifest {
  const manifest: ComponentManifest = {
    version: 1,
    imports: result.imports,
    exports: result.exports,
    wasiSubsystems: result.wasiSubsystems,
  }

  if (result.capabilities !== undefined) {
    manifest.capabilities = result.capabilities
  }

  return manifest
}

/**
 * Introspect a component file and generate a manifest
 *
 * Convenience function that combines introspect() and toManifest()
 */
export async function generateManifest(
  component: ArrayBuffer | Uint8Array,
  options: IntrospectOptions = {}
): Promise<ComponentManifest> {
  const result = await introspect(component, { parseCapabilities: true, ...options })
  return toManifest(result)
}

/**
 * Introspect a component from a file path (Node.js only)
 */
export async function introspectFile(
  filePath: string,
  options: IntrospectOptions = {}
): Promise<IntrospectResult> {
  const fs = await import('node:fs/promises')
  const buffer = await fs.readFile(filePath)
  return introspect(buffer, options)
}

/**
 * Generate manifest from a file path (Node.js only)
 */
export async function generateManifestFromFile(
  filePath: string,
  options: IntrospectOptions = {}
): Promise<ComponentManifest> {
  const result = await introspectFile(filePath, options)
  return toManifest(result)
}

/**
 * Write manifest to a JSON file (Node.js only)
 */
export async function writeManifest(
  manifest: ComponentManifest,
  outputPath: string
): Promise<void> {
  const fs = await import('node:fs/promises')
  await fs.writeFile(outputPath, JSON.stringify(manifest, null, 2))
}

/**
 * Generate and write manifest for a component file (Node.js only)
 *
 * @param componentPath - Path to the WASM component
 * @param outputPath - Path to write the manifest (defaults to componentPath + '.manifest.json')
 * @param options - Introspection options
 */
export async function generateManifestFile(
  componentPath: string,
  outputPath?: string,
  options: IntrospectOptions = {}
): Promise<ComponentManifest> {
  const manifest = await generateManifestFromFile(componentPath, options)
  const manifestPath = outputPath ?? `${componentPath}.manifest.json`
  await writeManifest(manifest, manifestPath)
  return manifest
}
