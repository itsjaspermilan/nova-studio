# The cold-agent trial

A repeatable test of how easy Nova is for an AI agent (TODO.md, "Nova for agents", A1). A fresh agent that has never seen the
repository gets the brief below and nothing else, builds a small game, and keeps a log of every place it stalled. Run it again after
each improvement and compare.

## The brief (give it word for word; only the folder name changes)

> You have been pointed at the Nova Studio repository at /Users/jasper/Developer/NovaStudio. Using Nova, make a small, good-looking
> top-down 2D adventure game in the folder `build/agent-trial/<name>/`: one outdoor map and one small indoor room joined by a door, a
> player who walks in four directions and swings a sword, two kinds of enemy, hearts for health, a key that opens a locked chest, sound
> effects, one piece of music, a title screen and an ending. All art, sound and music must be made by you with Nova's own tools (no
> downloads, no copying another example's assets). Check your work the way a player would see and hear it.
>
> Rules: do not change the engine, the studio or anything outside your folder (if Nova lacks something, work round it and log it); do
> not install or download anything; do not commit. As you go, keep `build/agent-trial/<name>/FRICTION.md`: one entry each time you
> stalled, guessed, retried, or could not check something, with what you wanted to do, what you tried, how many attempts it took, and
> what would have made it one step. Be specific and honest; that log is the main thing wanted. Finish with a short report: what
> works, what you could not verify, pictures of the game (paths), and the five things that cost you the most.

## The 3D brief (the same rules paragraph follows it)

