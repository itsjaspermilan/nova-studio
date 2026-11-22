//! Panels for the UI layer beyond a plain rectangle: rounded corners, a slant (a parallelogram: banners, wipes' slats), a
//! vertical gradient and an outline, for `nova.ui.rect(x, y, w, h, color, { radius, slant, gradient, outline, layer })`.
//!
//! The renderer draws the UI as upright rectangles, so a panel is cut into rows one screen pixel tall where its edges are
//! curved or leaning (straight runs of equal rows are merged into one rectangle), and each row's two ends get a rectangle of
//! partial alpha for the part of the pixel the edge covers: smooth edges, at the screen's own resolution.
//!
//! `layer = "top"` puts the panel (or a plain rectangle) in the text's list, in call order with the words: over every text drawn
//! before it and under every text drawn after it. Without it the UI's rectangles and sprites are all under all of its text.

/// One upright rectangle of the panel, in units: x, y, w, h and its colour.
pub(crate) type Piece = (f64, f64, f64, f64, [u8; 4]);

/// What a panel is asked to be.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Panel {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub color: [u8; 4],
    /// The colour at the bottom when it is a gradient (`color` is the top's).
    pub bottom: Option<[u8; 4]>,
    /// Corner radius in units.
    pub radius: f64,
    /// How far right the top edge sits of the bottom one (negative: left); the panel is `w` wide at every height.
    pub slant: f64,
    /// An outline of this colour and width (inside the panel's edge).
    pub outline: Option<([u8; 4], f64)>,
}

fn lerp(a: [u8; 4], b: [u8; 4], t: f64) -> [u8; 4] {
    let mut c = [0u8; 4];
    for i in 0..4 {
        c[i] = (a[i] as f64 + (b[i] as f64 - a[i] as f64) * t)
            .round()
            .clamp(0.0, 255.0) as u8;
    }
    c
}

fn faded(c: [u8; 4], k: f64) -> [u8; 4] {
    [
        c[0],
        c[1],
        c[2],
        (c[3] as f64 * k).round().clamp(0.0, 255.0) as u8,
    ]
}

/// The horizontal extent of a rounded, slanted box at height `v` (units from its top) inset by `inset`: None above or below it.
fn extent(p: &Panel, v: f64, inset: f64) -> Option<(f64, f64)> {
    let (w, h) = (p.w - 2.0 * inset, p.h - 2.0 * inset);
    let v = v - inset;
    if w <= 0.0 || h <= 0.0 || v < 0.0 || v > h {
        return None;
    }
    let r = (p.radius - inset).max(0.0).min(w / 2.0).min(h / 2.0);
    let dy = if v < r {
        r - v
    } else if v > h - r {
        v - (h - r)
    } else {
        0.0
    };
    let cut = if dy > 0.0 {
        r - (r * r - dy * dy).max(0.0).sqrt()
    } else {
        0.0
    };
    // (the slant moves each row: the top row by `slant`, the bottom row not at all)
    let shift = p.slant * (1.0 - (v + inset) / p.h);
    let left = p.x + inset + cut + shift;
    Some((left, left + w - 2.0 * cut))
}

/// Cuts the panel into rectangles, `scale` screen pixels to a unit.
pub(crate) fn pieces(p: &Panel, scale: f64) -> Vec<Piece> {
    let scale = scale.max(0.25);
    let mut out: Vec<Piece> = Vec::new();
    if p.w <= 0.0 || p.h <= 0.0 {
        return out;
    }
    let rows = (p.h * scale).ceil().clamp(1.0, 8192.0) as usize;
    let dy = p.h / rows as f64;
    let px = 1.0 / scale;
    // one row's runs: [a, b) in units with a colour, cut to whole pixels with a partly covered pixel at each end
    let row_pieces = |y: f64, a: f64, b: f64, c: [u8; 4], out: &mut Vec<Piece>| {
        if b - a <= 1e-6 || c[3] == 0 {
            return;
        }
        let (ia, ib) = ((a * scale).ceil() / scale, (b * scale).floor() / scale);
        if ib > ia {
            push(out, (ia, y, ib - ia, dy, c));
            let left = ia - a;
            if left > 1e-6 {
                push(out, (ia - px, y, px, dy, faded(c, left * scale)));
            }
            let right = b - ib;
            if right > 1e-6 {
                push(out, (ib, y, px, dy, faded(c, right * scale)));
            }
        } else {
            // (narrower than a pixel: one pixel at its share)
            push(
                out,
                (
                    (a * scale).floor() / scale,
                    y,
                    px,
                    dy,
                    faded(c, ((b - a) * scale).min(1.0)),
                ),
            );
        }
    };
    for i in 0..rows {
        let (y, v) = (p.y + i as f64 * dy, (i as f64 + 0.5) * dy);
        let t = v / p.h;
        let fill = match p.bottom {
            Some(b) => lerp(p.color, b, t),
            None => p.color,
        };
        let Some((l, r)) = extent(p, v, 0.0) else {
            continue;
        };
        match p.outline {
            Some((oc, ow)) if ow > 0.0 => match extent(p, v, ow) {
                Some((il, ir)) => {
                    row_pieces(y, l, il, oc, &mut out);
                    row_pieces(y, il, ir, fill, &mut out);
                    row_pieces(y, ir, r, oc, &mut out);
                }
                None => row_pieces(y, l, r, oc, &mut out),
            },
            _ => row_pieces(y, l, r, fill, &mut out),
        }
    }
    out
}

