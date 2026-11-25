# Working on Fernhollow Post (for agents)

Fernhollow Post is the game in focus (Pine Ridge Rally is paused, but it must keep working). This page is how the work is done day
to day. Read `AGENTS.md`, then `TODO.md` ("Where things stand"), then this, then the part of `docs/games/mountain-post.md` you need.

## The rule for this game

Perfect the vertical slice on the Retroid before adding anything beyond it. Work comes from the owner's play notes, which are
quoted word for word in `docs/games/mountain-post.md` ("The owner's ... notes"). Do what a note asks, check it, and record it there
under the note. Do not add features nobody asked for. Ask before reversing something the owner asked for.

## Where things are

| What | Where |
|---|---|
| Scenes and their Lua | `scenes/valley.scene.json` + `valley.lua` (outdoors), `office.*` (the post office), `title.lua` |
| The van (driving, lever, creep, wheels, dust) | `entities/van.lua`; its model `tools/van.mjs` -> `models/van.*` |
| Cameras | `lib/camera.lua` (walking, driving, the office's fixed view, see-through) |
| UI kit, chips, tips | `lib/ui.lua` (`ui.SP` spacing, `ui.corner_chip`, `ui.tip`); words in `lib/words.lua` |
| Gear and speed dial | `lib/gear_hud.lua` |
| Pause and Controls cards | `lib/cards.lua` |
| Dialogue (rich text) | `lib/dialogue.lua` |
| Game state, parcels | `lib/state.lua`, `lib/parcels.lua` |
| Test helpers (board, drive, ...) | `lib/testkit.lua` |
| World recipes | `tools/*.mjs` (below) |
| Picture routes | `tools/routes/*.json` (some written by a `.mjs` beside them) |
| Tests | `crates/nova-runtime/tests/mountain_post.rs`; flowers and grass on the GPU: `tests/flora_gpu.rs` |

## Regenerating the world

The valley's layout, terrain, roads, grass map, occluders and paper map are made by Node recipes, never edited by hand. After
changing the layout, a road, a building or a tree model, re-run them in this order (from the repo root):

```sh
scripts/env.sh node examples/mountain-post/tools/models.mjs
scripts/env.sh node examples/mountain-post/tools/edge-models.mjs
scripts/env.sh node examples/mountain-post/tools/terrain.mjs
scripts/env.sh node examples/mountain-post/tools/scene.mjs
scripts/env.sh node examples/mountain-post/tools/bounds.mjs
scripts/env.sh node examples/mountain-post/tools/grass.mjs
scripts/env.sh node examples/mountain-post/tools/occluders.mjs
scripts/env.sh node examples/mountain-post/tools/map.mjs
```

Re-running them on an unchanged tree must change nothing (`git status` clean): check that. The van is separate
(`tools/van.mjs`). When a merge conflicts in a generated file, take either side and re-run the recipes.

## Checking a change

- While working: `scripts/test.sh one mountain_post` (about 45 s). Before handing back: `scripts/test.sh` and
  `(cd studio && ../scripts/env.sh npx vitest run src/lib/examples.test.ts)`, then `scripts/env.sh cargo fmt`.
- New tests go **at the very end** of `mountain_post.rs` (several builders work at once; appending keeps merges simple). Change an
  existing test in place only when the owner's note changes what it pins, and say so in your report.
- Look at it. Write or reuse a route in `tools/routes/`, run it from `examples/mountain-post`:
  `../../target/release/nova run . --headless --size 1280x720 --play tools/routes/<name>.json`
  (build first: `scripts/env.sh cargo build --release -p nova-runtime --bin nova`). Pictures land in `build/gallery/<name>/`
  (git-ignored). Open the ones you mention; say which you did not look at. 1280x720 is the device's screen.
- Shared engine code (roads, terrain, models, the surface maker): also run `scripts/rally/verify.sh` so Pine Ridge does not change.
- New engine features are opt-in, documented in `docs/project-format.md`, and listed in `studio/src/lib/nova-api.json` if they are
  Lua API (`tests/api_docs.rs` checks it).

## The Retroid (Linux side, Steam game mode)

The owner plays on a Retroid Pocket 6 over the local network (`scripts/handheld-bench.sh` holds the host). The game lives in
`~/nova/fernhollow_post` and is started from Steam.

- **Never start anything on its screen without the owner's yes**, and only when they are not playing. A game started over SSH shows
  up on the screen with sound. Benchmarks pass `--no-audio` (after `--pak ...`). Builder agents do not touch the device at all:
  write the command in your report.
- Is the game running? `ssh <host> 'ps -eo pid,args | grep "fernhollow_post run" | grep -v grep'`. Do not use `pkill -f` over SSH:
  it matches the ssh command and kills the session.
- Install (copying files is fine when the game is not running):
  ```sh
  scripts/build-linux-arm64.sh --release --project examples/mountain-post
  rsync -a --delete build/linux-arm64/export/fernhollow_post/ <host>:nova/fernhollow_post/
  ```
  then compare checksums of both folders. Tell the owner the commit that is on the device.
- Screenshot of what is on screen:
  `ssh <host> 'XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=gamescope-0 gamescopectl screenshot /tmp/x.png'`.
- Frame timing: `scripts/handheld-bench.sh --no-build` (silent), `NOVA_FRAME_LOG`; results in `docs/play-on-linux-handheld.md`.
- Mac pictures are not device results. Nothing is "fixed" until the owner has played it.

## Housekeeping

- Builder agents work in worktrees under `.claude/worktrees/` (5 to 14 GB each with their build). After merging one, copy any
  pictures you want out of it, then remove it (`git worktree remove --force --force <path>`, `git branch -D <branch>`). Run
  `scripts/tidy.sh --apply` now and then.
- Commits end with the session's attribution line. Push to `origin main` only after the tests pass.
- Report honestly: what was checked how, what was not looked at, and what only the device can tell.
