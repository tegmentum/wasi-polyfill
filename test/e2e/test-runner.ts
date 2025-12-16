/**
 * Browser test runner for WASIP2 polyfill
 *
 * This runs a suite of tests in the browser to verify the polyfill
 * works correctly in a real browser environment.
 */

// Import directly from core modules to avoid Node.js-specific build deps
import { createDevPolyfill, createPolyfill } from '../../src/core/polyfill.js'
import { createSafePolicy, AllowAllPolicy } from '../../src/core/policy.js'
import { randomPlugin } from '../../src/plugins/random/index.js'
import { monotonicClockPlugin, wallClockPlugin } from '../../src/plugins/clocks/index.js'
import { environmentPlugin } from '../../src/plugins/cli/index.js'
import { streamsPlugin, pollPlugin } from '../../src/plugins/io/index.js'

interface TestResult {
  name: string
  passed: boolean
  error?: string
  duration: number
}

const results: TestResult[] = []

/**
 * Run a single test
 */
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  const start = performance.now()
  try {
    await fn()
    const duration = performance.now() - start
    results.push({ name, passed: true, duration })
    console.log(`✓ ${name} (${duration.toFixed(1)}ms)`)
  } catch (err) {
    const duration = performance.now() - start
    const error = err instanceof Error ? err.message : String(err)
    results.push({ name, passed: false, error, duration })
    console.error(`✗ ${name}: ${error}`)
  }
}

/**
 * Assert a condition is true
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

/**
 * Assert two values are equal
 */
function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message ?? `Expected ${expected} but got ${actual}`)
  }
}

/**
 * Assert a value is an instance of a class
 */
function assertInstanceOf<T>(
  value: unknown,
  cls: new (...args: unknown[]) => T,
  message?: string
): asserts value is T {
  if (!(value instanceof cls)) {
    throw new Error(
      message ?? `Expected instance of ${cls.name} but got ${typeof value}`
    )
  }
}

// =============================================================================
// Tests
// =============================================================================

