//! The 2D effects' Lua side (`gfx/fx2d.rs` draws them). Each is off until a game asks for it, so a game that does not is drawn as
//! it always was:
//!
//! - `nova.ambient2d({ r, g, b })` turns on 2D lighting: the colour a white thing shows where no light reaches. `nova.light2d { x, y,
//!   radius, color, intensity, flicker }` (world coordinates, every frame, from a draw) lights a pool round a point; an entity's
//!   `light = { ... }` does it for the entity. At most [`MAX_LIGHTS_2D`] a frame (the nearest to the middle of the view are kept).
//! - a sprite's, rectangle's or circle's `blend = "add"` (or `"screen"`) adds light instead of covering; `lit = false` keeps a plain
//!   sprite out of the lighting (a lit window). `nova.circle(x, y, r, color, { soft = true, ry })` draws discs and soft glows.
//! - an entity's `shadow = true`: a soft ellipse under its feet (all of a frame's in one draw).
//! - `nova.reflections { strength, ripple, tint }` with tile layers that have `reflect` tiles (tileset_make marks puddles and water):
//!   what stands above them shows in them, flipped.
//! - `nova.weather { rain = 0.5, wind = 0.3 }`: rain streaks and splash rings over the world, under the HUD.
//! - `nova.effects { lights = false, ... }` or `nova.effects("low")`: drop effects on a slow device.

use super::*;
use crate::gfx::{
    Blend2d, Fx2d, Fx2dFrame, Light2d, MAX_LIGHTS_2D, MAX_MIRRORED, Rain2d, Reflect2d, Shape2d,
    Style2d,
};

/// Which effects a game lets run (`nova.effects`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Toggles {
    pub lights: bool,
    pub shadows: bool,
    pub reflections: bool,
    pub rain: bool,
    pub bloom: bool,
    /// The cheaper versions: the light map at an eighth of the world picture's size, half the rain.
    pub low: bool,
}

impl Default for Toggles {
    fn default() -> Self {
        Self {
            lights: true,
            shadows: true,
            reflections: true,
            rain: true,
            bloom: true,
            low: false,
        }
    }
}

#[derive(Default)]
pub(super) struct Fx2dState {
    pub toggles: Toggles,
    /// Linear; and as given (0 to 255), for the report.
    ambient: Option<([f32; 3], [f32; 3])>,
    reflect: Option<Reflect2d>,
    rain: Option<Rain2d>,
    /// The world position of the view's top-left corner, set by the framework before it draws (`raw.view_origin`).
    origin: [f32; 2],
    // ---- this frame's
    /// Each light with its distance from the middle of the view (to keep the nearest when there are too many).
    lights: Vec<(Light2d, f32)>,
    lights_asked: usize,
    styles: Vec<(usize, Style2d)>,
    added: usize,
    shadows: Vec<SpriteInstance>,
    shadows_at: Option<usize>,
    pub mask: Vec<SpriteInstance>,
    pub reflect_at: Option<usize>,
    /// Mirror lines given for sprites (an entity's feet, the foot of a column of tiles), by index into the world's sprites, in order.
    pub axes: Vec<(usize, f32)>,
    pub reflective_tiles: usize,
}

impl Fx2dState {
    /// Whether reflections are drawn this frame (asked for and not switched off).
    pub fn reflecting(&self) -> bool {
        self.reflect.is_some() && self.toggles.reflections
    }

    fn lighting(&self) -> bool {
        self.ambient.is_some() && self.toggles.lights
    }

    /// Forgets the last frame's draws (the settings stay).
    pub fn begin_frame(&mut self) {
        self.lights.clear();
        self.lights_asked = 0;
        self.styles.clear();
        self.added = 0;
        self.shadows.clear();
        self.shadows_at = None;
        self.mask.clear();
        self.reflect_at = None;
        self.axes.clear();
        self.reflective_tiles = 0;
    }
}

