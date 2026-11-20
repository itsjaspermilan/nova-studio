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

### Round 3 (after batch 2, 2026-11-20)

| Brief, model | Folder | Stalls | Tool calls | Minutes | Notes |
|---|---|---|---|---|---|
| 2D, Sonnet 5.5 | `sonnet-r3` ("Emberwood") | 12 | 60 | 9 | Title to ending in one route with audio. Top cost: options ignored in silence (`scale` beside `tileset`, as the tool's own example showed it). |
| 2D, Fable 5.2 | `fable-r3` ("Moss Hollow") | 16 | 48 | 11 | Beaten enemies stay beaten across doors; music 7.5 dB under effects. The route only finishes with 12 hearts: `walk_to` clipped a one-tile gap and the bot cannot aim. |
| 3D, Fable 5.2 | `fable3d-r3` ("Ruin Garden") | 10 | 130 | 18 | A walked run collects all six gems (no teleports); footsteps from clip events; soles at 0.000 in the strip. A third of the session went on not knowing whether shadows were drawn. |

Across the three rounds (baseline -> batch 1 -> batch 2): 2D Sonnet 92 -> 83 -> 60 calls and 13 -> 10 -> 9 minutes; 2D Fable 86 -> 59 -> 48
calls and 26 -> 14 -> 11 minutes; 3D Fable 70 -> 70 -> 130 calls and 19 -> 14 -> 18 minutes (the 3D run went up because of the shadow hunt, and
because it now walks its whole route and checks far more). One run each: a direction, not a measurement.

What still costs, for batch 3:

1. **The test player is too simple:** `walk_to` goes straight (no path finding, stops short of things), a route cannot fight, cannot be
   made unkillable, and carries on from the wrong place after a failed step. All three finished their route only with help (extra hearts).
2. **Silence:** unknown keys accepted and ignored, pictures dropped from a strip without saying so, a wrong argument reported with no
   file or line on a line `check` never ran.
3. **3D:** no facts about what was rendered (shadows, light), the `mesh` shape undocumented, feet placed by a hand-written solver for
   the third time, no top-down plan of a 3D scene, no contact sheet of several models.
4. **Art:** textured fills, cutting one drawing into tiles, two-tile trees: the makers batch.
5. **Hearing:** the numbers are trusted now; whether a tune is pleasant is not answerable by a tool.

### Round 4 (after batch 3 and the first makers, 2026-11-20)

| Brief, model | Folder | Stalls | Tool calls | Minutes | Notes |
|---|---|---|---|---|---|
| 2D, Sonnet 5.5 | `sonnet-r4` ("Emberwood Key") | 14 | 49 | 5 | All art from the makers, sounds by purpose, the song by mood. One route plays the whole game with no extra hearts. Read `examples/maker-demo` (which resembles the brief) for the API; copied no assets. |
| 2D, Fable 5.2 | `fable-r4` ("Emberwick") | 12 | 40 | 6 | Makers in the autumn palette plus one hand-drawn sprite; two endings; the test player loses two half-hearts of six. |
| 3D, Fable 5.2 | `fable3d-r4` ("Ruin Garden") | 20 | 72 | 17 | 21 models, clip events, a walked six-gem route. Seven runs lost to `walk_to` stopping in the open or driving into bases; the `walk` maker crouches; the camera's collision ignores scene scenery; the guide has no 3D path. |

Across four rounds: 2D Sonnet 92 -> 83 -> 60 -> 49 calls and 13 -> 10 -> 9 -> 5 minutes; 2D Fable 86 -> 59 -> 48 -> 40 calls and
26 -> 14 -> 11 -> 6 minutes; 3D Fable 70 -> 70 -> 130 -> 72 calls and 19 -> 14 -> 18 -> 17 minutes. 2D is where it should be: about five
minutes for a complete, good-looking game, most of it made by the makers. 3D has not moved, because it has had tools for checking but no
makers, no starter and no path in the guide: that is batch 4. One run each, and round 4's 2D brief resembles the makers' demo, which
both agents could read: a direction, not a measurement.

What 2D still costs (small, for a later pass): `check` passes when Lua names a sound, sprite or scene that does not exist; nothing says
a scene is rebuilt when re-entered; an entity's own `draw()` replaces its sprite in silence; `walk_to` by tag follows on to the next
match after a scene change; text width in the pixel font is a guess; `nova.music.play` restarts the song that is playing; tool answers
are long with the picture path at the end; the `topdown` template cannot be used under a "no copied assets" rule.

### Round 5, 3D only (after batch 4: 3D fixes, makers, starter and guide path, 2026-11-20)

| Brief, model | Folder | Stalls | Notes |
|---|---|---|---|
| 3D, Sonnet 5.5 | `sonnet3d-r5` ("Lantern Hollow") | 12 | The first Sonnet run of the 3D brief, so nothing earlier to compare with; interrupted once by a usage limit, so its calls and minutes are not comparable either. Finished: a 15-part hero with idle, walk (the `walk` option), jump (`ik`), wave; nine hand-made props; a walked route to all five crystals with footsteps on the clip's events; soles at 0.000. It took "model and rig yourself" literally and used only `ground3d_make` of the makers. |

The Fable run of this round was stopped to save usage (trials run on Sonnet from here on). What it shows: the walking, camera and
clip fixes hold (no lost runs to `walk_to`), and a Sonnet agent can finish the 3D brief. What it does not show: whether agents reach for
`character3d_make` and `prop3d_make`, because the brief's wording ("a character you model and rig yourself", "props you model
yourself") steers away from them. The next 3D probe should be a short one that allows the makers. Still costing: the `ik` clip's
warnings do not give the leg's reach or say planted feet need unchanged x and z; no tool turns a clip's no-slide speed and a playback
rate into a movement speed; a capture cannot follow an entity or look at it from the side; which side `_l` is goes unstated.

From here on (decided with the owner, 2026-11-20): Sonnet builds and runs trials, Opus changes Nova itself and reviews once per batch,
and trials are small probes of one thing rather than whole games.
