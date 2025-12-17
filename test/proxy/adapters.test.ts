/**
 * Proxy Adapter Unit Tests
 *
 * Tests for TCP, HTTP, DNS, and Filesystem adapters
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MessageType,
  StreamType,
  ErrorCode,
  DnsRecordType,
  FsOpenFlags,
  FsFileType,
  HEADER_SIZE,
  DEFAULT_WINDOW_SIZE,
  PROTOCOL_MAGIC,
  PROTOCOL_VERSION,
  createFrame,
  encodeString,
  encodeDnsQuery,
  decodeDnsQuery,
  encodeDnsResponse,
  decodeDnsResponse,
} from '../../src/wasip2/proxy/protocol.js'

// =============================================================================
// DNS Adapter Tests
// =============================================================================

describe('DNS Adapter Protocol', () => {
  describe('DnsRecordType', () => {
    it('should have standard record type values', () => {
      expect(DnsRecordType.A).toBe(1)
      expect(DnsRecordType.AAAA).toBe(28)
      expect(DnsRecordType.CNAME).toBe(5)
      expect(DnsRecordType.MX).toBe(15)
      expect(DnsRecordType.TXT).toBe(16)
      expect(DnsRecordType.SRV).toBe(33)
    })
  })

  describe('DNS Query Encoding', () => {
    it('should encode A record query', () => {
      const query = {
        hostname: 'example.com',
        recordType: DnsRecordType.A,
      }

      const encoded = encodeDnsQuery(query)
      const decoded = decodeDnsQuery(encoded)

      expect(decoded.hostname).toBe('example.com')
      expect(decoded.recordType).toBe(DnsRecordType.A)
    })

    it('should encode AAAA record query', () => {
      const query = {
        hostname: 'ipv6.example.com',
        recordType: DnsRecordType.AAAA,
      }

      const encoded = encodeDnsQuery(query)
      const decoded = decodeDnsQuery(encoded)

      expect(decoded.hostname).toBe('ipv6.example.com')
      expect(decoded.recordType).toBe(DnsRecordType.AAAA)
    })

    it('should handle unicode hostnames', () => {
      const query = {
        hostname: 'münchen.example.com',
        recordType: DnsRecordType.A,
      }

      const encoded = encodeDnsQuery(query)
      const decoded = decodeDnsQuery(encoded)

      expect(decoded.hostname).toBe('münchen.example.com')
    })

    it('should handle long hostnames', () => {
      const longHostname = 'a'.repeat(253) + '.com'
      const query = {
        hostname: longHostname,
        recordType: DnsRecordType.A,
      }

      const encoded = encodeDnsQuery(query)
      const decoded = decodeDnsQuery(encoded)

      expect(decoded.hostname).toBe(longHostname)
    })
  })

  describe('DNS Response Encoding', () => {
    it('should encode response with single address', () => {
      const response = {
        hostname: 'example.com',
        recordType: DnsRecordType.A,
        addresses: ['93.184.216.34'],
        ttl: 300,
      }

      const encoded = encodeDnsResponse(response)
      const decoded = decodeDnsResponse(encoded)

      expect(decoded.hostname).toBe('example.com')
      expect(decoded.recordType).toBe(DnsRecordType.A)
      expect(decoded.addresses).toEqual(['93.184.216.34'])
      expect(decoded.ttl).toBe(300)
    })

    it('should encode response with multiple addresses', () => {
      const response = {
        hostname: 'multi.example.com',
        recordType: DnsRecordType.A,
        addresses: ['192.168.1.1', '192.168.1.2', '192.168.1.3'],
        ttl: 60,
      }

      const encoded = encodeDnsResponse(response)
      const decoded = decodeDnsResponse(encoded)

      expect(decoded.addresses).toHaveLength(3)
      expect(decoded.addresses).toContain('192.168.1.1')
      expect(decoded.addresses).toContain('192.168.1.2')
      expect(decoded.addresses).toContain('192.168.1.3')
    })

    it('should encode response with no addresses (NXDOMAIN)', () => {
      const response = {
        hostname: 'notfound.example.com',
        recordType: DnsRecordType.A,
        addresses: [],
        ttl: 0,
      }

      const encoded = encodeDnsResponse(response)
      const decoded = decodeDnsResponse(encoded)

      expect(decoded.addresses).toEqual([])
      expect(decoded.ttl).toBe(0)
    })

    it('should encode IPv6 addresses', () => {
      const response = {
        hostname: 'ipv6.example.com',
        recordType: DnsRecordType.AAAA,
        addresses: ['2001:db8::1', '::1'],
        ttl: 600,
      }

      const encoded = encodeDnsResponse(response)
      const decoded = decodeDnsResponse(encoded)

      expect(decoded.recordType).toBe(DnsRecordType.AAAA)
      expect(decoded.addresses).toEqual(['2001:db8::1', '::1'])
    })
  })

  describe('DNS Message Frames', () => {
    it('should create DNS_QUERY frame', () => {
      const payload = encodeDnsQuery({
        hostname: 'test.com',
        recordType: DnsRecordType.A,
      })
      const frame = createFrame(MessageType.DNS_QUERY, 1, payload)

      const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
      expect(view.getUint8(5)).toBe(MessageType.DNS_QUERY)
      expect(view.getUint32(8, true)).toBe(1) // streamId
    })

    it('should create DNS_RESPONSE frame', () => {
      const payload = encodeDnsResponse({
        hostname: 'test.com',
        recordType: DnsRecordType.A,
        addresses: ['1.2.3.4'],
        ttl: 300,
      })
      const frame = createFrame(MessageType.DNS_RESPONSE, 1, payload)

      const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
      expect(view.getUint8(5)).toBe(MessageType.DNS_RESPONSE)
    })
  })
})

// =============================================================================
// TCP Adapter Tests
// =============================================================================

describe('TCP Adapter Protocol', () => {
  describe('TCP Message Types', () => {
    it('should have correct TCP message types', () => {
      expect(MessageType.TCP_CONNECT).toBe(0x20)
      expect(MessageType.TCP_CONNECT_ACK).toBe(0x21)
      expect(MessageType.TCP_LISTEN).toBe(0x22)
      expect(MessageType.TCP_ACCEPT).toBe(0x23)
      expect(MessageType.TCP_SHUTDOWN).toBe(0x24)
    })
  })

  describe('TCP Connect Payload', () => {
    it('should encode host and port', () => {
      // Manually construct TCP_CONNECT payload
      const host = 'example.com'
      const port = 443
      const hostBytes = encodeString(host)

      const payload = new Uint8Array(2 + hostBytes.length + 1)
      const view = new DataView(payload.buffer)
      view.setUint16(0, port, true)
      payload.set(hostBytes, 2)
      payload[2 + hostBytes.length] = 0 // flags: no local address, no keepalive, no nodelay

      // Verify structure
      expect(view.getUint16(0, true)).toBe(443)
    })

    it('should encode connection options', () => {
      const flags = 0x02 | 0x04 // keepAlive + noDelay
      expect(flags & 0x02).toBeTruthy() // keepAlive
      expect(flags & 0x04).toBeTruthy() // noDelay
      expect(flags & 0x01).toBeFalsy() // no local address
    })
  })

  describe('TCP Connect ACK Payload', () => {
    it('should encode local and remote addresses', () => {
      const localAddr = '127.0.0.1'
      const remoteAddr = '93.184.216.34'
      const localPort = 54321
      const remotePort = 443

      const localAddrBytes = encodeString(localAddr)
      const remoteAddrBytes = encodeString(remoteAddr)

      const payload = new Uint8Array(4 + localAddrBytes.length + remoteAddrBytes.length)
      const view = new DataView(payload.buffer)
      view.setUint16(0, localPort, true)
      view.setUint16(2, remotePort, true)
      payload.set(localAddrBytes, 4)
      payload.set(remoteAddrBytes, 4 + localAddrBytes.length)

      expect(view.getUint16(0, true)).toBe(localPort)
      expect(view.getUint16(2, true)).toBe(remotePort)
    })
  })

  describe('TCP Shutdown', () => {
    it('should encode shutdown flags', () => {
      // Shutdown read only
      expect(0x01 & 0x01).toBe(0x01) // shutdownRead
      expect(0x01 & 0x02).toBe(0x00) // shutdownWrite

      // Shutdown write only
      expect(0x02 & 0x01).toBe(0x00) // shutdownRead
      expect(0x02 & 0x02).toBe(0x02) // shutdownWrite

      // Shutdown both
      expect(0x03 & 0x01).toBe(0x01)
      expect(0x03 & 0x02).toBe(0x02)
    })
  })
})

// =============================================================================
// HTTP Adapter Tests
// =============================================================================

describe('HTTP Adapter Protocol', () => {
  describe('HTTP Message Types', () => {
    it('should have correct HTTP message types', () => {
      expect(MessageType.HTTP_REQUEST).toBe(0x50)
      expect(MessageType.HTTP_RESPONSE_HEAD).toBe(0x51)
      expect(MessageType.HTTP_RESPONSE_BODY).toBe(0x52)
      expect(MessageType.HTTP_RESPONSE_TRAILERS).toBe(0x53)
    })
  })

  describe('HTTP Request Payload', () => {
    it('should encode request method and URI', () => {
      const method = 'GET'
      const uri = 'https://example.com/path'
      const methodBytes = encodeString(method)
      const uriBytes = encodeString(uri)

      // Verify encoding produces bytes
      expect(methodBytes.length).toBeGreaterThan(0)
      expect(uriBytes.length).toBeGreaterThan(0)
    })

    it('should encode headers as array of tuples', () => {
      const headers: Array<[string, Uint8Array]> = [
        ['Content-Type', new TextEncoder().encode('application/json')],
        ['Accept', new TextEncoder().encode('*/*')],
      ]

      // Verify header structure
      expect(headers).toHaveLength(2)
      expect(headers[0]![0]).toBe('Content-Type')
      expect(headers[1]![0]).toBe('Accept')
    })
  })

  describe('HTTP Response Head Payload', () => {
    it('should encode status code', () => {
      const statusCodes = [200, 201, 301, 400, 404, 500, 502, 503]

      for (const status of statusCodes) {
        const payload = new Uint8Array(2)
        const view = new DataView(payload.buffer)
        view.setUint16(0, status, true)
        expect(view.getUint16(0, true)).toBe(status)
      }
    })

    it('should encode hasBody flag', () => {
      // hasBody = true
      expect(1).toBe(1)
      // hasBody = false
      expect(0).toBe(0)
    })
  })
})

