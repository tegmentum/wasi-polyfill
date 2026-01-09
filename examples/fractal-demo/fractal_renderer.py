#!/usr/bin/env python3
"""
Animated Fractal Renderer

A Python implementation of the Julia/Mandelbrot fractal renderer
that generates animated frames as PNG images or GIF animations.

This demonstrates the same fractal algorithm used in the wasi:frame-buffer
JavaScript implementation, but in pure Python with PIL for image output.

Usage:
    python fractal_renderer.py --live           # Live animated display
    python fractal_renderer.py --show           # Generate and display single frame
    python fractal_renderer.py --animation --show  # Generate and display animation GIF
    python fractal_renderer.py --frames 60      # Generate 60 PNG frames
"""

import argparse
import math
import os
import sys
import time as time_module
from typing import Tuple, List, Optional

try:
    from PIL import Image
except ImportError:
    print("PIL/Pillow is required. Install with: pip install Pillow")
    sys.exit(1)

try:
    import pygame
    HAS_PYGAME = True
except ImportError:
    HAS_PYGAME = False

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False


# =============================================================================
# Color Palette
# =============================================================================

def hsl_to_rgb(h: float, s: float, l: float) -> Tuple[int, int, int]:
    """Convert HSL to RGB color."""
    h = h % 1.0
    if h < 0:
        h += 1.0

    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs((h * 6) % 2 - 1))
    m = l - c / 2

    if h < 1/6:
        r, g, b = c, x, 0
    elif h < 2/6:
        r, g, b = x, c, 0
    elif h < 3/6:
        r, g, b = 0, c, x
    elif h < 4/6:
        r, g, b = 0, x, c
    elif h < 5/6:
        r, g, b = x, 0, c
    else:
        r, g, b = c, 0, x

    return (
        int((r + m) * 255),
        int((g + m) * 255),
        int((b + m) * 255)
    )


def generate_palette(size: int, hue_offset: float) -> List[Tuple[int, int, int]]:
    """Generate a color palette for the fractal."""
    palette = []
    for i in range(size):
        t = i / size
        hue = (t * 0.8 + hue_offset) % 1.0
        saturation = 0.8
        lightness = 0.5 + 0.3 * math.sin(t * math.pi * 2)
        palette.append(hsl_to_rgb(hue, saturation, lightness))
    # Black for points inside the set
    palette.append((0, 0, 0))
    return palette


# =============================================================================
# Fractal Computation
# =============================================================================

def julia_iteration(zx: float, zy: float, cx: float, cy: float, max_iter: int) -> float:
    """Compute Julia set iteration count for a point."""
    x, y = zx, zy

    for i in range(max_iter):
        x2, y2 = x * x, y * y

        if x2 + y2 > 4:
            # Smooth coloring
            log_zn = math.log(x2 + y2) / 2
            nu = math.log(log_zn / math.log(2)) / math.log(2)
            return i + 1 - nu

        x, y = x2 - y2 + cx, 2 * x * y + cy

    return max_iter


def mandelbrot_iteration(cx: float, cy: float, max_iter: int) -> float:
    """Compute Mandelbrot set iteration count for a point."""
    x, y = 0.0, 0.0

    for i in range(max_iter):
        x2, y2 = x * x, y * y

        if x2 + y2 > 4:
            log_zn = math.log(x2 + y2) / 2
            nu = math.log(log_zn / math.log(2)) / math.log(2)
            return i + 1 - nu

        x, y = x2 - y2 + cx, 2 * x * y + cy

    return max_iter


# =============================================================================
# Fractal Renderer
# =============================================================================

