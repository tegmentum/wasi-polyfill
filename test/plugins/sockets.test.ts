/**
 * Tests for wasi:sockets plugins
 */

import { describe, it, expect } from 'vitest'
import {
  networkPlugin,
  instanceNetworkPlugin,
  ipNameLookupPlugin,
  tcpPlugin,
  tcpCreateSocketPlugin,
  udpPlugin,
  udpCreateSocketPlugin,
  socketPlugins,
  virtualNetworkImplementation,
  virtualInstanceNetworkImplementation,
  virtualIpNameLookupImplementation,
  dohIpNameLookupImplementation,
  stubIpNameLookupImplementation,
  virtualTcpImplementation,
  virtualTcpCreateSocketImplementation,
  virtualUdpImplementation,
  virtualUdpCreateSocketImplementation,
  globalNetworkRegistry,
  globalTcpSocketRegistry,
  globalUdpSocketRegistry,
  globalResolveAddressStreamRegistry,
  NetworkErrorCode,
  TcpState,
  UdpState,
  parseIpv4,
  parseIpv6,
  formatIpv4,
  formatIpv6,
  formatSocketAddress,
  isLoopback,
  isAny,
  anyAddress,
  loopbackAddress,
  DOH_PROVIDERS,
  DEFAULT_DOH_RESOLVER,
  DnsRecordType,
  NETWORK_INTERFACE,
  INSTANCE_NETWORK_INTERFACE,
  IP_NAME_LOOKUP_INTERFACE,
  TCP_INTERFACE,
  TCP_CREATE_SOCKET_INTERFACE,
  UDP_INTERFACE,
  UDP_CREATE_SOCKET_INTERFACE,
} from '../../src/wasip2/plugins/sockets/index.js'

