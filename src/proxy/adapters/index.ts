/**
 * Proxy Server Adapters
 *
 * Adapters handle specific protocol operations for the proxy server.
 */

export { TcpAdapter, createTcpAdapter, type TcpAdapterConfig } from './tcp.js'
export { DnsAdapter, createDnsAdapter, type DnsAdapterConfig } from './dns.js'
export { HttpAdapter, createHttpAdapter, type HttpAdapterConfig } from './http.js'
export { FsAdapter, createFsAdapter, type FsAdapterConfig } from './fs.js'
