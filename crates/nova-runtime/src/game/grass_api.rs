//! `nova.grass{ ... }` and `nova.grass_bend(x, z, radius)`: blades of grass round the camera (gfx/grass.rs; docs/project-format.md,
//! "Grass").

use super::*;
use crate::gfx::{Grass, GroundPicture};

const USAGE: &str = "grass takes map = \"terrain/grass.png\" with x, z and size (or cell), and if wanted color = { r, g, b }, \
colors = { x =, z =, cell =, columns =, rows =, data = { r, g, b, ... } }, height (metres, 0.05 to 2), width (0.01 to 0.5), \
density (clumps a square metre, 0.5 to 40), distance (metres, 4 to 80) and sway (0 to 4): nova.grass { map = \"terrain/grass.png\", \
x = -250, z = -265, size = 500 }; nova.grass() turns it off";

/// Where grass grows, from a picture: its grey (or red) channel, 0 none to 255 full.
fn density_picture(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|e| format!("not a readable PNG: {e}"))?;
    let mut buffer = vec![0u8; reader.output_buffer_size().ok_or("PNG is too large")?];
    let info = reader
        .next_frame(&mut buffer)
        .map_err(|e| format!("PNG data is damaged: {e}"))?;
    let (w, h) = (info.width, info.height);
    if !(2..=8192).contains(&w) || !(2..=8192).contains(&h) {
        return Err(format!(
            "a grass map is from 2 to 8192 pixels on a side, this one is {w} by {h}"
        ));
    }
    let channels = info.color_type.samples();
    let data = &buffer[..info.buffer_size()];
    Ok((w, h, data.chunks_exact(channels).map(|px| px[0]).collect()))
}

fn finite(v: f64, what: &str) -> mlua::Result<f32> {
    if v.is_finite() {
        Ok(v as f32)
    } else {
        Err(lua_err(format!("grass {what} must be a finite number")))
    }
}

