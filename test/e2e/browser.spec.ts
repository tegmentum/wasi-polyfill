/**
 * Playwright E2E tests for WASIP2 polyfill
 *
 * These tests verify that the polyfill works correctly in real browsers
 * by running a test suite in the browser and checking the results.
 */

import { test, expect } from '@playwright/test'

test.describe('WASIP2 Polyfill Browser Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the test page
    await page.goto('/')

    // Wait for tests to complete (testResults becomes available)
    await page.waitForFunction(
      () => (window as unknown as { testResults?: unknown[] }).testResults !== undefined,
      { timeout: 30000 }
    )
  })

  test('all browser tests pass', async ({ page }) => {
    // Get the test results from the page
    const results = await page.evaluate(() => {
      return (window as unknown as { testResults: Array<{ name: string; passed: boolean; error?: string }> }).testResults
    })

    // Log results for debugging
    console.log(`\nBrowser test results: ${results.filter(r => r.passed).length}/${results.length} passed`)

    // Check for failures
    const failures = results.filter((r) => !r.passed)
    if (failures.length > 0) {
      console.log('\nFailed tests:')
      for (const f of failures) {
        console.log(`  - ${f.name}: ${f.error}`)
      }
    }

    // Assert all tests passed
    expect(failures).toHaveLength(0)
    expect(results.length).toBeGreaterThan(0)
  })

  test('random plugin works in browser', async ({ page }) => {
    // Check that random tests passed
    const results = await page.evaluate(() => {
      return (window as unknown as { testResults: Array<{ name: string; passed: boolean }> }).testResults
    })

    const randomTests = results.filter((r) => r.name.includes('random'))
    expect(randomTests.length).toBeGreaterThan(0)
    expect(randomTests.every((t) => t.passed)).toBe(true)
  })

  test('clock plugins work in browser', async ({ page }) => {
    // Check that clock tests passed
    const results = await page.evaluate(() => {
      return (window as unknown as { testResults: Array<{ name: string; passed: boolean }> }).testResults
    })

    const clockTests = results.filter((r) => r.name.includes('clock'))
    expect(clockTests.length).toBeGreaterThan(0)
    expect(clockTests.every((t) => t.passed)).toBe(true)
  })

  test('web APIs are available', async ({ page }) => {
    // Verify that browser-specific APIs are available
    const apis = await page.evaluate(() => ({
      hasCrypto: typeof crypto !== 'undefined',
      hasGetRandomValues: typeof crypto?.getRandomValues === 'function',
      hasPerformance: typeof performance !== 'undefined',
      hasPerformanceNow: typeof performance?.now === 'function',
    }))

    expect(apis.hasCrypto).toBe(true)
    expect(apis.hasGetRandomValues).toBe(true)
    expect(apis.hasPerformance).toBe(true)
    expect(apis.hasPerformanceNow).toBe(true)
  })

  test('multiple interfaces can be loaded together', async ({ page }) => {
    const results = await page.evaluate(() => {
      return (window as unknown as { testResults: Array<{ name: string; passed: boolean }> }).testResults
    })

    const multiTest = results.find((r) =>
      r.name.includes('multiple interfaces')
    )
    expect(multiTest).toBeDefined()
    expect(multiTest!.passed).toBe(true)
  })

  test('polyfill cleanup works', async ({ page }) => {
    const results = await page.evaluate(() => {
      return (window as unknown as { testResults: Array<{ name: string; passed: boolean }> }).testResults
    })

    const cleanupTest = results.find((r) => r.name.includes('destroyed'))
    expect(cleanupTest).toBeDefined()
    expect(cleanupTest!.passed).toBe(true)
  })

  test('page has no console errors', async ({ page }) => {
    const errors: string[] = []

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    // Wait a bit for any delayed errors
    await page.waitForTimeout(1000)

    // Filter out expected errors (if any)
    const unexpectedErrors = errors.filter(
      (e) => !e.includes('expected') // Filter out test-related "expected" messages
    )

    expect(unexpectedErrors).toHaveLength(0)
  })
})

test.describe('UI Rendering', () => {
  test('displays test results', async ({ page }) => {
    await page.goto('/')

    // Wait for results to be rendered
    await page.waitForSelector('.test', { timeout: 30000 })

    // Check that tests are displayed
    const testElements = await page.locator('.test').count()
    expect(testElements).toBeGreaterThan(0)
  })

  test('shows pass/fail status', async ({ page }) => {
    await page.goto('/')

    // Wait for results
    await page.waitForSelector('.test', { timeout: 30000 })

    // Check for pass indicators
    const passCount = await page.locator('.test.pass').count()
    expect(passCount).toBeGreaterThan(0)
  })
})
