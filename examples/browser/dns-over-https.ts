/**
 * DNS-over-HTTPS (DoH) example for @tegmentum/wasi-polyfill
 *
 * Shows how to configure and use the DNS-over-HTTPS resolver
 * for name resolution in browser environments.
 */

import { Polyfill } from '@tegmentum/wasi-polyfill'
import {
  socketPlugins,
  ipNameLookupPlugin,
  dohIpNameLookupImplementation,
  DOH_PROVIDERS,
  DEFAULT_DOH_RESOLVER,
  DnsRecordType,
  IP_NAME_LOOKUP_INTERFACE,
} from '@tegmentum/wasi-polyfill/plugins/sockets'

/**
 * Example: Basic DoH setup with Cloudflare
 */
async function basicDoHSetup() {
  const polyfill = new Polyfill()

  // Register IP name lookup with DoH implementation
  polyfill.registerPlugin(ipNameLookupPlugin, {
    implementation: 'doh',
    options: {
      // Use Cloudflare's DoH resolver (default)
      dohResolverUrl: DOH_PROVIDERS.cloudflare,
      // Enable DoH
      enableDoh: true,
      // Timeout for DoH queries (ms)
      dohTimeoutMs: 5000,
      // Cache TTL (ms) - 5 minutes
      cacheTtlMs: 300000,
    },
  })

  console.log('DoH configured with resolver:', DEFAULT_DOH_RESOLVER)
}

/**
 * Example: Using different DoH providers
 */
async function alternativeProviders() {
  const polyfill = new Polyfill()

  // Available providers
  console.log('Available DoH providers:', Object.keys(DOH_PROVIDERS))
  console.log('  Cloudflare:', DOH_PROVIDERS.cloudflare)
  console.log('  Google:', DOH_PROVIDERS.google)
  console.log('  Quad9:', DOH_PROVIDERS.quad9)
  console.log('  AdGuard:', DOH_PROVIDERS.adguard)

  // Use Google's DoH resolver
  polyfill.registerPlugin(ipNameLookupPlugin, {
    implementation: 'doh',
    options: {
      dohResolverUrl: DOH_PROVIDERS.google,
      enableDoh: true,
    },
  })
}

/**
 * Example: Static hostname mappings with DoH fallback
 */
async function staticMappingsWithFallback() {
  const polyfill = new Polyfill()

  // Configure with static mappings for local/internal hostnames
  // and DoH for external queries
  polyfill.registerPlugin(ipNameLookupPlugin, {
    implementation: 'doh',
    options: {
      // Static mappings - these bypass DoH
      staticMappings: {
        localhost: ['127.0.0.1', '::1'],
        'local.dev': ['192.168.1.100'],
        'api.internal': ['10.0.0.50'],
      },
      // DoH configuration for non-static lookups
      dohResolverUrl: DOH_PROVIDERS.cloudflare,
      enableDoh: true,
      cacheTtlMs: 60000, // 1 minute cache
    },
  })

  console.log('Static mappings configured with DoH fallback')
}

/**
 * Example: Understanding DNS record types
 */
function dnsRecordTypes() {
  console.log('DNS Record Types:')
  console.log('  A (IPv4):', DnsRecordType.A)
  console.log('  AAAA (IPv6):', DnsRecordType.AAAA)

  // The DoH implementation queries both A and AAAA records
  // in parallel for each hostname resolution
}

/**
 * Example: Full sockets setup with DoH
 */
async function fullSocketsSetup() {
  const polyfill = new Polyfill()

  // Register all socket plugins
  polyfill.registerPlugins(socketPlugins)

  // Override IP name lookup specifically for DoH
  polyfill.registerPlugin(ipNameLookupPlugin, {
    implementation: 'doh',
    options: {
      dohResolverUrl: DOH_PROVIDERS.cloudflare,
      enableDoh: true,
      dohTimeoutMs: 3000,
    },
  })

  // Get imports for WASI sockets interfaces
  const imports = polyfill.getImportsForInterfaces([
    { package: 'wasi:sockets', name: 'instance-network', version: '0.2.0' },
    { package: 'wasi:sockets', name: 'ip-name-lookup', version: '0.2.0' },
    { package: 'wasi:sockets', name: 'tcp', version: '0.2.0' },
    { package: 'wasi:sockets', name: 'udp', version: '0.2.0' },
  ])

  console.log('Full sockets setup with DoH:', Object.keys(imports))
}

/**
 * Example: Privacy-focused DNS configuration
 */
async function privacyFocusedDns() {
  const polyfill = new Polyfill()

  // Use Quad9 or AdGuard for privacy-focused DNS
  // Both block known malicious domains

  // Option 1: Quad9 - Blocks malicious domains
  polyfill.registerPlugin(ipNameLookupPlugin, {
    implementation: 'doh',
    options: {
      dohResolverUrl: DOH_PROVIDERS.quad9,
      enableDoh: true,
    },
  })

  // Option 2: AdGuard - Blocks ads and trackers
  // polyfill.registerPlugin(ipNameLookupPlugin, {
  //   implementation: 'doh',
  //   options: {
  //     dohResolverUrl: DOH_PROVIDERS.adguard,
  //     enableDoh: true,
  //   },
  // })

  console.log('Privacy-focused DNS configured')
}

// Run examples
basicDoHSetup().catch(console.error)
alternativeProviders().catch(console.error)
staticMappingsWithFallback().catch(console.error)
dnsRecordTypes()
fullSocketsSetup().catch(console.error)
privacyFocusedDns().catch(console.error)