class FractalRenderer:
    """Renders Julia or Mandelbrot fractals."""

    def __init__(
        self,
        width: int = 800,
        height: int = 600,
        max_iterations: int = 100,
        fractal_type: str = "julia",
        zoom: float = 1.0,
        center_x: float = 0.0,
        center_y: float = 0.0
    ):
        self.width = width
        self.height = height
        self.max_iterations = max_iterations
        self.fractal_type = fractal_type
        self.zoom = zoom
        self.center_x = center_x
        self.center_y = center_y

    def get_julia_params(self, t: float) -> Tuple[float, float]:
        """Get animated Julia set parameters."""
        angle = t * 0.5
        radius = 0.7885 + 0.05 * math.sin(t * 2)
        return radius * math.cos(angle), radius * math.sin(angle)

    def render(self, time: float = 0.0) -> Image.Image:
        """Render a single frame."""
        # Create image
        image = Image.new("RGB", (self.width, self.height))
        pixels = image.load()

        # Generate palette
        palette = generate_palette(self.max_iterations, time * 0.1)

        # Calculate view bounds
        aspect_ratio = self.width / self.height
        view_width = 4 / self.zoom
        view_height = view_width / aspect_ratio

        min_x = self.center_x - view_width / 2
        max_x = self.center_x + view_width / 2
        min_y = self.center_y - view_height / 2
        max_y = self.center_y + view_height / 2

        # Get Julia parameters
        julia_cx, julia_cy = self.get_julia_params(time)

        # Render pixels
        for py in range(self.height):
            y = min_y + (py / self.height) * (max_y - min_y)

            for px in range(self.width):
                x = min_x + (px / self.width) * (max_x - min_x)

                if self.fractal_type == "julia":
                    iterations = julia_iteration(x, y, julia_cx, julia_cy, self.max_iterations)
                else:
                    iterations = mandelbrot_iteration(x, y, self.max_iterations)

                # Map iteration to color
                if iterations >= self.max_iterations:
                    color = palette[-1]  # Black for inside
                else:
                    color_idx = int(iterations) % (len(palette) - 1)
                    next_idx = (color_idx + 1) % (len(palette) - 1)
                    frac = iterations - int(iterations)

                    # Interpolate colors
                    c1, c2 = palette[color_idx], palette[next_idx]
                    color = (
                        int(c1[0] * (1 - frac) + c2[0] * frac),
                        int(c1[1] * (1 - frac) + c2[1] * frac),
                        int(c1[2] * (1 - frac) + c2[2] * frac)
                    )

                pixels[px, py] = color

            # Progress indicator
            if py % 50 == 0:
                print(f"  Rendering: {py * 100 // self.height}%", end="\r")

        print("  Rendering: 100%")
        return image


def create_animation(
    renderer: FractalRenderer,
    frames: int = 60,
    duration: float = 4.0,
    output_path: str = "fractal_animation.gif"
) -> None:
    """Create an animated GIF."""
    images = []
    frame_duration = duration / frames

    print(f"Generating {frames} frames...")
    for i in range(frames):
        time = i * frame_duration
        print(f"\nFrame {i + 1}/{frames} (t={time:.2f})")
        image = renderer.render(time)
        images.append(image)

    print(f"\nSaving animation to {output_path}...")
    # Save as GIF
    images[0].save(
        output_path,
        save_all=True,
        append_images=images[1:],
        duration=int(frame_duration * 1000),
        loop=0
    )
    print(f"Animation saved to {output_path}")


def create_frames(
    renderer: FractalRenderer,
    frames: int = 60,
    duration: float = 4.0,
    output_dir: str = "frames"
) -> None:
    """Create individual PNG frames."""
    os.makedirs(output_dir, exist_ok=True)
    frame_duration = duration / frames

    print(f"Generating {frames} frames to {output_dir}/...")
    for i in range(frames):
        time = i * frame_duration
        print(f"\nFrame {i + 1}/{frames} (t={time:.2f})")
        image = renderer.render(time)

        output_path = os.path.join(output_dir, f"frame_{i:04d}.png")
        image.save(output_path)
        print(f"  Saved to {output_path}")

    print(f"\n{frames} frames saved to {output_dir}/")


def run_live_animation(renderer: FractalRenderer) -> None:
    """Run a live animated display using pygame with direct buffer writes."""
    if not HAS_PYGAME:
        print("pygame is required for live animation. Install with: pip install pygame")
        sys.exit(1)

    if not HAS_NUMPY:
        print("numpy is required for fast rendering. Install with: pip install numpy")
        sys.exit(1)

    pygame.init()
    screen = pygame.display.set_mode((renderer.width, renderer.height))
    pygame.display.set_caption("Animated Fractal - Press Q or Escape to quit")
    clock = pygame.time.Clock()

    # Pre-allocate pixel buffer (RGB format for pygame)
    pixel_buffer = np.zeros((renderer.width, renderer.height, 3), dtype=np.uint8)

    anim_time = 0.0
    running = True
    frame_count = 0
    fps_time = time_module.time()
    current_fps = 0

    print("Live animation started. Press Q or Escape to quit.")
    print("Controls: T=toggle fractal, +/-=zoom, arrows=pan, R=reset")

    while running:
        # Handle events
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                if event.key in (pygame.K_q, pygame.K_ESCAPE):
                    running = False
                elif event.key == pygame.K_t:
                    renderer.fractal_type = 'mandelbrot' if renderer.fractal_type == 'julia' else 'julia'
                elif event.key in (pygame.K_PLUS, pygame.K_EQUALS):
                    renderer.zoom *= 1.5
                elif event.key == pygame.K_MINUS:
                    renderer.zoom /= 1.5
                elif event.key == pygame.K_UP:
                    renderer.center_y -= 0.1 / renderer.zoom
                elif event.key == pygame.K_DOWN:
                    renderer.center_y += 0.1 / renderer.zoom
                elif event.key == pygame.K_LEFT:
                    renderer.center_x -= 0.1 / renderer.zoom
                elif event.key == pygame.K_RIGHT:
                    renderer.center_x += 0.1 / renderer.zoom
                elif event.key == pygame.K_r:
                    renderer.zoom = 1.0
                    renderer.center_x = 0.0
                    renderer.center_y = 0.0

        # Get delta time
        delta = clock.get_time() / 1000.0
        anim_time += delta

        # Render directly to buffer using numpy
        render_to_buffer(renderer, pixel_buffer, anim_time)

        # Blit buffer to screen (transpose for pygame's x,y order)
        pygame.surfarray.blit_array(screen, pixel_buffer)
        pygame.display.flip()

        # Update FPS counter
        frame_count += 1
        now = time_module.time()
        if now - fps_time >= 1.0:
            current_fps = frame_count
            frame_count = 0
            fps_time = now
            fractal_name = "Julia" if renderer.fractal_type == "julia" else "Mandelbrot"
            pygame.display.set_caption(f"Animated Fractal ({fractal_name}) - {current_fps} FPS - Q to quit")

        clock.tick(60)  # Cap at 60 FPS

    pygame.quit()


