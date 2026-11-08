# The debugger

Added 2026-11-08. The studio talks to the running game: breakpoints, stepping, the call stack and variables, errors that
stop where they happen, a live view of the running scene's objects, and a hot reload that keeps the game running when
only code changed. The Help window's "Start here" page has the person-facing version ("Finding out what your game is
doing").

## Using it

- **Breakpoints**: click left of a line number in a Lua file (a red dot). The dots move with the lines as you type and
  are kept per project (in the studio's browser storage). Press Play; when the game reaches the line it stops and the
  line lights up.
- **Debugger tab** (bottom panel): Continue (F8), Step over (F10), Step into (F11), Step out (Shift+F11), Pause (stops at
  the next line of your code). The call stack lists frames innermost first; the framework's and the engine's frames are
  greyed. Locals, Upvalues and Globals of the chosen frame; tables open in place (▸). *Stop at errors* (on by default):
  an error stops at the failing line before the stack unwinds, so its variables can be looked at; Carry on then lets
  the error stop the game as before.
- **Objects tab**: the running scene (`nova.world`) and its living entities, refreshed twice a second, with a filter by
  name, tag or id. Click one to outline it in the game (a yellow box: a rectangle round a sprite or hitbox in 2D, a box
  of lines in 3D) and see its fields. Numbers, text and true/false can be changed while it runs (Enter sets it,
  Esc puts it back); a field keeps its kind, so a typo cannot turn a speed into text. Tables open in place and their
  plain fields can be set too. Changes last until the game restarts; they are not written to any file.
- **Reload**: saving while the game runs either *keeps it running* with the new code or *restarts* it. The studio says
  which (a notice, a line over the Play log, and "↻ kept running" / "↻ restarted" in the Debugger and Objects tabs).

## Keep-state reload (`Game::hot_reload`)

Every 400 ms the runtime looks for changed files (as before). It now records each project file's modification time at
load, so it knows *which* files changed:

| What changed | What happens |
| --- | --- |
| Only Lua files that the game loaded with `require` | Each new file is run once (into a fresh table); its functions replace the old ones in the old module table, so entities, the scene, timers, coroutines and module tables carry on. |
| A Lua file the game has not loaded | Nothing (it is read when first required). |
| The entry script (`main.lua`) | Restart: its top level runs once at start (it usually calls `nova.start`). |
| Anything else (scenes, pictures, sounds, `nova.json`...) | Restart. |
| A module that now returns something of another kind, or returns a function | Restart (other code may hold the old one). |
| The game had stopped while starting (an error in `main.lua` or `init`) | Restart. |
| The new code has a syntax error or fails at its top level | Nothing changes: the old code keeps running, and the studio shows the error. |

How functions are swapped (`lua/devtools.lua`, `D.swap` and `D.retarget`):

- Methods and functions in the module's table (and in entity/scene classes kept in it) are replaced; new ones are
  added; ones taken out of the file are removed. Plain values (numbers, text, true/false) take the new file's value, so
  a changed class default or constant shows. Tables already there are the game's state and stay.
- **Module-level locals** (upvalues): the new functions are joined to the old ones of the same name when the old one
  holds a table, function or other object (lists, caches, the class itself, other modules), so state is shared. When it
  holds a number, text or true/false, the new code's value is used, so a changed constant takes effect. A counter kept
  in a module-level number therefore starts again from the file's value; keep state in a table or on the entity.
- Subclasses copied their parent's methods when first used (`finalize`); every class still holding an old function gets
  the new one, and changed classes and their subclasses are worked out again (tags, defaults for new spawns, collision
  handlers).
- Globals that pointed at an old function (`update`, `draw` set by a module) are pointed at the new one.
- If the game had stopped with an error at run time and the reload succeeds, the error is cleared and the game carries
  on from where it stopped.

The log line says what happened (`content.rs`); the studio reads it, so this works without the debugger:

```
reload: kept the game running with the new code of entities/hero.lua
reload: not applied, the old code keeps running: entities/hero.lua: ...
reload: restarted the game (main.lua changed, and it runs once when the game starts)
```

## The connection

The game listens, the studio connects. `nova run <folder> --debug PORT` listens on `127.0.0.1:PORT` (0 picks a free
port) and prints `nova debug: listening on 127.0.0.1:PORT` on stdout; `--debug-wait` makes it wait up to 5 s, before
the entry script runs, for a studio to connect and send `ready` (so breakpoints in `main.lua` and `init` work). The
studio's Play passes `--debug 0 --debug-wait` and connects when it reads that line (`studio/src-tauri/src/debug_link.rs`).
It is a plain TCP socket on localhost because that works unchanged for a game on the Retroid through
`adb forward tcp:PORT tcp:PORT` (the studio would then connect to its own `127.0.0.1:PORT`). **Not done yet:** a way to
pass `--debug` to the Android build (an intent extra read in `lib.rs`), and the studio side of adb forwarding.

Messages are JSON objects, one per line, both ways. Requests carry an `id` and a `cmd`; replies are
`{"reply": id, "ok": true, "result": ...}` or `{"reply": id, "ok": false, "error": "..."}`. Frames are named by
`depth`, how far they are from the bottom of the paused coroutine's stack (1 = the oldest), which does not change while
the debugger looks around. Protocol version 1 (`hello` reports it).

| Request | Arguments | Result |
| --- | --- | --- |
| `hello`, `ready` | | `{ protocol, name, paused, pause_on_errors }`; `ready` also ends `--debug-wait` |
| `set_breakpoints` | `file` (project path), `lines` | `{ file, lines }` (replaces that file's breakpoints) |
| `pause_on_errors` | `on` | `{ on }` |
| `pause` | | `{}`; stops at the next line of a project file |
| `continue`, `step_over`, `step_into`, `step_out` | | `{}` (only while paused) |
| `stack` | | frames `[{ file, line, func, depth, internal }]`, innermost first (only while paused) |
| `scope` | `depth`, `which` (`locals`, `upvalues`, `globals`) | values `[{ name, value, type, ref? }]` |
| `children` | `ref` | the fields of a table given out by reference |
| `entities` | | `{ scene, count, entities: [{ id, name, kind, x, y, z, tags }] }` (the scene is id 0) |
| `entity` | `target` (an id) | its fields as values |
| `set` | `target` (an id) or `ref`, `key`, `value` | the new value; numbers, text and true/false only, and of the kind already there |
| `highlight` | `target` (an id or null) | `{ target }` |

Events from the game: `paused` `{ reason: "breakpoint" | "step" | "error", file, line, message, stack }`, `resumed`,
`reloaded` `{ kept, files, reason?, failed? }`, `protocol_error` (a line that was not a JSON object). The studio's own
link adds `connected` and `disconnected`.

`value` is the value as text (`"Ada"` in quotes for text, `hero entity #3` for an entity, `{ 3 items }`,
`function (lib/a.lua:12)`); `ref` numbers are good until the game moves on (the next pause, or the next `entity`
request while running).

## How it works in the runtime

- `src/debug.rs`: the socket, breakpoints, step state. Non-blocking reads at the start of each frame; while paused, a
  loop that waits for requests (polling every 4 ms).
- `src/game/debug_api.rs`: the line hook, the pause loop, the requests, the reload.
- `lua/devtools.lua`: the Lua side, loaded with Lua's `debug` library, which games never see: the library is opened
  straight into this chunk (`luaL_requiref`, not as a global) and kept in its locals.
- **Pausing** happens inside the Lua hook (a breakpoint or a step) or inside the error handler (an error): the Lua
  stack is intact, so locals and upvalues are read with `debug.getlocal` / `debug.getupvalue`. The game's window does
  not redraw while paused (the main thread is waiting); music keeps playing.
- **Errors** pause because, while a debugger is attached, `update`, `draw`, `init` and the entry script are called
  through `xpcall` with a handler that stops before the stack unwinds; the traceback is kept, so the Problems panel and
  the error banner read as before.
- **Cost**: without `--debug` nothing is created (no socket, no hook change, no devtools). With it and no breakpoints,
  a frame costs one non-blocking accept or read, and calls go through `xpcall`. Line hooks are switched on only while
  there are breakpoints or a step is under way, on the main thread and on every coroutine the game has made (Lua copies
  a thread's hook into a coroutine only when it is made, so the debugger keeps a weak list of coroutines while
  attached).
- **Stepping** only stops in project files (chunks named `@path`): stepping into `nova.spawn` goes through the framework
  and stops at the next line of your code. Step over and step out stay in the same coroutine.

## Limits (2026-11-08)

- Checked with runtime tests (`tests/debugger.rs`: a scripted studio over TCP against a real `Game`, and the reload
  cases), studio tests (`debugger.test.ts`, `debugger-panels.test.ts`, `debug_link.rs`), the panels in the browser
  preview against a pretend game (`mock-debug.ts`), and the real protocol against `nova run --headless` from the command
  line. **Not tried in the studio app's own window against a real game, and not on the Retroid.**
- An error inside a coroutine (`self:go`) pauses where the framework passes it on, not at the line inside the
  coroutine.
- While paused the game's window does not redraw or answer the system (a long pause may make the system say it is not
  responding).
- Variables can be looked at, not changed, while paused; values of entities can be changed while running. There is no
  "evaluate an expression" box yet.
- Breakpoints are by line; a line with no code never stops. They are not checked against the file's code lines.
- The keep-state reload does not know about state held in module-level numbers or text (see above), or about code
  that a module's top level ran once (for example spawning things): that runs again in the new copy only.