> You have been pointed at the Nova Studio repository at /Users/jasper/Developer/NovaStudio. Using Nova, make a small, good-looking
> 3D scene you can walk around in, in the folder `build/agent-trial/<name>/`: a character you model and rig yourself (a body with
> head, arms and legs that bend) with four animations (idle, walk, jump, and a wave or attack), a small level to walk in (ground, a
> few buildings or ruins, trees or props you model yourself, something to collect), a third-person camera, footsteps and two or
> three other sound effects, and one piece of music. All models, animations, sound and music must be made by you with Nova's own
> tools (no downloads, no copying another example's assets). Check your work the way a player would see and hear it: in particular
> check that each animation actually moves the right limbs the right way, at several moments of the clip, and that the character's
> feet meet the ground.

## Scoring (fill in after each run)

- **Finished?** Does `nova check` pass, and does the game start, play and end?
- **Looks:** title, outdoor map, indoor room, combat: read the pictures. Good-looking, plain, or broken?
- **Verified by the agent:** which of the brief's items did it actually see or measure, and which did it only assume?
- **Stalls:** the number of FRICTION.md entries, grouped: finding out how (docs, examples), making art, making sound, placing things
  (scenes, maps), seeing the result, hearing the result, errors that did not say what was wrong, tools missing.
- **Cost:** tool calls and minutes.

## Runs

| Date | Model | Folder | Finished | Stalls | Tool calls | Minutes | Notes |
|---|---|---|---|---|---|---|---|
| 2026-11-20 | Sonnet 5.5 | `sonnet` ("Mossglen") | yes: check clean, title to ending | 11 | 92 | 13 | Baseline. Clean readable pixel art. Never saw motion or heard sound. About 12 runs with hand-written input files to reach the key, fight and chest. Hero invisible until it read framework.lua (camera in a custom draw). Typed tiles as number arrays via its own script. |
| 2026-11-20 | Fable 5.2 | `fable` ("Bramble Key") | yes: check clean, title to ending in one recorded run | 28 | 86 | 26 | Baseline. The better-looking game (112-tile set, layered trees, brambles to cut). Wrote its own MCP client and tile generator. 9 trace-and-adjust rounds for a winning route; runs not repeatable (no seed). Measured sound with its own script, which caught two effects four times too quiet. |
| 2026-11-20 | Fable 5.2 | `fable3d` ("Fable Ruins", the 3D brief) | yes: check clean, 7 of 7 gems in a recorded run | 13 | 70 | 19 | Baseline. A skinned traveller with idle, walk, jump and a layered wave; ruins, grove, lanterns. Built its own animation strip (eight moments, front and side), its own leg solver for planted feet, hand-written collision boxes and its own orbit camera. First footsteps were 30 to 70 Hz rumble, found only by measuring. |
| 2026-11-20 | Sonnet 5.5 | `sonnet2` ("Ember Vale") | yes: title to ending in ONE scripted run with real inputs | 15 | 83 | 10 | After batch 1 (tools from the shell; the session's attached tools were stale). Walk animation in all four directions, half hearts, a game-over screen. Used `play` for the whole playthrough and `sound_report` on every effect and on the run: six retries were the tool's warnings (clicks, clipping, DC offset) being fixed, which the baseline never saw. Biggest remaining cost: pixel art as typed rows. |
| 2026-11-20 | Fable 5.2 | `fable2` ("Sunleaf Glade") | yes: title to ending and back to the title in one route | 14 | 59 | 14 | After batch 1. Baseline was 28 stalls, 86 calls, 26 minutes. Every claim backed by a log line, a printed value or a picture; all 11 effects without warnings. New top cost: a headless run that hot-reloaded the game when its own pictures were written into the project. |
| 2026-11-20 | Fable 5.2 | `fable3d2` ("Ruin Garden", the 3D brief) | yes, but 7 of 8 gems reached by teleporting in the test route | 19 | 70 | 14 | After batch 1. Baseline was 13 stalls, 70 calls, 19 minutes. Clips read from `model_preview` strips in one call each; found `nova.solid` (collision on the models' own triangles) through `api`, which the baseline never found. New top costs: the follow camera goes through hills and walls, and there is no way to walk a 3D route to a point. |

### What the baseline runs say (2026-11-20)

Both agents finished a complete, good-looking game from the repository alone. The cost was in checking it and in finding out how:

1. **Playing it:** one picture per run, input that cannot react, no seed, no view of game state. The largest single cost for both.
2. **Finding the 2D API:** `docs/project-format.md` is long, opens with 3D and has stale paragraphs; six basic facts needed `framework.lua`.
3. **Sprites and maps as text:** no sprite preview, errors that do not name the row, tile grids as numbers, an undocumented sheet layout.
4. **Hearing:** headless runs drop sound; both measured files with their own scripts.
5. **Traps:** camera in a custom draw, `cam.set` stopping `follow`, mirrored sprites and hitboxes, drum tracks needing `wave`, every PNG
   in the project joining the sprite atlas, `nova pack` packing tools and logs.

For 3D the same five hold, and three more: **animations cannot be looked at** (the model preview shows the rest pose only), **feet on the
ground and which way a rotation turns** had to be worked out by hand, and **scenery is not solid and the camera avoids nothing** unless the
game writes both itself.

### What the re-runs say (after batch 1, 2026-11-20)

| Brief, model | Stalls | Tool calls | Minutes |
|---|---|---|---|
| 2D, Sonnet 5.5 | 11 -> 15 | 92 -> 83 | 13 -> 10 |
| 2D, Fable 5.2 | 28 -> 14 | 86 -> 59 | 26 -> 14 |
| 3D, Fable 5.2 | 13 -> 19 | 70 -> 70 | 19 -> 14 |

Faster in every case, and the checking is of a different kind: whole playthroughs in one route, every sound measured, clips read as
strips. The stall counts did not fall evenly because the tools now show faults that went unseen before (clicks, a bass-heavy song, a
jump twice as high as meant). One run each, so the numbers are a direction, not a measurement. What still costs, for batch 2:

1. **Routes:** no walking and acting at once (`tap_every`, `repeat`), no `walk_to` a point (2D and 3D), an `until` that times out by
   design prints a warning, an error in a `lua` step aborts the run, the 3D entity list omits z.
2. **A headless run hot-reloads the game** when files change in the project (its own pictures), and `sound_report` refuses a file outside
   the project. Getting single frames and the sound out of the MCP `play` is awkward (a strip under /tmp).
3. **Pixel art as typed rows:** pad short rows, name the right frame in a row-count error, shape and mirror helpers, a close-up of one frame.
4. **Sound:** warnings should say which setting to change; the shipped `hit` preset fails the tool's own check; the mix table ignores
   play volumes; a click in a run should name the sounds that started there; the loop-seam warning should say what is sounding.
5. **3D:** `nova.cam3.follow` has no collision; no animation events (footsteps read private state); sole heights, not ankles;
   `model_write` does not document the shape of clips; nothing reaches the scene object from an entity.
6. **Finding things from the shell:** `nova-mcp-call.mjs --list` cuts descriptions and shows no parameters; `api` with `group` gives
   names only; Node fails outside the repository folder and scripts run with the repository as their folder.
7. **Semantics nobody states:** `tint` multiplies, `nova.first` takes a tag, a solid thing never fires its collide callback, `self.vy`
   is the engine's own field, which way `angle` turns, a room smaller than the screen floats in black.
