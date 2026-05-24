/**
 * browser:media - Media capture interface
 *
 * Provides a capability-scoped interface to the MediaDevices API
 * for accessing camera, microphone, and screen capture.
 *
 * Note: Media capture requires a secure context (HTTPS) and
 * explicit user permission.
 *
 * @packageDocumentation
 */

import {
  type BrowserError,
  BrowserErrorCode,
  mapErrorToBrowserError,
  type Result,
  ok,
  browserErr,
  PermissionState,
  mapPermissionState,
} from './types.js'
import { isSecureContext, supports, isMainThread } from './runtime.js'
import { WeakHandleRegistry } from '../shared/registry.js'
import { type ElementHandle, getDefaultDom } from './dom.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Handle to a media stream.
 */
export type MediaStreamHandle = number

/**
 * Handle to a media track.
 */
export type TrackHandle = number

/**
 * Media track kind.
 */
export type MediaTrackKind = 'audio' | 'video'

/**
 * Media track state.
 */
export type MediaTrackState = 'live' | 'ended'

/**
 * Audio constraints.
 */
export interface AudioConstraints {
  /** Device ID */
  deviceId?: string
  /** Echo cancellation */
  echoCancellation?: boolean
  /** Noise suppression */
  noiseSuppression?: boolean
  /** Auto gain control */
  autoGainControl?: boolean
  /** Sample rate */
  sampleRate?: number
  /** Channel count */
  channelCount?: number
}

/**
 * Video constraints.
 */
export interface VideoConstraints {
  /** Device ID */
  deviceId?: string
  /** Width */
  width?: number | { min?: number; max?: number; ideal?: number }
  /** Height */
  height?: number | { min?: number; max?: number; ideal?: number }
  /** Frame rate */
  frameRate?: number | { min?: number; max?: number; ideal?: number }
  /** Facing mode */
  facingMode?: 'user' | 'environment' | { exact?: string; ideal?: string }
  /** Aspect ratio */
  aspectRatio?: number | { min?: number; max?: number; ideal?: number }
}

/**
 * Media constraints for getUserMedia.
 */
export interface MediaConstraints {
  /** Audio constraints (or boolean to enable/disable) */
  audio?: boolean | AudioConstraints
  /** Video constraints (or boolean to enable/disable) */
  video?: boolean | VideoConstraints
}

/**
 * Track info.
 */
export interface TrackInfo {
  /** Track ID */
  id: string
  /** Track kind (audio/video) */
  kind: MediaTrackKind
  /** Track label (device name) */
  label: string
  /** Whether track is enabled */
  enabled: boolean
  /** Whether track is muted */
  muted: boolean
  /** Track state */
  readyState: MediaTrackState
}

/**
 * Stream info.
 */
export interface StreamInfo {
  /** Stream ID */
  id: string
  /** Whether stream is active */
  active: boolean
  /** Number of audio tracks */
  audioTrackCount: number
  /** Number of video tracks */
  videoTrackCount: number
}

/**
 * Media device info.
 */
export interface DeviceInfo {
  /** Device ID */
  deviceId: string
  /** Device kind */
  kind: 'audioinput' | 'audiooutput' | 'videoinput'
  /** Device label (may be empty without permission) */
  label: string
  /** Group ID */
  groupId: string
}

/**
 * Media options.
 */
export interface MediaOptions {
  /** DOM instance for attaching streams to elements */
  dom?: typeof getDefaultDom extends () => infer T ? T : never
}

// =============================================================================
// Browser Media
// =============================================================================

/**
 * Browser media implementation.
 */
export class BrowserMedia {
  private readonly streams = new WeakHandleRegistry<MediaStream>(1)
  private readonly tracks = new WeakHandleRegistry<MediaStreamTrack>(1)

  constructor(_options: MediaOptions = {}) {
    // Options reserved for future use
  }

