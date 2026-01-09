/**
 * Fractal WASM Loader and Animation Controller
 *
 * Loads the fractal.wasm module and provides an animation loop
 * that renders to a canvas.
 */

export class FractalWasm {
  constructor() {
    this.instance = null;
    this.memory = null;
    this.width = 800;
    this.height = 600;
    this.bufferPtr = 0;
    this.imageData = null;
  }

  /**
   * Load and instantiate the WASM module.
   */
  async load(wasmPath = './wasm/fractal.wasm') {
    const response = await fetch(wasmPath);
    const bytes = await response.arrayBuffer();

    const importObject = {
      env: {
        abort: (msg, file, line, col) => {
          console.error(`Abort at ${file}:${line}:${col}: ${msg}`);
        },
        memory: new WebAssembly.Memory({ initial: 256, maximum: 512 }),
      },
    };

    const { instance } = await WebAssembly.instantiate(bytes, importObject);
    this.instance = instance;
    this.memory = instance.exports.memory || importObject.env.memory;

    return this;
  }

  /**
   * Initialize the renderer with dimensions.
   */
  init(width, height) {
    this.width = width;
    this.height = height;

    // Call WASM init
    this.instance.exports.init(width, height);
    this.bufferPtr = this.instance.exports.getBufferPtr();

    // Create ImageData for canvas
    this.imageData = new ImageData(width, height);
  }

  /**
   * Set fractal type (0 = Julia, 1 = Mandelbrot).
   */
  setFractalType(type) {
    this.instance.exports.setFractalType(type);
  }

  /**
   * Set maximum iterations.
   */
  setMaxIterations(iterations) {
    this.instance.exports.setMaxIterations(iterations);
  }

  /**
   * Set zoom level.
   */
  setZoom(zoom) {
    this.instance.exports.setZoom(zoom);
  }

  /**
   * Set center position.
   */
  setCenter(x, y) {
    this.instance.exports.setCenter(x, y);
  }

  /**
   * Render a frame and return ImageData.
   */
  render(time) {
    // Call WASM render
    this.instance.exports.render(time);

    // Copy from WASM memory to ImageData
    const wasmMemory = new Uint8Array(this.memory.buffer);
    const pixelData = wasmMemory.slice(
      this.bufferPtr,
      this.bufferPtr + this.width * this.height * 4
    );

    this.imageData.data.set(pixelData);
    return this.imageData;
  }

  /**
   * Render directly to a canvas.
   */
  renderToCanvas(canvas, time) {
    const imageData = this.render(time);
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
  }
}

/**
 * Animation controller for the WASM fractal renderer.
 */
export class FractalAnimation {
  constructor(canvas, wasmPath = './wasm/fractal.wasm') {
    this.canvas = canvas;
    this.wasmPath = wasmPath;
    this.fractal = new FractalWasm();
    this.animationId = null;
    this.time = 0;
    this.lastTime = 0;
    this.fps = 0;
    this.frameCount = 0;
    this.lastFpsUpdate = 0;
    this.config = {
      fractalType: 0,
      zoom: 1,
      centerX: 0,
      centerY: 0,
      maxIterations: 100,
    };
  }

  /**
   * Load the WASM module and initialize.
   */
  async init() {
    await this.fractal.load(this.wasmPath);
    this.fractal.init(this.canvas.width, this.canvas.height);
    return this;
  }

  /**
   * Start the animation loop.
   */
  start() {
    if (this.animationId !== null) return;

    this.lastTime = performance.now();
    this.lastFpsUpdate = this.lastTime;
    this.frameCount = 0;

    const animate = (currentTime) => {
      const deltaTime = (currentTime - this.lastTime) / 1000;
      this.lastTime = currentTime;
      this.time += deltaTime;

      // Update FPS counter
      this.frameCount++;
      if (currentTime - this.lastFpsUpdate >= 1000) {
        this.fps = this.frameCount;
        this.frameCount = 0;
        this.lastFpsUpdate = currentTime;
      }

      // Render frame
      this.fractal.renderToCanvas(this.canvas, this.time);

      this.animationId = requestAnimationFrame(animate);
    };

    this.animationId = requestAnimationFrame(animate);
  }

  /**
   * Stop the animation loop.
   */
  stop() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * Get current FPS.
   */
  getFps() {
    return this.fps;
  }

  /**
   * Toggle between Julia and Mandelbrot.
   */
  toggleFractalType() {
    this.config.fractalType = this.config.fractalType === 0 ? 1 : 0;
    this.fractal.setFractalType(this.config.fractalType);
  }

  /**
   * Zoom in.
   */
  zoomIn(factor = 1.5) {
    this.config.zoom *= factor;
    this.fractal.setZoom(this.config.zoom);
  }

  /**
   * Zoom out.
   */
  zoomOut(factor = 1.5) {
    this.config.zoom /= factor;
    this.fractal.setZoom(this.config.zoom);
  }

  /**
   * Pan the view.
   */
  pan(dx, dy) {
    const scale = 1 / this.config.zoom;
    this.config.centerX += dx * scale;
    this.config.centerY += dy * scale;
    this.fractal.setCenter(this.config.centerX, this.config.centerY);
  }

  /**
   * Reset to default view.
   */
  reset() {
    this.config.zoom = 1;
    this.config.centerX = 0;
    this.config.centerY = 0;
    this.fractal.setZoom(this.config.zoom);
    this.fractal.setCenter(this.config.centerX, this.config.centerY);
  }

  /**
   * Get renderer config.
   */
  getRenderer() {
    return {
      getConfig: () => ({
        fractalType: this.config.fractalType === 0 ? 'julia' : 'mandelbrot',
        zoom: this.config.zoom,
      }),
      setConfig: (config) => {
        if (config.maxIterations !== undefined) {
          this.config.maxIterations = config.maxIterations;
          this.fractal.setMaxIterations(config.maxIterations);
        }
      },
    };
  }

  /**
   * Cleanup.
   */
  destroy() {
    this.stop();
  }
}

export default FractalAnimation;
