//! Vector text: fonts, layout and a glyph atlas.
//!
//! Text is laid out and rasterised in *physical pixels* (the logical size times the screen's
//! scale), so letters land on whole pixels and stay crisp at any resolution. Glyphs are
//! rasterised once per (font, character, pixel size) into one coverage atlas that the host
//! uploads when it changes; drawing is then one textured quad per letter.
//!
//! Built-in fonts (all SIL Open Font License, see `licenses/fonts/`): `sans` (Inter), `rounded`
//! (Fredoka), `pixel` (Press Start 2P), `terminal` (VT323), `mono` (JetBrains Mono), `serif`
//! (Lora), `comic` (Bangers), `display` (Cinzel), `script` (Pacifico). Projects add their own
//! TTF/OTF files.

use std::collections::HashMap;

use fontdue::{Font, FontSettings};

use crate::gfx::SpriteInstance;

pub const ATLAS_SIZE: u32 = 2048;
pub const DEFAULT_FONT: &str = "sans";
const MAX_TEXT_CHARS: usize = 20_000;

pub const BUILTIN: [(&str, &[u8]); 9] = [
    ("sans", include_bytes!("../assets/fonts/Inter.ttf")),
    ("rounded", include_bytes!("../assets/fonts/Fredoka.ttf")),
    ("pixel", include_bytes!("../assets/fonts/PressStart2P.ttf")),
    ("terminal", include_bytes!("../assets/fonts/VT323.ttf")),
    ("mono", include_bytes!("../assets/fonts/JetBrainsMono.ttf")),
    ("serif", include_bytes!("../assets/fonts/Lora.ttf")),
    ("comic", include_bytes!("../assets/fonts/Bangers.ttf")),
    ("display", include_bytes!("../assets/fonts/Cinzel.ttf")),
    ("script", include_bytes!("../assets/fonts/Pacifico.ttf")),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Align {
    Left,
    Center,
    Right,
}

#[derive(Clone, Copy, Debug)]
struct Glyph {
    /// Atlas rectangle in pixels (zero size for blank glyphs like spaces).
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    /// Offsets from the pen position / baseline, as fontdue reports them.
    xmin: i32,
    ymin: i32,
}

/// One laid-out line: glyphs with their pen x offsets, in physical pixels.
#[derive(Debug, Clone)]
pub struct Line {
    pub glyphs: Vec<(char, f32)>,
    pub width: f32,
}

#[derive(Debug, Clone)]
pub struct Layout {
    pub lines: Vec<Line>,
    pub width: f32,
    pub height: f32,
    pub ascent: f32,
    pub line_height: f32,
}

pub struct TextEngine {
    fonts: Vec<Font>,
    names: HashMap<String, usize>,
    /// (font, character, pixel size in quarters, growth in quarter pixels)
    glyphs: HashMap<(usize, char, u16, u16), Glyph>,
    atlas: Vec<u8>,
    dirty: bool,
    shelf: (u32, u32, u32), // x, y, row height
    full_warning_given: bool,
}

impl TextEngine {
    pub fn new() -> Result<Self, String> {
        let mut engine = TextEngine {
            fonts: Vec::new(),
            names: HashMap::new(),
            glyphs: HashMap::new(),
            atlas: vec![0; (ATLAS_SIZE * ATLAS_SIZE) as usize],
            dirty: true,
            shelf: (1, 1, 0),
            full_warning_given: false,
        };
        for (name, bytes) in BUILTIN {
            engine.add_font(name, bytes)?;
        }
        Ok(engine)
    }

    pub fn add_font(&mut self, name: &str, bytes: &[u8]) -> Result<(), String> {
        let font = Font::from_bytes(bytes, FontSettings::default())
            .map_err(|e| format!("not a usable font: {e}"))?;
        self.fonts.push(font);
        self.names.insert(name.to_string(), self.fonts.len() - 1);
        Ok(())
    }

    pub fn font_names(&self) -> Vec<&str> {
        let mut names: Vec<&str> = self.names.keys().map(String::as_str).collect();
        names.sort_unstable();
        names
    }

    /// A font by name: a built-in name (`pixel`), or the id a project font was added under.
    pub fn resolve(&self, name: &str) -> Option<usize> {
        self.names
            .get(name)
            .or_else(|| self.names.get(&format!("fonts/{name}.ttf")))
            .or_else(|| self.names.get(&format!("fonts/{name}.otf")))
            .copied()
    }

    /// The atlas bytes (`ATLAS_SIZE` squared, one coverage byte per pixel) when it changed
    /// since the last call, for the host to upload.
    pub fn take_atlas_if_dirty(&mut self) -> Option<&[u8]> {
        if std::mem::take(&mut self.dirty) {
            Some(&self.atlas)
        } else {
            None
        }
    }

    /// Whether a font has a picture for every character of `text` (a character a font lacks is drawn as a box, or as nothing).
    pub fn supports(&self, font: usize, text: &str) -> bool {
        let f = &self.fonts[font];
        text.chars()
            .all(|c| c.is_whitespace() || f.lookup_glyph_index(c) != 0)
    }

    /// Lays text out at `px` pixels tall. `wrap` is a width in pixels to break lines at.
    pub fn layout(&self, font: usize, text: &str, px: f32, wrap: Option<f32>) -> Layout {
        let f = &self.fonts[font];
        let metrics = f.horizontal_line_metrics(px);
        let (ascent, line_height) = match metrics {
            Some(m) => (m.ascent, m.new_line_size),
            None => (px * 0.8, px * 1.2),
        };
        let text: String = text.chars().take(MAX_TEXT_CHARS).collect();
        let mut lines: Vec<Line> = Vec::new();
        let mut current = Line {
            glyphs: Vec::new(),
            width: 0.0,
        };
        let mut previous: Option<char> = None;
        // Where the current word began, so it can move whole to the next line.
        let mut word_start: Option<usize> = None;

        let advance = |ch: char, prev: Option<char>| -> f32 {
            let kern = prev
                .and_then(|p| f.horizontal_kern(p, ch, px))
                .unwrap_or(0.0);
            kern + f.metrics(ch, px).advance_width
        };

        for ch in text.chars() {
            if ch == '\n' {
                lines.push(std::mem::replace(
                    &mut current,
                    Line {
                        glyphs: Vec::new(),
                        width: 0.0,
                    },
                ));
                previous = None;
                word_start = None;
                continue;
            }
            if ch == '\r' {
                continue;
            }
            let step = advance(ch, previous);
            if let Some(limit) = wrap
                && !ch.is_whitespace()
                && current.width + step > limit
                && !current.glyphs.is_empty()
            {
                // Break before this word if it started on this line, else mid-word.
                match word_start {
                    Some(start) if start > 0 => {
                        let carried: Vec<(char, f32)> = current.glyphs.split_off(start);
                        let shift = carried.first().map_or(0.0, |g| g.1);
                        current.width = shift;
                        // Trim the trailing space the word was separated by.
                        while current.glyphs.last().is_some_and(|g| g.0 == ' ') {
                            current.glyphs.pop();
                        }
                        current.width = current
                            .glyphs
                            .last()
                            .map_or(0.0, |g| g.1 + f.metrics(g.0, px).advance_width);
                        lines.push(std::mem::replace(
                            &mut current,
                            Line {
                                glyphs: Vec::new(),
                                width: 0.0,
                            },
                        ));
                        let mut x = 0.0;
                        let mut prev: Option<char> = None;
                        for (c, _) in carried {
                            x += prev
                                .and_then(|p| f.horizontal_kern(p, c, px))
                                .unwrap_or(0.0);
                            current.glyphs.push((c, x));
                            x += f.metrics(c, px).advance_width;
                            prev = Some(c);
                        }
                        current.width = x;
                        word_start = Some(0);
                    }
                    _ => {
                        lines.push(std::mem::replace(
                            &mut current,
                            Line {
                                glyphs: Vec::new(),
                                width: 0.0,
                            },
                        ));
                        previous = None;
                        word_start = None;
                    }
                }
            }
            if ch.is_whitespace() {
                word_start = None;
            } else if word_start.is_none() {
                word_start = Some(current.glyphs.len());
            }
            let kerned = advance(ch, previous);
            let pen = current.width + (kerned - f.metrics(ch, px).advance_width);
            current.glyphs.push((ch, pen));
            current.width += kerned;
            previous = Some(ch);
        }
        lines.push(current);
        // A trailing space does not count towards a line's width.
        for line in &mut lines {
            while line.glyphs.last().is_some_and(|g| g.0 == ' ') && line.glyphs.len() > 1 {
                let (c, _) = line.glyphs.pop().expect("checked non-empty");
                line.width -= f.metrics(c, px).advance_width;
            }
        }
        let width = lines.iter().map(|l| l.width).fold(0.0, f32::max);
        let height = lines.len() as f32 * line_height;
        Layout {
            lines,
            width,
            height,
            ascent,
            line_height,
        }
    }

    /// A glyph's coverage, grown outward by `grow` physical pixels when `grow` > 0 (bold letters, and the band behind them that an
    /// outline is): each pixel takes the strongest coverage within that distance, faded over the last pixel so the edge stays smooth.
    fn glyph(&mut self, font: usize, ch: char, px: f32, grow: f32) -> Glyph {
        let grow_q = (grow.clamp(0.0, 64.0) * 4.0).round() as u16;
        let key = (font, ch, (px * 4.0).round() as u16, grow_q);
        if let Some(g) = self.glyphs.get(&key) {
            return *g;
        }
        let (m, mut bitmap) = self.fonts[font].rasterize(ch, px);
        let (mut w, mut h) = (m.width as u32, m.height as u32);
        let (mut xmin, mut ymin) = (m.xmin, m.ymin);
        if grow_q > 0 && w > 0 && h > 0 {
            let r = grow_q as f32 / 4.0;
            let pad = r.ceil() as i32;
            let (ow, oh) = (w as i32 + 2 * pad, h as i32 + 2 * pad);
            // the distance from every pixel to the nearest one at least half covered (an exact Euclidean distance transform, so the cost
            // does not grow with the width), then coverage that falls off over one pixel at `r` beyond the letter's edge
            let (uw, uh) = (ow as usize, oh as usize);
            let mut grid = vec![f32::INFINITY; uw * uh];
            for y in 0..h as usize {
                for x in 0..w as usize {
                    if bitmap[y * w as usize + x] >= 128 {
                        grid[(y + pad as usize) * uw + x + pad as usize] = 0.0;
                    }
                }
            }
            distance_transform(&mut grid, uw, uh);
            let mut out = vec![0u8; uw * uh];
            for y in 0..uh {
                for x in 0..uw {
                    let d = grid[y * uw + x].sqrt();
                    let grown = (r + 1.0 - d).clamp(0.0, 1.0) * 255.0;
                    let (sx, sy) = (x as i32 - pad, y as i32 - pad);
                    let own = if sx >= 0 && sy >= 0 && sx < w as i32 && sy < h as i32 {
                        bitmap[(sy * w as i32 + sx) as usize] as f32
                    } else {
                        0.0
                    };
                    out[y * uw + x] = grown.max(own) as u8;
                }
            }
            bitmap = out;
            (w, h) = (ow as u32, oh as u32);
            xmin -= pad;
            ymin -= pad;
        }
        let mut glyph = Glyph {
            x: 0,
            y: 0,
            w,
            h,
            xmin,
            ymin,
        };
        if w > 0 && h > 0 {
            let (mut x, mut y, mut row) = self.shelf;
            if x + w + 1 > ATLAS_SIZE {
                x = 1;
                y += row + 1;
                row = 0;
            }
            if y + h + 1 > ATLAS_SIZE {
                // Out of room: start over. Glyphs drawn earlier this frame keep their old
                // rectangles for one frame, which is acceptable for a rare event.
                if !self.full_warning_given {
                    log::warn!("the glyph atlas was full and was cleared; use fewer font sizes");
                    self.full_warning_given = true;
                }
                self.glyphs.clear();
                self.atlas.fill(0);
                (x, y, row) = (1, 1, 0);
            }
            for r in 0..h {
                let dst = ((y + r) * ATLAS_SIZE + x) as usize;
                self.atlas[dst..dst + w as usize]
                    .copy_from_slice(&bitmap[(r * w) as usize..((r + 1) * w) as usize]);
            }
            glyph.x = x;
            glyph.y = y;
            self.shelf = (x + w + 1, y, row.max(h));
            self.dirty = true;
        }
        self.glyphs.insert(key, glyph);
        glyph
    }

    /// Appends one quad per visible letter. `origin` is the text block's top-left in logical
    /// units, `scale` is physical pixels per logical unit, `box_width` (physical px) is what
    /// `align` aligns within (the widest line when None). `grow` (physical pixels) thickens the letters (see `glyph`).
    #[allow(clippy::too_many_arguments)]
    pub fn draw(
        &mut self,
        out: &mut Vec<SpriteInstance>,
        font: usize,
        layout: &Layout,
        px: f32,
        origin: (f32, f32),
        scale: f32,
        color: [u8; 4],
        align: Align,
        box_width: Option<f32>,
        grow: f32,
    ) {
        let block = box_width.unwrap_or(layout.width);
        let atlas = ATLAS_SIZE as f32;
        // Whole physical pixels keep every letter sharp.
        let origin_px = ((origin.0 * scale).round(), (origin.1 * scale).round());
        for (i, line) in layout.lines.iter().enumerate() {
            let shift = match align {
                Align::Left => 0.0,
                Align::Center => (block - line.width) * 0.5,
                Align::Right => block - line.width,
            };
            let baseline =
                origin_px.1 + layout.ascent.round() + i as f32 * layout.line_height.round();
            for &(ch, pen) in &line.glyphs {
                let g = self.glyph(font, ch, px, grow);
                if g.w == 0 || g.h == 0 {
                    continue;
                }
                let left = (origin_px.0 + shift + pen).round() + g.xmin as f32;
                let top = baseline - (g.ymin as f32 + g.h as f32);
                out.push(SpriteInstance {
                    center: [
                        (left + g.w as f32 * 0.5) / scale,
                        (top + g.h as f32 * 0.5) / scale,
                    ],
                    size: [g.w as f32 / scale, g.h as f32 / scale],
                    uv: [
                        g.x as f32 / atlas,
                        g.y as f32 / atlas,
                        (g.x + g.w) as f32 / atlas,
                        (g.y + g.h) as f32 / atlas,
                    ],
                    color,
                    rotation: 0.0,
                });
            }
        }
    }
}

/// Squared Euclidean distances, in place: `grid` holds 0 where a pixel is inside and infinity elsewhere (Felzenszwalb and Huttenlocher's
/// two passes of the one-dimensional lower envelope of parabolas).
fn distance_transform(grid: &mut [f32], w: usize, h: usize) {
    fn pass(f: &[f32], out: &mut [f32], v: &mut [usize], z: &mut [f32]) {
        let n = f.len();
        let mut k = 0usize;
        v[0] = 0;
        z[0] = f32::NEG_INFINITY;
        z[1] = f32::INFINITY;
        for q in 1..n {
            if f[q].is_infinite() && f[v[k]].is_infinite() {
                continue;
            }
            loop {
                let p = v[k];
                let s = ((f[q] + (q * q) as f32) - (f[p] + (p * p) as f32))
                    / (2.0 * q as f32 - 2.0 * p as f32);
                if s <= z[k] && k > 0 {
                    k -= 1;
                    continue;
                }
                if s <= z[k] {
                    // (k is 0: this one replaces the first parabola outright)
                    v[0] = q;
                    z[0] = f32::NEG_INFINITY;
                    z[1] = f32::INFINITY;
                    break;
                }
                k += 1;
                v[k] = q;
                z[k] = s;
                z[k + 1] = f32::INFINITY;
                break;
            }
        }
        k = 0;
        for (q, o) in out.iter_mut().enumerate() {
            while z[k + 1] < q as f32 {
                k += 1;
            }
            let p = v[k];
            let d = q as f32 - p as f32;
            *o = if f[p].is_infinite() {
                f32::INFINITY
            } else {
                d * d + f[p]
            };
        }
    }
    let n = w.max(h);
    let (mut f, mut out, mut v, mut z) = (
        vec![0.0f32; n],
        vec![0.0f32; n],
        vec![0usize; n],
        vec![0.0f32; n + 1],
    );
    for x in 0..w {
        for y in 0..h {
            f[y] = grid[y * w + x];
        }
        pass(&f[..h], &mut out[..h], &mut v, &mut z);
        for y in 0..h {
            grid[y * w + x] = out[y];
        }
    }
    for y in 0..h {
        f[..w].copy_from_slice(&grid[y * w..(y + 1) * w]);
        pass(&f[..w], &mut out[..w], &mut v, &mut z);
        grid[y * w..(y + 1) * w].copy_from_slice(&out[..w]);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_distance_transform_is_euclidean() {
        let (w, h) = (9, 7);
        let mut g = vec![f32::INFINITY; w * h];
        g[3 * w + 4] = 0.0;
        g[w + w - 1] = 0.0;
        super::distance_transform(&mut g, w, h);
        for y in 0..h {
            for x in 0..w {
                let a = ((x as f32 - 4.0).powi(2) + (y as f32 - 3.0).powi(2))
                    .min((x as f32 - 8.0).powi(2) + (y as f32 - 1.0).powi(2));
                assert!(
                    (g[y * w + x] - a).abs() < 1e-3,
                    "{x},{y}: {} vs {a}",
                    g[y * w + x]
                );
            }
        }
    }

    #[test]
    fn bold_letters_are_wider_and_an_outline_wider_still() {
        let mut e = super::TextEngine::new().unwrap();
        let f = e.resolve("rounded").unwrap();
        let plain = e.glyph(f, 'o', 40.0, 0.0);
        let bold = e.glyph(f, 'o', 40.0, 2.0);
        let ring = e.glyph(f, 'o', 40.0, 6.0);
        assert_eq!(bold.w, plain.w + 4);
        assert_eq!(ring.w, plain.w + 12);
        assert_eq!(bold.xmin, plain.xmin - 2);
    }

    use super::*;

    fn engine() -> TextEngine {
        TextEngine::new().expect("built-in fonts load")
    }

    #[test]
    fn every_builtin_font_loads_and_draws_a_letter() {
        let mut e = engine();
        for (name, _) in BUILTIN {
            let font = e.resolve(name).unwrap_or_else(|| panic!("{name} resolves"));
            let layout = e.layout(font, "Aa", 32.0, None);
            assert!(
                layout.width > 10.0 && layout.height > 10.0,
                "{name}: {layout:?}"
            );
            let mut out = Vec::new();
            e.draw(
                &mut out,
                font,
                &layout,
                32.0,
                (0.0, 0.0),
                1.0,
                [255; 4],
                Align::Left,
                None,
                0.0,
            );
            assert_eq!(out.len(), 2, "{name} draws both letters");
            assert!(
                out.iter().all(|s| s.size[0] > 1.0 && s.size[1] > 1.0),
                "{name}"
            );
        }
        assert_eq!(e.font_names().len(), 9);
    }

    #[test]
    fn glyph_coverage_is_actually_rasterised_into_the_atlas() {
        let mut e = engine();
        let font = e.resolve("sans").unwrap();
        let layout = e.layout(font, "I", 48.0, None);
        let mut out = Vec::new();
        e.draw(
            &mut out,
            font,
            &layout,
            48.0,
            (0.0, 0.0),
            1.0,
            [255; 4],
            Align::Left,
            None,
            0.0,
        );
        let atlas = e
            .take_atlas_if_dirty()
            .expect("dirty after drawing a new glyph")
            .to_vec();
        assert!(atlas.contains(&255), "a stem pixel is fully covered");
        assert!(atlas.iter().filter(|&&c| c > 0).count() > 100);
        assert!(
            e.take_atlas_if_dirty().is_none(),
            "clean until something new is drawn"
        );
        let mut again = Vec::new();
        e.draw(
            &mut again,
            font,
            &layout,
            48.0,
            (0.0, 0.0),
            1.0,
            [255; 4],
            Align::Left,
            None,
            0.0,
        );
        assert!(
            e.take_atlas_if_dirty().is_none(),
            "the cached glyph is reused"
        );
        assert_eq!(out[0].uv, again[0].uv);
    }

    #[test]
    fn size_scales_width_and_height_proportionally() {
        let e = engine();
        let font = e.resolve("sans").unwrap();
        let small = e.layout(font, "Hello world", 16.0, None);
        let big = e.layout(font, "Hello world", 32.0, None);
        assert!(
            (big.width / small.width - 2.0).abs() < 0.05,
            "{} vs {}",
            big.width,
            small.width
        );
        assert!((big.height / small.height - 2.0).abs() < 0.05);
    }

    #[test]
    fn newlines_make_lines_and_wrapping_breaks_at_word_boundaries() {
        let e = engine();
        let font = e.resolve("sans").unwrap();
        let two = e.layout(font, "one\ntwo", 20.0, None);
        assert_eq!(two.lines.len(), 2);
        assert!((two.height - 2.0 * two.line_height).abs() < 0.01);

        let text = "the quick brown fox jumps over the lazy dog";
        let free = e.layout(font, text, 20.0, None);
        assert_eq!(free.lines.len(), 1);
        let limit = free.width * 0.45;
        let wrapped = e.layout(font, text, 20.0, Some(limit));
        assert!(wrapped.lines.len() >= 2, "{} lines", wrapped.lines.len());
        for line in &wrapped.lines {
            assert!(
                line.width <= limit + 0.5,
                "line of {} exceeds {limit}",
                line.width
            );
        }
        let rebuilt: Vec<String> = wrapped
            .lines
            .iter()
            .map(|l| l.glyphs.iter().map(|g| g.0).collect::<String>())
            .collect();
        assert_eq!(
            rebuilt.join(" "),
            text,
            "wrapping only replaces spaces with line breaks: {rebuilt:?}"
        );
    }

    #[test]
    fn a_word_longer_than_the_width_breaks_inside_the_word() {
        let e = engine();
        let font = e.resolve("sans").unwrap();
        let long = e.layout(font, "supercalifragilistic", 20.0, Some(60.0));
        assert!(long.lines.len() >= 3);
        assert!(long.lines.iter().all(|l| l.width <= 60.5));
        let joined: String = long
            .lines
            .iter()
            .flat_map(|l| l.glyphs.iter().map(|g| g.0))
            .collect();
        assert_eq!(joined, "supercalifragilistic");
    }

    #[test]
    fn alignment_shifts_lines_within_the_box() {
        let mut e = engine();
        let font = e.resolve("sans").unwrap();
        let layout = e.layout(font, "ab", 24.0, None);
        let place = |e: &mut TextEngine, align| {
            let mut out = Vec::new();
            e.draw(
                &mut out,
                font,
                &layout,
                24.0,
                (0.0, 0.0),
                1.0,
                [255; 4],
                align,
                Some(200.0),
                0.0,
            );
            out[0].center[0] - out[0].size[0] / 2.0
        };
        let (left, centre, right) = (
            place(&mut e, Align::Left),
            place(&mut e, Align::Center),
            place(&mut e, Align::Right),
        );
        assert!(left < centre && centre < right);
        assert!((centre - left - (200.0 - layout.width) / 2.0).abs() < 1.5);
        assert!((right - left - (200.0 - layout.width)).abs() < 1.5);
    }

    #[test]
    fn letters_land_on_whole_physical_pixels_at_any_scale() {
        let mut e = engine();
        let font = e.resolve("sans").unwrap();
        let scale = 2.0;
        let px = 24.0 * scale;
        let layout = e.layout(font, "Pixel", px, None);
        let mut out = Vec::new();
        e.draw(
            &mut out,
            font,
            &layout,
            px,
            (10.3, 7.7),
            scale,
            [255; 4],
            Align::Left,
            None,
            0.0,
        );
        for s in &out {
            let (x0, y0) = (
                (s.center[0] - s.size[0] / 2.0) * scale,
                (s.center[1] - s.size[1] / 2.0) * scale,
            );
            assert!(
                (x0 - x0.round()).abs() < 1e-3 && (y0 - y0.round()).abs() < 1e-3,
                "({x0}, {y0}) is not a whole pixel"
            );
        }
    }

    #[test]
    fn project_fonts_resolve_by_id_and_short_name_and_bad_fonts_are_rejected() {
        let mut e = engine();
        let (_, bytes) = BUILTIN[0];
        e.add_font("fonts/title.ttf", bytes).unwrap();
        assert!(e.resolve("fonts/title.ttf").is_some() && e.resolve("title").is_some());
        assert!(e.resolve("nope").is_none());
        let err = e.add_font("fonts/bad.ttf", b"not a font").unwrap_err();
        assert!(err.contains("not a usable font"), "{err}");
    }

    #[test]
    fn huge_text_is_bounded() {
        let e = engine();
        let font = e.resolve("mono").unwrap();
        let layout = e.layout(font, &"x".repeat(100_000), 10.0, None);
        assert_eq!(layout.lines[0].glyphs.len(), MAX_TEXT_CHARS);
    }
}
