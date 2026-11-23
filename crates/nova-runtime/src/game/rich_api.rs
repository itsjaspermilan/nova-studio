//! `nova.ui.rich_text` and `nova.ui.rich_text_letters`: a line with inline markup (`{shake}`, `{wave}`, `{big}`, `{slow}`, `{pop}`,
//! `{c=red}`, `{pause}`), laid out whole and then typed into that layout on the clock the game passes (`time`), each letter rising
//! softly into place as it appears. The markup, the pace, the layout and the letters' movements are `crate::rich_text`'s; this
//! file reads the options and puts the letters in the text's list (one quad a letter, as plain text).

use std::cell::RefCell;
use std::rc::Rc;

use mlua::{Lua, Table, Value};

use super::{Shared, color_option, drawn_api, lua_err, number_option, string_option};
use crate::rich_text::{self, BIG, BIG_BOLD, Metrics, Placed, RichChar};
use crate::text::{Align, TextEngine};

struct FontMetrics<'a> {
    text: &'a TextEngine,
    font: usize,
}

impl Metrics for FontMetrics<'_> {
    fn advance(&self, prev: Option<char>, ch: char, px: f32) -> (f32, f32) {
        self.text.advance(self.font, prev, ch, px)
    }
    fn line(&self, px: f32) -> (f32, f32) {
        self.text.line_metrics(self.font, px)
    }
}

/// A line read, laid out and timed.
struct Built {
    chars: Vec<RichChar>,
    letters: Vec<Placed>,
    shifts: Vec<f32>,
    at: Vec<f32>,
    last: f32,
    time: f32,
    appear: bool,
    font: usize,
    bold: f32,
    color: [u8; 4],
    /// the block's top-left in physical pixels (whole ones)
    origin: (f32, f32),
    scale: f32,
    width: f32,
    height: f32,
}

impl Built {
    fn shown(&self) -> usize {
        self.at.iter().filter(|&&a| a <= self.time).count()
    }
}

fn build(sh: &Shared, x: f64, y: f64, text: &str, opts: &Option<Table>) -> mlua::Result<Built> {
    let scale = sh.pixel_scale.max(0.25);
    let size = number_option(opts, "size")?
        .unwrap_or(16.0)
        .clamp(4.0, 400.0) as f32;
    let px = (size * scale).round().max(1.0);
    let font_name =
        string_option(opts, "font")?.unwrap_or_else(|| crate::text::DEFAULT_FONT.to_string());
    let font = sh.text.resolve(&font_name).ok_or_else(|| {
        lua_err(format!(
            "unknown font '{font_name}' (fonts available: {})",
            sh.text.font_names().join(", ")
        ))
    })?;
    let chars = rich_text::parse(text).map_err(lua_err)?;
    let wrap = number_option(opts, "width")?.map(|w| (w as f32 * scale).max(1.0));
    let line_spacing = number_option(opts, "line_spacing")?.unwrap_or(1.0) as f32;
    if !line_spacing.is_finite() || !(0.5..=4.0).contains(&line_spacing) {
        return Err(lua_err(format!(
            "line_spacing must be from 0.5 to 4 (1 is the font's own), not {line_spacing}"
        )));
    }
    let align = match string_option(opts, "align")?.as_deref() {
        None | Some("left") => Align::Left,
        Some("center") => Align::Center,
        Some("right") => Align::Right,
        Some(other) => {
            return Err(lua_err(format!(
                "align must be 'left', 'center' or 'right', not '{other}'"
            )));
        }
    };
    let layout = rich_text::layout(
        &chars,
        px,
        wrap,
        line_spacing,
        &FontMetrics {
            text: &sh.text,
            font,
        },
    );
    let block = wrap.unwrap_or(layout.width);
    let shifts = layout
        .line_widths
        .iter()
        .map(|w| match align {
            Align::Left => 0.0,
            Align::Center => ((block - w) * 0.5).round(),
            Align::Right => (block - w).round(),
        })
        .collect();
    let cps = number_option(opts, "cps")?.unwrap_or(rich_text::DEFAULT_CPS as f64) as f32;
    if !cps.is_finite() || cps <= 0.0 {
        return Err(lua_err(format!(
            "cps (letters a second) must be above 0, not {cps}"
        )));
    }
    let skip = number_option(opts, "skip")?.map(|s| s as f32);
    // without a `time` the whole line is out and settled; the effects move on the game's clock
    let (at, last, time) = match number_option(opts, "time")? {
        Some(t) => {
            let (at, last) = rich_text::appear_times(&chars, cps, skip);
            (at, last, t as f32)
        }
        None => (vec![f32::NEG_INFINITY; chars.len()], 0.0, sh.time as f32),
    };
    let appear = match opts {
        Some(t) => !matches!(t.get::<Value>("appear")?, Value::Boolean(false)),
        None => true,
    };
    let bold = match opts {
        Some(t) => match t.get::<Value>("bold")? {
            Value::Boolean(true) => 1.0,
            Value::Integer(n) => n as f32,
            Value::Number(n) => n as f32,
            _ => 0.0,
        },
        None => 0.0,
    };
    // (x, y is the top-left, as nova.ui.text's; with a width and "center" the lines centre in it, without one around x)
    let x = match (align, wrap) {
        (Align::Center, None) => x as f32 - layout.width / scale * 0.5,
        (Align::Right, None) => x as f32 - layout.width / scale,
        _ => x as f32,
    };
    Ok(Built {
        letters: layout.letters,
        shifts,
        chars,
        at,
        last,
        time,
        appear,
        font,
        bold,
        color: color_option(opts, "color", [255; 4])?,
        origin: ((x * scale).round(), (y as f32 * scale).round()),
        scale,
        width: layout.width / scale,
        height: layout.height / scale,
    })
}