/// Adds a piece, merged into the one above it when it continues it exactly (the straight middle of a panel is one rectangle).
fn push(out: &mut Vec<Piece>, p: Piece) {
    for q in out.iter_mut().rev().take(6) {
        if (q.0 - p.0).abs() < 1e-9
            && (q.2 - p.2).abs() < 1e-9
            && q.4 == p.4
            && (q.1 + q.3 - p.1).abs() < 1e-9
        {
            q.3 += p.3;
            return;
        }
    }
    out.push(p);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn panel() -> Panel {
        Panel {
            x: 10.0,
            y: 20.0,
            w: 100.0,
            h: 40.0,
            color: [255, 0, 0, 255],
            bottom: None,
            radius: 0.0,
            slant: 0.0,
            outline: None,
        }
    }

    #[test]
    fn a_plain_panel_is_one_rectangle_and_a_rounded_one_has_soft_corners() {
        let plain = pieces(&panel(), 2.0);
        assert_eq!(plain, vec![(10.0, 20.0, 100.0, 40.0, [255, 0, 0, 255])]);
        let round = pieces(
            &Panel {
                radius: 10.0,
                ..panel()
            },
            2.0,
        );
        assert!(round.len() > 10 && round.len() < 200, "{}", round.len());
        // the straight middle is one rectangle, full width
        assert!(
            round
                .iter()
                .any(|p| p.0 == 10.0 && p.2 == 100.0 && p.3 >= 19.0),
            "{round:?}"
        );
        // the corners have pixels of partial alpha
        assert!(round.iter().any(|p| p.4[3] > 0 && p.4[3] < 255));
        // nothing outside the box
        assert!(round.iter().all(|p| p.0 >= 10.0 - 0.5
            && p.0 + p.2 <= 110.5
            && p.1 >= 20.0
            && p.1 + p.3 <= 60.001));
    }

    #[test]
    fn a_slant_leans_the_panel_and_an_outline_rings_it_and_a_gradient_runs_down() {
        let s = pieces(
            &Panel {
                slant: 20.0,
                ..panel()
            },
            1.0,
        );
        let top = s
            .iter()
            .filter(|p| p.1 < 21.0 && p.4[3] == 255)
            .map(|p| p.0)
            .fold(f64::MAX, f64::min);
        let bottom = s
            .iter()
            .filter(|p| p.1 + p.3 > 59.5 && p.4[3] == 255)
            .map(|p| p.0)
            .fold(f64::MAX, f64::min);
        assert!(
            top > bottom + 15.0,
            "the top row starts further right: {top} {bottom}"
        );
        let o = pieces(
            &Panel {
                outline: Some(([0, 0, 0, 255], 3.0)),
                ..panel()
            },
            1.0,
        );
        assert!(
            o.iter().any(|p| p.4 == [0, 0, 0, 255]) && o.iter().any(|p| p.4 == [255, 0, 0, 255])
        );
        let g = pieces(
            &Panel {
                bottom: Some([0, 0, 255, 255]),
                ..panel()
            },
            1.0,
        );
        assert_eq!(g.first().unwrap().4[0] > 240, true);
        assert_eq!(g.last().unwrap().4[2] > 240, true);
    }
}
