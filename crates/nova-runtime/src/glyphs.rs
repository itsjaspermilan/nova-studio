//! `nova glyphs`: a line (or lines) of text in one of the built-in fonts (or a project's .ttf) as a picture, white with the
//! letters' coverage as alpha, for the studio's `image_make` tool to place, colour and outline. The same fonts the game draws
//! with (`text.rs`), rasterised by the same library, so a logo's words look like the game's own.
//!
//!   nova glyphs <font> <size in pixels> <out.png> [--text "words"] [--project folder]
//!
//! It prints one line of JSON: `{"width": w, "height": h, "ascent": a, "line": l}` (pixels; `ascent` from the top to the
//! first baseline, `line` from one baseline to the next).

use std::path::Path;

use fontdue::{Font, FontSettings};

/// The font by its built-in name (`sans`, `pixel`, ...) or a .ttf/.otf file in the project (`fonts/title.ttf`).
fn font(name: &str, project: Option<&Path>) -> Result<Font, String> {
    let bytes: Vec<u8> = match crate::text::BUILTIN.iter().find(|(n, _)| *n == name) {
        Some((_, b)) => b.to_vec(),
        None => {
            let file = project
                .map(|p| p.join(name))
                .filter(|p| p.is_file())
                .ok_or_else(|| {
                    format!(
                        "no font '{name}': the built-in ones are {}, or a .ttf file in the project (with --project)",
                        crate::text::BUILTIN
                            .iter()
                            .map(|(n, _)| *n)
                            .collect::<Vec<_>>()
                            .join(", ")
                    )
                })?;
            std::fs::read(&file).map_err(|e| format!("{}: {e}", file.display()))?
        }
    };
    Font::from_bytes(bytes, FontSettings::default()).map_err(|e| format!("font '{name}': {e}"))
}

/// The text's picture: width, height, RGBA (white, alpha the coverage), the ascent and the line height.
pub fn render(
    name: &str,
    px: f32,
    text: &str,
    project: Option<&Path>,
) -> Result<(u32, u32, Vec<u8>, f32, f32), String> {
    if !(px.is_finite() && (2.0..=1024.0).contains(&px)) {
        return Err("the size is from 2 to 1024 pixels".into());
    }
    if text.chars().count() > 2000 {
        return Err("at most 2000 letters".into());
    }
    let f = font(name, project)?;
    let metrics = f
        .horizontal_line_metrics(px)
        .ok_or("the font has no horizontal metrics")?;
    let line = metrics.new_line_size.max(1.0);
    let ascent = metrics.ascent;
    // lay the letters out: a pen per line, kerning between pairs
    let lines: Vec<&str> = text.split('\n').collect();
    let mut glyphs = Vec::new(); // (x, y of the bitmap's top left, width, height, coverage)
    let mut width = 1.0f32;
    for (row, words) in lines.iter().enumerate() {
        let baseline = ascent + line * row as f32;
        let mut pen = 0.0f32;
        let mut prev: Option<char> = None;
        for ch in words.chars() {
            if let Some(p) = prev {
                pen += f.horizontal_kern(p, ch, px).unwrap_or(0.0);
            }
            let (m, cov) = f.rasterize(ch, px);
            let x = (pen + m.xmin as f32).round();
            let y = (baseline - m.height as f32 - m.ymin as f32).round();
            glyphs.push((x, y, m.width, m.height, cov));
            pen += m.advance_width;
            prev = Some(ch);
        }
        width = width.max(pen.ceil());
    }
    let w = width.max(1.0) as u32 + 2;
    let h = ((line * lines.len() as f32).ceil() as u32).max(1) + 2;
    let mut rgba = vec![0u8; (w * h * 4) as usize];
    for px in rgba.chunks_mut(4) {
        px[0] = 255;
        px[1] = 255;
        px[2] = 255;
    }
    for (gx, gy, gw, gh, cov) in glyphs {
        for y in 0..gh {
            for x in 0..gw {
                let (tx, ty) = (gx as i64 + x as i64 + 1, gy as i64 + y as i64 + 1);
                if tx < 0 || ty < 0 || tx >= w as i64 || ty >= h as i64 {
                    continue;
                }
                let a = cov[y * gw + x];
                let o = ((ty as u32 * w + tx as u32) * 4 + 3) as usize;
                rgba[o] = rgba[o].max(a);
            }
        }
    }
    Ok((w, h, rgba, ascent + 1.0, line))
}

/// Writes the picture and prints its measures.
pub fn command(
    name: &str,
    px: f32,
    text: &str,
    out: &Path,
    project: Option<&Path>,
) -> Result<(), String> {
    let (w, h, rgba, ascent, line) = render(name, px, text, project)?;
    let file = std::fs::File::create(out).map_err(|e| format!("{}: {e}", out.display()))?;
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w, h);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    let mut writer = enc.write_header().map_err(|e| e.to_string())?;
    writer.write_image_data(&rgba).map_err(|e| e.to_string())?;
    println!("{{\"width\": {w}, \"height\": {h}, \"ascent\": {ascent}, \"line\": {line}}}");
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn words_become_a_picture_of_their_coverage() {
        let (w, h, rgba, ascent, line) = super::render("sans", 32.0, "Pine", None).unwrap();
        assert!(w > 40 && h >= 32, "{w}x{h}");
        assert!(ascent > 20.0 && line > 30.0);
        let inked = rgba.chunks(4).filter(|p| p[3] > 128).count();
        assert!(inked > 100, "{inked} pixels of ink");
        let (w2, ..) = super::render("sans", 32.0, "Pine\nRidge", None).unwrap();
        assert!(w2 >= w);
        assert!(
            super::render("nope", 32.0, "a", None)
                .unwrap_err()
                .contains("built-in ones are sans")
        );
    }
}
