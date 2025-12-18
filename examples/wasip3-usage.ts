/**
 * WASI Preview 3 (wasip3) usage examples
 *
 * This example demonstrates the new async features in WASIP3,
 * including streams, futures, the component loader, and P3 interfaces.
 *
 * WASIP3 introduces native async support with built-in stream<T> and
 * future<T> types, enabling composable concurrency across components.
 *
 * Expected timeline:
 * - August 2025: Preview release (0.3.0-rc)
 * - November 2025: Final release (0.3.0)
 */

import {
  // Main class
  Wasip3,
  createWasip3,
  // Async primitives
  createStream,
  createFuture,
  futureFromPromise,
  delay,
  resolvedFuture,
  raceFutures,
  allFutures,
  streamFromAsyncIterable,
  collectStream,
  pipeStream,
  mergeStreams,
  // Runtime
  AsyncExecutor,
  Wasip3ComponentLoader,
  // CLI utilities
  createStdinFromString,
  createStdinFromLines,
  createCollectingWriter,
  createConsoleWriter,
  // Interfaces
  monotonicNow,
  wallClockNow,
  sleepFor,
  getRandomBytes,
  getRandomU64,
  InMemoryFilesystem,
  // HTTP
  Fields,
  Body,
  Request,
  Response,
  OutgoingHandler,
  // Sockets
  TcpSocket,
  Network,
  // Types
  type Stream,
  type StreamWriter,
  type Future,
} from '@tegmentum/wasip2-polyfill/wasip3'

// ============================================================================
// Example 1: Streams - The Core Async Primitive
// ============================================================================

async function streamsExample() {
  console.log('=== Example 1: Streams ===\n')

  // Create a bidirectional stream pair
  const [reader, writer] = createStream<string>()

  console.log('Created stream pair (reader + writer)')

  // Write some values to the stream
  await writer.write(['Hello', 'World', 'from', 'WASIP3'])
  console.log('Wrote 4 values to stream')

  // Close the writer to signal end of stream
  writer.close()
  console.log('Closed writer')

  // Read all values from the stream
  const result = await reader.read()
  if (result.status === 'values') {
    console.log('Read values:', result.values)
  }

  // Read again to get end-of-stream
  const endResult = await reader.read()
  console.log('End of stream:', endResult.status)
  console.log()
}

// ============================================================================
// Example 2: Futures - Single Async Values
// ============================================================================

async function futuresExample() {
  console.log('=== Example 2: Futures ===\n')

  // Create a future manually
  const [future, resolver] = createFuture<number>()
  console.log('Created future')

  // Resolve it after a delay (simulating async work)
  setTimeout(() => {
    resolver.resolve(42)
    console.log('  Resolved future with value: 42')
  }, 100)

  // Read the value
  const result = await future.read()
  if (result.status === 'ok') {
    console.log('Future result:', result.value)
  }

  // Create a future from a Promise
  const promiseFuture = futureFromPromise(
    new Promise<string>(resolve => setTimeout(() => resolve('Hello from promise'), 50))
  )
  const promiseResult = await promiseFuture.read()
  if (promiseResult.status === 'ok') {
    console.log('Promise future result:', promiseResult.value)
  }

  // Pre-resolved future
  const instant = resolvedFuture('instant value')
  const instantResult = await instant.read()
  if (instantResult.status === 'ok') {
    console.log('Resolved future result:', instantResult.value)
  }

  // Delay future (like setTimeout as a future)
  console.log('Starting 100ms delay...')
  const start = Date.now()
  const delayFuture = delay(100)
  await delayFuture.read()
  console.log(`Delay completed in ${Date.now() - start}ms`)
  console.log()
}

// ============================================================================
// Example 3: Combining Futures - Race and All
// ============================================================================

async function combiningFuturesExample() {
  console.log('=== Example 3: Combining Futures ===\n')

  // Race multiple futures - first one wins
  const fast = delay(50).then(() => 'fast')
  const slow = delay(150).then(() => 'slow')

  console.log('Racing fast (50ms) vs slow (150ms)...')
  const raceResult = await raceFutures([
    futureFromPromise(fast),
    futureFromPromise(slow),
  ])
  if (raceResult.status === 'ok') {
    console.log('Race winner:', raceResult.value)
  }

  // Wait for all futures
  const futures = [
    futureFromPromise(Promise.resolve(1)),
    futureFromPromise(Promise.resolve(2)),
    futureFromPromise(Promise.resolve(3)),
  ]

  console.log('Waiting for all futures...')
  const allResult = await allFutures(futures)
  if (allResult.status === 'ok') {
    console.log('All results:', allResult.value)
  }
  console.log()
}

