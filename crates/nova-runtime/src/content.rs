//! What the host is running: the built-in M1 benchmark scene (the default, and what the
//! Android spike APK embeds) or a Nova project folder (`nova run <folder>`).

use std::rc::Rc;

use crate::app::Options;
use crate::game::Game;
use crate::gfx::{FrameInput, Gfx};
use crate::input::Actions;
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
        actions: Actions,
        pressed: bool,
        perf: &Perf,
        audio: &str,
    ) -> (f32, f32) {
        match self {
            Content::Spike(s) => {
                s.script.update(dt, actions, pressed);
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
                game.update(dt, time, view, actions, pressed);
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
                (0.0, game.last_update.as_secs_f32() * 1000.0)
            }
        }
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
