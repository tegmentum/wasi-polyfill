/**
 * Animated Fractal Renderer using wasi:frame-buffer
 *
 * Renders a Julia set fractal with animated parameters.
 */

import {
  FrameBufferRegistry,
  type FrameBufferHandle,
  BYTES_PER_PIXEL,
} from '../../src/wasip2/plugins/frame-buffer/index.js'

// =============================================================================
// Color Palette
// =============================================================================

/**
 * HSL to RGB conversion for vibrant fractal colors.
 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = h % 1
  if (h < 0) h += 1

  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h * 6) % 2 - 1))
  const m = l - c / 2

  let r = 0, g = 0, b = 0

  if (h < 1/6) {
    r = c; g = x; b = 0
  } else if (h < 2/6) {
    r = x; g = c; b = 0
  } else if (h < 3/6) {
    r = 0; g = c; b = x
  } else if (h < 4/6) {
    r = 0; g = x; b = c
  } else if (h < 5/6) {
    r = x; g = 0; b = c
  } else {
    r = c; g = 0; b = x
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ]
}

/**
 * Generate a color palette for the fractal.
 */
function generatePalette(size: number, hueOffset: number): Uint8Array[] {
  const palette: Uint8Array[] = []
  for (let i = 0; i < size; i++) {
    const t = i / size
    const hue = (t * 0.8 + hueOffset) % 1
    const saturation = 0.8
    const lightness = 0.5 + 0.3 * Math.sin(t * Math.PI * 2)
    const [r, g, b] = hslToRgb(hue, saturation, lightness)
    palette.push(new Uint8Array([r, g, b, 255]))
  }
  // Black for points inside the set
  palette.push(new Uint8Array([0, 0, 0, 255]))
  return palette
}

// =============================================================================
// Fractal Computation
// =============================================================================

/**
 * Compute Julia set iteration count for a point.
 */
function juliaIteration(
  zx: number,
  zy: number,
  cx: number,
  cy: number,
  maxIterations: number
): number {
  let x = zx
  let y = zy

  for (let i = 0; i < maxIterations; i++) {
    const x2 = x * x
    const y2 = y * y

    if (x2 + y2 > 4) {
      // Smooth coloring using escape time algorithm
      const log_zn = Math.log(x2 + y2) / 2
      const nu = Math.log(log_zn / Math.log(2)) / Math.log(2)
      return i + 1 - nu
    }

    const newX = x2 - y2 + cx
    y = 2 * x * y + cy
    x = newX
  }

  return maxIterations
}

/**
 * Compute Mandelbrot set iteration count for a point.
 */
function mandelbrotIteration(
  cx: number,
  cy: number,
  maxIterations: number
): number {
  let x = 0
  let y = 0

  for (let i = 0; i < maxIterations; i++) {
    const x2 = x * x
    const y2 = y * y

    if (x2 + y2 > 4) {
      const log_zn = Math.log(x2 + y2) / 2
      const nu = Math.log(log_zn / Math.log(2)) / Math.log(2)
      return i + 1 - nu
    }

    const newX = x2 - y2 + cx
    y = 2 * x * y + cy
    x = newX
  }

  return maxIterations
}

// =============================================================================
// Fractal Renderer
// =============================================================================

export interface FractalConfig {
  width: number
  height: number
  maxIterations: number
  fractalType: 'julia' | 'mandelbrot'
  zoom: number
  centerX: number
  centerY: number
}

export class FractalRenderer {
  private registry: FrameBufferRegistry
  private bufferHandle: FrameBufferHandle
  private config: FractalConfig
  private time: number = 0
  private palette: Uint8Array[] = []
  private canvas: HTMLCanvasElement | null = null