// ============================================================================
// Example 4: Stream Operations
// ============================================================================

async function streamOperationsExample() {
  console.log('=== Example 4: Stream Operations ===\n')

  // Create a stream from an async iterable
  async function* generateNumbers(): AsyncGenerator<number> {
    for (let i = 1; i <= 5; i++) {
      await new Promise(r => setTimeout(r, 10))
      yield i
    }
  }

  const numberStream = streamFromAsyncIterable(generateNumbers())
  console.log('Created stream from async generator')

  // Collect all values from the stream
  const numbers = await collectStream(numberStream)
  console.log('Collected values:', numbers)

  // Pipe one stream to another
  const [source, sourceWriter] = createStream<string>()
  const [dest, destWriter] = createStream<string>()

  // Start piping in background
  const pipePromise = pipeStream(source, destWriter)

  // Write to source
  await sourceWriter.write(['a', 'b', 'c'])
  sourceWriter.close()

  // Wait for pipe to complete
  await pipePromise
  destWriter.close()
  console.log('Piped stream from source to destination')

  // Merge multiple streams
  const [stream1, writer1] = createStream<number>()
  const [stream2, writer2] = createStream<number>()

  // Write different values to each stream
  setTimeout(async () => {
    await writer1.write([1, 3, 5])
    writer1.close()
  }, 10)

  setTimeout(async () => {
    await writer2.write([2, 4, 6])
    writer2.close()
  }, 20)

  const merged = mergeStreams([stream1, stream2])
  const mergedValues = await collectStream(merged)
  console.log('Merged stream values:', mergedValues)
  console.log()
}

// ============================================================================
// Example 5: Async Executor
// ============================================================================

async function asyncExecutorExample() {
  console.log('=== Example 5: Async Executor ===\n')

  const executor = new AsyncExecutor()

  // Execute an async function with P3 task semantics
  const result = await executor.execute<[string, number]>(async (_builtins, task) => {
    console.log('  Task starting...')
    task.start()

    // Simulate some async work
    await new Promise(r => setTimeout(r, 50))

    console.log('  Task returning...')
    task.return(['completed', 42])
  })

  console.log('Executor result:', result)

  // Cancel all pending tasks
  executor.cancelAll()
  console.log('Executor cleaned up')
  console.log()
}

// ============================================================================
// Example 6: Component Loader
// ============================================================================

async function componentLoaderExample() {
  console.log('=== Example 6: Component Loader ===\n')

  // Create output collectors
  const { writer: stdout, getOutput: getStdout } = createCollectingWriter()
  const { writer: stderr, getOutput: getStderr } = createCollectingWriter()

  // Configure the component loader
  const loader = new Wasip3ComponentLoader({
    args: ['my-component', '--verbose'],
    env: {
      HOME: '/home/user',
      NODE_ENV: 'development',
    },
    stdin: createStdinFromString('Hello from stdin!'),
    stdout,
    stderr,
    filesystem: new InMemoryFilesystem(),
  })

  console.log('Component loader configured with:')
  console.log('  - args:', ['my-component', '--verbose'])
  console.log('  - env: HOME, NODE_ENV')
  console.log('  - stdin: string input')
  console.log('  - stdout/stderr: collecting writers')
  console.log('  - filesystem: in-memory')

  // Build imports (shows what WASI interfaces are provided)
  const imports = loader.buildImports()
  console.log('\nAvailable WASI imports:')
  for (const namespace of Object.keys(imports)) {
    console.log(`  - ${namespace}`)
  }

  // In a real scenario:
  // const instance = await loader.load(wasmBytes)
  // const exitCode = await instance.run()
  // instance.dispose()

  console.log()
}

// ============================================================================
// Example 7: CLI Utilities
// ============================================================================

