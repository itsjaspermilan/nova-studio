# Nova Studio: plan and TODO

Last updated: 2026-11-09. Nothing below is implemented unless it is ticked. The long history (milestones M0 to M8, the probe games, the
per-game notes and the device logs) was pruned on 2026-11-09; it is in git: `git show db3e9c5:TODO.md`. Detail on finished runtime work lives in
`docs/` (`project-format.md`, `performance.md`, `spike-results.md`, `materials.md`, `switch-class-graphics.md`, `local-coop.md`, `debugger.md`, `play-on-device.md`).

## Where things stand

- **Plan (2026-11-09): one studio with four workspaces** (Model, Sprites, Sound, Engine). The master checklist is the next section;
  its detail is in `docs/studio-workspaces.md` (features) and `docs/studio-ux.md` (menus, toolbars, input, windows).
- **Art direction (2026-11-09):** Switch 1-class graphics at 60 fps on the Retroid (decisions table below).
- **Examples:** `examples/pine-ridge-rally` is the one game kept. The others were removed on 2026-11-09 and live in git tag
  `archive/examples-2026-11`. Small feature fixtures stay (`stress`, `material-demo`, `physics-toybox`, `skin-demo`, `ik-demo`, `menus`,
  `coop-test`, `font-gallery`, `sound-check`, `input-test`) because tests and scripts use them.
- **Engine (done, see docs):** native Rust runtime on wgpu + Lua; scenes, entities, 2D and 3D, GPU skinning, clips and IK, physics
  (Rapier), voxels, terrain, materials and shaders, keyframe animations, a sound mixer with streamed music, local wifi co-op, the
  Gradle-free APK path, and the opt-in Switch-class renderer (HDR, MSAA, cascaded shadows, image-based light, KTX2).
- **Device (Retroid Pocket 6, Android 13, Snapdragon 8 Gen 2 class, 1080x1920 panel shown in landscape, serial bc8565a3):** the stress
  benchmark holds 60 fps in all phases, and a 35-minute soak of Pine Ridge free roam with the car driving ran at 59.7 fps with no
  throttling (`docs/performance.md`). The emulator profile `retroid-sim` says nothing about frame rate, thermals or audio latency.
- **Not verified by a person or on the device:** the radio songs and engine sounds have not been listened to; drift feel, stiffness and
  camera are first guesses; the new cars are not played on the Retroid; the studio's native-only paths were checked once overall.

## One studio, four workspaces (decided 2026-11-09): the master checklist

Decided with the owner: **one Tauri app** (the four-app split in `docs/split-plan.md` was dropped). Four workspaces open as tabs or, on
request, their own windows: **Model** (3D, modelled on Blender), **Sprites** (2D, Pixelorama), **Sound** (LMMS), **Engine** (Lua, scenes,
play, export). One project folder. A document opens in one place at a time, one undo history per document. One full interface, no beginner mode.
Blender keymap in Model. Goal: a free, all-in-one studio for making games, no strings attached; nothing quirky.
**Detail lives in the docs; this list is what must not be missed. Tick an item only when it is built and checked.**

- Features per workspace: `docs/studio-workspaces.md` (sections 2 to 5, with the Blender, Pixelorama and LMMS references).
- UX, menus, toolbars, input, windows, test plan: `docs/studio-ux.md`. Order of work is in its section 8.
- The studio already has first versions of most editors (`studio/src/components/`: ModelEditor, ModifierStack, SpriteEditor, SoundEditor,
  SongEditor, TrackEditor, TimelineEditor, SceneEditor, Scene3D, Editor); items below say what is added.

### S0: Mockups and decisions (before code)
- [x] Wireframes for each workspace and the first-launch screen: `docs/ux/studio-wireframes.html` (owner approved 2026-11-09).
- [x] Icon set (2026-11-09: `lib/icons.ts`, 42 icons drawn for this project on a 24 grid, so nothing to license; `Icon.svelte`; shown in the menus, the palette, the workspace tabs and the 3D view buttons; a test keeps every named icon drawn). Not yet: 16 and 20 px hand-tuned versions.
- [~] Windows: `docs/windows-plan.md` (2026-11-10) evaluates the snap-layout options on paper (a native hit-test hook, a community plugin, or keeping the native caption) with a recommendation and a Windows test checklist. **Nothing was run or installed**; no plugin was added.

