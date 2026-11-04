//! What the host is running: the built-in M1 benchmark scene (the default, and what the
//! Android spike APK embeds) or a Nova project folder (`nova run <folder>`).

use std::rc::Rc;

use crate::actions::InputFrame;
use crate::app::Options;
use crate::game::Game;
use crate::gfx::{FrameInput, Gfx};
use crate::pak::PakVfs;
use crate::script::{ScriptHost, ScriptState};
use crate::spike::{self, Perf, Spike};
use crate::vfs::{DirVfs, Vfs};

pub struct SpikeContent {
    spike: Spike,
    script: ScriptHost,
    state: ScriptState,
}

pub enum Content {
    Spike(Box<SpikeContent>),
    Game { game: Box<Game>, hud: bool },
}

/// Save data goes where the platform keeps it (or `--save-dir`); headless runs keep it in
/// memory unless a folder is given, so tests and captures never touch real saves.
fn save_location(opts: &Options, game_name: &str) -> Option<std::path::PathBuf> {
    opts.save_dir.clone().or_else(|| {
        if opts.headless {
            None
        } else {
            crate::save::default_dir(game_name)
        }
    })
}

impl Content {
    pub fn load(opts: &Options, gfx: &mut Gfx) -> Result<Content, String> {
        if opts.project.is_some() || opts.pak.is_some() {
            let vfs: Rc<dyn Vfs> = match (&opts.pak, &opts.project) {
                (Some(pak), _) => Rc::new(PakVfs::new(pak.0.clone())?),
                (None, Some(dir)) => Rc::new(DirVfs::new(dir)?),
                (None, None) => unreachable!("checked above"),
            };
            let mut game = Game::load_with(vfs, &|name| save_location(opts, name))?;
            game.upload(gfx);
            log::info!(
                "project '{}': {} assets, world height {}",
                game.project.manifest.name,
                game.project.assets.len(),
                game.world_height()
            );
            return Ok(Content::Game {
                game: Box::new(game),
                hud: opts.hud,
            });
        }
        let script = match &opts.script {
            Some(path) => {
                let source = std::fs::read_to_string(path)
                    .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
                ScriptHost::new(source, path.display().to_string(), Some(path.clone()))
            }
            None => ScriptHost::new(spike::MAIN_LUA.to_string(), "main.lua".into(), None),
        };
        let state = script.state();
        Ok(Content::Spike(Box::new(SpikeContent {
            spike: Spike::new(gfx)?,
            script,
            state,
        })))
    }

    pub fn title(&self) -> String {
        match self {
            Content::Spike(_) => "Nova spike".into(),
            Content::Game { game, .. } => game.project.manifest.name.clone(),
        }
    }

    pub fn adapter_label(&self) -> Option<&str> {
        match self {
            Content::Spike(s) => Some(&s.spike.adapter),
            Content::Game { .. } => None,
        }
    }

    pub fn error(&self) -> Option<&str> {
        match self {
            Content::Spike(s) => s.script.error.as_deref(),
            Content::Game { game, .. } => game.error.as_deref(),
        }
    }

    pub fn toggle_hud(&mut self) {
        if let Content::Game { hud, .. } = self {
            *hud = !*hud;
        }
    }