  constructor(config: Partial<FractalConfig> = {}) {
    this.config = {
      width: config.width ?? 800,
      height: config.height ?? 600,
      maxIterations: config.maxIterations ?? 100,
      fractalType: config.fractalType ?? 'julia',
      zoom: config.zoom ?? 1,
      centerX: config.centerX ?? 0,
      centerY: config.centerY ?? 0,
    }

    this.registry = new FrameBufferRegistry()
    this.bufferHandle = this.registry.createBuffer({
      width: this.config.width,
      height: this.config.height,
      format: 'rgba8',
    })

    this.updatePalette(0)
  }

  /**
   * Update the color palette based on time.
   */
  private updatePalette(hueOffset: number): void {
    this.palette = generatePalette(this.config.maxIterations, hueOffset)
  }

  /**
   * Get Julia set parameters that animate over time.
   */
  private getJuliaParams(t: number): { cx: number; cy: number } {
    // Trace a path through interesting Julia set parameter space
    const angle = t * 0.5
    const radius = 0.7885 + 0.05 * Math.sin(t * 2)

    return {
      cx: radius * Math.cos(angle),
      cy: radius * Math.sin(angle),
    }
  }

  /**
   * Render a single frame of the fractal.
   */
  render(deltaTime: number = 0.016): void {
    this.time += deltaTime

    // Update palette color cycling
    this.updatePalette(this.time * 0.1)

    const buffer = this.registry.getBuffer(this.bufferHandle)
    if (!buffer) return

    const { width, height, maxIterations, fractalType, zoom, centerX, centerY } = this.config
    const data = buffer.data

    // Calculate view bounds
    const aspectRatio = width / height
    const viewWidth = 4 / zoom
    const viewHeight = viewWidth / aspectRatio

    const minX = centerX - viewWidth / 2
    const maxX = centerX + viewWidth / 2
    const minY = centerY - viewHeight / 2
    const maxY = centerY + viewHeight / 2

    // Get Julia parameters if using Julia set
    const juliaParams = fractalType === 'julia' ? this.getJuliaParams(this.time) : { cx: 0, cy: 0 }

    // Render each pixel
    for (let py = 0; py < height; py++) {
      const y = minY + (py / height) * (maxY - minY)

      for (let px = 0; px < width; px++) {
        const x = minX + (px / width) * (maxX - minX)

        let iterations: number
        if (fractalType === 'julia') {
          iterations = juliaIteration(x, y, juliaParams.cx, juliaParams.cy, maxIterations)
        } else {
          iterations = mandelbrotIteration(x, y, maxIterations)
        }

        // Map iteration to color
        let color: Uint8Array
        if (iterations >= maxIterations) {
          color = this.palette[this.palette.length - 1]! // Inside set = black
        } else {
          const colorIndex = Math.floor(iterations) % (this.palette.length - 1)
          const nextIndex = (colorIndex + 1) % (this.palette.length - 1)
          const frac = iterations - Math.floor(iterations)

          // Interpolate between colors for smooth gradients
          const c1 = this.palette[colorIndex]!
          const c2 = this.palette[nextIndex]!
          color = new Uint8Array([
            Math.round(c1[0]! * (1 - frac) + c2[0]! * frac),
            Math.round(c1[1]! * (1 - frac) + c2[1]! * frac),
            Math.round(c1[2]! * (1 - frac) + c2[2]! * frac),
            255,
          ])
        }

        // Write pixel to buffer
        const offset = (py * width + px) * 4
        data[offset] = color[0]!
        data[offset + 1] = color[1]!
        data[offset + 2] = color[2]!
        data[offset + 3] = color[3]!
      }
    }

    buffer.dirty = true
  }

  /**
   * Present the frame buffer to a canvas.
   */
  present(canvas: HTMLCanvasElement): void {
    const buffer = this.registry.getBuffer(this.bufferHandle)
    if (!buffer) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Create ImageData from buffer
    const imageData = new ImageData(
      new Uint8ClampedArray(buffer.data),
      this.config.width,
      this.config.height
    )

    ctx.putImageData(imageData, 0, 0)
    buffer.dirty = false
  }

  /**
   * Get the raw pixel data.
   */
  getData(): Uint8Array | null {
    return this.registry.getData(this.bufferHandle)
  }

