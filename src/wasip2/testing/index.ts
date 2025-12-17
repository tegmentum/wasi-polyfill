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

export {
  CASSETTE_FORMAT_VERSION,
  type OperationType,
  type CassetteInteraction,
  type HttpCassetteRequest,
  type HttpCassetteResponse,
  type DnsCassetteRequest,
  type DnsCassetteResponse,
  type RandomCassetteRequest,
  type RandomCassetteResponse,
  type Cassette,
  type MatchStrategy,
  type MatchConfig,
  type ReplayOptions,
  type RecordOptions,
  CassetteRecorder,
  CassettePlayer,
  loadCassette,
  createCassette,
  mergeCassettes,
  validateCassette,
} from './replay.js'