/// What the last frame's 2D effects were, for `play`'s `render:` line.
#[derive(Clone, Debug, Default)]
pub(crate) struct Fx2dFacts {
    pub any: bool,
    /// As given, 0 to 255.
    pub ambient: Option<[f32; 3]>,
    pub lights: usize,
    pub lights_asked: usize,
    /// Lights in view that were dropped because there were more than [`MAX_LIGHTS_2D`].
    pub dropped: usize,
    pub added: usize,
    pub shadows: usize,
    pub reflections: bool,
    pub reflective_tiles: usize,
    pub mirrored: usize,
    pub rain: Option<f32>,
    pub bloom: f32,
    pub low: bool,
    pub off: Vec<&'static str>,
}

fn linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// `{ r, g, b }` from 0 to 255, as given and in linear light.
fn colour(t: &Table, key: &str, what: &str) -> mlua::Result<Option<([f32; 3], [f32; 3])>> {
    match t.get::<Option<Table>>(key)? {
        Some(c) => colour_of(&c, &format!("{what} {key}")).map(Some),
        None => Ok(None),
    }
}

fn colour_of(c: &Table, what: &str) -> mlua::Result<([f32; 3], [f32; 3])> {
    let mut given = [0.0f32; 3];
    for (i, slot) in given.iter_mut().enumerate() {
        let v: f64 = c
            .get::<Option<f64>>(i + 1)?
            .filter(|v| v.is_finite())
            .ok_or_else(|| lua_err(format!("{what} is {{r, g, b}} from 0 to 255")))?;
        *slot = v.clamp(0.0, 255.0) as f32;
    }
    Ok((given, given.map(|v| linear(v / 255.0))))
}

/// The `blend`, `lit` and shape options of a sprite or shape: None for a plain one.
pub(super) fn style_option(opts: &Option<Table>, shape: Shape2d) -> mlua::Result<Option<Style2d>> {
    let blend = match string_option(opts, "blend")?.as_deref() {
        None | Some("alpha") | Some("normal") => Blend2d::Alpha,
        Some("add") => Blend2d::Add,
        Some("screen") => Blend2d::Screen,
        Some(other) => {
            return Err(lua_err(format!(
                "blend is \"add\" (adds light), \"screen\" (brightens, never past white) or \"alpha\" (covers, the default), not \"{other}\""
            )));
        }
    };
    let lit = match opts {
        Some(t) => match t.get::<Value>("lit")? {
            Value::Nil => true,
            Value::Boolean(b) => b,
            _ => {
                return Err(lua_err(
                    "lit is true or false (false: not darkened by nova.ambient2d, a lit window)",
                ));
            }
        },
        None => true,
    };
    let style = Style2d { blend, shape, lit };
    Ok((style != Style2d::PLAIN).then_some(style))
}

/// Marks the world sprite about to be pushed (its index is the list's length now) with its style and its mirror line.
pub(super) fn mark(sh: &mut Shared, style: Option<Style2d>, foot: Option<f64>) {
    let index = sh.world.len();
    if let Some(style) = style {
        if style.blend != Blend2d::Alpha {
            sh.fx.added += 1;
        }
        sh.fx.styles.push((index, style));
    }
    if let Some(foot) = foot.filter(|f| f.is_finite())
        && sh.fx.reflecting()
        && sh.fx.reflect_at.is_some()
    {
        sh.fx.axes.push((index, foot as f32));
    }
}

/// Light that flickers like a failing tube: a gentle wobble with now and then a short dip, the same at the same time.
fn flicker(amount: f32, time: f32, seed: f32) -> f32 {
    if amount <= 0.0 {
        return 1.0;
    }
    let wobble = 0.5 + 0.5 * ((time * 23.0 + seed).sin() * (time * 9.7 + seed * 1.3).sin());
    let phase = (time * 2.3 + seed * 0.37).fract();
    let dip = if phase < 0.05 || (0.11..0.14).contains(&phase) {
        1.0
    } else {
        0.0
    };
    (1.0 - amount * (0.35 * wobble + 0.6 * dip)).max(0.0)
}

