/**
 * browser:canvas - Canvas rendering interface
 *
 * Provides a capability-scoped interface to Canvas 2D rendering
 * with support for both regular and offscreen canvases.
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
  type Color,
  colorToCss,
} from './types.js'
import { isMainThread, supports } from './runtime.js'
import { WeakHandleRegistry } from '../shared/registry.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Handle to a canvas element or offscreen canvas.
 */
export type CanvasHandle = number

/**
 * Handle to a 2D rendering context.
 */
export type Context2DHandle = number

/**
 * Line cap style.
 */
export type LineCap = 'butt' | 'round' | 'square'

/**
 * Line join style.
 */
export type LineJoin = 'bevel' | 'miter' | 'round'

/**
 * Text alignment.
 */
export type TextAlign = 'start' | 'end' | 'left' | 'right' | 'center'

/**
 * Text baseline.
 */
export type TextBaseline = 'top' | 'hanging' | 'middle' | 'alphabetic' | 'ideographic' | 'bottom'

/**
 * Composite operation.
 */
export type CompositeOperation =
  | 'source-over'
  | 'source-in'
  | 'source-out'
  | 'source-atop'
  | 'destination-over'
  | 'destination-in'
  | 'destination-out'
  | 'destination-atop'
  | 'lighter'
  | 'copy'
  | 'xor'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'

/**
 * Image data for pixel manipulation.
 */
export interface ImageData {
  /** Width in pixels */
  width: number
  /** Height in pixels */
  height: number
  /** RGBA pixel data (4 bytes per pixel) */
  data: Uint8ClampedArray
}

/**
 * Canvas draw command for batching.
 */
export type DrawCommand =
  | { type: 'fill-rect'; x: number; y: number; width: number; height: number }
  | { type: 'stroke-rect'; x: number; y: number; width: number; height: number }
  | { type: 'clear-rect'; x: number; y: number; width: number; height: number }
  | { type: 'fill-text'; text: string; x: number; y: number; maxWidth?: number }
  | { type: 'stroke-text'; text: string; x: number; y: number; maxWidth?: number }
  | { type: 'begin-path' }
  | { type: 'close-path' }
  | { type: 'move-to'; x: number; y: number }
  | { type: 'line-to'; x: number; y: number }
  | { type: 'arc'; x: number; y: number; radius: number; startAngle: number; endAngle: number; counterclockwise?: boolean }
  | { type: 'arc-to'; x1: number; y1: number; x2: number; y2: number; radius: number }
  | { type: 'bezier-curve-to'; cp1x: number; cp1y: number; cp2x: number; cp2y: number; x: number; y: number }
  | { type: 'quadratic-curve-to'; cpx: number; cpy: number; x: number; y: number }
  | { type: 'rect'; x: number; y: number; width: number; height: number }
  | { type: 'fill' }
  | { type: 'stroke' }
  | { type: 'clip' }
  | { type: 'set-fill-style'; style: string | Color }
  | { type: 'set-stroke-style'; style: string | Color }
  | { type: 'set-line-width'; width: number }
  | { type: 'set-line-cap'; cap: LineCap }
  | { type: 'set-line-join'; join: LineJoin }
  | { type: 'set-font'; font: string }
  | { type: 'set-text-align'; align: TextAlign }
  | { type: 'set-text-baseline'; baseline: TextBaseline }
  | { type: 'set-global-alpha'; alpha: number }
  | { type: 'set-global-composite-operation'; operation: CompositeOperation }
  | { type: 'save' }
  | { type: 'restore' }
  | { type: 'translate'; x: number; y: number }
  | { type: 'rotate'; angle: number }
  | { type: 'scale'; x: number; y: number }
  | { type: 'set-transform'; a: number; b: number; c: number; d: number; e: number; f: number }
  | { type: 'reset-transform' }

/**
 * Canvas configuration options.
 */
export interface CanvasOptions {
  /** Custom document (for testing) */
  document?: Document
}

// =============================================================================
// Browser Canvas
// =============================================================================

/**
 * Browser canvas implementation.
 */
