//! Custom shaders a person writes: a `shaders/<name>.wgsl` file in the project that defines one function,
//! `fn shade(s: Surface) -> vec4<f32>`, the colour of a pixel. Nova puts it after its own prelude (the vertex work, the inputs, a
//! few helpers) for each place a shader can be used: on a model, on a sprite, or as a full-screen post effect over the world.
//!
//! Everything here runs on the CPU with naga (the shader compiler inside wgpu), so a project's shaders are checked by `nova check`
//! and when the game loads, before anything reaches the GPU: a mistake is a message with the file's own line and column, never a
//! GPU error. The same check translates each one for OpenGL ES 3.0 (the fallback backend), so a shader that could not run there
//! fails clearly too. See `docs/shaders.md`.

const MESH: &str = include_str!("shaders/mesh.wgsl");
const SPRITE: &str = include_str!("shaders/sprite.wgsl");
const COMMON: &str = include_str!("shaders/custom_common.wgsl");
const MODEL_HOOK: &str = include_str!("shaders/custom_model.wgsl");
const SPRITE_HOOK: &str = include_str!("shaders/custom_sprite.wgsl");
const POST_HOOK: &str = include_str!("shaders/custom_post.wgsl");

/// The fragment entry point every composed module has.
pub const FRAGMENT: &str = "fs_custom";

/// Where a custom shader is used: each has its own prelude and pipelines.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Kind {
    Model,
    Sprite,
    Post,
}

impl Kind {
    pub const ALL: [Kind; 3] = [Kind::Model, Kind::Sprite, Kind::Post];

    fn prelude(self) -> String {
        let parts: &[&str] = match self {
            Kind::Model => &[MESH, COMMON, MODEL_HOOK],
            Kind::Sprite => &[SPRITE, COMMON, SPRITE_HOOK],
            Kind::Post => &[COMMON, POST_HOOK],
        };
        let mut s = parts.join("\n");
        s.push_str("\n// ---- the project's shader ----\n");
        s
    }

    /// The vertex entry points the pipelines of this kind use.
    pub fn vertex_entries(self) -> &'static [&'static str] {
        match self {
            Kind::Model => &["vs_main", "vs_skinned"],
            Kind::Sprite => &["vs_main"],
            Kind::Post => &["vs_post"],
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Kind::Model => "a model",
            Kind::Sprite => "a sprite",
            Kind::Post => "a post effect",
        }
    }
}

/// A mistake in a shader file, at its own line and column (1-based; 0 when it is about the file as a whole).
#[derive(Clone, Debug, PartialEq)]
pub struct ShaderError {
    pub line: usize,
    pub column: usize,
    pub message: String,
}

impl ShaderError {
    fn whole(message: impl Into<String>) -> Self {
        Self {
            line: 0,
            column: 0,
            message: message.into(),
        }
    }

    /// `path:line:column: message` (or `path: message`).
    pub fn describe(&self, path: &str) -> String {
        if self.line == 0 {
            format!("{path}: {}", self.message)
        } else {
            format!("{path}:{}:{}: {}", self.line, self.column, self.message)
        }
    }
}

/// The whole module for `kind`: Nova's prelude, then the person's file. Also returns the composed line on which the file starts
/// (1-based), to put errors back on the file's own lines.
pub fn compose(kind: Kind, user: &str) -> (String, usize) {
    let prelude = kind.prelude();
    let first_line = prelude.lines().count() + 1;
    (format!("{prelude}{user}\n"), first_line)
}

/// The text with its comments blanked out (same length and lines), for the checks that look for words.
fn without_comments(src: &str) -> String {
    let bytes = src.as_bytes();
    let mut out = String::with_capacity(src.len());
    let mut i = 0;
    let mut depth = 0usize;
    while i < bytes.len() {
        let rest = &src[i..];
        if depth == 0 && rest.starts_with("//") {
            while i < bytes.len() && bytes[i] != b'\n' {
                out.push(' ');
                i += 1;
            }
            continue;
        }
        if rest.starts_with("/*") {
            depth += 1;
            out.push_str("  ");
            i += 2;
            continue;
        }
        if depth > 0 && rest.starts_with("*/") {
            depth -= 1;
            out.push_str("  ");
            i += 2;
            continue;
        }
        let c = rest.chars().next().expect("not at the end");
        if depth > 0 && c != '\n' {
            for _ in 0..c.len_utf8() {
                out.push(' ');
            }
        } else {
            out.push(c);
        }
        i += c.len_utf8();
    }
    out
}