fn push_light(sh: &mut Shared, x: f64, y: f64, opts: &Table, offset: bool) -> mlua::Result<()> {
    let o = Some(opts.clone());
    let (dx, dy) = if offset {
        (
            number_option(&o, "x")?.unwrap_or(0.0),
            number_option(&o, "y")?.unwrap_or(0.0),
        )
    } else {
        (0.0, 0.0)
    };
    let radius = number_option(&o, "radius")?.unwrap_or(96.0);
    let radius_y = number_option(&o, "radius_y")?.unwrap_or(radius);
    let intensity = number_option(&o, "intensity")?.unwrap_or(1.0);
    let flick = number_option(&o, "flicker")?.unwrap_or(0.0);
    if !(radius.is_finite() && radius > 0.0 && radius_y.is_finite() && radius_y > 0.0) {
        return Err(lua_err(
            "light2d radius must be more than 0 (world units: 96 is three detailed tiles)",
        ));
    }
    if !(intensity.is_finite() && (0.0..=16.0).contains(&intensity)) {
        return Err(lua_err(
            "light2d intensity is from 0 to 16 (1: the colour itself at the middle)",
        ));
    }
    if !(flick.is_finite() && (0.0..=1.0).contains(&flick)) {
        return Err(lua_err("light2d flicker is from 0 (steady) to 1"));
    }
    let (_, rgb) = colour(opts, "color", "light2d")?.unwrap_or(([255.0; 3], [1.0; 3]));
    sh.fx.lights_asked += 1;
    if !sh.fx.lighting() {
        return Ok(());
    }
    let screen = opts.get::<Option<bool>>("screen")?.unwrap_or(false);
    let (wx, wy) = (x + dx, y + dy);
    let (cx, cy) = if screen {
        (wx as f32, wy as f32)
    } else {
        (wx as f32 - sh.fx.origin[0], wy as f32 - sh.fx.origin[1])
    };
    let (rx, ry) = (radius as f32, radius_y as f32);
    let [vw, vh] = sh.view;
    // (off the view: nothing to light)
    if cx + rx < 0.0 || cy + ry < 0.0 || cx - rx > vw || cy - ry > vh {
        return Ok(());
    }
    let k =
        intensity as f32 * flicker(flick as f32, sh.time as f32, (wx * 0.37 + wy * 0.11) as f32);
    let distance = (cx - vw * 0.5).hypot(cy - vh * 0.5);
    sh.fx.lights.push((
        Light2d {
            center: [cx, cy],
            radius: [rx, ry],
            color: [rgb[0] * k, rgb[1] * k, rgb[2] * k, 1.0],
        },
        distance,
    ));
    Ok(())
}

fn whole_effect_names() -> &'static str {
    "lights, shadows, reflections, rain, bloom"
}

