/**
 * Deterministic testing harness
 *
 * Provides utilities for running WASM components in deterministic,
 * reproducible test environments.
 *
 * Features:
 * - Controllable time (virtual clocks)
 * - Seeded random numbers
 * - Captured I/O
 * - Snapshot/replay support
 */

export {
  TestHarness,
  createTestHarness,
  withTestHarness,
  type TestHarnessConfig,
  type TestSnapshot,
  type TestResult,
} from './harness.js'

export {
  deterministicBundle,
  browserTestBundle,
  minimalBundle,
  getBundlePreset,
  mergeBundleConfig,
  type BundlePreset,
} from './bundles.js'