### S1: The spine (every workspace needs it)
- [~] Command registry (2026-11-09: `studio/src/lib/commands.ts`, 10 tests; the studio's shortcuts and the Cmd/Ctrl-K palette use it; not yet: icons in a shared set, the shortcut editor, menus and toolbars reading it): id, plain name, icon, per-OS shortcut, enabled rule, help text; menus, toolbars, context menus, palette, tooltips, shortcut editor and help search all read it.
- [~] Menus (2026-11-09: one layout, `lib/menus.ts`, for both): the macOS system menu bar is built by `src-tauri/src/menu.rs` (checked by listing it through accessibility in `tauri dev`: File, Edit, View, Run, Window, Help; Run greyed with no project; a menu click reaching the command is not confirmed), and drawn menus (`MenuBar.svelte`, used on Windows and in the browser preview; Undo checked in a text field in the preview). **Alt-key access added 2026-11-09 to the drawn menus** (`MenuBar.svelte`, `mnemonicsFor` with a test; Alt+V opened View in the browser preview): Alt on its own opens the first menu, Alt and a letter opens that menu (the letter is underlined), arrows, Home, End and Enter move and run. The macOS system menu has its own keyboard access. Not yet: per-workspace menus, a Windows run, the Edit menu's Undo and Redo through the system menu in editors.
- [ ] Window chrome: macOS overlay title bar with native traffic lights; Windows `decorations: false` with our own caption buttons (+ snap-layout flyout, unverified until run on Windows).
- [~] Command palette (Cmd/Ctrl-K, `CommandPalette.svelte`, checked in the browser preview; searches commands only so far) searching commands, documents, assets, Lua symbols, help, settings.
- [~] Keymap system (2026-11-09: `lib/keymap.ts`, `KeymapEditor.svelte`, Edit > Keyboard shortcuts: a Blender preset (default) and a Nova preset, per-command overrides, conflict warning with "use it here instead", Reset, remembered; plain letters are text while typing in a box; the model editor's move, turn, resize, pivot, edit points, add, duplicate, delete, shading and reset view are commands with Blender keys G R S, Tab, Shift+A, Shift+D, X, Z, Home, and a Model menu; 14 tests; checked in the browser preview). Added later the same day: Blender's modal move and resize (G / S, then the mouse, X Y Z for one axis, a typed number, click or Enter keeps, Esc puts it back; one undo step; `lib/modal-transform.ts`, 10 tests; checked in the browser preview with real key presses), and select all (A), none (Alt+A), invert (Ctrl/Cmd+I). The handles moved to Shift+G / Shift+S in the Blender keymap. Modal turn (R) is still the handles. **Added 2026-11-09 (later):** box select for points (B or the Box button; Shift adds), the standard views (front, back, left, right, top, bottom as commands, toolbar buttons F B L R T Bt and the keys 1, 3, 7, 2, 4, 8), a flat (orthographic-like) view (5), and 15 degree view turns, all as commands in the Model menu; Sprites and Sound commands (the Sprite and Sound menus, all through the shortcut editor). Not yet: per-workspace presets, a printable cheat sheet, modal turn (R) with the mouse.
- [~] Areas (2026-11-09: each workspace remembers whether its tree and bottom panel are shown and how big they are, Cmd/Ctrl+J shows or hides the bottom panel, Window > Reset layout; `lib/layout.svelte.ts`, 5 tests, checked in the browser preview). Not yet: a right-hand properties area and a left tool shelf at the shell level (the editors still carry their own panels), split/join, switchable area types, named saved layouts, layouts per project.
- [~] Workspace tabs (2026-11-09: Model, Sprites, Sound, Engine in the top bar, Cmd/Ctrl+1 to 4, in the Window menu; a file opens in the workspace that owns it, each workspace remembers its document and shows a home page when none is open; a document opens once; `lib/workspaces.ts`, store tests). Not yet: each workspace's own layout, toolbar and panels (they still share the old editor area), tear-off windows (Tauri multi-window) with "open in another window" + Jump, and the undo history list.
- [~] Tear-off windows and the one-document rule across windows (2026-11-09: `src-tauri/src/windows.rs` keeps which window has which document and makes a document window with the same window chrome; Window > Move this document to its own window; opening a document another window has focuses that window; a document window shows just its editor and joins the open project; 3 Rust tests, 3 store tests; the app starts and the menus sync with it). **Not run end to end:** I could not drive the real app to tear a document off, so the second window, the focus hand-off, Windows chrome on it and what a closed window frees are untested. Not yet: dragging a tab out, a "Jump" note on the tab, returning a document to the main window, sprite and model editors checked in a second window.
- [~] Crash recovery (2026-11-09: `lib/recovery.ts`; every 30 s, and when the window hides or closes, a copy of each document's unsaved text is kept beside the studio's settings (not in the project), removed on save or tab close, and offered back with Restore / Discard when the project opens if it differs from the file; 7 tests; text documents only). **Added 2026-11-09: named version snapshots of the whole project** (File > Snapshots…; `src-tauri/src/snapshots.rs`, 4 Rust tests: a copy of every project file except exports and hidden ones into `.nova/snapshots/`, links not followed, restore removes files the snapshot lacks, takes a safety snapshot first so a restore can be undone, limits of 20,000 files, 1 GB and 40 snapshots; `SnapshotsDialog.svelte`; **the dialog and the real backend were not run in the app**). Not yet: a sprite's unsaved pixels and a model's unsaved edits that live outside the tab text, checked in the real app after a forced quit, a recovery list in a menu.
- [~] First-launch screen (2026-11-09: `FirstLaunch.svelte`: mouse, trackpad or pen, tried on a practice cube, a guess from the first scrolls, a reverse-scroll switch; Edit > Input settings reopens it; checked in the browser preview with a synthetic trackpad scroll). Not yet: the "start with" step, and a real trackpad or pen.
- [ ] Learnability instead of a beginner mode: tool hints in the status bar, a guided first exercise per workspace (`lib/tutorials`), project templates. (The Pine Ridge lessons and the Help panel exist; the per-workspace guided first exercises do not.)
- [~] Input layer (2026-11-09: `lib/view-nav.ts`: the scene and model 3D views follow the chosen scheme: middle-drag orbit, Shift-drag pan, trackpad two-finger orbit, Shift pan, pinch zoom, ortho cameras too; 5 tests on the moves). On-screen turn/move/zoom buttons (`NavButtons.svelte`: drag, or arrow keys when focused) are in the model and scene views, and the model editor's hint line follows the scheme (a button drag checked in the browser preview). Not yet: pen pressure, tilt and barrel button, emulate-numpad, the sprite canvas's trackpad pan and zoom, a check with a real trackpad, a Windows touchpad or a pen.
- [~] Accessibility (2026-11-09: focus rings on every control, UI size 75 to 200 percent, reduced motion, a high-contrast theme, screen-reader names on the icon buttons, dialogs marked as dialogs, 8 contrast tests of the three themes that found and fixed a faint grey; Edit > Appearance). Not yet: a full keyboard focus-order pass, a VoiceOver and keyboard-only audit, colour-blind-safe graphs, 32 px targets everywhere.
- [~] Shared asset browser (2026-11-09: the Assets tab in the bottom panel, Cmd/Ctrl+Shift+A: a card per resource with the sprite's picture or an icon, search, kind filter, click opens it in the owning workspace, drag drops its short name into code; 4 tests). Not yet: tags, model thumbnails, dragging into a scene, import settings per asset.
- [x] Themes: system, dark, light and high contrast, one accent colour (Edit > Appearance; remembered).

### S2: Model workspace (`docs/studio-workspaces.md` section 2)
- [ ] 2.1 Layout: viewport (persp/ortho, view gizmo, grid, camera, local view, shading, X-ray, overlays), tool shelf, outliner, properties tabs, mode switch (Object, Edit, Sculpt, Weight Paint, Texture Paint, Pose).
- [~] 2.2 Modelling. **Added 2026-11-09** (pure functions with 24 + 6 + 5 tests, `lib/mesh-ops.ts`, `lib/mesh-stats.ts`; the buttons are in the mesh inspector's "More tools", and the triangle budget in the Model inspector; the budget panel was checked in the browser preview, **the mesh buttons were only built and unit-tested, not clicked**): merge points (centre, first, last), dissolve points and edges, triangulate (ear clipping), smooth, **soft move with falloff** (smooth, linear, sharp, root, sphere, constant; connected-only option; typed, not dragged), snapping helpers, inset with a thickness, **bridge** two faces (library only, no button: the editor picks one face at a time), spin and screw a profile, decimate (grid clustering) and **LOD copies**, displace, bend, twist, taper and stretch; **modifiers**: Weld, Triangulate, Decimate, Displace, Simple deform and Smooth join the stack; **mesh analysis** with a triangle budget bar per model kind and plain-words problems (open edges, fins, empty faces, loose points); **reference pictures** (`lib/model-reference.ts`, 5 tests, `ReferencePanel.svelte`; seen working in the browser preview: a blueprint plane behind the model, up to six, per standard view with size, slide, depth, opacity, flip and on-top, remembered per model on this computer, not in the model file). Not done: knife as a free cut (a two-point cut exists), edge slide, fill by grid, selection tools beyond a face, an edge or points (box select, loop and ring select, select similar), a redo panel for primitives, the other modifiers (Boolean, Edge Split, Weighted Normal, Curve, Lattice, Shrinkwrap, Remesh, Wireframe, Armature), curves and text to mesh. Original list:
  primitives with redo panel; selection tools; extrude, inset, bevel, loop cut, knife, bridge, merge, dissolve, fill, spin, screw and the rest; proportional editing; snapping, pivot, orientation, mirror editing; more modifiers (Boolean, Weld, Decimate, Triangulate, Edge Split, Weighted Normal, Displace, Curve, Lattice, Shrinkwrap, Simple Deform, Smooth, Remesh, Screw, Wireframe, Armature); curves and text-to-mesh; reference images; mesh analysis with triangle-budget bar; LOD generation.
- [ ] 2.3 Sculpt, texture paint (layers, projection, per-channel), weight paint, baking (AO, curvature, normal, lighting).
- [ ] 2.4 UV editor (unwrap, seams, pin, pack, texel density, checker, stretch) and material editor (PBR, small node view baking to the runtime material); atlas packing, KTX2.
- [ ] 2.5 Rigging and animation: bones, skinning, IK, constraints, pose library, dope sheet, graph editor, actions as clips, NLA-lite, shape keys, markers/events, retarget, rig templates, humanoid auto-rig.
- [ ] 2.6 Scenes and landscape: instances, collections/prefabs, scatter, curve placement, surface snapping, terrain sculpt/paint/roads/water/foliage/biomes, camera and cutscene sequencer-lite, lightmap preview.
- [ ] 2.7 Interop: glTF (done), OBJ, one-click `.blend` import (headless bpy), asset libraries, backups.
- [ ] Proving project: the Pine Ridge cars made and edited in the workspace, not by script.

### S3: Sound workspace (section 4; detail in `docs/studio-workspaces.md`). Done on 2026-11-09, then everything still open, one line each
Done (checked in the browser preview and by unit tests; **none of it run in the real app, nothing listened to**):
- [x] Mixer strip per track (fader, pan, reverb send, echo send, mute, solo), master fader to 150 percent, "Measure levels" in dB (`MixerPanel.svelte`, `lib/mixer.ts`), a live master meter while playing; solo and master saved in the song file.
- [x] Piano roll: ghost notes of other tracks (already there), a Loudness view with draggable bars, snap to the beat, repeat twice over, set all loudness, pick several notes (Shift-click, Shift-drag, Cmd/Ctrl+A) and move, cut, copy, paste and delete them together.
- [x] Per-track echo (level, gap in steps, repeats; wraps round for a loop).
- [x] Stems: one Ogg per track, all the song's length (Sound menu). Four close variations of a sound effect (sound-effect editor).
- [x] A Sound menu and palette commands for all of the above.

Still open (4.1 Layout):
- [ ] Song editor with an arrangement: clips on tracks, split, resize, knife, loop, colour, zoom and snap; a pattern editor apart from the piano roll (today one song is one looping pattern).
- [x] (2026-11-09, `lib/song-tools.ts`, `lib/song.ts`, unit tests; the Tools panel checked in the browser preview, **nothing listened to**) Beats in a bar (the bar lines follow), markers (named, drawn on the roll), and a loop region (drawn on the roll; "Export the loop" writes `music/<song>_loop.ogg` of just those steps with the note tails wrapped onto its start, so it loops without a seam in the game).
- [ ] Still open: a tempo *track* (the tempo changing within a song) and a different time signature part-way: the song has one tempo; loop points as metadata in the Ogg for the runtime to seek (the exported loop is its own file).
- [x] (2026-11-09, unit tests; Tools panel) Piano roll helpers: strum (down or up, a gap), glue, humanise loudness and timing (seeded), snap to a scale (9 scales), build a chord on picked notes (10 chords, inversions), quantise to a chosen grid (1 step, 2, half a beat, a beat, a bar).
- [ ] Still open: a pan lane, pitch bend, per-note properties, Ctrl-drag to copy.
- [x] (2026-11-09, `lib/song-lanes.ts`, unit tests) A **gain lane** per track: points with a straight, smooth or stepped curve, an LFO generator (sine, triangle, square); each note plays at its loudness times the lane where it starts (rendered, so the exported file has it). Drawn as a small graph in the Tools panel; points are typed in.
- [ ] Still open: automation of any other knob (pan, cutoff, reverb, effect settings) and a lane drawn with the mouse over the roll; tangent handles.
- [x] (2026-11-09, `lib/loudness.ts`, 7 tests incl. BS.1770 reference levels) A LUFS meter (K-weighted, gated; "Measure the loudness" in Tools), a **loudness target** (the render is brought to e.g. -16 LUFS) and a **limiter** with a peak ceiling, both saved in the song's `master` and used by every export.
- [ ] Still open: send routing and buses, FX chains per channel (see Effects), colours per channel.
- [ ] Instrument and effect panel for the selected track (a plugin-style UI) instead of the one long inspector.
- [ ] Sample editor: loop points, slicing (auto-slice), pitch and time stretch, gain, record from the microphone (own consent step), spectrogram. (Trim, fade, normalise, reverse, waveform exist.)
Still open (4.2 Instruments, effects, files):
- [x] (2026-11-09, `lib/song.ts`, 4 tests that check the sound is the same every time, a string fades, more FM bend has more highs; **nothing listened to**) New instruments on a track: **FM** (ratio and bend, fading as the note rings), **plucked string** (Karplus-Strong, rings and brightness) and an **organ** (added harmonics with a sub octave), and 7 **presets** (bass monosynth, soft pad, bright lead, electric piano, bell, plucked string, organ) in the track inspector.
- [ ] Still open: wavetable synth, a sample-based drum machine, a sampler and keymap, soundfonts (SF2/SFZ), a formula ("expression") synth, vocoder-lite.
- [x] (2026-11-09, `lib/fx.ts`, 13 tests that check what each does to a signal, plus a render test; the panel checked only by building, **nothing listened to**) A chain of up to six effects per track, run after its volume and pan: 3-band EQ, compressor (threshold, ratio, attack, release, make-up), chorus, flanger, phaser, distortion (with tone), bit crusher, gate; each can be bypassed, moved or removed; saved in the song file and rendered into every export. Plus a master limiter and loudness target (see Mixer).
- [ ] Still open: a parametric EQ with an analyser, multiband compression, pitch shifter, stereo tools, transient shaper, a spectrum analyser, oscilloscope and vectorscope; effects on the master; reverb and echo as chain effects (they are track sliders).
- [ ] Controllers: LFO, envelope, peak follower, MIDI keyboard input for live play, tap tempo.
- [x] (2026-11-09, `lib/midi.ts`, 8 tests: round trip, running status, GM drums, error messages; the write to `exports/` and the file picker not run in the real app) MIDI export (type 1, tempo, bar, markers, one track each, drums on channel 10) and import (type 0 and 1, notes put on the grid with a warning for what was rounded or left out); loop-ready export (see above); loudness on export (see Mixer).
- [ ] Still open: MP3 import, project template songs, the audio core's synthesis connected to game audio.
Still open (4.3 Game audio):
- [ ] Adaptive music in the runtime (layers or stems mixed by game state, transitions on bar lines): the stems exist as files, the runtime does not mix them.
- [x] (2026-11-09; runtime: 6 tests in `tests/locale.rs` and 2 unit tests, docs in `project-format.md`; studio: `lib/soundbank.ts` 9 tests, the panel only built, not looked at) **Random sound groups**: `sounds/<name>.group.json` and `nova.sound.play("<name>")` (ranges for volume, pitch and pan, no repeats), `nova.sound.group`; **3D falloff presets** (`falloff = "smooth" | "linear" | "natural" | "none"` on positioned sounds); a **Sounds panel**: every sound with its size, estimated memory, the files that use it, unused ones, names the code asks for that do not exist, a memory budget for a handheld and the 32-voice limit, and "Make a group" from ticked sounds. Memory is an estimate (WAV as is; Ogg effects about 11 times the file; streamed music a small buffer), not measured on the device.
- [ ] A person listens to the songs and the sounds (nobody has yet); audio latency on the Retroid.

### S4: Sprites workspace (section 3; detail in `docs/studio-workspaces.md`): what exists, what was added on 2026-11-09, everything still open
Already there before: layers with opacity, visibility, merge down and linked cels; frames, animations (tags with direction and loop) and per-frame time; onion skin (3 before, 3 after, tinted); mirror drawing; pixel-perfect pencil; pencil, eraser, fill, line, rectangle, ellipse, colour picker, rectangle select with move, copy, cut, paste; sheet import with grid detection and smart slice; layers saved beside the sheet.
Added 2026-11-09 (browser preview and unit tests; **not run in the real app**):
- [x] Layer blend modes (normal, multiply, screen, overlay, add, darken, lighten): stacked, merged and saved in the layers file (`pixels.ts`, `sprite-doc.ts`, 6 tests).
- [x] Named palettes (`lib/palette.ts`): a palette list with the built-in Starter and Greys, the person's own, import of `.gpl`, hex lists and JSON, export as `.gpl`, a palette from the colours of the picture, add or take out colours, "Stay in palette" (snaps picked colours to the nearest); 14 tests.
- [x] Image effects on the cel or the selection (`lib/sprite-fx.ts`): flip, quarter turns of a square, invert, grey, hue shift, lighter, darker, outline, drop shadow (destructive, one undo step); 9 tests.
- [x] A Sprite menu; every tool is a command with its Pixelorama-style key (B, E, G, L, R, O, I, M), so the keys can be changed in Edit > Keyboard shortcuts.
Still open (3.1 Canvas):
- [x] (2026-11-09, `lib/symmetry.ts`, 6 tests; the right button and the tiled preview checked in the browser preview) Diagonal mirroring on square sprites, tiled drawing (strokes and brushes wrap round the edges, left-right and up-down, and the preview repeats the sprite three times across or down), a drawing section in the side panel.
- [x] (2026-11-09, browser preview) Rulers (pixel numbers, a marker follows the pointer), zoom to 64x (zoom tool: click in, Alt-click out; Cmd/Ctrl +/-, Ctrl-wheel and a trackpad pinch zoom about the pointer), a pan tool and middle-button pan, a pixel grid every 1, 2, 4, 8, 16 or 32 pixels.
- [ ] Still open on the canvas: mirroring about a point and symmetry guides drawn on the canvas for the diagonal, a mini-map for big pictures, a preview window at 1x that can be detached, a tiled view of the canvas itself (only the preview tiles today).
- [x] A tool and a colour for the right mouse button (default eraser and white; pick any non-selection tool, swap the colours with X or the button; a right-click with the picker sets the right colour).
- [x] (2026-11-09) A reference picture from the project (the Reference section in the side panel: opacity, behind or on top, size, position); never saved with the sprite.
- [ ] Still open: a per-tool options panel (the options bar is still shared); reference images beside the canvas and as an onion layer.
Still open (3.2 Tools):
- [x] (2026-11-09, `lib/brush.ts`, 9 tests; the gradient drag checked in the browser preview) Round and diamond brush shapes for the pencil, eraser and shading brush; a shading tool that lightens or darkens by painting (lightening turns the hue towards yellow, darkening towards blue; each cell once per stroke); a gradient tool (drag; the left colour to the right-hand one, inside the selection if there is one) with no dither, 2x2 or 4x4 Bayer, or checker patterns.
- [x] (2026-11-09, `lib/pixels.ts` `fillWith`, `drawPolygon`; `lib/brush.ts` picture brushes; polygon, zoom and pan checked in the browser preview) Fill with a tolerance, "same colour everywhere" and limited to the selection; a polygon tool (outline or filled; click corners, Enter or double-click finishes, Esc drops); zoom and pan tools; "Use the selection as a brush" (pencil and eraser stamp the picture, with its own colours or one).
- [ ] Still open (3.2): a text tool, pressure for a pen.
- [x] Selections (2026-11-09: `lib/selection.ts`, 12 tests; the wand checked in the browser preview, the rest by unit tests only): rectangle, ellipse, free-hand lasso, magic wand (joined colour, with a tolerance) and select-a-colour-everywhere; Shift adds, Alt takes away, both together keep the overlap; select all, none, invert, grow and shrink by a pixel, crop the sprite to the selection; a selection that is not a rectangle moves, cuts, copies and takes effects as its exact cells, drawn as dashed outline.
- [ ] Still open from selections: polygon-by-clicks and paint-select tools; transforms of a selection (scale, rotate with RotSprite, clean-edge); flip and quarter turns of a non-rectangular selection act on its box, not its exact cells; a selection that follows a frame to the next (it is per editor, not per cel).
- [x] (2026-11-09, `lib/sprite-fx.ts`, unit tests; the buttons are in the Effects section) Gradient map, palettize (to the palette's colours), pixelate, brightness / contrast / gamma curves.
- [ ] Still open: replace colour and offset as commands (the functions exist).
Still open (3.3 Layers, cels, frames):
- [x] (2026-11-09, `lib/sprite-doc.ts`, 3 tests; the padlock and clip buttons only built, not clicked) **Layer lock** (the tools, effects, paste, clear and flip leave a locked layer alone, with a message) and **clipping layers** (a layer shows only where the one below it has something; saved in the layers file).
- [ ] Still open: group layers, tilemap layers, audio layers, 3D layers; cel properties; **non-destructive** effects on a cel or layer (today the effects change the pixels for good).
- [x] (2026-11-09) **Per-frame hitboxes, pivots, frame events and a 9-slice**: the runtime reads them from `*.sprite.json` (`hitbox`, `pivot`, `nine_slice`, `frame_data`; `sprite.rs` with 2 unit tests that name the place of each mistake; `docs/project-format.md`), Lua gets `on_animation_event(name, frame)`, `self:frame_hitbox()`, `self:frame_pivot()` and `nova.ui.panel` uses the sheet's own borders by default (2 tests in `tests/framework.rs`). The studio edits them in the Sprites side panel (hitbox, pivot, events per frame; "same for the animation"; "make default"; nine-slice borders; drawn on the canvas as a green box, a red cross and blue dashed guides) and keeps them with the frames through inserting, moving, removing, copying, cropping and resizing (6 tests in `sprite-doc.test.ts`). The edit controls were checked in the browser preview (a value typed came back); **the game does not move an entity's collision box by itself**: a game reads `frame_hitbox()` where it wants it.
- [x] (2026-11-09) Timeline: "＋ N frames" after the current one, and a speed in frames a second for the animation.
- [ ] Still open on the timeline: scrubbing, ripple edit, dragging cels.
Tilemaps and tilesets (3.4), started 2026-11-09 (browser preview and unit tests, **not run in the real app**):
- [x] Tileset descriptions: `<picture>.tileset.json` beside the PNG (`lib/tileset.ts`): tile size, which tiles are solid, names for tiles, terrains; a Tilesets group in the project tree; opened by the Sprites workspace (Sprites home: "Open or make its tileset"); the game never reads it.
- [x] Tileset editor (`TilesetEditor.svelte`): the picture cut into numbered tiles, click a tile, name it, mark it solid, tile size, find tiles that look exactly alike, undo and redo; terrains: add one laid out from the selected tile, assign slots by clicking tiles in order, a little shape painted with it as a preview.
- [x] Auto-tiling (`lib/autotile.ts`): "edges" terrains (16 tiles by which of the four sides touch) and "edges and corners" terrains (47 tiles); painting and erasing refresh the neighbours; retile a map. 10 tests.
- [x] The scene editor's tile map: a new map takes its tile size and solid list from the tileset's description; "Paint with: terrain" paints with auto-tiling (the eraser takes it away); the scene file just holds tile numbers.
Still open (3.4): none of the following exists yet:
- [ ] Tilemap layers inside a sprite document, and a tile map editor in Sprites (today a map is made in the scene editor).
- [ ] Manual mode (edit one tile's pixels and have its copies update), draw-all-copies, tile size and shape beyond square (isometric, hex), offsets, rotated or flipped placement, tile properties beyond solid (collision shapes, custom values), terrain priorities between terrains, animated tiles, tileset import and export as PNG plus Nova's JSON beyond today's plain PNG, a layout wizard for common autotile layouts (the standard 47-tile "blob" sheet order and Godot or Tiled terrain sets).
- [ ] Re-tile a whole map from the scene editor after a terrain changes (the function exists), terrain painting with the fill tool, a map-wide solid overlay from the description.
Still open (3.5 Palettes):
- [x] (2026-11-09, `lib/palette.ts`, unit tests) `.pal` (Paint Shop Pro) read and write, a palette from a PNG's colours, sort (hue, lightness, saturation, R, G, B), move a swatch, colour ramps and hue-shifted shade ramps, "Lock to palette" (drawing takes the nearest palette colour).
- [ ] Still open: Lospec download (a network call: needs the owner's say-so), indexed-colour mode, project-wide palettes shared by Sprites and Model.
Still open (3.6 Files):
- [x] (2026-11-09) Export the current animation as an animated GIF (`lib/gif.ts`: our own writer with LZW, a colour table of up to 256 colours with transparency, looping or once, per-frame times; 7 tests including a reader written for the tests that decodes what the writer made) into the project's `exports/` folder, scaled by a whole number; a backend command `write_export` (Rust test; only inside `exports/`, a fixed list of file types, GIF and PNG checked by their first bytes); palette export now goes there too (a download link cannot be relied on in the studio's window). Checked in the browser preview; the real app's write was not run.
- [x] (2026-11-09, `lib/apng.ts`, 2 tests that check every chunk and the sequence numbers; the write was not run in the real app) Export the animation as an animated PNG (Sprite menu).
- [x] (2026-11-09; unit tests: `lib/gif-read.ts` 5, `apng-read.ts` 4 (all five PNG filters, palettes with transparency), `aseprite-read.ts` 4 (layers, blend, opacity, offsets, linked cels, tags, durations, grey and indexed, groups; read from files built by a small writer in the test, **not from a real Aseprite file**), `sprite-import.ts` 4, `sprite-export.ts` 10; the dialog only built) **Import** an animated GIF, an animated or plain PNG, or an Aseprite file (Sprite menu: "Open a GIF, animated PNG or Aseprite file…"; it replaces the sprite, undo brings it back); **Export…** dialog: a packed sheet with a JSON atlas (trim, gap, power-of-two, scale, identical frames stored once), each frame as a PNG (named after its animation), each layer and frame as a PNG, GIF, APNG, with saved export profiles per sprite.
- [ ] Still open (3.6): import `.pxo` (Pixelorama's zip: the format is not documented here, so a person is told to export a sheet, GIF or APNG from Pixelorama instead); `nova sprite export` on the command line (the code is TypeScript, the CLI is Rust); tilemap and slice import from Aseprite; a dithered or palette-limited GIF option; auto-save and backups of sprites (text crash recovery exists, not for pixels).

### S5: Engine workspace (section 5)
- [ ] Hub, project settings, device manager, export (`.npk`, APK), asset import settings.
- [x] Lua editor (2026-11-09, `lib/lua-tools.ts`, 15 tests; folding, tidy and go to definition checked in the browser preview): a small tokenizer, go to definition (F12 or Cmd/Ctrl-click), find uses (Shift+F12; a list over the editor), rename a name across the project (F2; names in strings and comments and fields of the same name stay; a clash is refused), tidy indentation (Shift+Alt+F), code snippets in completion (fn, if, for, forp, fork, while, repeat, entity), folding of blocks; a Code menu. Not a full language server: it follows names, not scopes or types.
- [x] Debugger and profiler panels already exist (`docs/debugger.md`, the Debugger and Performance panels).
- [x] Project settings page (2026-11-09, `ProjectSettings.svelte`, `lib/project-settings.ts`, 11 tests; checked in the browser preview): nova.json opens as a form (name, version, first script, wifi switch, picture size, sprite filter, materials, graphics options with a Switch-class preset) with the runtime's checks shown as problems, and an **input and actions editor** (actions as buttons or axes; sources added by pressing a key or choosing a gamepad button, stick, mouse button or touch zone; shown in plain words with Nintendo-style names; a note when a source is used twice). Edits nova.json as text, keeping its order and unknown keys; "Edit the file" shows the JSON. File > Project settings.
- [x] Languages (2026-11-09): `locales/<code>.json` per language, `nova.t(key, vars)` with {name} fill-in and .one/.other forms and `nova.locale.set/get/available` in the runtime (Rust `locale_data`, `locales`; 4 tests in `tests/locale.rs`; documented in `docs/project-format.md`), and a Languages table in the studio (`LocaleEditor.svelte`, `lib/locales.ts`, 10 tests; checked in the browser preview): a row per key, a column per language, gaps marked, {name} mismatches flagged, find the keys the code asks for, CSV export and import for a translator, a Languages group in the tree, File > Languages. Not done: choosing the language from the device's settings, right-to-left text, fonts per language.
- [x] Save-data inspector (2026-11-09: a Saves tab in the bottom panel; `src-tauri/src/save_data.rs` finds the save where `nova run` keeps it, 4 Rust tests; `lib/save-data.ts`, 7 tests): the keys as rows, edit a value (typed as JSON or plain text), add and delete keys, write it back after the same checks the runtime makes (the old file is kept as `save.json.reset-n`), "Start fresh" sets the file aside, nothing is deleted. Checked in the browser preview with the mock; **the real backend was not run in the app**, and it shows this computer's save only, not a device's.
- [x] **Menu and HUD editor** (2026-11-09, `MenuEditor.svelte`, `lib/menu-doc.ts` 9 tests; seen working in the browser preview: outline, settings, picture): `menus/*.menu.json` as an outline (add inside or after, move, duplicate with new ids, wrap in a row or panel, unwrap, delete, undo and redo), the settings of each kind and any other setting, checks in plain words, and a rough picture drawn by the studio (not the engine's layout). File > New menu or HUD…; a Menus group in the tree. **The picture is an approximation**; a true preview would run the engine's layout (headless) and is not done.
- [ ] Scene editor (exists: `SceneEditor.svelte`); a UI layout editor *shared with scenes* (placing HUD pieces on the scene's screen) is not done.
- [x] Play: desktop window (Play), device deploy (the Play on device button), keep-state hot reload and a console (`docs/debugger.md`), capture (`nova run --headless --capture`, the MCP tools) and recorded input replay (the Simulate panel and `inputscript.rs`) all exist; not re-checked tonight.

### Cross-cutting
- [~] UX tests, the input matrix and the accessibility audit: the protocol, tasks, matrix and audit checklist are written (`docs/ux/test-plan.md`, 2026-11-10). **No person or device was tested**; they need people.
- [ ] Palette bridge between Sprites and Model materials; drag assets into scenes and code; plugin/addon surface (later).
- [~] Licences: dependencies checked by field (above); assets' licences are in `licenses/` (Kenney kits, fonts, Lua, three.js, Vorbis); no Blender or Blockbench code was copied (only ideas, recorded in `docs/studio-workspaces.md`); no Pixelorama code was copied either, so there is no Pixelorama notice to keep (add one the day code is). Not done: a human reading the actual licence texts, and the project's own licence (an owner decision).


## Goal

A Game Maker 8-style studio, simpler and original, that makes **native Android
games** (no WebView, no streamed rendering) for powerful handhelds, first the
Retroid Pocket 6, in 2D and 3D. One app holds a scene/layout editor, a sprite and
animation editor, a 3D model editor and a sound/music studio. Games are written in
an easy language (Lua), not drag-and-drop blocks. Beginner wording, few choices,
good defaults. Native resolution, real GPU, real audio.

## Decisions (made with the user, 2026-11-02)

| Topic | Decision |
| --- | --- |
| Games | Native Rust runtime, `wgpu` (Vulkan/GLES on Android, Metal on Mac, Vulkan/DX12 elsewhere). One renderer for 2D and 3D. Optional per-game pixel-art mode; it is a setting, not a console. |
| Android shell | `android-activity` + `winit`, no Java UI layer. APK built from a prebuilt template, no Gradle for users. |
| Scripting | Lua 5.4 via `mlua`. The engine does heavy work natively (entities, batching, collisions, animation); Lua runs gameplay. Luau is a possible later swap for types. |
| Studio | Tauri 2 + TypeScript. Editors may use web tech (three.js for 3D views, Canvas for sprites). The *game* never runs in a WebView. |
| Project format | A folder of plain files: Lua, JSON, PNG, glTF, WAV/OGG. Studio never generates code a person could not have typed. Format is independent of the runtime so a different runtime could read it. |
| Sound | Reuse Nova's C11 audio core (`audio/`, no raylib/Lua/Qt dependency) through FFI behind a safe Rust wrapper; same DSP for in-game and exports. Device output via a Rust audio backend (replaces the raylib-tied adapter). |
| Sprites | Follow Pixelorama's model: layers x frames cel grid, linked cels, animation tags with direction, per-frame duration, onion skin, pixel-perfect drawing, symmetry, palettes, tilemap layers. Our own plain format; import Aseprite/.pxo later. |
| 3D modelling | Follow Blockbench's model: hierarchy of parts, per-face texturing, keyframed bones; skinned meshes bend with the part tree (added 2026-11-02, CPU skinning). glTF in/out. |
| Look | Low-poly/flat/unlit/vertex-colour/texture shading, simple enough that the editor viewport and the runtime match. |
| Resolution (decided 2026-11-02) | The **world** (3D and background sprites) renders to a target of fixed logical height, default **540 px** (960x540 on 16:9), and is upscaled to the screen with a sharp-bilinear filter. The **UI** (HUD sprites, text) always renders at native screen resolution. Coordinates are logical units, 540 high. Per-game setting `world_height` (e.g. 540, 720, 0 = native); pixel-art games may later opt into a smaller target scaled in whole steps. Implemented in the runtime (`FrameInput::world_height`, `--world-height`). |
| Project manifest (decided 2026-11-02) | `nova.json`: name, entry script and settings. Assets are found by scanning the project's folders; an asset's ID is its project-relative path, so nothing is declared by hand. |
| Scene files (decided 2026-11-02) | JSON data in `scenes/<name>.scene.json` beside the scene's Lua code in `scenes/<name>.lua`. Loading data never executes code; the studio edits and diffs the JSON. |
| Art direction (decided 2026-11-09, supersedes the "3D modelling" and "Look" rows above) | Aim for **Switch 1-class graphics at 60 fps** on the Retroid Pocket 6: detailed, textured, PBR-lit models (hero cars 15-40k triangles, props thousands), not blocky low poly. The renderer already has it (`"materials": true`: normal, metallic-roughness and emission maps, docs/materials.md); the gaps are the asset pipeline and the modeller. Do not try to out-Blender Blender: **take what works from Blender** into the studio (a non-destructive modifier stack: mirror, subdivision, bevel; proportional editing; snapping; reference images; Blender-style navigation and shortcuts; UV unwrap and baking) and use Blender (headless, `bpy`) as the heavy modeller through a one-click import and as the backend of procedural generators. One atlas per model (base colour, normal, metallic-roughness; ambient occlusion baked into the colour). World render height goes from 540 towards 720/1080 for games that want it (`world_height`).**Renderer steps done 2026-11-09** (`docs/switch-class-graphics.md`, costs in `docs/performance.md`): opt-in `graphics` settings: HDR target with an ACES curve and HDR bloom, 4x MSAA, 3 sun-shadow cascades, a sky cube for image-based light and a `KHR_materials_clearcoat` layer on materials, anisotropic filtering with full mip chains, KTX2 (ETC2/ASTC) textures beside models with a `nova ktx2` ETC2 encoder; `world_height` 720 and 1080 measured. Not done: an ASTC encoder, Basis Universal, ETC2 alpha, stripping the PNG out of the `.glb`; nothing here is judged by a player yet. |
| Reuse | Nova: audio core, docs/UX research, Pine Ridge Rally, Android notes. GameStudio (read/copy only, never modify it): editors, Lua API design, help, MCP server. Nova's old "no GameStudio" rule is superseded; copy deliberately, record what came from where. |
| Repo | This repo. Rebuild on `main`. Old Copilot work is salvaged from branches, then branches are deleted. |

References to study (read-only; MIT Pixelorama is safe to learn from, GPL-3
Blockbench is for workflow ideas only, do not copy its code):
Pixelorama, Blockbench, GameStudio, Game Maker 8 manual.

## Toolchain on this Mac (installed 2026-11-02)

- Rust stable via Homebrew `rustup`: put `/opt/homebrew/opt/rustup/bin` first on
  `PATH` (the shell config is untouched; plain `cargo` is still Homebrew's Rust,
  which GameStudio's Tauri build uses). Targets `aarch64-linux-android`,
  `x86_64-linux-android`; `cargo-ndk` 4.1.x.
- Android SDK at `~/Library/Android/sdk`: build-tools 36.1.0, platform 36, NDK
  `29.0.14206865`, emulator, platform-tools, cmdline-tools `latest`, arm64
  Android 13 Google APIs system image. Java 17 (asdf `temurin-17.0.21+9`) is for
  `sdkmanager`/`apksigner`.
- Emulator profile `retroid-sim`: 1920x1080, 400 dpi, 4 GB. Start:
  `~/Library/Android/sdk/emulator/emulator -avd retroid-sim`.
  Good for build/install/lifecycle/input checks. **Not** for frame rate, thermals or
  audio latency: this Mac is far faster than the handheld.
- Verified: a Rust hello-world cross-compiled with cargo-ndk ran on the emulator.
- `sdkmanager` prints a deprecation notice pointing to the newer `android` CLI in
  cmdline-tools; it still works. Revisit if it stops.
- Homebrew `cmake` stays (GameStudio). Old Nova installs (Qt, Ninja, Gradle cache,
  NDK 27, SDK 35, old build dirs, worktrees) are removed.
- Verify when the device arrives (do not assume): Retroid Pocket 6 SoC, Android
  version (believed 13), screen size/refresh, controller as Android gamepad,
  USB debugging.
- `scripts/env.sh <command>` sets `PATH`, `ANDROID_HOME`, `ANDROID_NDK_HOME` and
  `JAVA_HOME` command-locally (exists now); shell startup files stay untouched.

## Open engine, device and delivery items

**Needs the device**
- [ ] Audio latency and underruns on real output (AAudio low-latency mode is not requested).
- [ ] Battery (the soak ran on USB power); rotation (the device's rotation lock is on and changing it is not ours to do); Back and Home keys.
- [ ] Local co-op on the Retroid: the JNI controller list, vibration, the multicast lock and broadcast on its wifi, a desktop joining it, the
  APK's permissions; then two Retroids together (latency, a dropped wifi); more than one player on a joined device; the Retroid's button
  labels (assumed Nintendo by position, south = B).
- [ ] A real GPU driver reset (the recovery path is tested with a destroyed device only).
- [ ] Do not claim device-proven behaviour before it is recorded in `docs/performance.md`.

**Runtime and format**
- [ ] The OpenGL ES fallback backend was fixed (limits) but not re-run on Android; Vulkan is what has been exercised.
- [ ] Text is UI layer only and draws on top of UI sprites; world-space text and variable-font weights.
- [ ] Streamed music resamples linearly; a sound sped up past about 1.5 times can alias.
- [ ] glTF files that point at an external texture (`uri`) do not load: resolve relative `uri`s through the project's file view.
- [ ] Paths and `in_rect` in the collision helpers.
- [ ] Keyframe animations: a 3D preview, a curve (graph) editor, copy/paste and multi-select of keys, a "record" mode, blending and bone animation.
- [ ] Models from files cannot be drawn into the UI (only block cubes); a finger cannot drag a list to scroll it.
- [ ] Renderer follow-ups: ASTC encoder, Basis Universal, ETC2 alpha, stripping the PNG out of the `.glb` (`docs/switch-class-graphics.md`).
- [ ] The wish list toward Odyssey/BotW-style games (collision and character control, lighting, terrain, crowds) is in the old TODO: `git show db3e9c5:TODO.md`, "Toward games like".
- [ ] From the rally: skinned instancing and LOD for skinned models; heightmap terrain beyond the sine hills (the `terrain.rs` recipe exists), particle ground contact and soft particle sprites; a simulation test harness in the studio; capsule and box colliders in the model editor.

**Delivery and product**
- [ ] Choose the project's own licence before public distribution; decide the product name (keeping "Nova Studio" is fine).
- [x] Third-party licence notices (found on 2026-11-09 to be done already, the line here was stale): `licenses/rust-dependencies.txt` (made by `scripts/third-party.sh`) goes into a desktop export as `THIRD-PARTY.txt` (`export_desktop`) and into an APK's assets (`android.rs`); fonts' notices are in `licenses/fonts/`. Also `scripts/third-party-licenses.mjs` (2026-11-09) writes `licenses/third-party.md`: 636 Rust crates and the studio's 22 npm packages with their licence fields: all permissive (MIT, Apache-2.0, BSD, ISC, Unlicense, Zlib, MPL-2.0 and similar), none flagged. It reads licence *fields*; the texts are in the notice file.
- [ ] Released builds: the native library is not stripped or size-optimised; 16 KB page-size alignment is unchecked.
- [ ] APKs are debug-signed only; release signing, distribution and installing are the owner's to do.
- [ ] macOS: Developer-ID signing, notarisation, a DMG, an app icon; Windows and Linux builds.
- [ ] Failure-recovery exercise: crash during save, bad asset, missing file.

## Open decisions (ask the user before deciding)

- Pixel-art mode's exact rules (low-resolution target size, integer scaling, UI interaction).
- The full `nova.json` and `*.scene.json` schemas and versioning (the formats themselves are decided).
- Texture compression policy for Android (KTX2 ETC2 exists; ASTC not yet).
- Language server and typed-Lua (Luau) timing.
- Studio on Windows/Linux: when, and how the runtime ships with it.
- Licence for Nova, and acceptable licences for bundled dependencies.
- Pine Ridge: merge the radio branch `claude/pine-ridge-radio-d72262`; whether the menu modes go (free roam only); bring progression back (`state.UNLOCK_ALL_VEHICLES`).

## Risks

- Scope: four workspaces is large and "clone Blender" has no end. Ship one working slice at a time and exercise it with a real project.
- `wgpu` on Android: driver quirks and CPU overhead. Lua gameplay code can become the bottleneck; keep hot loops in Rust.
- Windows chrome and input (snap layouts, touchpads) cannot be tested on this Mac.
- Emulator speed is not device speed; do not tune from it.
- Copying ideas from Blender, Blockbench (GPL-3), Pixelorama (MIT) and LMMS (GPL): record provenance, never copy GPL code.

## Not now

Online networking (internet servers, accounts, matchmaking; local wifi co-op is in), WebView gameplay, a browser version of the studio,
iOS, Glow/GameStudio compatibility, app-store publishing, personal signing, device installation without the user's go-ahead.
