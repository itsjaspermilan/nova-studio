# Friction log, slice 1 (the runner)

What I wanted, what I tried, attempts, and what would have made it one step. Most costly first.

1. **A step's `until` with `tap`/`hold` presses at the start, not when the condition turns true.**
   Wanted: "press dash when the Scrapper's tell reaches 0.46 s". `{ hold, tap, until: cond }` taps at frame 0 of the step and
   then waits, so the roll happened 30 frames early and the whole route proved nothing (it passed quietly: no hit, no warning).
   Two attempts. Worked round with two steps (`{ until: cond }` then `{ hold, tap, until: state == 'roll' }`).
   One step: `{ "when": "<lua>", "press": "dash" }`, or say in `--help play` that `tap` fires on the step's first frame.

2. **No way to record a value every frame.** The hit-stop proof needs the runner's x for each frame around a hit. `every: 1`
   makes a picture per frame; the tool has no `lua_each_frame` although the Rust `Plan` does. 2 attempts. Worked round by
   wrapping `R.update` in a `lua` step (a probe that appends to a global string, printed at the end).
   One step: expose `lua_each_frame` in the `play` tool, or a `"record": ["expr", ...]` that prints a per-frame table.

3. **`self.sprite` is nil on an entity whose class gave the sprite** (`nova.entity { sprite = "runner" }`), so a
   `nova.spawn("ghost", ..., { sprite = self.sprite })` made an invisible entity, with no warning. 3 attempts to find
   (the report listed the ghost at the right place with "frame 22", so it looked fine). One step: `self.sprite` should read
   the class value (or `check` should warn "an entity with a frame and no sprite is drawn as nothing").

4. **`nova.count` / `nova.all` only take tags** (documented, but a debugging print `nova.count('ghost')` said 0 for a live
   `ghost` entity, which cost a detour). `nova.count_kind` or a `kind` match would help; the end-of-run entity list was what
   showed it.

5. **`character_make` with `item: "none"` still bakes a grey arc into the attack frames** (frames 7/8, 17/18...). Over my
   own arc it shows as a stray grey line by the feet. Not removable without repainting 12 frames by hand; I left it.
   One step: `item: "none"` draws no swing, or `swing: false`.

6. **Design says X/A/B/Y by Nintendo position; the engine's prompts print the engraved Retroid letters.**
   `nova.input.prompt("attack")` for `pad:north` is `Y` (the RP6 engraves Y on top, A at the bottom), so the HUD reads
   "Y baton, A roll, X shoot, B use" while the design table says X, B, Y, A. The HUD follows the engine (right for the device
   in the hand). The design doc's letters need a note or a different table. (A decision, not a bug.)

7. **No built-in hit-stop or screen shake.** Written in `lib/juice.lua` (a freeze counter every entity checks, and a scene
   camera that follows by itself and adds the shake, because `nova.cam.follow` cannot be offset). 1 attempt, but every
   game of this kind will need it. One step: `nova.time_hold(frames)` and `nova.cam.shake(px, frames)`.

8. **Entity hitboxes are axis-aligned, not turned with `angle`.** Fine once known; I give each swing a box per facing
   direction (`lib/combat.lua`). A note under `angle` in the docs would have saved a look.

9. **`scene_write`'s `background` wants `[r,g,b]`**, while the sprite palettes want `"#rrggbb"`: the error was clear and
   fixed in one go, but the mixed styles invite it.

10. **Puddles cannot be water terrain**: `tileset_make`'s `water` is solid, so puddles are `puddle` entities (a picture
    with depth 85 over the street layer at 100) and not painted cells. A `walkable` flag on a terrain, or a `water_shallow`
    terrain, would let them be painted in the scene like everything else.

11. `scene_write` painted "crate on path" correctly in one go (good); the `route` file format of the tools (`route`) differs
    from the Rust plan (`steps`), so the Rust test converts it (a 12-line shim in `neon_undertow.rs`).

12. The `sprite_write` hand-drawn art needed a Node generator (`art_args.mjs`) for the crescent and hearts (a crescent from
    shapes is not possible: no clip or arc primitive; a heart half needs a mask). A `{ "arc": [cx, cy, r0, r1, a0, a1] }`
    shape would remove the script.

Top five by cost: 1, 2, 3, 5, 6/7.
