//! Sprite sheets: `sprites/<name>.sprite.json`, format version 1.
//!
//! A sheet file describes how to cut one PNG into equal frames and how to play them.
//! The model follows Pixelorama's: frames in a grid, a duration per frame, and *tags*
//! (named frame ranges with a play direction). The sprite studio (M5) will write these
//! files; hand edits are fine.
//!
//! ```json
//! {
//!   "version": 1,
//!   "image": "hero_sheet.png",
//!   "frame_width": 32, "frame_height": 32,
//!   "columns": 4, "frames": 6,
//!   "frame_duration_ms": 100,
//!   "tags": [
//!     { "name": "idle", "from": 0, "to": 1, "direction": "pingpong" },
//!     { "name": "run",  "from": 2, "to": 5 },
//!     { "name": "hit",  "from": 5, "to": 5, "loop": false }
//!   ]
//! }
//! ```
//!
//! `image` is relative to the file's folder. `columns` and `frames` default to what fits
//! in the image. Durations come from `frame_duration_ms` (default 100, for every frame)
//! or `durations_ms` (one per frame).

use serde_json::{Map, Value};

use crate::vfs::normalize;

pub const VERSION: u64 = 1;
pub const MAX_FRAMES: u32 = 4096;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Forward,
    Reverse,
    PingPong,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Tag {
    pub name: String,
    pub from: u32,
    pub to: u32,
    pub direction: Direction,
    pub looping: bool,
}