async function runTests(): Promise<void> {
  // Polyfill Creation Tests
  await test('createPolyfill creates a new polyfill instance', async () => {
    const polyfill = createPolyfill()
    assert(polyfill !== null, 'Polyfill should not be null')
    assert(typeof polyfill.getImports === 'function', 'getImports should be a function')
    polyfill.destroy()
  })

  await test('createDevPolyfill allows all interfaces', async () => {
    const polyfill = createDevPolyfill()
    assert(polyfill.isAllowed('wasi:random@0.2.0'), 'Should allow random')
    assert(polyfill.isAllowed('wasi:clocks/monotonic-clock@0.2.0'), 'Should allow clocks')
    polyfill.destroy()
  })

  await test('createSafePolicy denies filesystem by default', async () => {
    const policy = createSafePolicy()
    // Safe policy allows random and clocks but denies filesystem
    const allowsRandom = policy.allow({
      package: 'wasi:random',
      name: 'random',
      version: '0.2.0',
    })
    const allowsFilesystem = policy.allow({
      package: 'wasi:filesystem',
      name: 'types',
      version: '0.2.0',
    })
    assertEquals(allowsRandom, true, 'Safe policy should allow random')
    assertEquals(allowsFilesystem, false, 'Safe policy should deny filesystem')
  })

  await test('AllowAllPolicy allows everything', async () => {
    const policy = new AllowAllPolicy()
    const allowed = policy.allow({
      package: 'wasi:random',
      name: 'random',
      version: '0.2.0',
    })
    assertEquals(allowed, true, 'AllowAll should allow everything')
  })

  // Random Plugin Tests
  await test('random plugin provides get-random-bytes', async () => {
    const polyfill = createDevPolyfill()
    polyfill.registerPlugin(randomPlugin)

    const result = await polyfill.getImports([
      { package: 'wasi:random', name: 'random', version: '0.2.0' },
    ])

    const imports = result.imports['wasi:random@0.2.0']
    assert(imports !== undefined, 'Random imports should exist')

    const getRandomBytes = imports['get-random-bytes'] as (len: bigint) => Uint8Array
    const bytes = getRandomBytes(16n)

    assertInstanceOf(bytes, Uint8Array, 'Should return Uint8Array')
    assertEquals(bytes.length, 16, 'Should return 16 bytes')

    polyfill.destroy()
  })

  await test('random plugin returns different bytes each time', async () => {
    const polyfill = createDevPolyfill()
    polyfill.registerPlugin(randomPlugin)

    const result = await polyfill.getImports([
      { package: 'wasi:random', name: 'random', version: '0.2.0' },
    ])

    const getRandomBytes = result.imports['wasi:random@0.2.0'][
      'get-random-bytes'
    ] as (len: bigint) => Uint8Array

    const bytes1 = getRandomBytes(32n)
    const bytes2 = getRandomBytes(32n)

    // Compare byte arrays
    let allSame = true
    for (let i = 0; i < bytes1.length; i++) {
      if (bytes1[i] !== bytes2[i]) {
        allSame = false
        break
      }
    }

    assert(!allSame, 'Random bytes should be different each call')

    polyfill.destroy()
  })

  await test('random plugin provides get-random-u64', async () => {
    const polyfill = createDevPolyfill()
    polyfill.registerPlugin(randomPlugin)

    const result = await polyfill.getImports([
      { package: 'wasi:random', name: 'random', version: '0.2.0' },
    ])

    const getRandomU64 = result.imports['wasi:random@0.2.0'][
      'get-random-u64'
    ] as () => bigint
    const value = getRandomU64()

    assertEquals(typeof value, 'bigint', 'Should return bigint')
    assert(value >= 0n, 'Should be non-negative')

    polyfill.destroy()
  })

  // Clock Plugin Tests
  await test('monotonic clock provides now()', async () => {
    const polyfill = createDevPolyfill()
    polyfill.registerPlugin(monotonicClockPlugin)

    const result = await polyfill.getImports([
      { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
    ])

    const imports = result.imports['wasi:clocks/monotonic-clock@0.2.0']
    assert(imports !== undefined, 'Monotonic clock imports should exist')

    const now = imports['now'] as () => bigint
    const time = now()

    assertEquals(typeof time, 'bigint', 'now() should return bigint')
    assert(time > 0n, 'Time should be positive')

    polyfill.destroy()
  })

  await test('monotonic clock increases over time', async () => {
    const polyfill = createDevPolyfill()
    polyfill.registerPlugin(monotonicClockPlugin)

    const result = await polyfill.getImports([
      { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
    ])

    const now = result.imports['wasi:clocks/monotonic-clock@0.2.0'][
      'now'
    ] as () => bigint

    const t1 = now()
    await new Promise((resolve) => setTimeout(resolve, 10))
    const t2 = now()

    assert(t2 > t1, 'Time should increase')

    polyfill.destroy()
  })

  await test('wall clock provides datetime', async () => {
    const polyfill = createDevPolyfill()
    polyfill.registerPlugin(wallClockPlugin)

    const result = await polyfill.getImports([
      { package: 'wasi:clocks', name: 'wall-clock', version: '0.2.0' },
    ])

    const imports = result.imports['wasi:clocks/wall-clock@0.2.0']
    const now = imports['now'] as () => { seconds: bigint; nanoseconds: number }
    const datetime = now()

    assert(datetime !== null, 'Should return datetime')
    assertEquals(typeof datetime.seconds, 'bigint', 'seconds should be bigint')
    assertEquals(
      typeof datetime.nanoseconds,
      'number',
      'nanoseconds should be number'
    )

    // Should be after year 2020
    const year2020 = 1577836800n
    assert(datetime.seconds > year2020, 'Time should be after 2020')

    polyfill.destroy()
  })

  // Environment Plugin Tests
  await test('environment plugin provides get-environment', async () => {
    const polyfill = createDevPolyfill()
    polyfill.registerPlugin(environmentPlugin)

    const result = await polyfill.getImports([
      { package: 'wasi:cli', name: 'environment', version: '0.2.0' },
    ])

    const imports = result.imports['wasi:cli/environment@0.2.0']
    assert(imports !== undefined, 'Environment imports should exist')

    const getEnvironment = imports['get-environment'] as () => [string, string][]
    const env = getEnvironment()

    assert(Array.isArray(env), 'Should return array')

    polyfill.destroy()
  })

  await test('environment plugin provides get-arguments', async () => {
    const polyfill = createDevPolyfill()
    polyfill.registerPlugin(environmentPlugin)

    const result = await polyfill.getImports([
      { package: 'wasi:cli', name: 'environment', version: '0.2.0' },
    ])

    const getArguments = result.imports['wasi:cli/environment@0.2.0'][
      'get-arguments'
    ] as () => string[]
    const args = getArguments()

    assert(Array.isArray(args), 'Should return array')

    polyfill.destroy()
  })

  // IO Plugin Tests
  await test('streams plugin provides stream methods', async () => {
    const polyfill = createDevPolyfill()
    polyfill.registerPlugin(streamsPlugin)

    const result = await polyfill.getImports([
      { package: 'wasi:io', name: 'streams', version: '0.2.0' },
    ])

    const imports = result.imports['wasi:io/streams@0.2.0']
    assert(imports !== undefined, 'Streams imports should exist')
    assert(
      typeof imports['[method]input-stream.read'] === 'function',
      'Should have read method'
    )
    assert(
      typeof imports['[method]output-stream.write'] === 'function',
      'Should have write method'
    )

    polyfill.destroy()
  })

  await test('poll plugin provides poll function', async () => {
    const polyfill = createDevPolyfill()
    polyfill.registerPlugin(pollPlugin)

    const result = await polyfill.getImports([
      { package: 'wasi:io', name: 'poll', version: '0.2.0' },
    ])

    const imports = result.imports['wasi:io/poll@0.2.0']
    assert(imports !== undefined, 'Poll imports should exist')
    assert(typeof imports['poll'] === 'function', 'Should have poll function')

    polyfill.destroy()
  })

  // Multiple Interfaces Test
  await test('can load multiple interfaces together', async () => {
    const polyfill = createDevPolyfill()
    polyfill.registerPlugin(randomPlugin)
    polyfill.registerPlugin(monotonicClockPlugin)
    polyfill.registerPlugin(environmentPlugin)

    const result = await polyfill.getImports([
      { package: 'wasi:random', name: 'random', version: '0.2.0' },
      { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
      { package: 'wasi:cli', name: 'environment', version: '0.2.0' },
    ])

    assertEquals(result.loaded.length, 3, 'Should load 3 interfaces')
    assert(
      result.imports['wasi:random@0.2.0'] !== undefined,
      'Should have random'
    )
    assert(
      result.imports['wasi:clocks/monotonic-clock@0.2.0'] !== undefined,
      'Should have clocks'
    )
    assert(
      result.imports['wasi:cli/environment@0.2.0'] !== undefined,
      'Should have cli'
    )

    polyfill.destroy()
  })

  // Cleanup Test
  await test('polyfill can be destroyed', async () => {
    const polyfill = createDevPolyfill()
    polyfill.registerPlugin(randomPlugin)

    // Use it first
    await polyfill.getImports([
      { package: 'wasi:random', name: 'random', version: '0.2.0' },
    ])

    // Destroy should not throw
    polyfill.destroy()

    // After destroy, should throw
    let threwError = false
    try {
      await polyfill.getImports([
        { package: 'wasi:random', name: 'random', version: '0.2.0' },
      ])
    } catch {
      threwError = true
    }

    assert(threwError, 'Should throw after destroy')
  })

  // forInterfaces Test
  await test('forInterfaces accepts string format', async () => {
    const polyfill = createDevPolyfill()
    polyfill.registerPlugin(randomPlugin)
    polyfill.registerPlugin(monotonicClockPlugin)

    const result = await polyfill.forInterfaces([
      'wasi:random@0.2.0',
      'wasi:clocks/monotonic-clock@0.2.0',
    ])

    assertEquals(result.loaded.length, 2, 'Should load 2 interfaces')

    polyfill.destroy()
  })

  // Web Crypto Test (browser-specific)
  await test('uses Web Crypto API for random', async () => {
    // Verify crypto is available
    assert(
      typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function',
      'Web Crypto should be available'
    )

    const polyfill = createDevPolyfill()
    polyfill.registerPlugin(randomPlugin)

    const result = await polyfill.getImports([
      { package: 'wasi:random', name: 'random', version: '0.2.0' },
    ])

    const getRandomBytes = result.imports['wasi:random@0.2.0'][
      'get-random-bytes'
    ] as (len: bigint) => Uint8Array

    // Should work without errors in the browser
    const bytes = getRandomBytes(64n)
    assertEquals(bytes.length, 64, 'Should return requested length')

    polyfill.destroy()
  })

  // Performance API Test (browser-specific)
  await test('uses Performance API for monotonic clock', async () => {
    // Verify performance is available
    assert(
      typeof performance !== 'undefined' && typeof performance.now === 'function',
      'Performance API should be available'
    )

    const polyfill = createDevPolyfill()
    polyfill.registerPlugin(monotonicClockPlugin)

    const result = await polyfill.getImports([
      { package: 'wasi:clocks', name: 'monotonic-clock', version: '0.2.0' },
    ])

    const now = result.imports['wasi:clocks/monotonic-clock@0.2.0'][
      'now'
    ] as () => bigint

    // Should work and return reasonable values
    const time = now()
    assert(time > 0n, 'Should return positive time')

    polyfill.destroy()
  })
}

// =============================================================================
// UI Rendering
// =============================================================================

function updateUI(): void {
  const statusEl = document.getElementById('status')!
  const resultsEl = document.getElementById('results')!

  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length
  const total = results.length

  statusEl.innerHTML = `
    <strong>Status:</strong> ${failed === 0 ? 'All tests passed' : 'Some tests failed'}<br>
    <strong>Passed:</strong> ${passed}/${total}<br>
    <strong>Failed:</strong> ${failed}/${total}
  `

  resultsEl.innerHTML = results
    .map(
      (r) => `
      <div class="test ${r.passed ? 'pass' : 'fail'}" data-testid="test-${r.name.replace(/\s+/g, '-')}">
        <strong>${r.passed ? '✓' : '✗'} ${r.name}</strong>
        <span>(${r.duration.toFixed(1)}ms)</span>
        ${r.error ? `<pre>${r.error}</pre>` : ''}
      </div>
    `
    )
    .join('')

  // Expose results for Playwright
  ;(window as unknown as { testResults: TestResult[] }).testResults = results
}

// Run tests and update UI
runTests()
  .then(() => {
    updateUI()
    console.log('\n=== Test Results ===')
    console.log(
      `Passed: ${results.filter((r) => r.passed).length}/${results.length}`
    )
    console.log(
      `Failed: ${results.filter((r) => !r.passed).length}/${results.length}`
    )
  })
  .catch((err) => {
    console.error('Test runner failed:', err)
    document.getElementById('status')!.textContent = `Error: ${err.message}`
  })