pub(super) fn install(
    lua: &Lua,
    shared: &Rc<RefCell<Shared>>,
    nova: &Table,
    raw: &Table,
) -> mlua::Result<()> {
    // ambient2d({ r, g, b }) | ambient2d(nil)
    let s = shared.clone();
    nova.set(
        "ambient2d",
        lua.create_function(move |_, c: Option<Table>| {
            let mut sh = s.borrow_mut();
            sh.fx.ambient = match c {
                None => None,
                Some(t) => Some(colour_of(&t, "ambient2d")?),
            };
            Ok(())
        })?,
    )?;
    // light2d { x, y, radius, color, intensity, flicker } | light2d(x, y, { ... })
    let s = shared.clone();
    nova.set(
        "light2d",
        lua.create_function(move |lua, (a, b, c): (Value, Option<f64>, Option<Table>)| {
            let x = match a {
                Value::Number(x) => Some(x),
                Value::Integer(x) => Some(x as f64),
                _ => None,
            };
            match (a, x, b, c) {
                (Value::Table(t), _, None, None) => {
                    let o = Some(t.clone());
                    let x = number_option(&o, "x")?.ok_or_else(|| lua_err("light2d needs x and y: nova.light2d { x = 300, y = 200, radius = 96, color = { 255, 80, 200 } }"))?;
                    let y = number_option(&o, "y")?.ok_or_else(|| lua_err("light2d needs x and y"))?;
                    push_light(&mut s.borrow_mut(), x, y, &t, false)
                }
                (_, Some(x), Some(y), opts) => {
                    let t = match opts {
                        Some(t) => t,
                        None => lua.create_table()?,
                    };
                    push_light(&mut s.borrow_mut(), x, y, &t, false)
                }
                _ => Err(lua_err("light2d takes { x, y, radius, color, intensity, flicker } or (x, y, { radius, ... })")),
            }
        })?,
    )?;
    // circle(x, y, r, color, { blend, soft, ry, lit }): a disc (or a soft glow) in screen coordinates, like nova.rect
    let s = shared.clone();
    nova.set(
        "circle",
        lua.create_function(
            move |_, (x, y, r, color, opts): (f64, f64, f64, Option<Table>, Option<Table>)| {
                let mut sh = s.borrow_mut();
                let soft = match &opts {
                    Some(t) => t.get::<Option<bool>>("soft")?.unwrap_or(false),
                    None => false,
                };
                let ry = number_option(&opts, "ry")?.unwrap_or(r);
                let shape = if soft { Shape2d::Soft } else { Shape2d::Disc };
                let style = style_option(&opts, shape)?.unwrap_or(Style2d {
                    shape,
                    ..Style2d::PLAIN
                });
                mark(&mut sh, Some(style), None);
                let inst = SpriteInstance {
                    center: [x as f32, y as f32],
                    size: [(2.0 * r) as f32, (2.0 * ry) as f32],
                    uv: sh.layout.white_uv(),
                    color: rgba(color)?,
                    rotation: 0.0,
                };
                sh.world.push(inst);
                Ok(())
            },
        )?,
    )?;
    // reflections { strength = 0.5, ripple = 1, tint = {r, g, b} } | reflections(nil)
    let s = shared.clone();
    nova.set(
        "reflections",
        lua.create_function(move |_, opts: Option<Table>| {
            let mut sh = s.borrow_mut();
            sh.fx.reflect = match opts {
                None => None,
                Some(t) => {
                    let o = Some(t.clone());
                    let strength = number_option(&o, "strength")?.unwrap_or(0.55);
                    let ripple = number_option(&o, "ripple")?.unwrap_or(1.0);
                    if !(0.0..=1.0).contains(&strength) || !(0.0..=8.0).contains(&ripple) {
                        return Err(lua_err("reflections: strength is from 0 to 1, ripple from 0 to 8 (units it wobbles)"));
                    }
                    let tint = colour(&t, "tint", "reflections")?.map_or([0.55, 0.62, 0.85], |c| c.1);
                    Some(Reflect2d {
                        strength: strength as f32,
                        ripple: ripple as f32,
                        tint,
                    })
                }
            };
            Ok(())
        })?,
    )?;
    // effects { lights = false, ... } | effects("low") | effects("high") | effects("off")
    let s = shared.clone();
    nova.set(
        "effects",
        lua.create_function(move |_, v: Value| {
            let mut sh = s.borrow_mut();
            sh.fx.toggles = match v {
                Value::Nil => Toggles::default(),
                Value::String(name) => match name.to_str()?.as_ref() {
                    "high" => Toggles::default(),
                    "low" => Toggles {
                        reflections: false,
                        bloom: false,
                        low: true,
                        ..Toggles::default()
                    },
                    "off" => Toggles {
                        lights: false,
                        shadows: false,
                        reflections: false,
                        rain: false,
                        bloom: false,
                        low: false,
                    },
                    other => {
                        return Err(lua_err(format!(
                            "effects is \"high\" (all), \"low\" (no reflections or bloom, a coarser light map, half the rain), \"off\", or a table of {} = true/false; not \"{other}\"",
                            whole_effect_names()
                        )));
                    }
                },
                Value::Table(t) => {
                    let mut out = sh.fx.toggles;
                    for pair in t.pairs::<String, Value>() {
                        let (k, v) = pair?;
                        let Value::Boolean(on) = v else {
                            return Err(lua_err(format!("effects {k} is true or false")));
                        };
                        match k.as_str() {
                            "lights" => out.lights = on,
                            "shadows" => out.shadows = on,
                            "reflections" => out.reflections = on,
                            "rain" => out.rain = on,
                            "bloom" => out.bloom = on,
                            "low" => out.low = on,
                            other => {
                                return Err(lua_err(format!(
                                    "effects has no '{other}'; it takes {}, low",
                                    whole_effect_names()
                                )));
                            }
                        }
                    }
                    out
                }
                _ => return Err(lua_err("effects takes \"high\", \"low\", \"off\" or { lights = true, shadows = true, reflections = true, rain = true, bloom = true }")),
            };
            Ok(())
        })?,
    )?;
    // --- for the framework
    // view_origin(x, y): the world position of the view's top-left corner (the 2D camera), before anything is drawn
    let s = shared.clone();
    raw.set(
        "view_origin",
        lua.create_function(move |_, (x, y): (f64, f64)| {
            s.borrow_mut().fx.origin = [x as f32, y as f32];
            Ok(())
        })?,
    )?;
    // light_at(x, y, opts): an entity's `light` (x, y in the table are an offset from the entity)
    let s = shared.clone();
    raw.set(
        "light_at",
        lua.create_function(move |_, (x, y, opts): (f64, f64, Table)| {
            push_light(&mut s.borrow_mut(), x, y, &opts, true)
        })?,
    )?;
    // shadow2d(x, y, rx, ry, alpha): a soft ellipse in screen coordinates (an entity's `shadow`); all of a frame's are drawn together
    let s = shared.clone();
    raw.set(
        "shadow2d",
        lua.create_function(move |_, (x, y, rx, ry, alpha): (f64, f64, f64, f64, f64)| {
            let mut sh = s.borrow_mut();
            if !sh.fx.toggles.shadows {
                return Ok(());
            }
            if sh.fx.shadows_at.is_none() {
                sh.fx.shadows_at = Some(sh.world.len());
            }
            let uv = sh.layout.white_uv();
            sh.fx.shadows.push(SpriteInstance {
                center: [x as f32, y as f32],
                size: [(2.0 * rx) as f32, (2.0 * ry) as f32],
                uv,
                color: [0, 0, 0, (alpha.clamp(0.0, 1.0) * 255.0).round() as u8],
                rotation: 0.0,
            });
            Ok(())
        })?,
    )?;
    // rain2d(amount, wind, color) | rain2d(nil)
    let s = shared.clone();
    raw.set(
        "rain2d",
        lua.create_function(move |_, (amount, wind, color): (Option<f64>, Option<f64>, Option<Table>)| {
            let mut sh = s.borrow_mut();
            sh.fx.rain = match amount {
                None => None,
                Some(a) if !(0.0..=1.0).contains(&a) => {
                    return Err(lua_err("weather rain is from 0 (none) to 1 (a downpour)"));
                }
                Some(a) => {
                    let wind = wind.unwrap_or(0.25);
                    if !(-3.0..=3.0).contains(&wind) {
                        return Err(lua_err("weather wind is from -3 to 3 (sideways units for each unit of fall; 0.3 slants it)"));
                    }
                    let c = rgba(color)?;
                    let c = if c == [255; 4] { [170, 190, 230, 120] } else { c };
                    Some(Rain2d {
                        amount: a as f32,
                        wind: wind as f32,
                        color: [
                            linear(f32::from(c[0]) / 255.0),
                            linear(f32::from(c[1]) / 255.0),
                            linear(f32::from(c[2]) / 255.0),
                            f32::from(c[3]) / 255.0,
                        ],
                    })
                }
            };
            Ok(())
        })?,
    )?;
    // lights2d() -> { { x, y, rx, ry }, ... } in screen units: this frame's lights (for `play`'s overlay)
    let s = shared.clone();
    raw.set(
        "lights2d",
        lua.create_function(move |lua, ()| {
            let sh = s.borrow();
            let out = lua.create_table()?;
            for (i, (l, _)) in sh.fx.lights.iter().enumerate() {
                let t = lua.create_table()?;
                t.set("x", l.center[0])?;
                t.set("y", l.center[1])?;
                t.set("rx", l.radius[0])?;
                t.set("ry", l.radius[1])?;
                out.set(i + 1, t)?;
            }
            Ok(out)
        })?,
    )?;
    Ok(())
}

