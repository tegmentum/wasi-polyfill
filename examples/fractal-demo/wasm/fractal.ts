/**
 * Fractal Renderer - AssemblyScript WebAssembly Module
 *
 * This module computes Julia/Mandelbrot fractals and writes the result
 * to a frame buffer in memory. The host (browser or Python) reads this
 * buffer and displays it.
 */

// Frame buffer in linear memory
// Layout: [width, height, fractal_type, ...pixel_data]
// Pixel data is RGBA8 format (4 bytes per pixel)

const HEADER_SIZE: i32 = 16; // 4 ints: width, height, fractal_type, max_iterations
let bufferPtr: i32 = HEADER_SIZE;
let width: i32 = 800;
let height: i32 = 600;
let maxIterations: i32 = 100;
let fractalType: i32 = 0; // 0 = Julia, 1 = Mandelbrot
let zoom: f64 = 1.0;
let centerX: f64 = 0.0;
let centerY: f64 = 0.0;

/**
 * Initialize the frame buffer with dimensions.
 */
export function init(w: i32, h: i32): i32 {
  width = w;
  height = h;

  // Store dimensions in header
  store<i32>(0, width);
  store<i32>(4, height);
  store<i32>(8, fractalType);
  store<i32>(12, maxIterations);

  // Calculate buffer pointer (after header)
  bufferPtr = HEADER_SIZE;

  // Return the size of pixel data needed
  return width * height * 4;
}

/**
 * Get the pointer to the frame buffer data.
 */
export function getBufferPtr(): i32 {
  return bufferPtr;
}

/**
 * Get the buffer size in bytes.
 */
export function getBufferSize(): i32 {
  return width * height * 4;
}

/**
 * Set the fractal type (0 = Julia, 1 = Mandelbrot).
 */
export function setFractalType(t: i32): void {
  fractalType = t;
  store<i32>(8, fractalType);
}

/**
 * Set the maximum iterations.
 */
export function setMaxIterations(iter: i32): void {
  maxIterations = iter;
  store<i32>(12, maxIterations);
}

/**
 * Set zoom level.
 */
export function setZoom(z: f64): void {
  zoom = z;
}

/**
 * Set center position.
 */
export function setCenter(x: f64, y: f64): void {
  centerX = x;
  centerY = y;
}

/**
 * HSL to RGB conversion.
 */
function hslToRgb(h: f64, s: f64, l: f64): u32 {
  h = h % 1.0;
  if (h < 0) h += 1.0;

  const c: f64 = (1.0 - Math.abs(2.0 * l - 1.0)) * s;
  const x: f64 = c * (1.0 - Math.abs((h * 6.0) % 2.0 - 1.0));
  const m: f64 = l - c / 2.0;

  let r: f64 = 0, g: f64 = 0, b: f64 = 0;

  if (h < 1.0 / 6.0) {
    r = c; g = x; b = 0;
  } else if (h < 2.0 / 6.0) {
    r = x; g = c; b = 0;
  } else if (h < 3.0 / 6.0) {
    r = 0; g = c; b = x;
  } else if (h < 4.0 / 6.0) {
    r = 0; g = x; b = c;
  } else if (h < 5.0 / 6.0) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  const ri: u32 = <u32>((r + m) * 255.0);
  const gi: u32 = <u32>((g + m) * 255.0);
  const bi: u32 = <u32>((b + m) * 255.0);

  // Return as RGBA (little-endian: ABGR in memory)
  return (255 << 24) | (bi << 16) | (gi << 8) | ri;
}

/**
 * Generate a color from iteration count.
 */
function iterationToColor(iterations: f64, maxIter: i32, hueOffset: f64): u32 {
  if (iterations >= <f64>maxIter) {
    return 0xFF000000; // Black with full alpha
  }

  const t: f64 = iterations / <f64>maxIter;
  const hue: f64 = (t * 0.8 + hueOffset) % 1.0;
  const saturation: f64 = 0.8;
  const lightness: f64 = 0.5 + 0.3 * Math.sin(t * Math.PI * 2.0);

  return hslToRgb(hue, saturation, lightness);
}

/**
 * Julia set iteration with smooth coloring.
 */
function juliaIteration(zx: f64, zy: f64, cx: f64, cy: f64, maxIter: i32): f64 {
  let x: f64 = zx;
  let y: f64 = zy;

  for (let i: i32 = 0; i < maxIter; i++) {
    const x2: f64 = x * x;
    const y2: f64 = y * y;

    if (x2 + y2 > 4.0) {
      // Smooth coloring
      const logZn: f64 = Math.log(x2 + y2) / 2.0;
      const nu: f64 = Math.log(logZn / Math.LN2) / Math.LN2;
      return <f64>i + 1.0 - nu;
    }

    const newX: f64 = x2 - y2 + cx;
    y = 2.0 * x * y + cy;
    x = newX;
  }

  return <f64>maxIter;
}

/**
 * Mandelbrot set iteration with smooth coloring.
 */
function mandelbrotIteration(cx: f64, cy: f64, maxIter: i32): f64 {
  let x: f64 = 0.0;
  let y: f64 = 0.0;

  for (let i: i32 = 0; i < maxIter; i++) {
    const x2: f64 = x * x;
    const y2: f64 = y * y;

    if (x2 + y2 > 4.0) {
      const logZn: f64 = Math.log(x2 + y2) / 2.0;
      const nu: f64 = Math.log(logZn / Math.LN2) / Math.LN2;
      return <f64>i + 1.0 - nu;
    }

    const newX: f64 = x2 - y2 + cx;
    y = 2.0 * x * y + cy;
    x = newX;
  }

  return <f64>maxIter;
}

/**
 * Render a frame of the fractal animation.
 *
 * @param time - Animation time in seconds
 */
export function render(time: f64): void {
  const aspectRatio: f64 = <f64>width / <f64>height;
  const viewWidth: f64 = 4.0 / zoom;
  const viewHeight: f64 = viewWidth / aspectRatio;

  const minX: f64 = centerX - viewWidth / 2.0;
  const maxX: f64 = centerX + viewWidth / 2.0;
  const minY: f64 = centerY - viewHeight / 2.0;
  const maxY: f64 = centerY + viewHeight / 2.0;

  // Julia set parameters (animated)
  const angle: f64 = time * 0.5;
  const radius: f64 = 0.7885 + 0.05 * Math.sin(time * 2.0);
  const juliaCx: f64 = radius * Math.cos(angle);
  const juliaCy: f64 = radius * Math.sin(angle);

  const hueOffset: f64 = time * 0.1;

  for (let py: i32 = 0; py < height; py++) {
    const y: f64 = minY + (<f64>py / <f64>height) * (maxY - minY);

    for (let px: i32 = 0; px < width; px++) {
      const x: f64 = minX + (<f64>px / <f64>width) * (maxX - minX);

      let iterations: f64;
      if (fractalType == 0) {
        iterations = juliaIteration(x, y, juliaCx, juliaCy, maxIterations);
      } else {
        iterations = mandelbrotIteration(x, y, maxIterations);
      }

      const color: u32 = iterationToColor(iterations, maxIterations, hueOffset);

      // Write pixel to buffer (RGBA format)
      const offset: i32 = bufferPtr + (py * width + px) * 4;
      store<u32>(offset, color);
    }
  }
}

/**
 * Entry point (called on module instantiation if using --exportStart).
 */
export function _start(): void {
  // Default initialization
  init(800, 600);
}