  /**
   * Check media requirements.
   */
  private checkRequirements(): Result<void, BrowserError> {
    if (!isSecureContext()) {
      return browserErr(
        BrowserErrorCode.INSECURE_CONTEXT,
        'Media capture requires a secure context (HTTPS)'
      )
    }

    if (!supports('browser:media-capture')) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Media capture is not supported in this environment'
      )
    }

    return ok(undefined)
  }

  /**
   * Get or create a handle for a stream.
   */
  private getStreamHandle(stream: MediaStream): MediaStreamHandle {
    return this.streams.handleFor(stream)
  }

  /**
   * Get a stream from its handle.
   */
  private getStream(handle: MediaStreamHandle): MediaStream | null {
    return this.streams.get(handle) ?? null
  }

  /**
   * Get or create a handle for a track.
   */
  private getTrackHandle(track: MediaStreamTrack): TrackHandle {
    return this.tracks.handleFor(track)
  }

  /**
   * Get a track from its handle.
   */
  private getTrack(handle: TrackHandle): MediaStreamTrack | null {
    return this.tracks.get(handle) ?? null
  }

  /**
   * Query camera permission.
   */
  async queryCameraPermission(): Promise<Result<PermissionState, BrowserError>> {
    if (!supports('browser:permissions')) {
      return browserErr(BrowserErrorCode.NOT_SUPPORTED, 'Permissions API not supported')
    }

    try {
      const result = await navigator.permissions.query({ name: 'camera' as PermissionName })
      return ok(mapPermissionState(result.state))
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Query microphone permission.
   */
  async queryMicrophonePermission(): Promise<Result<PermissionState, BrowserError>> {
    if (!supports('browser:permissions')) {
      return browserErr(BrowserErrorCode.NOT_SUPPORTED, 'Permissions API not supported')
    }

    try {
      const result = await navigator.permissions.query({ name: 'microphone' as PermissionName })
      return ok(mapPermissionState(result.state))
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Get user media (camera/microphone).
   */
  async getUserMedia(constraints: MediaConstraints): Promise<Result<MediaStreamHandle, BrowserError>> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      return ok(this.getStreamHandle(stream))
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Get display media (screen capture).
   */
  async getDisplayMedia(constraints?: MediaConstraints): Promise<Result<MediaStreamHandle, BrowserError>> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    if (!isMainThread()) {
      return browserErr(
        BrowserErrorCode.WRONG_THREAD,
        'Screen capture can only be initiated from the main thread'
      )
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia(constraints ?? { video: true })
      return ok(this.getStreamHandle(stream))
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Enumerate available media devices.
   */
  async enumerateDevices(): Promise<Result<DeviceInfo[], BrowserError>> {
    const check = this.checkRequirements()
    if (!check.ok) return check

    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      return ok(devices.map(device => ({
        deviceId: device.deviceId,
        kind: device.kind,
        label: device.label,
        groupId: device.groupId,
      })))
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Get stream info.
   */
  getStreamInfo(handle: MediaStreamHandle): Result<StreamInfo | null, BrowserError> {
    const stream = this.getStream(handle)
    if (!stream) {
      return ok(null)
    }

    return ok({
      id: stream.id,
      active: stream.active,
      audioTrackCount: stream.getAudioTracks().length,
      videoTrackCount: stream.getVideoTracks().length,
    })
  }

  /**
   * Get audio tracks from a stream.
   */
  getAudioTracks(handle: MediaStreamHandle): Result<TrackHandle[], BrowserError> {
    const stream = this.getStream(handle)
    if (!stream) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Stream not found')
    }

    return ok(stream.getAudioTracks().map(track => this.getTrackHandle(track)))
  }

  /**
   * Get video tracks from a stream.
   */
  getVideoTracks(handle: MediaStreamHandle): Result<TrackHandle[], BrowserError> {
    const stream = this.getStream(handle)
    if (!stream) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Stream not found')
    }

    return ok(stream.getVideoTracks().map(track => this.getTrackHandle(track)))
  }

  /**
   * Get all tracks from a stream.
   */
  getTracks(handle: MediaStreamHandle): Result<TrackHandle[], BrowserError> {
    const stream = this.getStream(handle)
    if (!stream) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Stream not found')
    }

    return ok(stream.getTracks().map(track => this.getTrackHandle(track)))
  }

  /**
   * Get track info.
   */
  getTrackInfo(handle: TrackHandle): Result<TrackInfo | null, BrowserError> {
    const track = this.getTrack(handle)
    if (!track) {
      return ok(null)
    }

    return ok({
      id: track.id,
      kind: track.kind as MediaTrackKind,
      label: track.label,
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState as MediaTrackState,
    })
  }

  /**
   * Set track enabled state.
   */
  setTrackEnabled(handle: TrackHandle, enabled: boolean): Result<void, BrowserError> {
    const track = this.getTrack(handle)
    if (!track) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Track not found')
    }

    track.enabled = enabled
    return ok(undefined)
  }

  /**
   * Stop a track.
   */
  stopTrack(handle: TrackHandle): Result<void, BrowserError> {
    const track = this.getTrack(handle)
    if (!track) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Track not found')
    }

    track.stop()
    return ok(undefined)
  }

  /**
   * Stop all tracks in a stream.
   */
  stopStream(handle: MediaStreamHandle): Result<void, BrowserError> {
    const stream = this.getStream(handle)
    if (!stream) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Stream not found')
    }

    stream.getTracks().forEach(track => track.stop())
    return ok(undefined)
  }

  /**
   * Attach a stream to a video element.
   */
  attachStreamToVideo(streamHandle: MediaStreamHandle, elementHandle: ElementHandle): Result<void, BrowserError> {
    if (!isMainThread()) {
      return browserErr(BrowserErrorCode.WRONG_THREAD, 'Video attachment requires main thread')
    }

    const stream = this.getStream(streamHandle)
    if (!stream) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Stream not found')
    }

    const dom = getDefaultDom()
    const element = dom.getRawElement(elementHandle)
    if (!element) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Element not found')
    }

    if (!(element instanceof HTMLVideoElement)) {
      return browserErr(BrowserErrorCode.INVALID_ARGUMENT, 'Element is not a video element')
    }

    element.srcObject = stream
    return ok(undefined)
  }

  /**
   * Detach stream from a video element.
   */
  detachStreamFromVideo(elementHandle: ElementHandle): Result<void, BrowserError> {
    if (!isMainThread()) {
      return browserErr(BrowserErrorCode.WRONG_THREAD, 'Video detachment requires main thread')
    }

    const dom = getDefaultDom()
    const element = dom.getRawElement(elementHandle)
    if (!element) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Element not found')
    }

    if (!(element instanceof HTMLVideoElement)) {
      return browserErr(BrowserErrorCode.INVALID_ARGUMENT, 'Element is not a video element')
    }

    element.srcObject = null
    return ok(undefined)
  }

  /**
   * Release a stream handle.
   */
  releaseStream(handle: MediaStreamHandle): void {
    this.streams.drop(handle)
  }

  /**
   * Release a track handle.
   */
  releaseTrack(handle: TrackHandle): void {
    this.tracks.drop(handle)
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultMedia: BrowserMedia | null = null

/**
 * Get the default media instance.
 */
export function getDefaultMedia(): BrowserMedia {
  if (!defaultMedia) {
    defaultMedia = new BrowserMedia()
  }
  return defaultMedia
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:media imports object.
 */
export function getBrowserMediaImports(options?: MediaOptions): Record<string, unknown> {
  let media: BrowserMedia | null = null

  const getMedia = (): BrowserMedia => {
    if (!media) {
      media = options ? new BrowserMedia(options) : getDefaultMedia()
    }
    return media
  }

  return {
    'browser:media/media': {
      // Permissions
      'query-camera-permission': () => getMedia().queryCameraPermission(),
      'query-microphone-permission': () => getMedia().queryMicrophonePermission(),

      // Device enumeration
      'enumerate-devices': () => getMedia().enumerateDevices(),

      // Stream acquisition
      'get-user-media': (constraints: MediaConstraints) => getMedia().getUserMedia(constraints),
      'get-display-media': (constraints?: MediaConstraints) => getMedia().getDisplayMedia(constraints),

      // Stream info
      'get-stream-info': (handle: MediaStreamHandle) => getMedia().getStreamInfo(handle),
      'get-audio-tracks': (handle: MediaStreamHandle) => getMedia().getAudioTracks(handle),
      'get-video-tracks': (handle: MediaStreamHandle) => getMedia().getVideoTracks(handle),
      'get-tracks': (handle: MediaStreamHandle) => getMedia().getTracks(handle),

      // Track operations
      'get-track-info': (handle: TrackHandle) => getMedia().getTrackInfo(handle),
      'set-track-enabled': (handle: TrackHandle, enabled: boolean) => getMedia().setTrackEnabled(handle, enabled),
      'stop-track': (handle: TrackHandle) => getMedia().stopTrack(handle),
      'stop-stream': (handle: MediaStreamHandle) => getMedia().stopStream(handle),

      // Video attachment
      'attach-stream-to-video': (streamHandle: MediaStreamHandle, elementHandle: ElementHandle) =>
        getMedia().attachStreamToVideo(streamHandle, elementHandle),
      'detach-stream-from-video': (elementHandle: ElementHandle) =>
        getMedia().detachStreamFromVideo(elementHandle),

      // Cleanup
      'release-stream': (handle: MediaStreamHandle) => getMedia().releaseStream(handle),
      'release-track': (handle: TrackHandle) => getMedia().releaseTrack(handle),
    },
  }
}
