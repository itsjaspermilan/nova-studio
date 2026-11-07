# Studio tools from Pine Ridge Rally

Four things the rally needed that were missing from the studio. The first three are screens in the header
(**Simulate**, **Store art**) and the Play panel; the fourth is in the model editor. All of them go through the `Api`
interface (`studio/src/lib/types.ts`), so the browser preview (mock backend) shows them too, with simulated runs.

## Store art

Header → **Store art**. Makes `icon.png` (512×512) and `boxart.png` (768×1024) from the running game, the same way the
MCP tool `store_art` does: `nova run <project> --headless --frames N --size WxH --press ... --capture out.png`.

- *Which screen?* The game starts at its first screen. A list of "after S seconds press KEY" steps gets it to a later one
  (`Enter`, `Space`, `ArrowRight`, `a`, or `pad:south`), then it waits some seconds and takes the picture. Choosing a
  scene directly is not possible yet: the runtime has no option to start in a given scene, so the keys are the way.
- **Take the picture** shows the result; **Save as icon.png** writes it into the project (through `writeImage`, so the file
  is confined to the project like every other). The icon is also shown the way an Android launcher shows it (circle and
  rounded square at 192, 96, 72 and 48 px) and the box art as a cover tile. `scripts/build-apk.sh` makes the launcher icon
  from `icon.png`.
- Backend: the `run_headless` command (`studio/src-tauri/src/headless.rs`) runs the `nova` binary once and returns its
  log lines and, with `capture`, the last frame as a PNG data URL. It validates every option, stops a run that takes more
  than ten minutes and is tested against a stand-in program.

## Speed strip and hitches

While the game runs, the top of the **Play** panel shows frames a second, the frame time at the 95th percentile and the
worst frame, GPU ms, Lua ms, draw calls and triangles, and a graph of the last minute. Below it, the slow frames
(`hitch:` lines written by `nova.hitch(ms [, describe])`) are listed newest first. The numbers come from the log: the
runtime writes `fps= p95= max= upd= lua= render= gpu= draws= sprites= tris= culled=` every second
(`studio/src/lib/perf.ts` reads it; the per-second line is kept out of the Play log, the hitch lines stay in it).

Not done: **Play on device** (reading the Android log over adb with the serial from settings and feeding the same lines to
the strip). The strip only needs lines in the same format, so `adb logcat -s nova` piped into `PerfTracker.feed` is
the whole job; nothing for it is built. `nova run --hud` draws its numbers onto the picture, not into the log, so the
strip does not use it.

## Simulate

Header → **Simulate**. Plays the game with no window many times and turns the lines it prints into a table, the way the
rally's `ai_balance` test prints lap times. It is generic: a script, options, a pattern and column names.

1. **The input script**: a JSON file of events (`docs/project-format.md`, "Recorded input"; `crates/nova-runtime/src/inputscript.rs`).
   **Record a play session** runs the game with `--record sims/play.json`; the file is written when the game's *window is
   closed* (stopping the game from the studio kills it before it can write). **Write one** creates a starter script and
   opens it.
2. **What to try**: frames per run, how many times to repeat each combination, and options. An option is a name and a
   list of values; `{{name}}` in the script is replaced by each value in turn, as text, before the script is read, so it
   can stand for a key name (`"key:{{key}}"`) or a number (`"at": {{frame}}`). Every combination runs. A script that uses
   a placeholder with no option is refused rather than run wrongly. Filled-in scripts are written to `.nova/sim/run.json`.
3. **What to look for**: a regular expression applied to every line the game prints (stdout and stderr). Each bracket
   group becomes a column, named in the column box; without brackets the whole line is the column. A list of the last run's
   lines is shown, and clicking one makes a pattern from it.

The table has the option values first, then the run number if runs are repeated, then the columns. It can be saved as
`sims/results.csv`. The setup is remembered per project in the browser. Logic is in `studio/src/lib/sim.ts` (tested).

## Colliders in the model editor

The Collision section of the model panel has **＋ Circle**, **＋ Capsule** and **＋ Box**; shapes are drawn green on the
ground. A capsule is a segment (from x, z to x, z) made thick by a radius; a box has a centre, half width (across), half
length (along z) and a turn in degrees. The file format, `extras.nova` keys and `nova.model_shapes` are in
`docs/project-format.md`; static scenery turns capsules and boxes into chains of circles (a box's corners are cut
a little), so `nova.scenery.push` and `push_capsule` work unchanged.