  /**
   * Get configuration.
   */
  getConfig(): FractalConfig {
    return { ...this.config }
  }

  /**
   * Update configuration.
   */
  setConfig(config: Partial<FractalConfig>): void {
    const needsResize = config.width !== undefined || config.height !== undefined
    Object.assign(this.config, config)

    if (needsResize) {
      // Create new buffer with new size
      this.registry.deleteBuffer(this.bufferHandle)
      this.bufferHandle = this.registry.createBuffer({
        width: this.config.width,
        height: this.config.height,
        format: 'rgba8',
      })
    }
  }

  /**
   * Destroy and cleanup.
   */
  destroy(): void {
    this.registry.deleteBuffer(this.bufferHandle)
  }
}

// =============================================================================
// Animation Controller
// =============================================================================

export class FractalAnimation {
  private renderer: FractalRenderer
  private canvas: HTMLCanvasElement
  private animationId: number | null = null
  private lastTime: number = 0
  private fps: number = 0
  private frameCount: number = 0
  private lastFpsUpdate: number = 0

  constructor(canvas: HTMLCanvasElement, config: Partial<FractalConfig> = {}) {
    this.canvas = canvas

    // Use canvas dimensions if not specified
    const finalConfig = {
      width: config.width ?? canvas.width,
      height: config.height ?? canvas.height,
      ...config,
    }

    this.renderer = new FractalRenderer(finalConfig)

    // Ensure canvas matches buffer size
    canvas.width = finalConfig.width
    canvas.height = finalConfig.height
  }

  /**
   * Start the animation loop.
   */
  start(): void {
    if (this.animationId !== null) return

    this.lastTime = performance.now()
    this.lastFpsUpdate = this.lastTime
    this.frameCount = 0

    const animate = (currentTime: number) => {
      const deltaTime = (currentTime - this.lastTime) / 1000
      this.lastTime = currentTime

      // Update FPS counter
      this.frameCount++
      if (currentTime - this.lastFpsUpdate >= 1000) {
        this.fps = this.frameCount
        this.frameCount = 0
        this.lastFpsUpdate = currentTime
      }

      // Render frame
      this.renderer.render(deltaTime)
      this.renderer.present(this.canvas)

      this.animationId = requestAnimationFrame(animate)
    }

    this.animationId = requestAnimationFrame(animate)
  }

  /**
   * Stop the animation loop.
   */
  stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  /**
   * Get current FPS.
   */
  getFps(): number {
    return this.fps
  }

  /**
   * Get the renderer for configuration changes.
   */
  getRenderer(): FractalRenderer {
    return this.renderer
  }

  /**
   * Toggle between Julia and Mandelbrot sets.
   */
  toggleFractalType(): void {
    const config = this.renderer.getConfig()
    this.renderer.setConfig({
      fractalType: config.fractalType === 'julia' ? 'mandelbrot' : 'julia',
    })
  }

  /**
   * Zoom in at center.
   */
  zoomIn(factor: number = 1.5): void {
    const config = this.renderer.getConfig()
    this.renderer.setConfig({ zoom: config.zoom * factor })
  }

  /**
   * Zoom out at center.
   */
  zoomOut(factor: number = 1.5): void {
    const config = this.renderer.getConfig()
    this.renderer.setConfig({ zoom: config.zoom / factor })
  }

  /**
   * Pan the view.
   */
  pan(dx: number, dy: number): void {
    const config = this.renderer.getConfig()
    const scale = 1 / config.zoom
    this.renderer.setConfig({
      centerX: config.centerX + dx * scale,
      centerY: config.centerY + dy * scale,
    })
  }

  /**
   * Reset to default view.
   */
  reset(): void {
    this.renderer.setConfig({
      zoom: 1,
      centerX: 0,
      centerY: 0,
    })
  }

  /**
   * Cleanup.
   */
  destroy(): void {
    this.stop()
    this.renderer.destroy()
  }
}

export default FractalAnimation