/// The frame's effects for the renderer, made at the end of the frame from what was asked (and the world's sprites, for the mirrored
/// copies), and what they were for the report. None when nothing is asked for: the frame is then drawn exactly as without effects.
pub(super) fn finish(
    sh: &mut Shared,
    world: &[SpriteInstance],
    bloom: f32,
) -> (Option<Fx2d>, Fx2dFacts) {
    let fx = &mut sh.fx;
    let t = fx.toggles;
    let lighting = fx.lighting();
    let reflecting = fx.reflecting() && !fx.mask.is_empty();
    let rain = fx.rain.filter(|_| t.rain).map(|r| Rain2d {
        amount: if t.low { r.amount * 0.5 } else { r.amount },
        ..r
    });
    let mut off = Vec::new();
    for (name, on) in [
        ("lights", t.lights),
        ("shadows", t.shadows),
        ("reflections", t.reflections),
        ("rain", t.rain),
        ("bloom", t.bloom),
    ] {
        if !on {
            off.push(name);
        }
    }
    // the nearest lights to the middle of the view, when there are too many
    let dropped = fx.lights.len().saturating_sub(MAX_LIGHTS_2D);
    if fx.lights.len() > MAX_LIGHTS_2D {
        fx.lights.sort_by(|a, b| a.1.total_cmp(&b.1));
        fx.lights.truncate(MAX_LIGHTS_2D);
    }
    let mut mirrored = Vec::new();
    let mut mirrored_styles = Vec::new();
    if reflecting && let Some(at) = fx.reflect_at {
        mirror(fx, world, at, sh.view, &mut mirrored, &mut mirrored_styles);
    }
    let facts = Fx2dFacts {
        any: fx.ambient.is_some()
            || !fx.styles.is_empty()
            || !fx.shadows.is_empty()
            || fx.reflect.is_some()
            || fx.rain.is_some()
            || fx.reflective_tiles > 0,
        ambient: fx.ambient.map(|a| a.0),
        lights: if lighting { fx.lights.len() } else { 0 },
        lights_asked: fx.lights_asked,
        dropped: if lighting { dropped } else { 0 },
        added: fx.added,
        shadows: fx.shadows.len(),
        reflections: reflecting,
        reflective_tiles: fx.reflective_tiles,
        mirrored: mirrored.len(),
        rain: rain.map(|r| r.amount),
        bloom,
        low: t.low,
        off,
    };
    let active =
        lighting || !fx.styles.is_empty() || !fx.shadows.is_empty() || reflecting || rain.is_some();
    if !active {
        return (None, facts);
    }
    let frame = Fx2dFrame {
        ambient: lighting.then(|| fx.ambient.map(|a| a.1)).flatten(),
        lights: if lighting {
            fx.lights.iter().map(|l| l.0).collect()
        } else {
            Vec::new()
        },
        light_scale: if t.low { 8 } else { 4 },
        styles: std::mem::take(&mut fx.styles),
        shadows: std::mem::take(&mut fx.shadows),
        shadows_at: fx.shadows_at.unwrap_or(0),
        reflect: if reflecting { fx.reflect } else { None },
        mask: if reflecting {
            std::mem::take(&mut fx.mask)
        } else {
            Vec::new()
        },
        reflect_at: fx.reflect_at.unwrap_or(0),
        mirrored,
        mirrored_styles,
        rain,
        origin: fx.origin,
        time: (sh.time % 10_000.0) as f32,
    };
    (Some(Fx2d(std::sync::Arc::new(frame))), facts)
}

