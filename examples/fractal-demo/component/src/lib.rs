//! Fractal Renderer WebAssembly Component
//!
//! This component renders animated Julia/Mandelbrot fractals using
//! the wasi:frame-buffer interface for display.

wit_bindgen::generate!({
    path: "../wit",
    world: "frame-buffer-renderer",
});

use wasi::frame_buffer::frame_buffer_interface::{
    create_buffer, FrameBuffer, FrameBufferDescriptor, PixelFormat,
};

/// Global state for the renderer
struct FractalRenderer {
    buffer: Option<FrameBuffer>,
    width: u32,
    height: u32,
    max_iterations: u32,
    fractal_type: FractalType,
    zoom: f64,
    center_x: f64,
    center_y: f64,
}

#[derive(Clone, Copy, PartialEq)]
enum FractalType {
    Julia,
    Mandelbrot,
}

static mut RENDERER: Option<FractalRenderer> = None;

impl FractalRenderer {
    fn new() -> Self {
        Self {
            buffer: None,
            width: 800,
            height: 600,
            max_iterations: 100,
            fractal_type: FractalType::Julia,
            zoom: 1.0,
            center_x: 0.0,
            center_y: 0.0,
        }
    }

    fn init(&mut self, width: u32, height: u32) {
        self.width = width;
        self.height = height;

        // Create the frame buffer
        let desc = FrameBufferDescriptor {
            width,
            height,
            format: PixelFormat::Rgba8,
        };
        self.buffer = Some(create_buffer(&desc));
    }

    fn render(&mut self, time: f64, _delta: f64) {
        let buffer = match &self.buffer {
            Some(b) => b,
            None => return,
        };

        let width = self.width;
        let height = self.height;
        let max_iter = self.max_iterations;
        let zoom = self.zoom;
        let center_x = self.center_x;
        let center_y = self.center_y;

        // Calculate view bounds
        let aspect_ratio = width as f64 / height as f64;
        let view_width = 4.0 / zoom;
        let view_height = view_width / aspect_ratio;

        let min_x = center_x - view_width / 2.0;
        let max_x = center_x + view_width / 2.0;
        let min_y = center_y - view_height / 2.0;
        let max_y = center_y + view_height / 2.0;

        // Get Julia parameters (animated)
        let (julia_cx, julia_cy) = if self.fractal_type == FractalType::Julia {
            let angle = time * 0.5;
            let radius = 0.7885 + 0.05 * (time * 2.0).sin();
            (radius * angle.cos(), radius * angle.sin())
        } else {
            (0.0, 0.0)
        };

        // Generate palette
        let palette = generate_palette(max_iter, time * 0.1);

        // Render each pixel
        for py in 0..height {
            let y = min_y + (py as f64 / height as f64) * (max_y - min_y);

            for px in 0..width {
                let x = min_x + (px as f64 / width as f64) * (max_x - min_x);

                let iterations = if self.fractal_type == FractalType::Julia {
                    julia_iteration(x, y, julia_cx, julia_cy, max_iter)
                } else {
                    mandelbrot_iteration(x, y, max_iter)
                };

                // Map iteration to color
                let (r, g, b) = if iterations >= max_iter as f64 {
                    (0, 0, 0) // Inside set = black
                } else {
                    let color_idx = (iterations as usize) % palette.len();
                    let next_idx = (color_idx + 1) % palette.len();
                    let frac = iterations - iterations.floor();

                    let c1 = palette[color_idx];
                    let c2 = palette[next_idx];

                    (
                        ((c1.0 as f64 * (1.0 - frac) + c2.0 as f64 * frac) as u8),
                        ((c1.1 as f64 * (1.0 - frac) + c2.1 as f64 * frac) as u8),
                        ((c1.2 as f64 * (1.0 - frac) + c2.2 as f64 * frac) as u8),
                    )
                };

                buffer.set_pixel(px, py, r, g, b, 255);
            }
        }

        buffer.mark_dirty();
        buffer.present();
    }
}

/// Julia set iteration with smooth coloring
fn julia_iteration(zx: f64, zy: f64, cx: f64, cy: f64, max_iter: u32) -> f64 {
    let mut x = zx;
    let mut y = zy;

    for i in 0..max_iter {
        let x2 = x * x;
        let y2 = y * y;

        if x2 + y2 > 4.0 {
            // Smooth coloring
            let log_zn = (x2 + y2).ln() / 2.0;
            let nu = (log_zn / 2.0_f64.ln()).ln() / 2.0_f64.ln();
            return i as f64 + 1.0 - nu;
        }

        let new_x = x2 - y2 + cx;
        y = 2.0 * x * y + cy;
        x = new_x;
    }

    max_iter as f64
}

/// Mandelbrot set iteration with smooth coloring
fn mandelbrot_iteration(cx: f64, cy: f64, max_iter: u32) -> f64 {
    let mut x = 0.0;
    let mut y = 0.0;

    for i in 0..max_iter {
        let x2 = x * x;
        let y2 = y * y;

        if x2 + y2 > 4.0 {
            let log_zn = (x2 + y2).ln() / 2.0;
            let nu = (log_zn / 2.0_f64.ln()).ln() / 2.0_f64.ln();
            return i as f64 + 1.0 - nu;
        }

        let new_x = x2 - y2 + cx;
        y = 2.0 * x * y + cy;
        x = new_x;
    }

    max_iter as f64
}

/// HSL to RGB conversion
fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (u8, u8, u8) {
    let h = h % 1.0;
    let h = if h < 0.0 { h + 1.0 } else { h };

    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let x = c * (1.0 - ((h * 6.0) % 2.0 - 1.0).abs());
    let m = l - c / 2.0;

    let (r, g, b) = if h < 1.0 / 6.0 {
        (c, x, 0.0)
    } else if h < 2.0 / 6.0 {
        (x, c, 0.0)
    } else if h < 3.0 / 6.0 {
        (0.0, c, x)
    } else if h < 4.0 / 6.0 {
        (0.0, x, c)
    } else if h < 5.0 / 6.0 {
        (x, 0.0, c)
    } else {
        (c, 0.0, x)
    };

    (
        ((r + m) * 255.0) as u8,
        ((g + m) * 255.0) as u8,
        ((b + m) * 255.0) as u8,
    )
}

/// Generate a color palette
fn generate_palette(size: u32, hue_offset: f64) -> Vec<(u8, u8, u8)> {
    let mut palette = Vec::with_capacity(size as usize);

    for i in 0..size {
        let t = i as f64 / size as f64;
        let hue = (t * 0.8 + hue_offset) % 1.0;
        let saturation = 0.8;
        let lightness = 0.5 + 0.3 * (t * std::f64::consts::PI * 2.0).sin();
        palette.push(hsl_to_rgb(hue, saturation, lightness));
    }

    palette
}

// Export the component interface
struct Component;

impl Guest for Component {
    fn init(width: u32, height: u32) {
        unsafe {
            if RENDERER.is_none() {
                RENDERER = Some(FractalRenderer::new());
            }
            if let Some(renderer) = &mut RENDERER {
                renderer.init(width, height);
            }
        }
    }

    fn render(time: f64, delta: f64) {
        unsafe {
            if let Some(renderer) = &mut RENDERER {
                renderer.render(time, delta);
            }
        }
    }
}

export!(Component);