/// Line and column (1-based) of a byte offset.
fn place(src: &str, offset: usize) -> (usize, usize) {
    let before = &src[..offset.min(src.len())];
    let line = before.matches('\n').count() + 1;
    let column = before.rsplit('\n').next().map_or(0, |l| l.chars().count()) + 1;
    (line, column)
}

/// What a shader file may not do: declare GPU resources or entry points of its own (Nova owns those), or switch on extensions.
fn check_safe(user: &str) -> Result<(), ShaderError> {
    let text = without_comments(user);
    const FORBIDDEN: &[(&str, &str)] = &[
        (
            "@group",
            "a shader file cannot declare its own bindings (@group): use the textures and params Nova passes in",
        ),
        (
            "@binding",
            "a shader file cannot declare its own bindings (@binding): use the textures and params Nova passes in",
        ),
        (
            "@vertex",
            "a shader file cannot have entry points (@vertex): write `fn shade(s: Surface) -> vec4<f32>`",
        ),
        (
            "@fragment",
            "a shader file cannot have entry points (@fragment): write `fn shade(s: Surface) -> vec4<f32>`",
        ),
        (
            "@compute",
            "a shader file cannot have entry points (@compute): write `fn shade(s: Surface) -> vec4<f32>`",
        ),
        (
            "var<storage",
            "a shader file cannot declare storage buffers",
        ),
        (
            "var<uniform",
            "a shader file cannot declare uniform buffers: the draw's `params` arrive as s.param and s.param2",
        ),
        (
            "var<workgroup",
            "a shader file cannot declare workgroup memory",
        ),
        (
            "override",
            "a shader file cannot declare pipeline overrides (override): use a const or a param",
        ),
    ];
    for (word, why) in FORBIDDEN {
        let mut from = 0;
        while let Some(at) = text[from..].find(word) {
            let at = from + at;
            from = at + word.len();
            // a whole word only (`overrides` or `my_override` are names, not the keyword)
            let before_ok = text[..at]
                .chars()
                .next_back()
                .is_none_or(|c| !(c.is_alphanumeric() || c == '_'));
            let after_ok = text[from..].chars().next().is_none_or(|c| {
                !(c.is_alphanumeric() || c == '_') || word.ends_with(|c: char| !c.is_alphanumeric())
            });
            if before_ok && after_ok {
                let (line, column) = place(user, at);
                return Err(ShaderError {
                    line,
                    column,
                    message: (*why).to_string(),
                });
            }
        }
    }
    for line in text.lines() {
        let t = line.trim_start();
        if t.starts_with("enable ") || t.starts_with("requires ") {
            let (l, _) = place(user, text.find(line).unwrap_or(0));
            return Err(ShaderError {
                line: l,
                column: 1,
                message: "a shader file cannot switch on WGSL extensions (enable/requires)".into(),
            });
        }
    }
    let has_shade = text
        .match_indices("fn shade")
        .any(|(at, _)| text[at + 8..].trim_start().starts_with('('));
    if !has_shade {
        return Err(ShaderError::whole(
            "no `fn shade(s: Surface) -> vec4<f32>` in the file: that function gives each pixel its colour (see docs/shaders.md)",
        ));
    }
    Ok(())
}

/// Puts a place in the composed module back on the person's file (None when it is in Nova's prelude).
fn user_place(composed: &str, first_line: usize, offset: usize) -> Option<(usize, usize)> {
    let (line, column) = place(composed, offset);
    (line >= first_line).then(|| (line - first_line + 1, column))
}

/// Nova's own names, which a shader file must not define again (they are in the prelude).
fn renamed_hint(message: &str) -> String {
    if message.contains("redefinition") {
        format!(
            "{message} (Nova's prelude already uses that name: pick another; names starting with nova_ are Nova's)"
        )
    } else {
        message.to_string()
    }
}

/// naga's validation messages without its internal numbering: "Function [24] 'shade' is invalid: The `return` expression
/// Some([2]) does not match ..." becomes "in fn shade: the `return` expression does not match ...".
fn tidy(message: &str) -> String {
    let mut out = String::with_capacity(message.len());
    let mut rest = message;
    while let Some(at) = rest.find('[') {
        let close = rest[at..].find(']').map(|c| at + c);
        let inner = close.map(|c| &rest[at + 1..c]);
        if let (Some(c), Some(inner)) = (close, inner)
            && !inner.is_empty()
            && inner.chars().all(|ch| ch.is_ascii_digit())
        {
            let mut head = &rest[..at];
            // "Some([2])": drop the wrapper too
            if head.ends_with("Some(") && rest[c + 1..].starts_with(')') {
                head = &head[..head.len() - 5];
                out.push_str(head.trim_end());
                rest = &rest[c + 2..];
            } else {
                out.push_str(head.trim_end());
                rest = &rest[c + 1..];
            }
            continue;
        }
        out.push_str(&rest[..=at]);
        rest = &rest[at + 1..];
    }
    out.push_str(rest);
    let out = out.replace("Function 'shade' is invalid: ", "in fn shade: ");
    match out.strip_prefix("Function '") {
        Some(r) => match r.split_once("' is invalid: ") {
            Some((name, why)) => format!("in fn {name}: {why}"),
            None => out,
        },
        None => out,
    }
}