/// The sprites drawn after the reflective layer whose flipped copy lands on a reflective tile, flipped about their foot.
fn mirror(
    fx: &Fx2dState,
    world: &[SpriteInstance],
    at: usize,
    view: [f32; 2],
    out: &mut Vec<SpriteInstance>,
    styles: &mut Vec<(usize, Style2d)>,
) {
    // a coarse grid over the view (16 units a cell) of where the reflective tiles are, to test each flipped copy cheaply
    const CELL: f32 = 16.0;
    let cols = (view[0] / CELL).ceil().max(1.0) as usize + 1;
    let rows = (view[1] / CELL).ceil().max(1.0) as usize + 1;
    let mut grid = vec![false; cols * rows];
    let cell_range = |lo: f32, hi: f32, n: usize| -> Option<(usize, usize)> {
        let a = (lo / CELL).floor().max(0.0) as usize;
        let b = ((hi / CELL).floor().max(-1.0) as isize).min(n as isize - 1);
        (b >= a as isize).then_some((a, b as usize))
    };
    for m in &fx.mask {
        let (hw, hh) = (m.size[0].abs() * 0.5, m.size[1].abs() * 0.5);
        let (Some((c0, c1)), Some((r0, r1))) = (
            cell_range(m.center[0] - hw, m.center[0] + hw - 0.01, cols),
            cell_range(m.center[1] - hh, m.center[1] + hh - 0.01, rows),
        ) else {
            continue;
        };
        for r in r0..=r1 {
            for c in c0..=c1 {
                grid[r * cols + c] = true;
            }
        }
    }
    let mut axes = fx.axes.iter().peekable();
    let mut marks = fx.styles.iter().peekable();
    for (i, s) in world.iter().enumerate().skip(at) {
        while axes.peek().is_some_and(|a| a.0 < i) {
            axes.next();
        }
        while marks.peek().is_some_and(|m| m.0 < i) {
            marks.next();
        }
        if out.len() >= MAX_MIRRORED {
            break;
        }
        if s.color[3] == 0 {
            continue;
        }
        let style = marks.peek().filter(|m| m.0 == i).map(|m| m.1);
        // (a soft or round shape mirrors too: a glow on the water)
        let (sin, cos) = s.rotation.sin_cos();
        let (w, h) = (s.size[0].abs(), s.size[1].abs());
        let half_h = 0.5 * (w * sin.abs() + h * cos.abs());
        let half_w = 0.5 * (w * cos.abs() + h * sin.abs());
        let foot = axes
            .peek()
            .filter(|a| a.0 == i)
            .map_or(s.center[1] + half_h, |a| a.1);
        let cy = 2.0 * foot - s.center[1];
        let (Some((c0, c1)), Some((r0, r1))) = (
            cell_range(s.center[0] - half_w, s.center[0] + half_w, cols),
            cell_range(cy - half_h, cy + half_h, rows),
        ) else {
            continue;
        };
        let hit = (r0..=r1).any(|r| (c0..=c1).any(|c| grid[r * cols + c]));
        if !hit {
            continue;
        }
        if let Some(style) = style {
            styles.push((out.len(), style));
        }
        out.push(SpriteInstance {
            center: [s.center[0], cy],
            size: [s.size[0], -s.size[1]],
            rotation: -s.rotation,
            ..*s
        });
    }
}
