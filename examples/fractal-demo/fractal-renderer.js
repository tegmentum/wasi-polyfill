/**
 * Animated Fractal Renderer
 *
 * Standalone browser version that renders Julia/Mandelbrot fractals.
 */

// =============================================================================
// Color Palette
// =============================================================================

function hslToRgb(h, s, l) {
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

function generatePalette(size, hueOffset) {
  const palette = []
  for (let i = 0; i < size; i++) {
    const t = i / size
    const hue = (t * 0.8 + hueOffset) % 1
    const saturation = 0.8
    const lightness = 0.5 + 0.3 * Math.sin(t * Math.PI * 2)
    const [r, g, b] = hslToRgb(hue, saturation, lightness)
    palette.push([r, g, b, 255])
  }
  // Black for points inside the set
  palette.push([0, 0, 0, 255])
  return palette
}

// =============================================================================
// Fractal Computation
// =============================================================================

function juliaIteration(zx, zy, cx, cy, maxIterations) {
  let x = zx
  let y = zy

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

function mandelbrotIteration(cx, cy, maxIterations) {
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

export class FractalRenderer {
  constructor(config = {}) {
    this.config = {
      width: config.width ?? 800,
      height: config.height ?? 600,
      maxIterations: config.maxIterations ?? 100,
      fractalType: config.fractalType ?? 'julia',
      zoom: config.zoom ?? 1,
      centerX: config.centerX ?? 0,
      centerY: config.centerY ?? 0,
    }

    this.time = 0
    this.palette = []
    this.imageData = null

    this.updatePalette(0)
  }

  updatePalette(hueOffset) {
    this.palette = generatePalette(this.config.maxIterations, hueOffset)
  }

  getJuliaParams(t) {
    const angle = t * 0.5
    const radius = 0.7885 + 0.05 * Math.sin(t * 2)
    return {
      cx: radius * Math.cos(angle),
      cy: radius * Math.sin(angle),
    }
  }

  render(deltaTime = 0.016) {
    this.time += deltaTime
    this.updatePalette(this.time * 0.1)

    const { width, height, maxIterations, fractalType, zoom, centerX, centerY } = this.config

    if (!this.imageData || this.imageData.width !== width || this.imageData.height !== height) {
      this.imageData = new ImageData(width, height)
    }

    const data = this.imageData.data

    const aspectRatio = width / height
    const viewWidth = 4 / zoom
    const viewHeight = viewWidth / aspectRatio

    const minX = centerX - viewWidth / 2
    const maxX = centerX + viewWidth / 2
    const minY = centerY - viewHeight / 2
    const maxY = centerY + viewHeight / 2

    const juliaParams = fractalType === 'julia' ? this.getJuliaParams(this.time) : { cx: 0, cy: 0 }

    for (let py = 0; py < height; py++) {
      const y = minY + (py / height) * (maxY - minY)

      for (let px = 0; px < width; px++) {
        const x = minX + (px / width) * (maxX - minX)

        let iterations
        if (fractalType === 'julia') {
          iterations = juliaIteration(x, y, juliaParams.cx, juliaParams.cy, maxIterations)
        } else {
          iterations = mandelbrotIteration(x, y, maxIterations)
        }

        let color
        if (iterations >= maxIterations) {
          color = this.palette[this.palette.length - 1]
        } else {
          const colorIndex = Math.floor(iterations) % (this.palette.length - 1)
          const nextIndex = (colorIndex + 1) % (this.palette.length - 1)
          const frac = iterations - Math.floor(iterations)

          const c1 = this.palette[colorIndex]
          const c2 = this.palette[nextIndex]
          color = [
            Math.round(c1[0] * (1 - frac) + c2[0] * frac),
            Math.round(c1[1] * (1 - frac) + c2[1] * frac),
            Math.round(c1[2] * (1 - frac) + c2[2] * frac),
            255,
          ]
        }

        const offset = (py * width + px) * 4
        data[offset] = color[0]
        data[offset + 1] = color[1]
        data[offset + 2] = color[2]
        data[offset + 3] = color[3]
      }
    }
  }

  present(canvas) {
    const ctx = canvas.getContext('2d')
    if (!ctx || !this.imageData) return
    ctx.putImageData(this.imageData, 0, 0)
  }

  getConfig() {
    return { ...this.config }
  }

  setConfig(config) {
    Object.assign(this.config, config)
    if (config.maxIterations) {
      this.updatePalette(this.time * 0.1)
    }
  }

  destroy() {
    this.imageData = null
  }
}

// =============================================================================
// Animation Controller
// =============================================================================

export class FractalAnimation {
  constructor(canvas, config = {}) {
    this.canvas = canvas

    const finalConfig = {
      width: config.width ?? canvas.width,
      height: config.height ?? canvas.height,
      ...config,
    }

    this.renderer = new FractalRenderer(finalConfig)

    canvas.width = finalConfig.width
    canvas.height = finalConfig.height

    this.animationId = null
    this.lastTime = 0
    this.fps = 0
    this.frameCount = 0
    this.lastFpsUpdate = 0
  }

  start() {
    if (this.animationId !== null) return

    this.lastTime = performance.now()
    this.lastFpsUpdate = this.lastTime
    this.frameCount = 0

    const animate = (currentTime) => {
      const deltaTime = (currentTime - this.lastTime) / 1000
      this.lastTime = currentTime

      this.frameCount++
      if (currentTime - this.lastFpsUpdate >= 1000) {
        this.fps = this.frameCount
        this.frameCount = 0
        this.lastFpsUpdate = currentTime
      }

      this.renderer.render(deltaTime)
      this.renderer.present(this.canvas)

      this.animationId = requestAnimationFrame(animate)
    }

    this.animationId = requestAnimationFrame(animate)
  }

  stop() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  getFps() {
    return this.fps
  }

  getRenderer() {
    return this.renderer
  }

  toggleFractalType() {
    const config = this.renderer.getConfig()
    this.renderer.setConfig({
      fractalType: config.fractalType === 'julia' ? 'mandelbrot' : 'julia',
    })
  }

  zoomIn(factor = 1.5) {
    const config = this.renderer.getConfig()
    this.renderer.setConfig({ zoom: config.zoom * factor })
  }

  zoomOut(factor = 1.5) {
    const config = this.renderer.getConfig()
    this.renderer.setConfig({ zoom: config.zoom / factor })
  }

  pan(dx, dy) {
    const config = this.renderer.getConfig()
    const scale = 1 / config.zoom
    this.renderer.setConfig({
      centerX: config.centerX + dx * scale,
      centerY: config.centerY + dy * scale,
    })
  }

  reset() {
    this.renderer.setConfig({
      zoom: 1,
      centerX: 0,
      centerY: 0,
    })
  }

  destroy() {
    this.stop()
    this.renderer.destroy()
  }
}

export default FractalAnimation
