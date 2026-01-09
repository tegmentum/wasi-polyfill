#!/usr/bin/env python3
"""
Python Host for Fractal WebAssembly Module

This host loads the fractal.wasm module and provides a pygame display.
The same WebAssembly code runs in both browser and Python environments.

Usage:
    python host.py                    # Run with default settings
    python host.py --width 640 --height 480
"""

import argparse
import sys
import time as time_module
from pathlib import Path

try:
    import pygame
    import numpy as np
except ImportError:
    print("Required packages: pygame, numpy")
    print("Install with: pip install pygame numpy")
    sys.exit(1)

try:
    from wasmtime import Engine, Module, Store, Instance, Memory, MemoryType, Limits
except ImportError:
    print("wasmtime is required. Install with: pip install wasmtime")
    sys.exit(1)


class FractalWasm:
    """Python wrapper for the fractal WASM module."""

    def __init__(self, wasm_path: str):
        self.engine = Engine()
        self.store = Store(self.engine)

        # Load the module
        self.module = Module.from_file(self.engine, wasm_path)

        # Create memory import if needed
        memory_type = MemoryType(Limits(256, 512))
        self.memory = Memory(self.store, memory_type)

        # Instantiate with imports
        imports = []
        for imp in self.module.imports:
            if imp.type.memory_type:
                imports.append(self.memory)
            elif imp.type.func_type:
                # Provide abort function
                if imp.name == "abort":
                    def abort(msg, file, line, col):
                        print(f"WASM abort at {file}:{line}:{col}: {msg}")
                    imports.append(abort)

        self.instance = Instance(self.store, self.module, imports)

        # Get exports
        self.exports = self.instance.exports(self.store)

        # Check if memory is exported
        if "memory" in dir(self.exports):
            self.memory = self.exports.memory

        self.width = 800
        self.height = 600
        self.buffer_ptr = 16  # After header

    def init(self, width: int, height: int):
        """Initialize the renderer."""
        self.width = width
        self.height = height
        self.exports["init"](self.store, width, height)
        self.buffer_ptr = self.exports["getBufferPtr"](self.store)

    def set_fractal_type(self, fractal_type: int):
        """Set fractal type (0=Julia, 1=Mandelbrot)."""
        self.exports["setFractalType"](self.store, fractal_type)

    def set_max_iterations(self, iterations: int):
        """Set maximum iterations."""
        self.exports["setMaxIterations"](self.store, iterations)

    def set_zoom(self, zoom: float):
        """Set zoom level."""
        self.exports["setZoom"](self.store, zoom)

    def set_center(self, x: float, y: float):
        """Set center position."""
        self.exports["setCenter"](self.store, x, y)

    def render(self, time: float) -> np.ndarray:
        """Render a frame and return pixel data as numpy array."""
        # Call WASM render
        self.exports["render"](self.store, time)

        # Read pixel data from memory
        memory_data = self.memory.data_ptr(self.store)
        buffer_size = self.width * self.height * 4

        # Create numpy array from memory
        # Memory is in RGBA format
        import ctypes
        ptr = ctypes.cast(memory_data, ctypes.POINTER(ctypes.c_uint8))
        arr = np.ctypeslib.as_array(ptr, shape=(self.memory.data_len(self.store),))

        # Extract pixel data
        pixel_data = arr[self.buffer_ptr:self.buffer_ptr + buffer_size].copy()

        # Reshape to (height, width, 4) for RGBA
        return pixel_data.reshape((self.height, self.width, 4))