/// Parses and validates the composed module of one kind. Returns the checked module.
pub fn validate_kind(kind: Kind, user: &str) -> Result<naga::Module, ShaderError> {
    let (composed, first_line) = compose(kind, user);
    let module = naga::front::wgsl::parse_str(&composed).map_err(|e| {
        let message = renamed_hint(e.message());
        match e
            .location(&composed)
            .and_then(|l| user_place(&composed, first_line, l.offset as usize))
        {
            Some((line, column)) => ShaderError {
                line,
                column,
                message,
            },
            None => ShaderError::whole(message),
        }
    })?;
    let mut validator = naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::empty(),
    );
    let info = validator.validate(&module).map_err(|e| {
        let mut message = e.as_inner().to_string();
        let mut source = std::error::Error::source(e.as_inner());
        while let Some(s) = source {
            message.push_str(": ");
            message.push_str(&s.to_string());
            source = s.source();
        }
        let message = tidy(&message);
        // the most specific place (the last label) that is in the person's file
        let at = e
            .spans()
            .filter_map(|(span, _)| span.to_range())
            .filter_map(|r| user_place(&composed, first_line, r.start))
            .last();
        match at {
            Some((line, column)) => ShaderError {
                line,
                column,
                message,
            },
            None => ShaderError::whole(message),
        }
    })?;
    check_gles(kind, &module, &info)?;
    Ok(module)
}

/// Translates the module's entry points for OpenGL ES 3.0, as the GL backend would: a shader that cannot be is reported now.
fn check_gles(
    kind: Kind,
    module: &naga::Module,
    info: &naga::valid::ModuleInfo,
) -> Result<(), ShaderError> {
    let options = naga::back::glsl::Options {
        version: naga::back::glsl::Version::Embedded {
            version: 300,
            is_webgl: false,
        },
        ..Default::default()
    };
    let stages = kind
        .vertex_entries()
        .iter()
        .map(|e| (naga::ShaderStage::Vertex, *e))
        .chain([(naga::ShaderStage::Fragment, FRAGMENT)]);
    for (shader_stage, entry_point) in stages {
        let pipeline = naga::back::glsl::PipelineOptions {
            shader_stage,
            entry_point: entry_point.to_string(),
            multiview: None,
        };
        let fail = |e: naga::back::glsl::Error| {
            ShaderError::whole(format!(
                "would not run on OpenGL ES 3.0 (the fallback backend) as {}: {e}",
                kind.name()
            ))
        };
        let mut out = String::new();
        naga::back::glsl::Writer::new(
            &mut out,
            module,
            info,
            &options,
            &pipeline,
            naga::proc::BoundsCheckPolicies::default(),
        )
        .map_err(fail)?
        .write()
        .map_err(fail)?;
    }
    Ok(())
}

/// Checks a shader file for every place it can be used. The first mistake found is returned.
pub fn validate(user: &str) -> Result<(), ShaderError> {
    check_safe(user)?;
    for kind in Kind::ALL {
        validate_kind(kind, user).map_err(|e| {
            if e.line == 0 && !e.message.contains(kind.name()) {
                ShaderError::whole(format!("as {}: {}", kind.name(), e.message))
            } else {
                e
            }
        })?;
    }
    Ok(())
}