def render_to_buffer(renderer: FractalRenderer, buffer: 'np.ndarray', anim_time: float) -> None:
    """Render fractal directly to numpy buffer using vectorized operations."""
    width = renderer.width
    height = renderer.height
    max_iter = renderer.max_iterations
    zoom = renderer.zoom
    center_x = renderer.center_x
    center_y = renderer.center_y
    fractal_type = renderer.fractal_type

    # Calculate view bounds
    aspect_ratio = width / height
    view_width = 4 / zoom
    view_height = view_width / aspect_ratio

    min_x = center_x - view_width / 2
    max_x = center_x + view_width / 2
    min_y = center_y - view_height / 2
    max_y = center_y + view_height / 2

    # Create coordinate grids (transposed for pygame's [x,y] format)
    x_coords = np.linspace(min_x, max_x, width).reshape(width, 1)
    y_coords = np.linspace(min_y, max_y, height).reshape(1, height)

    # Broadcast to full grid
    x_grid = np.broadcast_to(x_coords, (width, height))
    y_grid = np.broadcast_to(y_coords, (width, height))

    # Get Julia parameters
    if fractal_type == 'julia':
        angle = anim_time * 0.5
        radius = 0.7885 + 0.05 * math.sin(anim_time * 2)
        julia_cx = radius * math.cos(angle)
        julia_cy = radius * math.sin(angle)
        iterations = julia_vectorized(x_grid, y_grid, julia_cx, julia_cy, max_iter)
    else:
        iterations = mandelbrot_vectorized(x_grid, y_grid, max_iter)

    # Generate palette as numpy array
    palette = generate_palette_numpy(max_iter, anim_time * 0.1)

    # Map iterations to colors with smooth interpolation
    iterations_floor = np.floor(iterations).astype(np.int32)
    frac = (iterations - iterations_floor).reshape(width, height, 1)

    # Handle inside set (iterations >= max_iter)
    inside_mask = iterations >= max_iter
    iterations_floor = np.clip(iterations_floor, 0, max_iter - 1)

    # Get color indices
    color_idx = iterations_floor % (max_iter)
    next_idx = (color_idx + 1) % (max_iter)

    # Interpolate colors
    c1 = palette[color_idx]
    c2 = palette[next_idx]
    colors = (c1 * (1 - frac) + c2 * frac).astype(np.uint8)

    # Set inside pixels to black
    colors[inside_mask] = [0, 0, 0]

    buffer[:, :, :] = colors


def julia_vectorized(zx: 'np.ndarray', zy: 'np.ndarray', cx: float, cy: float, max_iter: int) -> 'np.ndarray':
    """Vectorized Julia set computation."""
    x = zx.copy()
    y = zy.copy()
    iterations = np.zeros_like(x, dtype=np.float64)
    mask = np.ones_like(x, dtype=bool)

    for i in range(max_iter):
        x2 = x * x
        y2 = y * y
        mag2 = x2 + y2

        # Find escaped points
        escaped = mask & (mag2 > 4)
        if np.any(escaped):
            # Smooth coloring
            log_zn = np.log(mag2[escaped]) / 2
            nu = np.log(log_zn / np.log(2)) / np.log(2)
            iterations[escaped] = i + 1 - nu
            mask[escaped] = False

        if not np.any(mask):
            break

        # Update only non-escaped points
        new_x = x2 - y2 + cx
        y = 2 * x * y + cy
        x = new_x

    # Points that never escaped
    iterations[mask] = max_iter
    return iterations