describe('Socket Plugins', () => {
  describe('Plugin Definitions', () => {
    it('should define network plugin correctly', () => {
      expect(networkPlugin.witInterface).toEqual(NETWORK_INTERFACE)
      expect(networkPlugin.witInterface.package).toBe('wasi:sockets')
      expect(networkPlugin.witInterface.name).toBe('network')
      expect(networkPlugin.defaultImplementation).toBe('virtual')
    })

    it('should define instance-network plugin correctly', () => {
      expect(instanceNetworkPlugin.witInterface).toEqual(INSTANCE_NETWORK_INTERFACE)
      expect(instanceNetworkPlugin.witInterface.package).toBe('wasi:sockets')
      expect(instanceNetworkPlugin.witInterface.name).toBe('instance-network')
      expect(instanceNetworkPlugin.defaultImplementation).toBe('virtual')
    })

    it('should define ip-name-lookup plugin correctly', () => {
      expect(ipNameLookupPlugin.witInterface).toEqual(IP_NAME_LOOKUP_INTERFACE)
      expect(ipNameLookupPlugin.witInterface.package).toBe('wasi:sockets')
      expect(ipNameLookupPlugin.witInterface.name).toBe('ip-name-lookup')
      expect(ipNameLookupPlugin.defaultImplementation).toBe('virtual')
    })

    it('should define tcp plugin correctly', () => {
      expect(tcpPlugin.witInterface).toEqual(TCP_INTERFACE)
      expect(tcpPlugin.witInterface.package).toBe('wasi:sockets')
      expect(tcpPlugin.witInterface.name).toBe('tcp')
      expect(tcpPlugin.defaultImplementation).toBe('virtual')
    })

    it('should define tcp-create-socket plugin correctly', () => {
      expect(tcpCreateSocketPlugin.witInterface).toEqual(TCP_CREATE_SOCKET_INTERFACE)
      expect(tcpCreateSocketPlugin.witInterface.package).toBe('wasi:sockets')
      expect(tcpCreateSocketPlugin.witInterface.name).toBe('tcp-create-socket')
      expect(tcpCreateSocketPlugin.defaultImplementation).toBe('virtual')
    })

    it('should define udp plugin correctly', () => {
      expect(udpPlugin.witInterface).toEqual(UDP_INTERFACE)
      expect(udpPlugin.witInterface.package).toBe('wasi:sockets')
      expect(udpPlugin.witInterface.name).toBe('udp')
      expect(udpPlugin.defaultImplementation).toBe('virtual')
    })

    it('should define udp-create-socket plugin correctly', () => {
      expect(udpCreateSocketPlugin.witInterface).toEqual(UDP_CREATE_SOCKET_INTERFACE)
      expect(udpCreateSocketPlugin.witInterface.package).toBe('wasi:sockets')
      expect(udpCreateSocketPlugin.witInterface.name).toBe('udp-create-socket')
      expect(udpCreateSocketPlugin.defaultImplementation).toBe('virtual')
    })

    it('should export all socket plugins', () => {
      expect(socketPlugins).toHaveLength(7)
      expect(socketPlugins).toContain(networkPlugin)
      expect(socketPlugins).toContain(instanceNetworkPlugin)
      expect(socketPlugins).toContain(ipNameLookupPlugin)
      expect(socketPlugins).toContain(tcpPlugin)
      expect(socketPlugins).toContain(tcpCreateSocketPlugin)
      expect(socketPlugins).toContain(udpPlugin)
      expect(socketPlugins).toContain(udpCreateSocketPlugin)
    })
  })

  describe('IP Address Utilities', () => {
    describe('parseIpv4', () => {
      it('should parse valid IPv4 addresses', () => {
        expect(parseIpv4('192.168.1.1')).toEqual([192, 168, 1, 1])
        expect(parseIpv4('0.0.0.0')).toEqual([0, 0, 0, 0])
        expect(parseIpv4('255.255.255.255')).toEqual([255, 255, 255, 255])
        expect(parseIpv4('127.0.0.1')).toEqual([127, 0, 0, 1])
      })

      it('should return null for invalid IPv4 addresses', () => {
        expect(parseIpv4('')).toBeNull()
        expect(parseIpv4('192.168.1')).toBeNull()
        expect(parseIpv4('192.168.1.256')).toBeNull()
        expect(parseIpv4('not.an.ip.address')).toBeNull()
      })
    })

    describe('parseIpv6', () => {
      it('should parse valid IPv6 addresses', () => {
        expect(parseIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
        expect(parseIpv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
        expect(parseIpv6('fe80::1')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1])
      })

      it('should return null for invalid IPv6 addresses', () => {
        expect(parseIpv6('')).toBeNull()
        expect(parseIpv6('not:an:ipv6')).toBeNull()
      })
    })

    describe('formatIpv4', () => {
      it('should format IPv4 addresses', () => {
        expect(formatIpv4([192, 168, 1, 1])).toBe('192.168.1.1')
        expect(formatIpv4([127, 0, 0, 1])).toBe('127.0.0.1')
      })
    })

    describe('formatIpv6', () => {
      it('should format IPv6 addresses', () => {
        expect(formatIpv6([0, 0, 0, 0, 0, 0, 0, 1])).toBe('0:0:0:0:0:0:0:1')
        expect(formatIpv6([0xfe80, 0, 0, 0, 0, 0, 0, 1])).toBe('fe80:0:0:0:0:0:0:1')
      })
    })

    describe('formatSocketAddress', () => {
      it('should format IPv4 socket addresses', () => {
        expect(
          formatSocketAddress({
            tag: 'ipv4',
            val: { port: 80, address: [192, 168, 1, 1] },
          })
        ).toBe('192.168.1.1:80')
      })

      it('should format IPv6 socket addresses', () => {
        expect(
          formatSocketAddress({
            tag: 'ipv6',
            val: { port: 443, address: [0, 0, 0, 0, 0, 0, 0, 1], flowInfo: 0, scopeId: 0 },
          })
        ).toBe('[0:0:0:0:0:0:0:1]:443')
      })
    })

    describe('isLoopback', () => {
      it('should detect IPv4 loopback', () => {
        expect(isLoopback({ tag: 'ipv4', val: [127, 0, 0, 1] })).toBe(true)
        expect(isLoopback({ tag: 'ipv4', val: [127, 255, 255, 255] })).toBe(true)
        expect(isLoopback({ tag: 'ipv4', val: [192, 168, 1, 1] })).toBe(false)
      })

      it('should detect IPv6 loopback', () => {
        expect(isLoopback({ tag: 'ipv6', val: [0, 0, 0, 0, 0, 0, 0, 1] })).toBe(true)
        expect(isLoopback({ tag: 'ipv6', val: [0xfe80, 0, 0, 0, 0, 0, 0, 1] })).toBe(false)
      })
    })

    describe('isAny', () => {
      it('should detect IPv4 any address', () => {
        expect(isAny({ tag: 'ipv4', val: [0, 0, 0, 0] })).toBe(true)
        expect(isAny({ tag: 'ipv4', val: [192, 168, 1, 1] })).toBe(false)
      })

      it('should detect IPv6 any address', () => {
        expect(isAny({ tag: 'ipv6', val: [0, 0, 0, 0, 0, 0, 0, 0] })).toBe(true)
        expect(isAny({ tag: 'ipv6', val: [0, 0, 0, 0, 0, 0, 0, 1] })).toBe(false)
      })
    })

    describe('anyAddress', () => {
      it('should create any address for each family', () => {
        expect(anyAddress('ipv4')).toEqual({ tag: 'ipv4', val: [0, 0, 0, 0] })
        expect(anyAddress('ipv6')).toEqual({ tag: 'ipv6', val: [0, 0, 0, 0, 0, 0, 0, 0] })
      })
    })

    describe('loopbackAddress', () => {
      it('should create loopback address for each family', () => {
        expect(loopbackAddress('ipv4')).toEqual({ tag: 'ipv4', val: [127, 0, 0, 1] })
        expect(loopbackAddress('ipv6')).toEqual({ tag: 'ipv6', val: [0, 0, 0, 0, 0, 0, 0, 1] })
      })
    })
  })

  describe('Network Plugin', () => {
    it('should create an instance', () => {
      const instance = virtualNetworkImplementation.create({ interface: NETWORK_INTERFACE })
      expect(instance).toBeDefined()
    })

    it('should provide resource drop function', () => {
      const instance = virtualNetworkImplementation.create({ interface: NETWORK_INTERFACE })
      const imports = instance.getImports() as {
        '[resource-drop]network': (handle: number) => void
      }

      expect(imports['[resource-drop]network']).toBeDefined()
      expect(typeof imports['[resource-drop]network']).toBe('function')
    })
  })

  describe('Instance Network Plugin', () => {
    it('should create an instance', () => {
      const instance = virtualInstanceNetworkImplementation.create({
        interface: INSTANCE_NETWORK_INTERFACE,
      })
      expect(instance).toBeDefined()
    })

    it('should return a network handle', () => {
      const instance = virtualInstanceNetworkImplementation.create({
        interface: INSTANCE_NETWORK_INTERFACE,
      })
      const imports = instance.getImports() as {
        'instance-network': () => number
      }

      const handle = imports['instance-network']()
      expect(typeof handle).toBe('number')
      expect(handle).toBeGreaterThan(0)

      instance.destroy()
    })
  })

  describe('IP Name Lookup Plugin', () => {
    describe('Virtual Implementation', () => {
      it('should create an instance', () => {
        const instance = virtualIpNameLookupImplementation.create({
          interface: IP_NAME_LOOKUP_INTERFACE,
        })
        expect(instance).toBeDefined()
      })

      it('should resolve localhost', () => {
        // First get a network handle
        const networkInstance = virtualInstanceNetworkImplementation.create({
          interface: INSTANCE_NETWORK_INTERFACE,
        })
        const networkImports = networkInstance.getImports() as {
          'instance-network': () => number
        }
        const networkHandle = networkImports['instance-network']()

        const instance = virtualIpNameLookupImplementation.create({
          interface: IP_NAME_LOOKUP_INTERFACE,
        })
        const imports = instance.getImports() as {
          'resolve-addresses': (
            network: number,
            name: string
          ) => number | { tag: 'err'; val: string }
          '[method]resolve-address-stream.resolve-next-address': (
            stream: number
          ) => unknown | undefined | { tag: 'err'; val: string }
        }

        const streamHandle = imports['resolve-addresses'](networkHandle, 'localhost')
        expect(typeof streamHandle).toBe('number')

        // Get first address
        const addr = imports['[method]resolve-address-stream.resolve-next-address'](
          streamHandle as number
        )
        expect(addr).toBeDefined()

        networkInstance.destroy()
      })

      it('should resolve IP address directly', () => {
        const networkInstance = virtualInstanceNetworkImplementation.create({
          interface: INSTANCE_NETWORK_INTERFACE,
        })
        const networkImports = networkInstance.getImports() as {
          'instance-network': () => number
        }
        const networkHandle = networkImports['instance-network']()

        const instance = virtualIpNameLookupImplementation.create({
          interface: IP_NAME_LOOKUP_INTERFACE,
        })
        const imports = instance.getImports() as {
          'resolve-addresses': (
            network: number,
            name: string
          ) => number | { tag: 'err'; val: string }
          '[method]resolve-address-stream.resolve-next-address': (
            stream: number
          ) => unknown | undefined | { tag: 'err'; val: string }
        }

        const streamHandle = imports['resolve-addresses'](networkHandle, '192.168.1.1')
        expect(typeof streamHandle).toBe('number')

        const addr = imports['[method]resolve-address-stream.resolve-next-address'](
          streamHandle as number
        ) as { tag: 'ipv4'; val: number[] }
        expect(addr.tag).toBe('ipv4')
        expect(addr.val).toEqual([192, 168, 1, 1])

        networkInstance.destroy()
      })

      it('should use static mappings', () => {
        const networkInstance = virtualInstanceNetworkImplementation.create({
          interface: INSTANCE_NETWORK_INTERFACE,
        })
        const networkImports = networkInstance.getImports() as {
          'instance-network': () => number
        }
        const networkHandle = networkImports['instance-network']()

        const instance = virtualIpNameLookupImplementation.create({
          interface: IP_NAME_LOOKUP_INTERFACE,
          options: {
            staticMappings: {
              'example.com': ['93.184.216.34'],
            },
          },
        })
        const imports = instance.getImports() as {
          'resolve-addresses': (
            network: number,
            name: string
          ) => number | { tag: 'err'; val: string }
          '[method]resolve-address-stream.resolve-next-address': (
            stream: number
          ) => unknown | undefined | { tag: 'err'; val: string }
        }

        const streamHandle = imports['resolve-addresses'](networkHandle, 'example.com')
        expect(typeof streamHandle).toBe('number')

        const addr = imports['[method]resolve-address-stream.resolve-next-address'](
          streamHandle as number
        ) as { tag: 'ipv4'; val: number[] }
        expect(addr.tag).toBe('ipv4')
        expect(addr.val).toEqual([93, 184, 216, 34])

        networkInstance.destroy()
      })
    })

    describe('Stub Implementation', () => {
      it('should return error for unknown hostnames', () => {
        const networkInstance = virtualInstanceNetworkImplementation.create({
          interface: INSTANCE_NETWORK_INTERFACE,
        })
        const networkImports = networkInstance.getImports() as {
          'instance-network': () => number
        }
        const networkHandle = networkImports['instance-network']()

        const instance = stubIpNameLookupImplementation.create({
          interface: IP_NAME_LOOKUP_INTERFACE,
        })
        const imports = instance.getImports() as {
          'resolve-addresses': (
            network: number,
            name: string
          ) => number | { tag: 'err'; val: string }
          '[method]resolve-address-stream.resolve-next-address': (
            stream: number
          ) => unknown | undefined | { tag: 'err'; val: string }
        }

        const streamHandle = imports['resolve-addresses'](networkHandle, 'unknown.example.com')
        expect(typeof streamHandle).toBe('number')

        // Should return error or empty
        const result = imports['[method]resolve-address-stream.resolve-next-address'](
          streamHandle as number
        )
        // Either undefined (end of stream) or error
        expect(result === undefined || (result as { tag: string }).tag === 'err').toBe(true)

        networkInstance.destroy()
      })
    })
  })

  describe('TCP Plugin', () => {
    it('should create an instance', () => {
      const instance = virtualTcpImplementation.create({ interface: TCP_INTERFACE })
      expect(instance).toBeDefined()
    })

    it('should create a TCP socket', () => {
      const networkInstance = virtualInstanceNetworkImplementation.create({
        interface: INSTANCE_NETWORK_INTERFACE,
      })
      const networkImports = networkInstance.getImports() as {
        'instance-network': () => number
      }
      const networkHandle = networkImports['instance-network']()

      const createInstance = virtualTcpCreateSocketImplementation.create({
        interface: TCP_CREATE_SOCKET_INTERFACE,
      })
      const createImports = createInstance.getImports() as {
        'create-tcp-socket': (
          network: number,
          family: string
        ) => number | { tag: 'err'; val: string }
      }

      const socketHandle = createImports['create-tcp-socket'](networkHandle, 'ipv4')
      expect(typeof socketHandle).toBe('number')
      expect(socketHandle).toBeGreaterThan(0)

      networkInstance.destroy()
    })

    it('should get/set socket options', () => {
      const networkInstance = virtualInstanceNetworkImplementation.create({
        interface: INSTANCE_NETWORK_INTERFACE,
      })
      const networkImports = networkInstance.getImports() as {
        'instance-network': () => number
      }
      const networkHandle = networkImports['instance-network']()

      const createInstance = virtualTcpCreateSocketImplementation.create({
        interface: TCP_CREATE_SOCKET_INTERFACE,
      })
      const createImports = createInstance.getImports() as {
        'create-tcp-socket': (
          network: number,
          family: string
        ) => number | { tag: 'err'; val: string }
      }

      const instance = virtualTcpImplementation.create({ interface: TCP_INTERFACE })
      const imports = instance.getImports() as {
        '[method]tcp-socket.keep-alive-enabled': (handle: number) => boolean
        '[method]tcp-socket.set-keep-alive-enabled': (handle: number, value: boolean) => void
        '[method]tcp-socket.hop-limit': (handle: number) => number
        '[method]tcp-socket.set-hop-limit': (handle: number, value: number) => void
      }

      const socketHandle = createImports['create-tcp-socket'](networkHandle, 'ipv4') as number

      // Test keep-alive
      expect(imports['[method]tcp-socket.keep-alive-enabled'](socketHandle)).toBe(false)
      imports['[method]tcp-socket.set-keep-alive-enabled'](socketHandle, true)
      expect(imports['[method]tcp-socket.keep-alive-enabled'](socketHandle)).toBe(true)

      // Test hop limit
      expect(imports['[method]tcp-socket.hop-limit'](socketHandle)).toBe(64)
      imports['[method]tcp-socket.set-hop-limit'](socketHandle, 128)
      expect(imports['[method]tcp-socket.hop-limit'](socketHandle)).toBe(128)

      networkInstance.destroy()
    })

    it('should return NotSupported for connect', () => {
      const networkInstance = virtualInstanceNetworkImplementation.create({
        interface: INSTANCE_NETWORK_INTERFACE,
      })
      const networkImports = networkInstance.getImports() as {
        'instance-network': () => number
      }
      const networkHandle = networkImports['instance-network']()

      const createInstance = virtualTcpCreateSocketImplementation.create({
        interface: TCP_CREATE_SOCKET_INTERFACE,
      })
      const createImports = createInstance.getImports() as {
        'create-tcp-socket': (
          network: number,
          family: string
        ) => number | { tag: 'err'; val: string }
      }

      const instance = virtualTcpImplementation.create({ interface: TCP_INTERFACE })
      const imports = instance.getImports() as {
        '[method]tcp-socket.start-connect': (
          handle: number,
          network: number,
          addr: unknown
        ) => void | { tag: 'err'; val: string }
        '[method]tcp-socket.finish-connect': (
          handle: number
        ) => [number, number] | { tag: 'err'; val: string }
      }

      const socketHandle = createImports['create-tcp-socket'](networkHandle, 'ipv4') as number

      const remoteAddr = {
        tag: 'ipv4',
        val: { port: 80, address: [192, 168, 1, 1] },
      }

      imports['[method]tcp-socket.start-connect'](socketHandle, networkHandle, remoteAddr)
      const result = imports['[method]tcp-socket.finish-connect'](socketHandle)

      expect((result as { tag: string; val: string }).tag).toBe('err')
      expect((result as { tag: string; val: string }).val).toBe(NetworkErrorCode.NotSupported)

      networkInstance.destroy()
    })
  })

  describe('UDP Plugin', () => {
    it('should create an instance', () => {
      const instance = virtualUdpImplementation.create({ interface: UDP_INTERFACE })
      expect(instance).toBeDefined()
    })

    it('should create a UDP socket', () => {
      const networkInstance = virtualInstanceNetworkImplementation.create({
        interface: INSTANCE_NETWORK_INTERFACE,
      })
      const networkImports = networkInstance.getImports() as {
        'instance-network': () => number
      }
      const networkHandle = networkImports['instance-network']()

      const createInstance = virtualUdpCreateSocketImplementation.create({
        interface: UDP_CREATE_SOCKET_INTERFACE,
      })
      const createImports = createInstance.getImports() as {
        'create-udp-socket': (
          network: number,
          family: string
        ) => number | { tag: 'err'; val: string }
      }

      const socketHandle = createImports['create-udp-socket'](networkHandle, 'ipv4')
      expect(typeof socketHandle).toBe('number')
      expect(socketHandle).toBeGreaterThan(0)

      networkInstance.destroy()
    })

    it('should get/set socket options', () => {
      const networkInstance = virtualInstanceNetworkImplementation.create({
        interface: INSTANCE_NETWORK_INTERFACE,
      })
      const networkImports = networkInstance.getImports() as {
        'instance-network': () => number
      }
      const networkHandle = networkImports['instance-network']()

      const createInstance = virtualUdpCreateSocketImplementation.create({
        interface: UDP_CREATE_SOCKET_INTERFACE,
      })
      const createImports = createInstance.getImports() as {
        'create-udp-socket': (
          network: number,
          family: string
        ) => number | { tag: 'err'; val: string }
      }

      const instance = virtualUdpImplementation.create({ interface: UDP_INTERFACE })
      const imports = instance.getImports() as {
        '[method]udp-socket.unicast-hop-limit': (handle: number) => number
        '[method]udp-socket.set-unicast-hop-limit': (handle: number, value: number) => void
        '[method]udp-socket.receive-buffer-size': (handle: number) => bigint
        '[method]udp-socket.set-receive-buffer-size': (handle: number, value: bigint) => void
      }

      const socketHandle = createImports['create-udp-socket'](networkHandle, 'ipv4') as number

      // Test unicast hop limit
      expect(imports['[method]udp-socket.unicast-hop-limit'](socketHandle)).toBe(64)
      imports['[method]udp-socket.set-unicast-hop-limit'](socketHandle, 128)
      expect(imports['[method]udp-socket.unicast-hop-limit'](socketHandle)).toBe(128)

      // Test receive buffer size
      expect(imports['[method]udp-socket.receive-buffer-size'](socketHandle)).toBe(65536n)
      imports['[method]udp-socket.set-receive-buffer-size'](socketHandle, 131072n)
      expect(imports['[method]udp-socket.receive-buffer-size'](socketHandle)).toBe(131072n)

      networkInstance.destroy()
    })

    it('should bind and create streams', () => {
      const networkInstance = virtualInstanceNetworkImplementation.create({
        interface: INSTANCE_NETWORK_INTERFACE,
      })
      const networkImports = networkInstance.getImports() as {
        'instance-network': () => number
      }
      const networkHandle = networkImports['instance-network']()

      const createInstance = virtualUdpCreateSocketImplementation.create({
        interface: UDP_CREATE_SOCKET_INTERFACE,
      })
      const createImports = createInstance.getImports() as {
        'create-udp-socket': (
          network: number,
          family: string
        ) => number | { tag: 'err'; val: string }
      }

      const instance = virtualUdpImplementation.create({ interface: UDP_INTERFACE })
      const imports = instance.getImports() as {
        '[method]udp-socket.start-bind': (
          handle: number,
          network: number,
          addr: unknown
        ) => void | { tag: 'err'; val: string }
        '[method]udp-socket.finish-bind': (
          handle: number
        ) => void | { tag: 'err'; val: string }
        '[method]udp-socket.stream': (
          handle: number,
          remoteAddr?: unknown
        ) => [number, number] | { tag: 'err'; val: string }
      }

      const socketHandle = createImports['create-udp-socket'](networkHandle, 'ipv4') as number

      const localAddr = {
        tag: 'ipv4',
        val: { port: 0, address: [0, 0, 0, 0] },
      }

      // Bind
      const bindResult = imports['[method]udp-socket.start-bind'](
        socketHandle,
        networkHandle,
        localAddr
      )
      expect(bindResult).toBeUndefined()

      const finishResult = imports['[method]udp-socket.finish-bind'](socketHandle)
      expect(finishResult).toBeUndefined()

      // Create streams
      const streamResult = imports['[method]udp-socket.stream'](socketHandle, undefined)
      expect(Array.isArray(streamResult)).toBe(true)
      expect((streamResult as number[]).length).toBe(2)

      networkInstance.destroy()
    })
  })
})

describe('DNS-over-HTTPS (DoH)', () => {
  describe('DOH_PROVIDERS', () => {
    it('should define Cloudflare provider', () => {
      expect(DOH_PROVIDERS.cloudflare).toBe('https://cloudflare-dns.com/dns-query')
    })

    it('should define Google provider', () => {
      expect(DOH_PROVIDERS.google).toBe('https://dns.google/dns-query')
    })

    it('should define Quad9 provider', () => {
      expect(DOH_PROVIDERS.quad9).toBe('https://dns.quad9.net/dns-query')
    })

    it('should define AdGuard provider', () => {
      expect(DOH_PROVIDERS.adguard).toBe('https://dns.adguard-dns.com/dns-query')
    })
  })

  describe('DEFAULT_DOH_RESOLVER', () => {
    it('should default to Cloudflare', () => {
      expect(DEFAULT_DOH_RESOLVER).toBe(DOH_PROVIDERS.cloudflare)
    })
  })

  describe('DnsRecordType', () => {
    it('should define A record type', () => {
      expect(DnsRecordType.A).toBe(1)
    })

    it('should define AAAA record type', () => {
      expect(DnsRecordType.AAAA).toBe(28)
    })
  })

  describe('dohIpNameLookupImplementation', () => {
    it('should have correct name', () => {
      expect(dohIpNameLookupImplementation.name).toBe('doh')
    })

    it('should have correct description', () => {
      expect(dohIpNameLookupImplementation.description).toBe('DNS-over-HTTPS resolver')
    })

    it('should create instance', () => {
      const instance = dohIpNameLookupImplementation.create({})
      expect(instance).toBeDefined()
      expect(instance.getImports).toBeDefined()
      instance.destroy()
    })

    it('should create instance with custom resolver', () => {
      const instance = dohIpNameLookupImplementation.create({
        options: {
          dohResolverUrl: DOH_PROVIDERS.google,
          dohTimeoutMs: 10000,
          cacheTtlMs: 60000,
        },
      })
      expect(instance).toBeDefined()
      instance.destroy()
    })
  })

  describe('ipNameLookupPlugin with DoH', () => {
    it('should have doh implementation', () => {
      expect(ipNameLookupPlugin.implementations.has('doh')).toBe(true)
    })

    it('should have virtual, doh, and stub implementations', () => {
      expect(ipNameLookupPlugin.implementations.size).toBe(3)
      expect(ipNameLookupPlugin.implementations.has('virtual')).toBe(true)
      expect(ipNameLookupPlugin.implementations.has('doh')).toBe(true)
      expect(ipNameLookupPlugin.implementations.has('stub')).toBe(true)
    })
  })

  describe('virtualIpNameLookupImplementation with DoH', () => {
    it('should create instance with DoH enabled by default', () => {
      const instance = virtualIpNameLookupImplementation.create({})
      expect(instance).toBeDefined()
      instance.destroy()
    })

    it('should create instance with DoH disabled', () => {
      const instance = virtualIpNameLookupImplementation.create({
        options: {
          enableDoh: false,
        },
      })
      expect(instance).toBeDefined()
      instance.destroy()
    })

    it('should support static mappings alongside DoH', () => {
      const instance = virtualIpNameLookupImplementation.create({
        options: {
          staticMappings: {
            'test.local': ['192.168.1.1'],
          },
          enableDoh: true,
        },
      })
      expect(instance).toBeDefined()
      instance.destroy()
    })
  })

  describe('stubIpNameLookupImplementation', () => {
    it('should have DoH disabled', () => {
      const instance = stubIpNameLookupImplementation.create({})
      expect(instance).toBeDefined()
      // Stub implementation doesn't do external lookups
      instance.destroy()
    })

    it('should still support static mappings', () => {
      const instance = stubIpNameLookupImplementation.create({
        options: {
          staticMappings: {
            'internal.local': ['10.0.0.1'],
          },
        },
      })
      expect(instance).toBeDefined()
      instance.destroy()
    })
  })
})