export class BrowserCanvas {
  private doc: Document | null
  private readonly canvases = new WeakHandleRegistry<HTMLCanvasElement | OffscreenCanvas>(1)
  private readonly contexts = new WeakHandleRegistry<
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  >(1)

  constructor(options: CanvasOptions = {}) {
    this.doc = options.document ?? (isMainThread() ? globalThis.document : null)
  }

  /**
   * Get or create a handle for a canvas.
   */
  private getCanvasHandle(canvas: HTMLCanvasElement | OffscreenCanvas): CanvasHandle {
    return this.canvases.handleFor(canvas)
  }

  /**
   * Get a canvas from its handle.
   */
  private getCanvas(handle: CanvasHandle): HTMLCanvasElement | OffscreenCanvas | null {
    return this.canvases.get(handle) ?? null
  }

  /**
   * Get or create a handle for a context.
   */
  private getContextHandle(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): Context2DHandle {
    return this.contexts.handleFor(ctx)
  }

  /**
   * Get a context from its handle.
   */
  private getContext(handle: Context2DHandle): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
    return this.contexts.get(handle) ?? null
  }

  /**
   * Convert style to CSS string.
   */
  private styleToString(style: string | Color): string {
    if (typeof style === 'string') {
      return style
    }
    return colorToCss(style)
  }

  // ===========================================================================
  // Canvas Management
  // ===========================================================================

  /**
   * Get a canvas element by its ID.
   */
  getCanvasById(id: string): Result<CanvasHandle | null, BrowserError> {
    if (!this.doc) {
      return browserErr(
        BrowserErrorCode.WRONG_THREAD,
        'Canvas by ID can only be accessed on the main thread'
      )
    }

    const element = this.doc.getElementById(id)
    if (!element) {
      return ok(null)
    }

    if (!(element instanceof HTMLCanvasElement)) {
      return browserErr(
        BrowserErrorCode.INVALID_ARGUMENT,
        `Element '${id}' is not a canvas element`
      )
    }

    return ok(this.getCanvasHandle(element))
  }

  /**
   * Create a new offscreen canvas.
   */
  createOffscreenCanvas(width: number, height: number): Result<CanvasHandle, BrowserError> {
    if (!supports('browser:canvas-offscreen')) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'OffscreenCanvas is not supported in this environment'
      )
    }

    try {
      const canvas = new OffscreenCanvas(width, height)
      return ok(this.getCanvasHandle(canvas))
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Get canvas dimensions.
   */
  getCanvasSize(handle: CanvasHandle): Result<{ width: number; height: number }, BrowserError> {
    const canvas = this.getCanvas(handle)
    if (!canvas) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Canvas not found')
    }

    return ok({ width: canvas.width, height: canvas.height })
  }

  /**
   * Set canvas dimensions.
   */
  setCanvasSize(handle: CanvasHandle, width: number, height: number): Result<void, BrowserError> {
    const canvas = this.getCanvas(handle)
    if (!canvas) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Canvas not found')
    }

    canvas.width = width
    canvas.height = height
    return ok(undefined)
  }

  // ===========================================================================
  // Context Management
  // ===========================================================================

  /**
   * Get the 2D rendering context for a canvas.
   */
  getContext2D(canvasHandle: CanvasHandle): Result<Context2DHandle, BrowserError> {
    const canvas = this.getCanvas(canvasHandle)
    if (!canvas) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Canvas not found')
    }

    // getContext('2d') on a union receiver (HTMLCanvasElement | OffscreenCanvas)
    // resolves to the wide RenderingContext overload; we asked for '2d', so the
    // result is a 2D context.
    const ctx = canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null
    if (!ctx) {
      return browserErr(
        BrowserErrorCode.NOT_SUPPORTED,
        'Could not get 2D rendering context'
      )
    }

    return ok(this.getContextHandle(ctx))
  }

  // ===========================================================================
  // Drawing Operations
  // ===========================================================================

  /**
   * Fill a rectangle.
   */
  fillRect(handle: Context2DHandle, x: number, y: number, width: number, height: number): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.fillRect(x, y, width, height)
    return ok(undefined)
  }

  /**
   * Stroke a rectangle.
   */
  strokeRect(handle: Context2DHandle, x: number, y: number, width: number, height: number): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.strokeRect(x, y, width, height)
    return ok(undefined)
  }

  /**
   * Clear a rectangle.
   */
  clearRect(handle: Context2DHandle, x: number, y: number, width: number, height: number): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.clearRect(x, y, width, height)
    return ok(undefined)
  }

  /**
   * Fill text.
   */
  fillText(handle: Context2DHandle, text: string, x: number, y: number, maxWidth?: number): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    if (maxWidth !== undefined) {
      ctx.fillText(text, x, y, maxWidth)
    } else {
      ctx.fillText(text, x, y)
    }
    return ok(undefined)
  }

  /**
   * Stroke text.
   */
  strokeText(handle: Context2DHandle, text: string, x: number, y: number, maxWidth?: number): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    if (maxWidth !== undefined) {
      ctx.strokeText(text, x, y, maxWidth)
    } else {
      ctx.strokeText(text, x, y)
    }
    return ok(undefined)
  }

  /**
   * Measure text width.
   */
  measureText(handle: Context2DHandle, text: string): Result<{ width: number }, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    const metrics = ctx.measureText(text)
    return ok({ width: metrics.width })
  }

  // ===========================================================================
  // Path Operations
  // ===========================================================================

  /**
   * Begin a new path.
   */
  beginPath(handle: Context2DHandle): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.beginPath()
    return ok(undefined)
  }

  /**
   * Close the current path.
   */
  closePath(handle: Context2DHandle): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.closePath()
    return ok(undefined)
  }

  /**
   * Move to a point.
   */
  moveTo(handle: Context2DHandle, x: number, y: number): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.moveTo(x, y)
    return ok(undefined)
  }

  /**
   * Draw a line to a point.
   */
  lineTo(handle: Context2DHandle, x: number, y: number): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.lineTo(x, y)
    return ok(undefined)
  }

  /**
   * Draw an arc.
   */
  arc(
    handle: Context2DHandle,
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean
  ): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.arc(x, y, radius, startAngle, endAngle, counterclockwise)
    return ok(undefined)
  }

  /**
   * Add a rectangle to the path.
   */
  rect(handle: Context2DHandle, x: number, y: number, width: number, height: number): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.rect(x, y, width, height)
    return ok(undefined)
  }

  /**
   * Fill the current path.
   */
  fill(handle: Context2DHandle): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.fill()
    return ok(undefined)
  }

  /**
   * Stroke the current path.
   */
  stroke(handle: Context2DHandle): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.stroke()
    return ok(undefined)
  }

  /**
   * Clip to the current path.
   */
  clip(handle: Context2DHandle): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.clip()
    return ok(undefined)
  }

  // ===========================================================================
  // Style Operations
  // ===========================================================================

  /**
   * Set fill style.
   */
  setFillStyle(handle: Context2DHandle, style: string | Color): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.fillStyle = this.styleToString(style)
    return ok(undefined)
  }

  /**
   * Set stroke style.
   */
  setStrokeStyle(handle: Context2DHandle, style: string | Color): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.strokeStyle = this.styleToString(style)
    return ok(undefined)
  }

  /**
   * Set line width.
   */
  setLineWidth(handle: Context2DHandle, width: number): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.lineWidth = width
    return ok(undefined)
  }

  /**
   * Set font.
   */
  setFont(handle: Context2DHandle, font: string): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.font = font
    return ok(undefined)
  }

  /**
   * Set text alignment.
   */
  setTextAlign(handle: Context2DHandle, align: TextAlign): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.textAlign = align
    return ok(undefined)
  }

  /**
   * Set global alpha.
   */
  setGlobalAlpha(handle: Context2DHandle, alpha: number): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.globalAlpha = alpha
    return ok(undefined)
  }

  /**
   * Set global composite operation.
   */
  setGlobalCompositeOperation(handle: Context2DHandle, operation: CompositeOperation): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.globalCompositeOperation = operation
    return ok(undefined)
  }

  // ===========================================================================
  // Transform Operations
  // ===========================================================================

  /**
   * Save the current state.
   */
  save(handle: Context2DHandle): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.save()
    return ok(undefined)
  }

  /**
   * Restore the previous state.
   */
  restore(handle: Context2DHandle): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.restore()
    return ok(undefined)
  }

  /**
   * Translate the canvas.
   */
  translate(handle: Context2DHandle, x: number, y: number): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.translate(x, y)
    return ok(undefined)
  }

  /**
   * Rotate the canvas.
   */
  rotate(handle: Context2DHandle, angle: number): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.rotate(angle)
    return ok(undefined)
  }

  /**
   * Scale the canvas.
   */
  scale(handle: Context2DHandle, x: number, y: number): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.scale(x, y)
    return ok(undefined)
  }

  /**
   * Set the transform matrix.
   */
  setTransform(
    handle: Context2DHandle,
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number
  ): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.setTransform(a, b, c, d, e, f)
    return ok(undefined)
  }

  /**
   * Reset the transform to identity.
   */
  resetTransform(handle: Context2DHandle): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    ctx.resetTransform()
    return ok(undefined)
  }

  // ===========================================================================
  // Pixel Operations
  // ===========================================================================

  /**
   * Get image data from a region.
   */
  getImageData(handle: Context2DHandle, x: number, y: number, width: number, height: number): Result<ImageData, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    try {
      const imageData = ctx.getImageData(x, y, width, height)
      return ok({
        width: imageData.width,
        height: imageData.height,
        data: imageData.data,
      })
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  /**
   * Put image data to the canvas.
   */
  putImageData(
    handle: Context2DHandle,
    imageData: ImageData,
    dx: number,
    dy: number,
    dirtyX?: number,
    dirtyY?: number,
    dirtyWidth?: number,
    dirtyHeight?: number
  ): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    try {
      // Copy to a new Uint8ClampedArray with regular ArrayBuffer to avoid SharedArrayBuffer issues
      const dataCopy = new Uint8ClampedArray(imageData.data.length)
      dataCopy.set(imageData.data)
      const nativeImageData = new globalThis.ImageData(dataCopy, imageData.width, imageData.height)

      if (dirtyX !== undefined && dirtyY !== undefined && dirtyWidth !== undefined && dirtyHeight !== undefined) {
        ctx.putImageData(nativeImageData, dx, dy, dirtyX, dirtyY, dirtyWidth, dirtyHeight)
      } else {
        ctx.putImageData(nativeImageData, dx, dy)
      }

      return ok(undefined)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  // ===========================================================================
  // Batch Operations
  // ===========================================================================

  /**
   * Execute a batch of draw commands for better performance.
   */
  executeCommands(handle: Context2DHandle, commands: DrawCommand[]): Result<void, BrowserError> {
    const ctx = this.getContext(handle)
    if (!ctx) {
      return browserErr(BrowserErrorCode.NOT_FOUND, 'Context not found')
    }

    try {
      for (const cmd of commands) {
        switch (cmd.type) {
          case 'fill-rect':
            ctx.fillRect(cmd.x, cmd.y, cmd.width, cmd.height)
            break
          case 'stroke-rect':
            ctx.strokeRect(cmd.x, cmd.y, cmd.width, cmd.height)
            break
          case 'clear-rect':
            ctx.clearRect(cmd.x, cmd.y, cmd.width, cmd.height)
            break
          case 'fill-text':
            if (cmd.maxWidth !== undefined) {
              ctx.fillText(cmd.text, cmd.x, cmd.y, cmd.maxWidth)
            } else {
              ctx.fillText(cmd.text, cmd.x, cmd.y)
            }
            break
          case 'stroke-text':
            if (cmd.maxWidth !== undefined) {
              ctx.strokeText(cmd.text, cmd.x, cmd.y, cmd.maxWidth)
            } else {
              ctx.strokeText(cmd.text, cmd.x, cmd.y)
            }
            break
          case 'begin-path':
            ctx.beginPath()
            break
          case 'close-path':
            ctx.closePath()
            break
          case 'move-to':
            ctx.moveTo(cmd.x, cmd.y)
            break
          case 'line-to':
            ctx.lineTo(cmd.x, cmd.y)
            break
          case 'arc':
            ctx.arc(cmd.x, cmd.y, cmd.radius, cmd.startAngle, cmd.endAngle, cmd.counterclockwise)
            break
          case 'arc-to':
            ctx.arcTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.radius)
            break
          case 'bezier-curve-to':
            ctx.bezierCurveTo(cmd.cp1x, cmd.cp1y, cmd.cp2x, cmd.cp2y, cmd.x, cmd.y)
            break
          case 'quadratic-curve-to':
            ctx.quadraticCurveTo(cmd.cpx, cmd.cpy, cmd.x, cmd.y)
            break
          case 'rect':
            ctx.rect(cmd.x, cmd.y, cmd.width, cmd.height)
            break
          case 'fill':
            ctx.fill()
            break
          case 'stroke':
            ctx.stroke()
            break
          case 'clip':
            ctx.clip()
            break
          case 'set-fill-style':
            ctx.fillStyle = this.styleToString(cmd.style)
            break
          case 'set-stroke-style':
            ctx.strokeStyle = this.styleToString(cmd.style)
            break
          case 'set-line-width':
            ctx.lineWidth = cmd.width
            break
          case 'set-line-cap':
            ctx.lineCap = cmd.cap
            break
          case 'set-line-join':
            ctx.lineJoin = cmd.join
            break
          case 'set-font':
            ctx.font = cmd.font
            break
          case 'set-text-align':
            ctx.textAlign = cmd.align
            break
          case 'set-text-baseline':
            ctx.textBaseline = cmd.baseline
            break
          case 'set-global-alpha':
            ctx.globalAlpha = cmd.alpha
            break
          case 'set-global-composite-operation':
            ctx.globalCompositeOperation = cmd.operation
            break
          case 'save':
            ctx.save()
            break
          case 'restore':
            ctx.restore()
            break
          case 'translate':
            ctx.translate(cmd.x, cmd.y)
            break
          case 'rotate':
            ctx.rotate(cmd.angle)
            break
          case 'scale':
            ctx.scale(cmd.x, cmd.y)
            break
          case 'set-transform':
            ctx.setTransform(cmd.a, cmd.b, cmd.c, cmd.d, cmd.e, cmd.f)
            break
          case 'reset-transform':
            ctx.resetTransform()
            break
        }
      }

      return ok(undefined)
    } catch (error) {
      return { ok: false, error: mapErrorToBrowserError(error) }
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Release a canvas handle.
   */
  releaseCanvas(handle: CanvasHandle): void {
    this.canvases.drop(handle)
  }

  /**
   * Release a context handle.
   */
  releaseContext(handle: Context2DHandle): void {
    this.contexts.drop(handle)
  }
}

// =============================================================================
// Default Instance
// =============================================================================

let defaultCanvas: BrowserCanvas | null = null

/**
 * Get the default canvas instance.
 */
export function getDefaultCanvas(): BrowserCanvas {
  if (!defaultCanvas) {
    defaultCanvas = new BrowserCanvas()
  }
  return defaultCanvas
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Get the browser:canvas imports object.
 */
export function getBrowserCanvasImports(options?: CanvasOptions): Record<string, unknown> {
  let canvas: BrowserCanvas | null = null

  const getCanvas = (): BrowserCanvas => {
    if (!canvas) {
      canvas = options ? new BrowserCanvas(options) : getDefaultCanvas()
    }
    return canvas
  }

  return {
    'browser:canvas/canvas': {
      // Canvas management
      'get-canvas-by-id': (id: string) => getCanvas().getCanvasById(id),
      'create-offscreen-canvas': (width: number, height: number) => getCanvas().createOffscreenCanvas(width, height),
      'get-canvas-size': (handle: CanvasHandle) => getCanvas().getCanvasSize(handle),
      'set-canvas-size': (handle: CanvasHandle, width: number, height: number) =>
        getCanvas().setCanvasSize(handle, width, height),

      // Context
      'get-context-2d': (handle: CanvasHandle) => getCanvas().getContext2D(handle),

      // Drawing
      'fill-rect': (handle: Context2DHandle, x: number, y: number, w: number, h: number) =>
        getCanvas().fillRect(handle, x, y, w, h),
      'stroke-rect': (handle: Context2DHandle, x: number, y: number, w: number, h: number) =>
        getCanvas().strokeRect(handle, x, y, w, h),
      'clear-rect': (handle: Context2DHandle, x: number, y: number, w: number, h: number) =>
        getCanvas().clearRect(handle, x, y, w, h),
      'fill-text': (handle: Context2DHandle, text: string, x: number, y: number, maxWidth?: number) =>
        getCanvas().fillText(handle, text, x, y, maxWidth),
      'stroke-text': (handle: Context2DHandle, text: string, x: number, y: number, maxWidth?: number) =>
        getCanvas().strokeText(handle, text, x, y, maxWidth),
      'measure-text': (handle: Context2DHandle, text: string) => getCanvas().measureText(handle, text),

      // Paths
      'begin-path': (handle: Context2DHandle) => getCanvas().beginPath(handle),
      'close-path': (handle: Context2DHandle) => getCanvas().closePath(handle),
      'move-to': (handle: Context2DHandle, x: number, y: number) => getCanvas().moveTo(handle, x, y),
      'line-to': (handle: Context2DHandle, x: number, y: number) => getCanvas().lineTo(handle, x, y),
      arc: (handle: Context2DHandle, x: number, y: number, r: number, start: number, end: number, ccw?: boolean) =>
        getCanvas().arc(handle, x, y, r, start, end, ccw),
      rect: (handle: Context2DHandle, x: number, y: number, w: number, h: number) =>
        getCanvas().rect(handle, x, y, w, h),
      fill: (handle: Context2DHandle) => getCanvas().fill(handle),
      stroke: (handle: Context2DHandle) => getCanvas().stroke(handle),
      clip: (handle: Context2DHandle) => getCanvas().clip(handle),

      // Styles
      'set-fill-style': (handle: Context2DHandle, style: string | Color) =>
        getCanvas().setFillStyle(handle, style),
      'set-stroke-style': (handle: Context2DHandle, style: string | Color) =>
        getCanvas().setStrokeStyle(handle, style),
      'set-line-width': (handle: Context2DHandle, width: number) => getCanvas().setLineWidth(handle, width),
      'set-font': (handle: Context2DHandle, font: string) => getCanvas().setFont(handle, font),
      'set-text-align': (handle: Context2DHandle, align: TextAlign) => getCanvas().setTextAlign(handle, align),
      'set-global-alpha': (handle: Context2DHandle, alpha: number) => getCanvas().setGlobalAlpha(handle, alpha),
      'set-global-composite-operation': (handle: Context2DHandle, op: CompositeOperation) =>
        getCanvas().setGlobalCompositeOperation(handle, op),

      // Transforms
      save: (handle: Context2DHandle) => getCanvas().save(handle),
      restore: (handle: Context2DHandle) => getCanvas().restore(handle),
      translate: (handle: Context2DHandle, x: number, y: number) => getCanvas().translate(handle, x, y),
      rotate: (handle: Context2DHandle, angle: number) => getCanvas().rotate(handle, angle),
      scale: (handle: Context2DHandle, x: number, y: number) => getCanvas().scale(handle, x, y),
      'set-transform': (handle: Context2DHandle, a: number, b: number, c: number, d: number, e: number, f: number) =>
        getCanvas().setTransform(handle, a, b, c, d, e, f),
      'reset-transform': (handle: Context2DHandle) => getCanvas().resetTransform(handle),

      // Pixels
      'get-image-data': (handle: Context2DHandle, x: number, y: number, w: number, h: number) =>
        getCanvas().getImageData(handle, x, y, w, h),
      'put-image-data': (
        handle: Context2DHandle,
        data: ImageData,
        dx: number,
        dy: number,
        dirtyX?: number,
        dirtyY?: number,
        dirtyW?: number,
        dirtyH?: number
      ) => getCanvas().putImageData(handle, data, dx, dy, dirtyX, dirtyY, dirtyW, dirtyH),

      // Batch
      'execute-commands': (handle: Context2DHandle, commands: DrawCommand[]) =>
        getCanvas().executeCommands(handle, commands),

      // Cleanup
      'release-canvas': (handle: CanvasHandle) => getCanvas().releaseCanvas(handle),
      'release-context': (handle: Context2DHandle) => getCanvas().releaseContext(handle),
    },
  }
}