def mandelbrot_vectorized(cx: 'np.ndarray', cy: 'np.ndarray', max_iter: int) -> 'np.ndarray':
    """Vectorized Mandelbrot set computation."""
    x = np.zeros_like(cx, dtype=np.float64)
    y = np.zeros_like(cy, dtype=np.float64)
    iterations = np.zeros_like(cx, dtype=np.float64)
    mask = np.ones_like(cx, dtype=bool)

    for i in range(max_iter):
        x2 = x * x
        y2 = y * y
        mag2 = x2 + y2

        # Find escaped points
        escaped = mask & (mag2 > 4)
        if np.any(escaped):
            log_zn = np.log(mag2[escaped]) / 2
            nu = np.log(log_zn / np.log(2)) / np.log(2)
            iterations[escaped] = i + 1 - nu
            mask[escaped] = False

        if not np.any(mask):
            break

        new_x = x2 - y2 + cx
        y = 2 * x * y + cy
        x = new_x

    iterations[mask] = max_iter
    return iterations


def generate_palette_numpy(size: int, hue_offset: float) -> 'np.ndarray':
    """Generate color palette as numpy array."""
    palette = np.zeros((size + 1, 3), dtype=np.float64)

    for i in range(size):
        t = i / size
        hue = (t * 0.8 + hue_offset) % 1.0
        saturation = 0.8
        lightness = 0.5 + 0.3 * math.sin(t * math.pi * 2)
        r, g, b = hsl_to_rgb(hue, saturation, lightness)
        palette[i] = [r, g, b]

    # Last entry is black for inside set
    palette[size] = [0, 0, 0]
    return palette


def main():
    parser = argparse.ArgumentParser(
        description="Generate animated fractal images using the same algorithm as wasi:frame-buffer demo"
    )
    parser.add_argument(
        "--width", type=int, default=800,
        help="Image width (default: 800)"
    )
    parser.add_argument(
        "--height", type=int, default=600,
        help="Image height (default: 600)"
    )
    parser.add_argument(
        "--iterations", type=int, default=100,
        help="Maximum iterations (default: 100)"
    )
    parser.add_argument(
        "--type", choices=["julia", "mandelbrot"], default="julia",
        help="Fractal type (default: julia)"
    )
    parser.add_argument(
        "--zoom", type=float, default=1.0,
        help="Zoom level (default: 1.0)"
    )
    parser.add_argument(
        "--animation", action="store_true",
        help="Generate animated GIF"
    )
    parser.add_argument(
        "--frames", type=int, default=0,
        help="Generate N individual PNG frames"
    )
    parser.add_argument(
        "--duration", type=float, default=4.0,
        help="Animation duration in seconds (default: 4.0)"
    )
    parser.add_argument(
        "--output", type=str, default=None,
        help="Output file/directory path"
    )
    parser.add_argument(
        "--time", type=float, default=0.0,
        help="Time value for single frame (default: 0.0)"
    )
    parser.add_argument(
        "--show", action="store_true",
        help="Display the result after generation"
    )
    parser.add_argument(
        "--live", action="store_true",
        help="Run live animated display in a window"
    )

    args = parser.parse_args()

    # Create renderer
    renderer = FractalRenderer(
        width=args.width,
        height=args.height,
        max_iterations=args.iterations,
        fractal_type=args.type,
        zoom=args.zoom
    )

    if args.live:
        # Run live animation
        run_live_animation(renderer)

    elif args.animation:
        # Generate animated GIF
        output = args.output or "fractal_animation.gif"
        frame_count = args.frames if args.frames > 0 else 60
        create_animation(renderer, frame_count, args.duration, output)
        if args.show:
            Image.open(output).show()

    elif args.frames > 0:
        # Generate individual frames
        output_dir = args.output or "frames"
        create_frames(renderer, args.frames, args.duration, output_dir)
        if args.show:
            # Show first frame
            first_frame = os.path.join(output_dir, "frame_0000.png")
            if os.path.exists(first_frame):
                Image.open(first_frame).show()

    else:
        # Generate single frame
        output = args.output or f"fractal_{args.type}.png"
        print(f"Generating single frame (t={args.time})...")
        image = renderer.render(args.time)
        image.save(output)
        print(f"Saved to {output}")
        if args.show:
            image.show()


if __name__ == "__main__":
    main()