def run_animation(wasm_path: str, width: int = 800, height: int = 600):
    """Run the fractal animation with pygame display."""
    # Initialize pygame
    pygame.init()
    screen = pygame.display.set_mode((width, height))
    pygame.display.set_caption("Fractal WASM - Press Q to quit")
    clock = pygame.time.Clock()

    # Load WASM module
    print(f"Loading WebAssembly module: {wasm_path}")
    fractal = FractalWasm(wasm_path)
    fractal.init(width, height)

    # Pre-allocate surface array (pygame uses [x, y, rgb])
    surface_array = np.zeros((width, height, 3), dtype=np.uint8)

    # Animation state
    anim_time = 0.0
    running = True
    frame_count = 0
    fps_time = time_module.time()
    current_fps = 0
    fractal_type = 0
    zoom = 1.0
    center_x = 0.0
    center_y = 0.0

    print("Animation started. Controls:")
    print("  Q/Escape - Quit")
    print("  T - Toggle Julia/Mandelbrot")
    print("  +/- - Zoom in/out")
    print("  Arrows - Pan")
    print("  R - Reset view")

    while running:
        # Handle events
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                if event.key in (pygame.K_q, pygame.K_ESCAPE):
                    running = False
                elif event.key == pygame.K_t:
                    fractal_type = 1 - fractal_type
                    fractal.set_fractal_type(fractal_type)
                elif event.key in (pygame.K_PLUS, pygame.K_EQUALS):
                    zoom *= 1.5
                    fractal.set_zoom(zoom)
                elif event.key == pygame.K_MINUS:
                    zoom /= 1.5
                    fractal.set_zoom(zoom)
                elif event.key == pygame.K_UP:
                    center_y -= 0.1 / zoom
                    fractal.set_center(center_x, center_y)
                elif event.key == pygame.K_DOWN:
                    center_y += 0.1 / zoom
                    fractal.set_center(center_x, center_y)
                elif event.key == pygame.K_LEFT:
                    center_x -= 0.1 / zoom
                    fractal.set_center(center_x, center_y)
                elif event.key == pygame.K_RIGHT:
                    center_x += 0.1 / zoom
                    fractal.set_center(center_x, center_y)
                elif event.key == pygame.K_r:
                    zoom = 1.0
                    center_x = 0.0
                    center_y = 0.0
                    fractal.set_zoom(zoom)
                    fractal.set_center(center_x, center_y)

        # Update animation time
        delta = clock.get_time() / 1000.0
        anim_time += delta

        # Render frame from WASM
        pixels = fractal.render(anim_time)

        # Convert from [h, w, rgba] to [w, h, rgb] for pygame
        # Transpose and drop alpha channel
        surface_array[:, :, 0] = pixels[:, :, 0].T  # R
        surface_array[:, :, 1] = pixels[:, :, 1].T  # G
        surface_array[:, :, 2] = pixels[:, :, 2].T  # B

        # Blit to screen
        pygame.surfarray.blit_array(screen, surface_array)
        pygame.display.flip()

        # Update FPS counter
        frame_count += 1
        now = time_module.time()
        if now - fps_time >= 1.0:
            current_fps = frame_count
            frame_count = 0
            fps_time = now
            fractal_name = "Julia" if fractal_type == 0 else "Mandelbrot"
            pygame.display.set_caption(
                f"Fractal WASM ({fractal_name}) - {current_fps} FPS - Q to quit"
            )

        clock.tick(60)

    pygame.quit()


def main():
    parser = argparse.ArgumentParser(
        description="Run the fractal WebAssembly module with pygame display"
    )
    parser.add_argument(
        "--width", type=int, default=800,
        help="Display width (default: 800)"
    )
    parser.add_argument(
        "--height", type=int, default=600,
        help="Display height (default: 600)"
    )
    parser.add_argument(
        "--wasm", type=str, default="wasm/fractal.wasm",
        help="Path to the WebAssembly module"
    )

    args = parser.parse_args()

    wasm_path = Path(args.wasm)
    if not wasm_path.exists():
        print(f"WebAssembly file not found: {wasm_path}")
        print("\nTo build the WASM module:")
        print("  cd wasm")
        print("  npm install")
        print("  npm run build")
        sys.exit(1)

    run_animation(str(wasm_path), args.width, args.height)


if __name__ == "__main__":
    main()
