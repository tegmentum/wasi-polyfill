/**
 * wasi:nn type definitions
 *
 * Types for neural network inference following the wasi-nn specification.
 */

// =============================================================================
// Handle Types
// =============================================================================

/**
 * Handle to a loaded ML graph (model).
 */
export type GraphHandle = number

/**
 * Handle to an execution context for a graph.
 */
export type GraphExecutionContextHandle = number

// =============================================================================
// Tensor Types
// =============================================================================

/**
 * Tensor element types.
 */
export enum TensorType {
  /** 32-bit floating point */
  FP32 = 'fp32',
  /** 16-bit floating point */
  FP16 = 'fp16',
  /** 8-bit unsigned integer */
  U8 = 'u8',
  /** 32-bit signed integer */
  I32 = 'i32',
  /** 64-bit signed integer */
  I64 = 'i64',
  /** 8-bit floating point (E4M3) */
  FP8_E4M3 = 'fp8-e4m3',
  /** 8-bit floating point (E5M2) */
  FP8_E5M2 = 'fp8-e5m2',
  /** Brain float 16-bit */
  BF16 = 'bf16',
}

/**
 * Tensor dimensions (shape).
 * Each element represents the size along that dimension.
 */
export type TensorDimensions = number[]

/**
 * Tensor data as bytes.
 */
export type TensorData = Uint8Array

/**
 * A complete tensor with type, dimensions, and data.
 */
export interface Tensor {
  /** Element data type */
  type: TensorType
  /** Shape of the tensor */
  dimensions: TensorDimensions
  /** Raw data bytes */
  data: TensorData
}

// =============================================================================
// Graph Types
// =============================================================================

/**
 * ML framework/encoding for the graph.
 */
export enum GraphEncoding {
  /** ONNX format */
  ONNX = 'onnx',
  /** OpenVINO IR format */
  OPENVINO = 'openvino',
  /** TensorFlow format */
  TENSORFLOW = 'tensorflow',
  /** TensorFlow Lite format */
  TFLITE = 'tflite',
  /** PyTorch format */
  PYTORCH = 'pytorch',
  /** GGML/GGUF format (llama.cpp) */
  GGML = 'ggml',
  /** Autodetect from file */
  AUTO = 'auto',
}

/**
 * Execution target for the graph.
 */
export enum ExecutionTarget {
  /** Use CPU */
  CPU = 'cpu',
  /** Use GPU */
  GPU = 'gpu',
  /** Use TPU/NPU */
  TPU = 'tpu',
  /** Use Neural Processing Unit */
  NPU = 'npu',
  /** Use hardware accelerator (auto-select) */
  AUTO = 'auto',
}

/**
 * Builder for loading a graph.
 */
export interface GraphBuilder {
  /** The graph encoding (format) */
  encoding: GraphEncoding
  /** The execution target */
  target: ExecutionTarget
}

// =============================================================================
// Named Tensor Types
// =============================================================================

/**
 * A named tensor for named input/output binding.
 */
export interface NamedTensor {
  /** Tensor name */
  name: string
  /** The tensor data */
  tensor: Tensor
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * wasi:nn error codes.
 */
export enum NnErrorCode {
  /** Successful operation */
  SUCCESS = 'success',
  /** Invalid argument provided */
  INVALID_ARGUMENT = 'invalid-argument',
  /** Requested encoding not supported */
  INVALID_ENCODING = 'invalid-encoding',
  /** Feature not yet implemented */
  MISSING_IMPLEMENTATION = 'missing-implementation',
  /** Caller lacks permission */
  NOT_ALLOWED = 'not-allowed',
  /** Backend busy, try again */
  BUSY = 'busy',
  /** Runtime error during execution */
  RUNTIME_ERROR = 'runtime-error',
  /** Unknown/unspecified error */
  UNKNOWN = 'unknown',
}

/**
 * Error structure for wasi:nn operations.
 */
export interface NnError {
  code: NnErrorCode
  message: string
}

/**
 * Create an NnError.
 */
export function createNnError(code: NnErrorCode, message: string): NnError {
  return { code, message }
}

// =============================================================================
// Result Type
// =============================================================================

/**
 * Result type for operations that can fail.
 */
export type NnResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: NnError }

/**
 * Create a successful result.
 */
export function nnOk<T>(value: T): NnResult<T> {
  return { ok: true, value }
}

/**
 * Create an error result.
 */
export function nnErr<T>(code: NnErrorCode, message: string): NnResult<T> {
  return { ok: false, error: createNnError(code, message) }
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for the nn plugin.
 */
export interface NnPluginConfig {
  /** Default execution target */
  defaultTarget?: ExecutionTarget
  /** Maximum number of graphs to cache */
  maxGraphs?: number
  /** Maximum number of execution contexts */
  maxContexts?: number
  /** Model registry path or URL */
  modelRegistry?: string
  /** Enable debug logging */
  debug?: boolean
}

// =============================================================================
// Backend Information
// =============================================================================

/**
 * Information about an nn backend.
 */
export interface BackendInfo {
  /** Backend name */
  name: string
  /** Supported encodings */
  encodings: GraphEncoding[]
  /** Supported execution targets */
  targets: ExecutionTarget[]
  /** Backend version */
  version?: string
}

// =============================================================================
// Inference Statistics
// =============================================================================

/**
 * Statistics from inference execution.
 */
export interface InferenceStats {
  /** Time to run compute in milliseconds */
  computeTimeMs: number
  /** Time to copy inputs in milliseconds */
  inputCopyTimeMs?: number
  /** Time to copy outputs in milliseconds */
  outputCopyTimeMs?: number
  /** Peak memory usage in bytes */
  peakMemoryBytes?: number
}