async function cliUtilitiesExample() {
  console.log('=== Example 7: CLI Utilities ===\n')

  // Create stdin from a string
  const stdinFromString = createStdinFromString('Line 1\nLine 2\nLine 3')
  console.log('Created stdin from string')

  // Read from it
  let result = await stdinFromString.read()
  if (result.status === 'values') {
    console.log('  Read:', new TextDecoder().decode(result.values[0]))
  }

  // Create stdin from lines
  const stdinFromLines = createStdinFromLines(['First line', 'Second line', 'Third line'])
  console.log('Created stdin from lines array')

  // Read each line
  for (let i = 0; i < 3; i++) {
    result = await stdinFromLines.read()
    if (result.status === 'values') {
      console.log('  Line:', new TextDecoder().decode(result.values[0]).trim())
    }
  }

  // Collecting writer for capturing output
  const { writer, getOutput } = createCollectingWriter()
  await writer.write([new TextEncoder().encode('Hello ')])
  await writer.write([new TextEncoder().encode('World!')])
  console.log('Collected output:', getOutput())

  // Console writer (writes to console.log)
  console.log('Console writer output:')
  const consoleWriter = createConsoleWriter('  [app] ')
  await consoleWriter.write([new TextEncoder().encode('This goes to console\n')])
  consoleWriter.close()
  console.log()
}

// ============================================================================
// Example 8: Clock and Random Functions
// ============================================================================

async function clockRandomExample() {
  console.log('=== Example 8: Clock and Random Functions ===\n')

  // Monotonic clock (for measuring durations)
  const startTime = monotonicNow()
  console.log('Monotonic time (nanoseconds):', startTime.toString())

  // Wall clock (real-world time)
  const wallTime = wallClockNow()
  console.log('Wall clock time:', new Date(Number(wallTime.seconds) * 1000).toISOString())

  // Sleep for a duration
  console.log('Sleeping for 50ms...')
  const beforeSleep = monotonicNow()
  await sleepFor(50_000_000n) // 50ms in nanoseconds
  const afterSleep = monotonicNow()
  console.log(`Slept for ${Number(afterSleep - beforeSleep) / 1_000_000}ms`)

  // Random bytes
  const randomBytes = getRandomBytes(16n)
  console.log('Random bytes (16):', Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join(''))

  // Random u64
  const randomU64 = getRandomU64()
  console.log('Random u64:', randomU64.toString())
  console.log()
}

// ============================================================================
// Example 9: HTTP Client
// ============================================================================

