# Fractal Demo - WebAssembly Component

This demo showcases the **same WebAssembly code** running in two different environments:
- **Browser**: Using JavaScript with canvas-based display
- **Python**: Using wasmtime-py with pygame-based display

The fractal computation is done entirely in WebAssembly. Each host reads the pixel buffer from WASM memory and displays it using platform-native graphics.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                Fractal Module (WebAssembly)                 │
│  - Julia/Mandelbrot computation                             │
│  - Writes pixels to shared memory buffer                    │
│  - Exports: init(), render(), setZoom(), setCenter(), etc   │
└─────────────────────────────────────────────────────────────┘
                            │
                   shared memory buffer
                            │
        ┌───────────────────┴───────────────────┐
        ▼                                       ▼
┌───────────────────┐                 ┌───────────────────┐
│   Browser Host    │                 │   Python Host     │
│  (JS + Canvas)    │                 │ (wasmtime + pygame)│
│  index.html       │                 │  host.py          │
└───────────────────┘                 └───────────────────┘
```

## Quick Start

### 1. Build the WebAssembly Module

```bash
cd wasm
npm install
npm run build
```

This compiles `fractal.ts` (AssemblyScript) to `fractal.wasm`.

### 2. Run in Browser

```bash
# From examples/fractal-demo directory
python -m http.server 8080
```

Open http://localhost:8080

### 3. Run in Python

```bash
# Install dependencies
pip install pygame numpy wasmtime

# Run
python host.py
```

## Controls

Both browser and Python hosts support the same controls:

| Key | Action |
|-----|--------|
| Q / Escape | Quit |
| T | Toggle Julia/Mandelbrot |
| + / = | Zoom in |
| - | Zoom out |
| Arrow keys | Pan |
| R | Reset view |
| Space | Pause/Resume (browser only) |

Browser also supports:
- Mouse drag to pan
- Scroll wheel to zoom

## Files

```
examples/fractal-demo/
├── wasm/
│   ├── fractal.ts        # AssemblyScript fractal implementation
│   ├── package.json      # Build configuration
│   └── fractal.wasm      # Compiled WebAssembly (after build)
├── host.py               # Python host using wasmtime + pygame
├── index.html            # Browser demo page
├── fractal-wasm.js       # Browser WASM loader
├── fractal-renderer.js   # Pure JS fallback renderer
└── README.md
```

## How It Works

### WebAssembly Module

The `fractal.wasm` module exports:
- `init(width, height)` - Initialize with dimensions
- `render(time)` - Render a frame at given animation time
- `getBufferPtr()` - Get pointer to pixel buffer in memory
- `setFractalType(type)` - 0=Julia, 1=Mandelbrot
- `setZoom(zoom)` - Set zoom level
- `setCenter(x, y)` - Set view center

The pixel buffer is stored in linear memory as RGBA8 format (4 bytes per pixel).

### Browser Host

1. Loads `fractal.wasm` using WebAssembly API
2. Calls `init()` and `render()` in animation loop
3. Reads pixel buffer from WASM memory
4. Copies to canvas using `putImageData()`

### Python Host

1. Loads `fractal.wasm` using wasmtime
2. Calls `init()` and `render()` in pygame loop
3. Reads pixel buffer from WASM memory using ctypes
4. Displays using `pygame.surfarray.blit_array()`

## Fallback Mode

If the WASM module isn't available, the browser demo falls back to a pure JavaScript implementation (`fractal-renderer.js`) with the same functionality.

## Building from Source

### Prerequisites

- Node.js 18+ (for AssemblyScript)
- Python 3.11+ (for Python host)
- Rust with wasm32-wasip1 target (optional, for component model version)

### AssemblyScript Build

```bash
cd wasm
npm install
npm run build
```

### Optional: Rust Component Model Version

For the full wasi:frame-buffer component model approach:

```bash
cd component
rustup target add wasm32-wasip1
cargo build --release --target wasm32-wasip1
```

## Performance Notes

- The WASM module runs at ~10-30 FPS depending on resolution and iteration count
- Lower `maxIterations` for better performance
- Use smaller window sizes for smoother animation
- The Python host may be slightly slower due to memory copy overhead