pub(super) fn register(lua: &Lua, ui: &Table, shared: &Rc<RefCell<Shared>>) -> mlua::Result<()> {
    let s = shared.clone();
    ui.set(
        "rich_text",
        lua.create_function(
            move |_, (x, y, text, opts): (f64, f64, String, Option<Table>)| {
                let mut sh = s.borrow_mut();
                let b = build(&sh, x, y, &text, &opts)?;
                let shown = b.shown();
                let words: String = b
                    .chars
                    .iter()
                    .zip(&b.at)
                    .filter(|(_, a)| **a <= b.time)
                    .map(|(c, _)| c.ch)
                    .collect();
                drawn_api::note(
                    &mut sh,
                    "ui_text",
                    &words,
                    [x, y, 0.0],
                    [b.width as f64, b.height as f64],
                );
                let mut out = std::mem::take(&mut sh.text_out);
                for (k, (c, p)) in b.chars.iter().zip(&b.letters).enumerate() {
                    if c.ch.is_whitespace() {
                        continue;
                    }
                    let pose = rich_text::pose(c.fx, k, p.px, b.at[k], b.time, b.appear);
                    if !pose.shown || pose.alpha <= 0.0 {
                        continue;
                    }
                    let bold = b.bold + if c.fx & BIG != 0 { BIG_BOLD } else { 0.0 };
                    let grow = p.px * 0.04 * bold.clamp(0.0, 3.0);
                    let mut color = c.color.unwrap_or(b.color);
                    color[3] = ((b.color[3] as f32) * pose.alpha).round().clamp(0.0, 255.0) as u8;
                    let pen = b.origin.0 + b.shifts[p.line] + p.x;
                    if let Some(mut q) = sh.text.letter(
                        b.font,
                        c.ch,
                        p.px,
                        grow,
                        pen,
                        b.origin.1 + p.baseline,
                        b.scale,
                        color,
                    ) {
                        q.center[0] += pose.dx / b.scale;
                        q.center[1] += pose.dy / b.scale;
                        q.size = [q.size[0] * pose.scale, q.size[1] * pose.scale];
                        q.rotation += pose.rot;
                        out.push(q);
                    }
                }
                sh.text_out = out;
                Ok((b.width as f64, b.height as f64, shown, b.time >= b.last))
            },
        )?,
    )?;
    let s = shared.clone();
    ui.set(
        "rich_text_letters",
        lua.create_function(
            move |lua, (x, y, text, opts): (f64, f64, String, Option<Table>)| {
                let sh = s.borrow();
                let b = build(&sh, x, y, &text, &opts)?;
                let t = lua.create_table()?;
                t.set("text", rich_text::plain(&b.chars))?;
                t.set("last", b.last)?;
                t.set("shown", b.shown())?;
                t.set("done", b.time >= b.last)?;
                t.set("width", b.width)?;
                t.set("height", b.height)?;
                let list = lua.create_table()?;
                for (k, (c, p)) in b.chars.iter().zip(&b.letters).enumerate() {
                    let pose = rich_text::pose(c.fx, k, p.px, b.at[k], b.time, b.appear);
                    let l = lua.create_table()?;
                    l.set("char", c.ch.to_string())?;
                    l.set(
                        "x",
                        ((b.origin.0 + b.shifts[p.line] + p.x) / b.scale) as f64,
                    )?;
                    l.set("y", ((b.origin.1 + p.baseline) / b.scale) as f64)?;
                    l.set("line", p.line + 1)?;
                    l.set("size", (p.px / b.scale) as f64)?;
                    l.set(
                        "at",
                        if b.at[k].is_finite() {
                            b.at[k] as f64
                        } else {
                            0.0
                        },
                    )?;
                    l.set("shown", pose.shown)?;
                    l.set("dx", (pose.dx / b.scale) as f64)?;
                    l.set("dy", (pose.dy / b.scale) as f64)?;
                    l.set("scale", pose.scale as f64)?;
                    l.set("rotation", pose.rot as f64)?;
                    l.set("alpha", pose.alpha as f64)?;
                    let fx = lua.create_table()?;
                    for (bit, name) in [
                        (rich_text::SHAKE, "shake"),
                        (rich_text::WAVE, "wave"),
                        (rich_text::BIG, "big"),
                        (rich_text::SLOW, "slow"),
                        (rich_text::POP, "pop"),
                    ] {
                        if c.fx & bit != 0 {
                            fx.set(name, true)?;
                        }
                    }
                    l.set("fx", fx)?;
                    list.push(l)?;
                }
                t.set("letters", list)?;
                Ok(t)
            },
        )?,
    )?;
    Ok(())
}