    /// Runs one frame of gameplay and builds the draw lists. Returns (build ms, script ms).
    #[allow(clippy::too_many_arguments)]
    pub fn update(
        &mut self,
        gfx: &mut Gfx,
        dt: f32,
        time: f64,
        size: (u32, u32),
        input: &InputFrame,
        perf: &Perf,
        audio: &str,
    ) -> (f32, f32) {
        match self {
            Content::Spike(s) => {
                s.script.update(dt, input.legacy_actions(), false);
                s.state = s.script.state();
                let hud =
                    spike::hud_text(&s.spike, perf, &s.state, s.script.error.as_deref(), audio);
                let build_ms = s.spike.build(dt, size, &s.state, &hud);
                (build_ms, s.script.last_update.as_secs_f32() * 1000.0)
            }
            Content::Game { game, hud } => {
                if game.changed_on_disk() {
                    game.flush_save(); // the reloaded game reads the file, so write first
                    let dir = game.save_dir().map(std::path::Path::to_path_buf);
                    match Game::load_with(game.vfs(), &|_| dir.clone()) {
                        Ok(mut reloaded) => {
                            reloaded.upload(gfx);
                            log::info!("project reloaded");
                            **game = reloaded;
                        }
                        Err(e) => game.set_error(e),
                    }
                }
                let scale = Gfx::ui_scale(size);
                let view = [size.0 as f32 / scale, size.1 as f32 / scale];
                game.set_pixel_scale(scale);
                game.set_host_stats(crate::game::HostStats {
                    fps: perf.fps,
                    render_ms: perf.times.render_ms,
                    draw_calls: perf.stats.draw_calls,
                    triangles: perf.stats.triangles,
                    sprites: perf.stats.sprites,
                });
                let started = std::time::Instant::now();
                game.update_input(dt, time, view, input);
                let whole_update = started.elapsed().as_secs_f32() * 1000.0;
                if let Some(atlas) = game.take_glyph_atlas() {
                    gfx.update_glyph_atlas(&atlas);
                }
                if *hud {
                    let text = format!(
                        "FPS {:.0}  UPD {:.2}  DRAW {:.2} MS\nWORLD {}X{}  DRAWS {}  SPRITES {}  TRIS {}\nAUDIO {}",
                        perf.fps,
                        game.last_update.as_secs_f32() * 1000.0,
                        perf.times.render_ms,
                        perf.stats.world_size.0,
                        perf.stats.world_size.1,
                        perf.stats.draw_calls,
                        perf.stats.sprites,
                        perf.stats.triangles,
                        audio.to_uppercase()
                    );
                    game.debug_text(8.0, view[1] - 62.0, &text);
                }
                // (the first number is what the update took besides running the scripts: swapping and sorting the draw lists, saving)
                let lua = game.last_update.as_secs_f32() * 1000.0;
                ((whole_update - lua).max(0.0), lua)
            }
        }
    }

    /// Tells the game how far into the music track the audio thread is (None when no music plays).
    pub fn set_music_position(&mut self, position: Option<f64>) {
        if let Content::Game { game, .. } = self {
            game.set_music_position(position);
        }
    }

    /// Sound commands queued by scripts this frame (none for the benchmark scene).
    pub fn take_audio(&mut self) -> Vec<crate::mixer::Command> {
        match self {
            Content::Game { game, .. } => game.take_audio(),
            Content::Spike(_) => Vec::new(),
        }
    }

    /// Did a script ask for the mouse to be locked (true) or freed (false)?
    pub fn take_grab_request(&mut self) -> Option<bool> {
        match self {
            Content::Game { game, .. } => game.take_grab_request(),
            Content::Spike(_) => None,
        }
    }

    /// Does the game use this source for something (so the host should leave it alone)?
    pub fn uses_source(&self, id: &str) -> bool {
        match self {
            Content::Game { game, .. } => game.uses_source(id),
            Content::Spike(_) => false,
        }
    }

    /// Gamepad rumbles queued by scripts this frame (none for the benchmark scene).
    pub fn take_rumble(&mut self) -> Vec<crate::game::Rumble> {
        match self {
            Content::Game { game, .. } => game.take_rumble(),
            Content::Spike(_) => Vec::new(),
        }
    }

    /// Starts the Lua profiler (`--profile`).
    pub fn set_profile(&mut self, on: bool) {
        if let Content::Game { game, .. } = self {
            game.set_profile(on);
        }
    }

    /// The profiler's top functions as text, if there is a game.
    pub fn profile_text(&self, top: usize) -> Option<String> {
        let Content::Game { game, .. } = self else {
            return None;
        };
        let (rows, total) = game.profile_report(top);
        let mut s = format!("where the script time went ({total:.0} ms sampled in all):\n");
        for (name, ms, n) in rows {
            s += &format!(
                "  {:5.1}%  {:8.1} ms  {:6} samples  {}\n",
                if total > 0.0 { ms / total * 100.0 } else { 0.0 },
                ms,
                n,
                name
            );
        }
        Some(s)
    }

    /// Runs the voxel world without worker threads (headless runs: every run does the same).
    pub fn set_deterministic(&mut self, on: bool) {
        if let Content::Game { game, .. } = self {
            game.set_deterministic(on);
        }
    }

    /// A frame has been drawn: what scripts built for it (voxel meshes) has reached the GPU.
    pub fn frame_done(&mut self) {
        if let Content::Game { game, .. } = self {
            game.clear_mesh_ops();
        }
    }

    pub fn plays_sound_effects(&self) -> bool {
        matches!(self, Content::Game { .. })
    }

    /// `cli_world_height` is the `--world-height` override, when given.
    pub fn frame_input(&self, cli_world_height: Option<u32>) -> FrameInput<'_> {
        match self {
            Content::Spike(s) => s
                .spike
                .frame_input(&s.state, cli_world_height.unwrap_or(540)),
            Content::Game { game, .. } => {
                game.frame_input(cli_world_height.unwrap_or_else(|| game.world_height()))
            }
        }
    }
}