/// The shader's name from its path: `shaders/water.wgsl` is "water" (and `shaders/fx/heat.wgsl` is "fx/heat").
pub fn name_of(path: &str) -> Option<String> {
    let rest = path.strip_prefix("shaders/")?;
    let stem = rest.strip_suffix(".wgsl")?;
    (!stem.is_empty()).then(|| stem.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const RIPPLE: &str = "fn shade(s: Surface) -> vec4<f32> {\n    let w = sin(length(s.uv - vec2<f32>(0.5)) * 40.0 - s.time * 3.0);\n    return vec4<f32>(nova_fog(s, nova_light(s, s.color.rgb * (0.8 + 0.2 * w))), s.color.a);\n}\n";

    #[test]
    fn a_plain_shader_compiles_for_every_kind_and_for_gles() {
        validate(RIPPLE).expect("valid");
        validate("fn shade(s: Surface) -> vec4<f32> { return s.color; }").expect("valid");
    }

    #[test]
    fn every_prelude_is_valid_with_a_trivial_shade() {
        for kind in Kind::ALL {
            validate_kind(kind, "fn shade(s: Surface) -> vec4<f32> { return s.color * nova_texture_a(s.uv) * nova_texture_b(s.uv) + nova_scene(s.uv) * nova_noise(s.uv) * nova_hash(s.pixel) * nova_luma(s.color.rgb); }")
                .unwrap_or_else(|e| panic!("{kind:?}: {e:?}"));
        }
    }

    #[test]
    fn a_mistake_is_reported_on_the_files_own_line() {
        let e = validate("// water\nfn shade(s: Surface) -> vec4<f32> {\n    let x = s.colour;\n    return x;\n}\n").unwrap_err();
        eprintln!("{e:?}");
        assert_eq!(e.line, 3, "{e:?}");
        assert!(e.message.contains("colour"), "{e:?}");
        let e = validate("fn shade(s: Surface) -> vec4<f32> {\n    return vec3<f32>(1.0);\n}\n")
            .unwrap_err();
        assert_eq!(e.line, 2, "{e:?}");
        assert!(!e.message.contains('['), "{e:?}");
        let e = validate("fn shade(s: Surface) -> vec4<f32> {\n  return s.color\n}\n").unwrap_err();
        assert_eq!(e.line, 3, "{e:?}");
        assert_eq!(e.describe("shaders/x.wgsl").split(':').nth(1), Some("3"));
    }

    #[test]
    fn bindings_entry_points_and_a_missing_shade_are_refused() {
        let e = validate("@group(0) @binding(0) var t: texture_2d<f32>;\nfn shade(s: Surface) -> vec4<f32> { return s.color; }").unwrap_err();
        assert_eq!((e.line, e.column), (1, 1));
        assert!(e.message.contains("bindings"));
        let e = validate("fn shade(s: Surface) -> vec4<f32> { return s.color; }\n@fragment fn main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }").unwrap_err();
        assert_eq!(e.line, 2);
        let e = validate("fn colour(s: Surface) -> vec4<f32> { return s.color; }").unwrap_err();
        assert_eq!(e.line, 0);
        assert!(e.message.contains("fn shade"));
        // in a comment it is fine
        validate("// @group(0) is Nova's\nfn shade(s: Surface) -> vec4<f32> { return s.color; }")
            .unwrap();
        // a name that contains a forbidden word is fine
        validate("fn overrides(x: f32) -> f32 { return x; }\nfn shade(s: Surface) -> vec4<f32> { return s.color * overrides(1.0); }").unwrap();
    }

    #[test]
    fn redefining_a_prelude_name_says_so() {
        let e = validate("fn safe_normalize(v: vec3<f32>) -> vec3<f32> { return v; }\nfn shade(s: Surface) -> vec4<f32> { return s.color; }").unwrap_err();
        assert!(e.message.contains("prelude"), "{e:?}");
    }

    #[test]
    fn names_come_from_the_path() {
        assert_eq!(name_of("shaders/water.wgsl").as_deref(), Some("water"));
        assert_eq!(name_of("shaders/fx/heat.wgsl").as_deref(), Some("fx/heat"));
        assert_eq!(name_of("scripts/water.wgsl"), None);
    }

    #[test]
    fn nova_shaders_translate_for_gles() {
        // the built-in material path must also work on the fallback backend
        let module = naga::front::wgsl::parse_str(MESH).expect("mesh.wgsl parses");
        let info = naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::empty(),
        )
        .validate(&module)
        .expect("mesh.wgsl validates");
        let options = naga::back::glsl::Options {
            version: naga::back::glsl::Version::Embedded {
                version: 300,
                is_webgl: false,
            },
            ..Default::default()
        };
        for (stage, entry) in [
            (naga::ShaderStage::Vertex, "vs_material"),
            (naga::ShaderStage::Vertex, "vs_skinned_material"),
            (naga::ShaderStage::Fragment, "fs_material"),
        ] {
            let mut out = String::new();
            let pipeline = naga::back::glsl::PipelineOptions {
                shader_stage: stage,
                entry_point: entry.into(),
                multiview: None,
            };
            naga::back::glsl::Writer::new(
                &mut out,
                &module,
                &info,
                &options,
                &pipeline,
                naga::proc::BoundsCheckPolicies::default(),
            )
            .and_then(|mut w| w.write().map(|_| ()))
            .unwrap_or_else(|e| panic!("{entry}: {e}"));
        }
    }
}