pub(super) fn install(
    lua: &Lua,
    shared: &Rc<RefCell<Shared>>,
    vfs: &Rc<dyn Vfs>,
    nova: &Table,
) -> mlua::Result<()> {
    let s = shared.clone();
    let vfs = vfs.clone();
    type Loaded = Option<(String, Arc<GroundPicture>)>;
    let loaded: Rc<RefCell<Loaded>> = Rc::new(RefCell::new(None));
    nova.set(
        "grass",
        lua.create_function(move |_, opts: Option<Table>| {
            let Some(opts) = opts else {
                s.borrow_mut().lighting.grass = None;
                return Ok(());
            };
            let mut grass = Grass::default();
            let some = Some(opts.clone());
            if let Some(path) = string_option(&some, "map")? {
                let x = finite(number_option(&some, "x")?.unwrap_or(0.0), "x")?;
                let z = finite(number_option(&some, "z")?.unwrap_or(0.0), "z")?;
                let size = number_option(&some, "size")?;
                let cell = number_option(&some, "cell")?;
                if size.is_none() && cell.is_none() {
                    return Err(lua_err(USAGE));
                }
                if size.is_some_and(|v| !(v.is_finite() && v > 0.0))
                    || cell.is_some_and(|v| !(v.is_finite() && v > 0.0))
                {
                    return Err(lua_err("grass size and cell must be more than 0"));
                }
                let key = format!("{path}|{x}|{z}|{size:?}|{cell:?}");
                let cached = loaded
                    .borrow()
                    .as_ref()
                    .filter(|(k, _)| *k == key)
                    .map(|(_, m)| m.clone());
                let map = match cached {
                    Some(m) => m,
                    None => {
                        if !vfs.exists(&path) {
                            return Err(lua_err(format!(
                                "grass map '{path}' is not in the project"
                            )));
                        }
                        let bytes = vfs.read(&path).map_err(lua_err)?;
                        let (w, h, texels) = density_picture(&bytes)
                            .map_err(|e| lua_err(format!("grass map '{path}': {e}")))?;
                        let cell = match (size, cell) {
                            (Some(size), _) => size as f32 / (w - 1) as f32,
                            (None, Some(cell)) => cell as f32,
                            _ => unreachable!(),
                        };
                        let m = Arc::new(GroundPicture {
                            width: w,
                            rows: h,
                            x0: x,
                            z0: z,
                            cell,
                            texels,
                        });
                        *loaded.borrow_mut() = Some((key, m.clone()));
                        m
                    }
                };
                grass.map = Some(map);
            }
            if let Some(c) = opts.get::<Option<Table>>("color")? {
                // (sRGB 0 to 255, as every colour in the API; kept linear)
                let mut rgb = [0.0f64; 4];
                for (i, v) in rgb.iter_mut().take(3).enumerate() {
                    let n: f64 = c.get(i + 1).map_err(|_| lua_err(USAGE))?;
                    *v = (finite(n, "color")? as f64 / 255.0).clamp(0.0, 1.0);
                }
                let lin = srgb_to_linear(rgb);
                grass.color = [lin[0] as f32, lin[1] as f32, lin[2] as f32];
            }
            if let Some(c) = opts.get::<Option<Table>>("colors")? {
                let cs = Some(c.clone());
                let columns = number_option(&cs, "columns")?.unwrap_or(0.0);
                let rows = number_option(&cs, "rows")?.unwrap_or(0.0);
                let cell = number_option(&cs, "cell")?.unwrap_or(0.0);
                if !(2.0..=4096.0).contains(&columns)
                    || !(2.0..=4096.0).contains(&rows)
                    || !(cell.is_finite() && cell > 0.0)
                {
                    return Err(lua_err(
                        "grass colors need columns and rows (2 to 4096) and cell (metres, above 0)",
                    ));
                }
                let (w, h) = (columns as u32, rows as u32);
                let data: Vec<f64> = c
                    .get::<Option<Vec<f64>>>("data")?
                    .ok_or_else(|| lua_err("grass colors need data = { r, g, b, ... }"))?;
                if data.len() != (w * h * 3) as usize {
                    return Err(lua_err(format!(
                        "grass colors: data has {} numbers, columns x rows x 3 is {}",
                        data.len(),
                        w * h * 3
                    )));
                }
                let mut texels = Vec::with_capacity((w * h * 4) as usize);
                for px in data.as_chunks::<3>().0 {
                    for v in px {
                        texels.push(v.clamp(0.0, 255.0) as u8);
                    }
                    texels.push(255);
                }
                grass.colors = Some(Arc::new(GroundPicture {
                    width: w,
                    rows: h,
                    x0: finite(number_option(&cs, "x")?.unwrap_or(0.0), "colors x")?,
                    z0: finite(number_option(&cs, "z")?.unwrap_or(0.0), "colors z")?,
                    cell: cell as f32,
                    texels,
                }));
            }
            let range = |key: &str, lo: f64, hi: f64, now: f32| -> mlua::Result<f32> {
                match number_option(&some, key)? {
                    Some(v) if v.is_finite() && (lo..=hi).contains(&v) => Ok(v as f32),
                    Some(_) => Err(lua_err(USAGE)),
                    None => Ok(now),
                }
            };
            grass.height = range("height", 0.05, 2.0, grass.height)?;
            grass.width = range("width", 0.01, 0.5, grass.width)?;
            grass.density = range("density", 0.5, 40.0, grass.density)?;
            grass.distance = range("distance", 4.0, 80.0, grass.distance)?;
            grass.sway = range("sway", 0.0, 4.0, grass.sway)?;
            s.borrow_mut().lighting.grass = Some(grass);
            Ok(())
        })?,
    )?;
    // grass_bend(x, z, radius): the grass within `radius` metres of that point bends away from it this frame (up to 8 a frame)
    let s = shared.clone();
    nova.set(
        "grass_bend",
        lua.create_function(move |_, (x, z, radius): (f64, f64, Option<f64>)| {
            let r = radius.unwrap_or(0.8);
            if !(x.is_finite() && z.is_finite() && r.is_finite() && r > 0.0) {
                return Err(lua_err(
                    "grass_bend takes x, z and a radius above 0: nova.grass_bend(hero.x, hero.z, 0.8)",
                ));
            }
            let mut sh = s.borrow_mut();
            if let Some(g) = sh.lighting.grass.as_mut()
                && g.bends.len() < crate::gfx::grass::MAX_BENDS
            {
                g.bends.push([x as f32, 0.0, z as f32, r as f32]);
            }
            Ok(())
        })?,
    )?;
    Ok(())
}