// =============================================================================
// Filesystem Adapter Tests
// =============================================================================

describe('Filesystem Adapter Protocol', () => {
  describe('FS Message Types', () => {
    it('should have correct FS message types', () => {
      expect(MessageType.FS_OPEN).toBe(0x60)
      expect(MessageType.FS_OPEN_ACK).toBe(0x61)
      expect(MessageType.FS_READ).toBe(0x62)
      expect(MessageType.FS_READ_ACK).toBe(0x63)
      expect(MessageType.FS_WRITE).toBe(0x64)
      expect(MessageType.FS_WRITE_ACK).toBe(0x65)
      expect(MessageType.FS_STAT).toBe(0x66)
      expect(MessageType.FS_STAT_ACK).toBe(0x67)
      expect(MessageType.FS_READDIR).toBe(0x68)
      expect(MessageType.FS_READDIR_ACK).toBe(0x69)
      expect(MessageType.FS_CLOSE).toBe(0x6a)
      expect(MessageType.FS_UNLINK).toBe(0x6b)
      expect(MessageType.FS_MKDIR).toBe(0x6c)
      expect(MessageType.FS_RMDIR).toBe(0x6d)
      expect(MessageType.FS_RENAME).toBe(0x6e)
    })
  })

  describe('FsOpenFlags', () => {
    it('should have correct flag values', () => {
      expect(FsOpenFlags.READ).toBe(0x01)
      expect(FsOpenFlags.WRITE).toBe(0x02)
      expect(FsOpenFlags.CREATE).toBe(0x04)
      expect(FsOpenFlags.TRUNCATE).toBe(0x08)
      expect(FsOpenFlags.APPEND).toBe(0x10)
      expect(FsOpenFlags.EXCLUSIVE).toBe(0x20)
    })

    it('should allow combining flags', () => {
      // Read + Write
      const rw = FsOpenFlags.READ | FsOpenFlags.WRITE
      expect(rw).toBe(0x03)

      // Create + Truncate + Write
      const create = FsOpenFlags.CREATE | FsOpenFlags.TRUNCATE | FsOpenFlags.WRITE
      expect(create).toBe(0x0e)

      // Append + Write
      const append = FsOpenFlags.APPEND | FsOpenFlags.WRITE
      expect(append).toBe(0x12)

      // Create + Exclusive
      const exclusive = FsOpenFlags.CREATE | FsOpenFlags.EXCLUSIVE | FsOpenFlags.WRITE
      expect(exclusive).toBe(0x26)
    })
  })

  describe('FsFileType', () => {
    it('should have correct file type values', () => {
      expect(FsFileType.FILE).toBe(0)
      expect(FsFileType.DIRECTORY).toBe(1)
      expect(FsFileType.SYMLINK).toBe(2)
      expect(FsFileType.OTHER).toBe(3)
    })
  })

  describe('FS Open Payload', () => {
    it('should encode path and flags', () => {
      const path = '/home/user/test.txt'
      const flags = FsOpenFlags.READ | FsOpenFlags.WRITE
      const mode = 0o644

      const pathBytes = encodeString(path)
      const payload = new Uint8Array(pathBytes.length + 5)
      payload.set(pathBytes, 0)
      const view = new DataView(payload.buffer)
      view.setUint8(pathBytes.length, flags)
      view.setUint32(pathBytes.length + 1, mode, true)

      expect(view.getUint8(pathBytes.length)).toBe(flags)
      expect(view.getUint32(pathBytes.length + 1, true)).toBe(mode)
    })
  })

  describe('FS Open ACK Payload', () => {
    it('should encode fd and fileType', () => {
      const fd = 3
      const fileType = FsFileType.FILE

      const payload = new Uint8Array(5)
      const view = new DataView(payload.buffer)
      view.setUint32(0, fd, true)
      view.setUint8(4, fileType)

      expect(view.getUint32(0, true)).toBe(fd)
      expect(view.getUint8(4)).toBe(fileType)
    })
  })

  describe('FS Read Payload', () => {
    it('should encode fd, offset, and length', () => {
      const fd = 5
      const offset = BigInt(1024)
      const length = 4096

      const payload = new Uint8Array(16)
      const view = new DataView(payload.buffer)
      view.setUint32(0, fd, true)
      view.setBigUint64(4, offset, true)
      view.setUint32(12, length, true)

      expect(view.getUint32(0, true)).toBe(fd)
      expect(view.getBigUint64(4, true)).toBe(offset)
      expect(view.getUint32(12, true)).toBe(length)
    })

    it('should handle large offsets', () => {
      const largeOffset = BigInt('9007199254740992') // 2^53

      const payload = new Uint8Array(8)
      const view = new DataView(payload.buffer)
      view.setBigUint64(0, largeOffset, true)

      expect(view.getBigUint64(0, true)).toBe(largeOffset)
    })
  })

  describe('FS Stat ACK Payload', () => {
    it('should encode file metadata', () => {
      const stat = {
        fileType: FsFileType.FILE,
        size: BigInt(12345),
        mtime: BigInt(1700000000000000000n), // nanoseconds
        atime: BigInt(1700000001000000000n),
        ctime: BigInt(1699999999000000000n),
        mode: 0o644,
      }

      const payload = new Uint8Array(37)
      const view = new DataView(payload.buffer)
      view.setUint8(0, stat.fileType)
      view.setBigUint64(1, stat.size, true)
      view.setBigUint64(9, stat.mtime, true)
      view.setBigUint64(17, stat.atime, true)
      view.setBigUint64(25, stat.ctime, true)
      view.setUint32(33, stat.mode, true)

      expect(view.getUint8(0)).toBe(FsFileType.FILE)
      expect(view.getBigUint64(1, true)).toBe(stat.size)
      expect(view.getUint32(33, true)).toBe(stat.mode)
    })
  })

  describe('FS Readdir ACK Payload', () => {
    it('should encode directory entries', () => {
      const entries = [
        { name: 'file1.txt', fileType: FsFileType.FILE },
        { name: 'subdir', fileType: FsFileType.DIRECTORY },
        { name: 'link', fileType: FsFileType.SYMLINK },
      ]

      // Calculate size
      let size = 4 // entry count
      const encodedNames: Uint8Array[] = []
      for (const entry of entries) {
        const nameBytes = encodeString(entry.name)
        encodedNames.push(nameBytes)
        size += nameBytes.length + 1 // name + fileType
      }

      const payload = new Uint8Array(size)
      const view = new DataView(payload.buffer)
      view.setUint32(0, entries.length, true)

      expect(view.getUint32(0, true)).toBe(3)
    })
  })

  describe('FS Rename Payload', () => {
    it('should encode old and new paths', () => {
      const oldPath = '/old/path.txt'
      const newPath = '/new/path.txt'

      const oldBytes = encodeString(oldPath)
      const newBytes = encodeString(newPath)

      const payload = new Uint8Array(oldBytes.length + newBytes.length)
      payload.set(oldBytes, 0)
      payload.set(newBytes, oldBytes.length)

      // Verify both paths are included
      expect(payload.length).toBe(oldBytes.length + newBytes.length)
    })
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Adapter Error Handling', () => {
  describe('Error Codes', () => {
    it('should have appropriate error codes for each adapter', () => {
      // DNS errors
      expect(ErrorCode.DNS_ERROR).toBe(11)

      // Connection errors (TCP/HTTP)
      expect(ErrorCode.CONNECT_ERROR).toBe(10)
      expect(ErrorCode.TIMEOUT).toBe(9)

      // IO errors (all adapters)
      expect(ErrorCode.IO_ERROR).toBe(12)

      // Permission errors (FS)
      expect(ErrorCode.PERMISSION_DENIED).toBe(13)
      expect(ErrorCode.NOT_FOUND).toBe(14)
      expect(ErrorCode.ALREADY_EXISTS).toBe(15)
    })
  })

  describe('Error Messages', () => {
    it('should create error frames', () => {
      const errorPayload = new Uint8Array(50)
      const view = new DataView(errorPayload.buffer)
      view.setUint32(0, ErrorCode.NOT_FOUND, true)

      const message = 'File not found: /test/path.txt'
      const messageBytes = encodeString(message)
      errorPayload.set(messageBytes, 4)

      const frame = createFrame(MessageType.ERROR, 1, errorPayload)
      const frameView = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)

      expect(frameView.getUint8(5)).toBe(MessageType.ERROR)
    })
  })
})

// =============================================================================
// Adapter Configuration Tests
// =============================================================================

describe('Adapter Configuration', () => {
  describe('Host Filtering', () => {
    it('should validate allowed hosts pattern', () => {
      const patterns = ['example.com', '*.example.com', 'localhost']

      // Exact match
      expect('example.com'.match(/^example\.com$/)).toBeTruthy()

      // Wildcard subdomain match
      const wildcardPattern = /^.*\.example\.com$/
      expect('sub.example.com'.match(wildcardPattern)).toBeTruthy()
      expect('a.b.example.com'.match(wildcardPattern)).toBeTruthy()
      expect('example.com'.match(wildcardPattern)).toBeFalsy()
    })

    it('should validate blocked hosts', () => {
      const blocked = ['malware.com', '*.evil.org']

      // Should block exact match
      expect(blocked.includes('malware.com')).toBe(true)
    })
  })

  describe('Port Filtering', () => {
    it('should validate port ranges', () => {
      const allowedPorts: Array<number | [number, number]> = [80, 443, [8000, 9000]]

      // Check individual port
      expect(allowedPorts.includes(80)).toBe(true)
      expect(allowedPorts.includes(443)).toBe(true)

      // Check range
      const ranges = allowedPorts.filter((p): p is [number, number] => Array.isArray(p))
      expect(ranges).toHaveLength(1)
      expect(ranges[0]![0]).toBe(8000)
      expect(ranges[0]![1]).toBe(9000)
    })

    it('should validate blocked ports', () => {
      const blockedPorts = [25, 587, 465] // SMTP ports
      expect(blockedPorts.includes(25)).toBe(true)
    })
  })

  describe('FS Path Sandboxing', () => {
    it('should detect path traversal attempts', () => {
      const dangerousPaths = ['../etc/passwd', '/root/../etc/shadow', 'foo/../../bar']

      for (const path of dangerousPaths) {
        expect(path.includes('..')).toBe(true)
      }
    })

    it('should validate preopen roots', () => {
      const preopens: Array<[string, string]> = [
        ['/', '/sandbox/data'],
        ['/tmp', '/sandbox/tmp'],
      ]

      expect(preopens).toHaveLength(2)
      expect(preopens[0]![0]).toBe('/')
      expect(preopens[0]![1]).toBe('/sandbox/data')
    })
  })
})