async function httpClientExample() {
  console.log('=== Example 9: HTTP Client ===\n')

  // Create request headers
  const headers = new Fields()
  headers.set('Content-Type', 'application/json')
  headers.set('Accept', 'application/json')
  console.log('Created headers:', headers.entries())

  // Create a request body
  const body = Body.fromString('{"message": "Hello, World!"}')
  console.log('Created body from string')

  // Create a request
  const request = new Request({
    method: { tag: 'post' },
    scheme: { tag: 'HTTPS' },
    authority: 'api.example.com',
    pathWithQuery: '/v1/messages',
    headers,
    body,
  })
  console.log('Created request:', request.method.tag.toUpperCase(), request.pathWithQuery)

  // Create an outgoing handler (HTTP client)
  // In browser, this would use the provided fetch function
  const handler = new OutgoingHandler(async (url, init) => {
    console.log('  [Mock fetch]:', url)
    // Return a mock response
    return new globalThis.Response('{"status": "ok"}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  // Note: In a real scenario with actual fetch:
  // const response = await handler.handle(request)
  // const body = await response.body.text()

  console.log('HTTP handler configured')
  console.log()
}

// ============================================================================
// Example 10: TCP Sockets
// ============================================================================

async function tcpSocketsExample() {
  console.log('=== Example 10: TCP Sockets ===\n')

  // Create a network with WebSocket gateway URL
  // In production, you'd provide a real WebSocket gateway URL
  const network = new Network('wss://tcp-gateway.example.com')
  console.log('Created network with WebSocket gateway')

  // Create a TCP socket
  const socket = network.createTcpSocket()
  console.log('Created TCP socket, state:', socket.getState())

  // Bind to local address
  socket.bind({
    address: { tag: 'ipv4', val: [0, 0, 0, 0] },
    port: 0, // Let OS choose port
  })
  console.log('Bound socket, state:', socket.getState())

  // In a real scenario with a working gateway:
  // const [input, output] = await socket.connect({
  //   address: { tag: 'ipv4', val: [93, 184, 216, 34] },
  //   port: 80,
  // })
  // await output.write([new TextEncoder().encode('GET / HTTP/1.0\r\n\r\n')])
  // const response = await collectStream(input)

  console.log('Socket demonstration complete')
  socket.close()
  console.log('Socket closed, state:', socket.getState())
  console.log()
}

// ============================================================================
// Example 11: In-Memory Filesystem
// ============================================================================

async function filesystemExample() {
  console.log('=== Example 11: In-Memory Filesystem ===\n')

  const fs = new InMemoryFilesystem()

  // Create some files
  fs.writeFile('/hello.txt', new TextEncoder().encode('Hello, World!'))
  fs.writeFile('/data/config.json', new TextEncoder().encode('{"debug": true}'))
  console.log('Created files: /hello.txt, /data/config.json')

  // Read a file
  const content = fs.readFile('/hello.txt')
  if (content) {
    console.log('Read /hello.txt:', new TextDecoder().decode(content))
  }

  // List directory
  const entries = fs.readDirectory('/')
  console.log('Root directory:', entries?.map(e => e.name))

  // Get file stats
  const stat = fs.stat('/hello.txt')
  console.log('File stats:', stat)

  // Create directory
  fs.createDirectory('/newdir')
  console.log('Created /newdir')

  // Rename file
  fs.rename('/hello.txt', '/greeting.txt')
  console.log('Renamed /hello.txt to /greeting.txt')

  // Delete file
  fs.unlink('/greeting.txt')
  console.log('Deleted /greeting.txt')
  console.log()
}

// ============================================================================
// Example 12: Full WASIP3 Integration Pattern
// ============================================================================

async function fullIntegrationPattern() {
  console.log('=== Example 12: Full Integration Pattern ===\n')

  console.log(`
// This is the typical pattern for running a WASIP3 component:

import {
  Wasip3ComponentLoader,
  createStdinFromString,
  createCollectingWriter,
  InMemoryFilesystem,
} from '@tegmentum/wasip2-polyfill/wasip3'

async function runP3Component(wasmBytes: ArrayBuffer) {
  // 1. Set up I/O
  const { writer: stdout, getOutput: getStdout } = createCollectingWriter()
  const { writer: stderr, getOutput: getStderr } = createCollectingWriter()

  // 2. Create filesystem with initial content
  const fs = new InMemoryFilesystem()
  fs.writeFile('/input.txt', new TextEncoder().encode('input data'))

  // 3. Create and configure the loader
  const loader = new Wasip3ComponentLoader({
    args: ['my-component', 'arg1'],
    env: { DEBUG: 'true' },
    stdin: createStdinFromString('stdin input'),
    stdout,
    stderr,
    filesystem: fs,
  })

  // 4. Load and run the component
  const instance = await loader.load(wasmBytes)

  try {
    const exitCode = await instance.run()
    console.log('Exit code:', exitCode)
    console.log('Stdout:', getStdout())
    console.log('Stderr:', getStderr())

    // Read output files
    const output = fs.readFile('/output.txt')
    if (output) {
      console.log('Output file:', new TextDecoder().decode(output))
    }
  } finally {
    // 5. Clean up
    instance.dispose()
    loader.disposeAll()
  }
}

// For jco-transpiled components:
async function runTranspiledComponent(instantiateFn) {
  const loader = new Wasip3ComponentLoader({ ... })
  const instance = await loader.loadTranspiled(instantiateFn)
  await instance.run()
  instance.dispose()
}
`)
}

// ============================================================================
// Run all examples
// ============================================================================

async function main() {
  console.log('WASIP3 Usage Examples')
  console.log('=====================\n')

  await streamsExample()
  await futuresExample()
  await combiningFuturesExample()
  await streamOperationsExample()
  await asyncExecutorExample()
  await componentLoaderExample()
  await cliUtilitiesExample()
  await clockRandomExample()
  await httpClientExample()
  await tcpSocketsExample()
  await filesystemExample()
  await fullIntegrationPattern()

  console.log('All examples completed!')
}

// Run if executed directly
main().catch(console.error)

export {
  streamsExample,
  futuresExample,
  combiningFuturesExample,
  streamOperationsExample,
  asyncExecutorExample,
  componentLoaderExample,
  cliUtilitiesExample,
  clockRandomExample,
  httpClientExample,
  tcpSocketsExample,
  filesystemExample,
  fullIntegrationPattern,
}