impl Tag {
    /// The absolute frame numbers one pass of this tag plays, in order. Ping-pong goes
    /// forward then back without repeating the end frames, so a loop has no stutter.
    pub fn sequence(&self) -> Vec<u32> {
        let forward: Vec<u32> = (self.from..=self.to).collect();
        match self.direction {
            Direction::Forward => forward,
            Direction::Reverse => forward.into_iter().rev().collect(),
            Direction::PingPong => {
                let mut seq = forward.clone();
                if forward.len() > 2 {
                    seq.extend(forward[1..forward.len() - 1].iter().rev());
                } else if forward.len() == 2 {
                    // Two frames ping-pong as 0,1 which loops as 0,1,0,1: nothing to add.
                }
                seq
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SpriteDef {
    /// Full project path of the sheet's PNG.
    pub image: String,
    pub frame_width: u32,
    pub frame_height: u32,
    pub columns: u32,
    pub frames: u32,
    pub durations_ms: Vec<u32>,
    pub tags: Vec<Tag>,
}

impl SpriteDef {
    /// Column and row of a frame in the sheet.
    pub fn cell(&self, frame: u32) -> (u32, u32) {
        let frame = frame.min(self.frames.saturating_sub(1));
        (frame % self.columns, frame / self.columns)
    }
}

fn err(path: &str, message: impl std::fmt::Display) -> String {
    format!("{path}: {message}")
}

fn whole(o: &Map<String, Value>, key: &str, at: &str) -> Result<Option<u32>, String> {
    match o.get(key) {
        None => Ok(None),
        Some(v) => match v.as_u64() {
            Some(n) if n <= u32::MAX as u64 => Ok(Some(n as u32)),
            _ => Err(err(
                &format!("{at}.{key}"),
                format!("\"{key}\" must be a whole number, 0 or more"),
            )),
        },
    }
}

/// Validates a sprite sheet file. `file` is its project path; `image_size` reports the
/// pixel size of a project image (None when it does not exist).
pub fn parse_sprite(
    text: &str,
    file: &str,
    image_size: &dyn Fn(&str) -> Option<(u32, u32)>,
) -> Result<SpriteDef, String> {
    let value: Value = serde_json::from_str(text).map_err(|e| {
        err(
            file,
            format!(
                "not valid JSON (line {}, column {}): {e}",
                e.line(),
                e.column()
            ),
        )
    })?;
    let root = value.as_object().ok_or_else(|| {
        err(
            file,
            "must be a JSON object like {\"version\": 1, \"image\": \"sheet.png\", ...}",
        )
    })?;
    match root.get("version") {
        None => return Err(err(file, "missing \"version\"; add \"version\": 1")),
        Some(v) if v.as_u64() == Some(VERSION) => {}
        Some(v) => {
            return Err(err(
                file,
                format!(
                    "unsupported \"version\" {v}; this Nova understands sprite version {VERSION}"
                ),
            ));
        }
    }
    for key in root.keys() {
        if ![
            "version",
            "image",
            "frame_width",
            "frame_height",
            "columns",
            "frames",
            "frame_duration_ms",
            "durations_ms",
            "tags",
        ]
        .contains(&key.as_str())
        {
            return Err(err(file, format!("unknown key \"{key}\"")));
        }
    }

    let image_rel = match root.get("image") {
        Some(Value::String(s)) if !s.is_empty() => s.as_str(),
        Some(_) => {
            return Err(err(
                &format!("{file}.image"),
                "\"image\" must be a non-empty string",
            ));
        }
        None => return Err(err(file, "missing \"image\" (the PNG this sheet cuts up)")),
    };
    let folder = file.rsplit_once('/').map(|(f, _)| f).unwrap_or("");
    let joined = if folder.is_empty() {
        image_rel.to_string()
    } else {
        format!("{folder}/{image_rel}")
    };
    let image = normalize(&joined).map_err(|e| err(&format!("{file}.image"), e))?;
    let (iw, ih) = image_size(&image).ok_or_else(|| {
        err(
            &format!("{file}.image"),
            format!("'{image}' is not an image in this project (PNG files only)"),
        )
    })?;

    let frame_width =
        whole(root, "frame_width", file)?.ok_or_else(|| err(file, "missing \"frame_width\""))?;
    let frame_height =
        whole(root, "frame_height", file)?.ok_or_else(|| err(file, "missing \"frame_height\""))?;
    if frame_width == 0 || frame_height == 0 {
        return Err(err(
            file,
            "\"frame_width\" and \"frame_height\" must be greater than 0",
        ));
    }
    if frame_width > iw || frame_height > ih {
        return Err(err(
            file,
            format!(
                "frames of {frame_width}x{frame_height} do not fit in the {iw}x{ih} image '{image}'"
            ),
        ));
    }
    let fit_columns = iw / frame_width;
    let fit_rows = ih / frame_height;
    let columns = whole(root, "columns", file)?.unwrap_or(fit_columns);
    if columns == 0 || columns > fit_columns {
        return Err(err(
            &format!("{file}.columns"),
            format!(
                "\"columns\" is {columns} but only {fit_columns} columns of {frame_width} pixels fit in a {iw} pixel wide image"
            ),
        ));
    }
    let frames = whole(root, "frames", file)?.unwrap_or(columns * fit_rows);
    let max_frames = columns * fit_rows;
    if frames == 0 || frames > max_frames || frames > MAX_FRAMES {
        return Err(err(
            &format!("{file}.frames"),
            format!(
                "\"frames\" is {frames} but the image holds {max_frames} frames of {frame_width}x{frame_height} (at most {MAX_FRAMES})"
            ),
        ));
    }

    let durations_ms = match (root.get("durations_ms"), root.get("frame_duration_ms")) {
        (Some(_), Some(_)) => {
            return Err(err(
                file,
                "use either \"durations_ms\" or \"frame_duration_ms\", not both",
            ));
        }
        (Some(Value::Array(list)), None) => {
            if list.len() != frames as usize {
                return Err(err(
                    &format!("{file}.durations_ms"),
                    format!(
                        "has {} entries but the sheet has {frames} frames",
                        list.len()
                    ),
                ));
            }
            list.iter()
                .enumerate()
                .map(|(i, d)| match d.as_u64() {
                    Some(n) if (1..=60_000).contains(&n) => Ok(n as u32),
                    _ => Err(err(
                        &format!("{file}.durations_ms[{i}]"),
                        "durations are milliseconds from 1 to 60000",
                    )),
                })
                .collect::<Result<Vec<_>, _>>()?
        }
        (Some(_), None) => {
            return Err(err(
                &format!("{file}.durations_ms"),
                "\"durations_ms\" must be a list of numbers",
            ));
        }
        (None, Some(v)) => match v.as_u64() {
            Some(n) if (1..=60_000).contains(&n) => vec![n as u32; frames as usize],
            _ => {
                return Err(err(
                    &format!("{file}.frame_duration_ms"),
                    "must be milliseconds from 1 to 60000",
                ));
            }
        },
        (None, None) => vec![100; frames as usize],
    };

    let mut tags: Vec<Tag> = Vec::new();
    match root.get("tags") {
        None => {}
        Some(Value::Array(list)) => {
            for (i, item) in list.iter().enumerate() {
                let at = format!("{file}.tags[{i}]");
                let o = item
                    .as_object()
                    .ok_or_else(|| err(&at, "each tag must be a JSON object"))?;
                for key in o.keys() {
                    if !["name", "from", "to", "direction", "loop"].contains(&key.as_str()) {
                        return Err(err(&at, format!("unknown key \"{key}\"")));
                    }
                }
                let name = match o.get("name") {
                    Some(Value::String(s)) if !s.is_empty() => s.clone(),
                    _ => return Err(err(&at, "missing \"name\" (a non-empty string)")),
                };
                if tags.iter().any(|t| t.name == name) {
                    return Err(err(&at, format!("the tag \"{name}\" is defined twice")));
                }
                let from = whole(o, "from", &at)?
                    .ok_or_else(|| err(&at, "missing \"from\" (first frame)"))?;
                let to = whole(o, "to", &at)?.unwrap_or(from);
                if from > to || to >= frames {
                    return Err(err(
                        &at,
                        format!(
                            "frames {from} to {to} are not a valid range for a sheet with frames 0 to {}",
                            frames - 1
                        ),
                    ));
                }
                let direction = match o.get("direction") {
                    None => Direction::Forward,
                    Some(Value::String(s)) if s == "forward" => Direction::Forward,
                    Some(Value::String(s)) if s == "reverse" => Direction::Reverse,
                    Some(Value::String(s)) if s == "pingpong" => Direction::PingPong,
                    Some(_) => {
                        return Err(err(
                            &format!("{at}.direction"),
                            "\"direction\" must be \"forward\", \"reverse\" or \"pingpong\"",
                        ));
                    }
                };
                let looping = match o.get("loop") {
                    None => true,
                    Some(Value::Bool(b)) => *b,
                    Some(_) => {
                        return Err(err(&format!("{at}.loop"), "\"loop\" must be true or false"));
                    }
                };
                tags.push(Tag {
                    name,
                    from,
                    to,
                    direction,
                    looping,
                });
            }
        }
        Some(_) => return Err(err(&format!("{file}.tags"), "\"tags\" must be a list")),
    }

    Ok(SpriteDef {
        image,
        frame_width,
        frame_height,
        columns,
        frames,
        durations_ms,
        tags,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sizes(id: &str) -> Option<(u32, u32)> {
        match id {
            "sprites/sheet.png" => Some((128, 64)),
            "sheet.png" => Some((128, 64)),
            _ => None,
        }
    }

    fn parse(text: &str) -> Result<SpriteDef, String> {
        parse_sprite(text, "sprites/hero.sprite.json", &sizes)
    }

    #[test]
    fn defaults_fill_columns_frames_and_durations_from_the_image() {
        let d = parse(r#"{"version":1,"image":"sheet.png","frame_width":32,"frame_height":32}"#)
            .unwrap();
        assert_eq!(
            (d.image.as_str(), d.columns, d.frames),
            ("sprites/sheet.png", 4, 8)
        );
        assert_eq!(d.durations_ms, vec![100; 8]);
        assert_eq!(d.cell(5), (1, 1));
        assert_eq!(d.cell(99), (3, 1), "frame numbers clamp to the last frame");
        assert!(d.tags.is_empty());
    }

    /// The exact shapes the studio's sprite editor writes (`toSheetJson` in studio/src/lib/sprite-doc.ts;
    /// its test pins the same text), so a format drift on either side fails a test.
    #[test]
    fn files_written_by_the_studio_are_accepted() {
        let full = "{\n  \"version\": 1,\n  \"image\": \"sheet.png\",\n  \"frame_width\": 32,\n  \"frame_height\": 32,\n  \"columns\": 4,\n  \"frames\": 4,\n  \"durations_ms\": [100, 100, 250, 100],\n  \"tags\": [\n    { \"name\": \"run\", \"from\": 0, \"to\": 2, \"direction\": \"pingpong\" },\n    { \"name\": \"hit\", \"from\": 3, \"to\": 3, \"loop\": false }\n  ]\n}\n";
        let d = parse(full).unwrap();
        assert_eq!((d.columns, d.frames), (4, 4));
        assert_eq!(d.durations_ms, vec![100, 100, 250, 100]);
        assert_eq!(d.tags[0].sequence(), vec![0, 1, 2, 1]);
        assert!(!d.tags[1].looping);

        let single = "{\n  \"version\": 1,\n  \"image\": \"sheet.png\",\n  \"frame_width\": 128,\n  \"frame_height\": 64,\n  \"frame_duration_ms\": 100\n}\n";
        let d = parse(single).unwrap();
        assert_eq!((d.columns, d.frames), (1, 1));
    }

    #[test]
    fn the_image_path_is_relative_to_the_sheet_file() {
        let d = parse_sprite(
            r#"{"version":1,"image":"sprites/sheet.png","frame_width":64,"frame_height":64}"#,
            "game.sprite.json",
            &sizes,
        )
        .unwrap();
        assert_eq!(d.image, "sprites/sheet.png");
    }

    #[test]
    fn tags_durations_and_directions_are_read() {
        let d = parse(
            r#"{"version":1,"image":"sheet.png","frame_width":32,"frame_height":32,"frames":6,
                "durations_ms":[50,60,70,80,90,100],
                "tags":[{"name":"idle","from":0,"to":1,"direction":"pingpong"},
                        {"name":"run","from":2,"to":5},
                        {"name":"hit","from":5,"loop":false,"direction":"reverse"}]}"#,
        )
        .unwrap();
        assert_eq!(d.durations_ms, [50, 60, 70, 80, 90, 100]);
        assert_eq!(d.tags.len(), 3);
        assert_eq!(d.tags[1].sequence(), [2, 3, 4, 5]);
        assert!(!d.tags[2].looping);
        assert_eq!(
            (d.tags[2].from, d.tags[2].to),
            (5, 5),
            "\"to\" defaults to \"from\""
        );
    }

    #[test]
    fn pingpong_does_not_repeat_the_end_frames() {
        let tag = |from, to, direction| Tag {
            name: "t".into(),
            from,
            to,
            direction,
            looping: true,
        };
        assert_eq!(
            tag(0, 3, Direction::PingPong).sequence(),
            [0, 1, 2, 3, 2, 1]
        );
        assert_eq!(tag(0, 1, Direction::PingPong).sequence(), [0, 1]);
        assert_eq!(tag(4, 4, Direction::PingPong).sequence(), [4]);
        assert_eq!(tag(1, 3, Direction::Reverse).sequence(), [3, 2, 1]);
    }

    #[test]
    fn malformed_sheets_name_the_exact_problem() {
        let cases: &[(&str, &str)] = &[
            ("{ nope", "not valid JSON"),
            ("[]", "must be a JSON object"),
            (r#"{}"#, "missing \"version\""),
            (r#"{"version":3}"#, "unsupported \"version\" 3"),
            (r#"{"version":1,"bogus":1}"#, "unknown key \"bogus\""),
            (r#"{"version":1}"#, "missing \"image\""),
            (
                r#"{"version":1,"image":"missing.png","frame_width":8,"frame_height":8}"#,
                "not an image in this project",
            ),
            (
                r#"{"version":1,"image":"../x.png","frame_width":8,"frame_height":8}"#,
                "leaves the project",
            ),
            (
                r#"{"version":1,"image":"sheet.png","frame_height":8}"#,
                "missing \"frame_width\"",
            ),
            (
                r#"{"version":1,"image":"sheet.png","frame_width":0,"frame_height":8}"#,
                "greater than 0",
            ),
            (
                r#"{"version":1,"image":"sheet.png","frame_width":500,"frame_height":8}"#,
                "do not fit",
            ),
            (
                r#"{"version":1,"image":"sheet.png","frame_width":32,"frame_height":32,"columns":9}"#,
                "only 4 columns",
            ),
            (
                r#"{"version":1,"image":"sheet.png","frame_width":32,"frame_height":32,"frames":99}"#,
                "the image holds 8 frames",
            ),
            (
                r#"{"version":1,"image":"sheet.png","frame_width":32,"frame_height":32,"durations_ms":[1,2]}"#,
                "has 2 entries but the sheet has 8",
            ),
            (
                r#"{"version":1,"image":"sheet.png","frame_width":32,"frame_height":32,"durations_ms":[1],"frame_duration_ms":5}"#,
                "not both",
            ),
            (
                r#"{"version":1,"image":"sheet.png","frame_width":32,"frame_height":32,"frame_duration_ms":0}"#,
                "1 to 60000",
            ),
            (
                r#"{"version":1,"image":"sheet.png","frame_width":32,"frame_height":32,"tags":{}}"#,
                "\"tags\" must be a list",
            ),
            (
                r#"{"version":1,"image":"sheet.png","frame_width":32,"frame_height":32,"tags":[{"from":0}]}"#,
                "tags[0]: missing \"name\"",
            ),
            (
                r#"{"version":1,"image":"sheet.png","frame_width":32,"frame_height":32,"tags":[{"name":"a"}]}"#,
                "missing \"from\"",
            ),
            (
                r#"{"version":1,"image":"sheet.png","frame_width":32,"frame_height":32,"tags":[{"name":"a","from":5,"to":2}]}"#,
                "not a valid range",
            ),
            (
                r#"{"version":1,"image":"sheet.png","frame_width":32,"frame_height":32,"tags":[{"name":"a","from":0,"to":8}]}"#,
                "frames 0 to 7",
            ),
            (
                r#"{"version":1,"image":"sheet.png","frame_width":32,"frame_height":32,"tags":[{"name":"a","from":0,"direction":"sideways"}]}"#,
                "tags[0].direction",
            ),
            (
                r#"{"version":1,"image":"sheet.png","frame_width":32,"frame_height":32,"tags":[{"name":"a","from":0},{"name":"a","from":1}]}"#,
                "defined twice",
            ),
            (
                r#"{"version":1,"image":"sheet.png","frame_width":32,"frame_height":32,"tags":[{"name":"a","from":0,"loop":"yes"}]}"#,
                "tags[0].loop",
            ),
        ];
        for (text, expected) in cases {
            let e = parse(text)
                .err()
                .unwrap_or_else(|| format!("accepted {text}"));
            assert!(
                e.contains(expected),
                "sheet {text}: expected '{expected}' in '{e}'"
            );
            assert!(
                e.starts_with("sprites/hero.sprite.json"),
                "messages begin with the file: {e}"
            );
        }
    }
}
