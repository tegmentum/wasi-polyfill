/**
 * WASI Preview 3 interfaces
 *
 * Simplified P3-native interface implementations.
 *
 * @packageDocumentation
 */

// I/O
export {
  ErrorContextImpl,
  createErrorContext,
  errorContextFromError,
  mapErrorToCode,
  getIoImports,
} from './io.js'

// Clocks
export {
  monotonicNow,
  monotonicResolution,
  sleepUntil,
  sleepFor,
  wallClockNow,
  wallClockResolution,
  getClocksImports,
  type Instant,
  type Duration,
  type Datetime,
} from './clocks.js'

// Random
export {
  getRandomBytes,
  getRandomU64,
  getInsecureRandomBytes,
  getInsecureRandomU64,
  setInsecureSeed,
  getSeededU64,
  getRandomImports,
} from './random.js'

// CLI
export {
  CliExitError,
  createStdinFromString,
  createStdinFromLines,
  createCollectingWriter,
  createConsoleWriter,
  getCliImports,
  type CliConfig,
  type ExitStatus,
} from './cli.js'

// Filesystem
export {
  InMemoryFilesystem,
  getFilesystemImports,
  DescriptorFlags,
  DescriptorType,
  type DescriptorStat,
  type DirectoryEntry,
} from './filesystem.js'

// HTTP
export {
  Fields,
  Body,
  Request,
  Response,
  OutgoingHandler,
  IncomingHandler,
  getHttpImports,
  HttpErrorCode,
  type Method,
  type Scheme,
  type HttpHandler,
} from './http.js'

// Sockets
export {
  TcpSocket,
  UdpSocket,
  Network,
  resolveAddresses,
  getSocketsImports,
  SocketErrorCode,
  type IpAddress,
  type IpSocketAddress,
  type TcpState,
} from './sockets.js'
