# Wireframes against the app (checked 2026-11-10)

The wireframes are `docs/ux/studio-wireframes.html`. This compares each window with the app as it runs in the browser preview (mock backend); nothing here was
looked at in the real Tauri app or on Windows. "Same" means the zones and controls are where the wireframe puts them, not that the look is final.

## Every window (the four zones)

| Wireframe | App |
|---|---|
| Title row: traffic lights, `Nova`, the menus of the workspace, project name on the right | Done: `Nova`, the menus of the workspace you are in (`lib/menus.ts`, `for:`), Projects and project name, Help. The native macOS menu follows the same list. |
| Row of workspace tabs, undo, redo, search, play on the right | Done, plus Export and Save all as icons. |
| Context header (mode or tool, its options) and a tool shelf | Model: done. Sprites and Sound: an options bar and a tool column, close but not the wireframe's single header. Engine: none. |
| Bottom strip and a status bar with key hints and figures | Status bar done in all four (hints left, figures right). The bottom strip is a true area only in Model's Pose mode and in Engine (problems, play, debugger). |

## Model (window 1): same, with gaps

Done: Mode list, Vertex · Edge · Face, Snap, Proportional, Solid · Material · Wire, an Overlays menu, icon shelf, outliner above icon property tabs, gizmo and nav buttons,
status bar. Gaps: no Pivot list (Median); the Add, Object, Select and Mesh menus hold only the commands that exist; the bottom Timeline and UV editor tabs open Pose and
Texture Paint rather than being switchable areas; the Properties tabs show one name only for the open tab.

## Sprites (window 2): close

Matches: tool column on the left, canvas, palette, layers and tags on the right, frames below. Gaps: menus are File, Edit, View, Sprite, Run, Window, Help (wireframe: Image,
Layer, Frame, Select); no header row of Size, Pixel-perfect, Symmetry, Tiled, Zoom (they sit in an options bar and the right panel); the wireframe's floating Preview (1×)
is not on the canvas; the right panel is much taller than the wireframe's three boxes (colour tools, effects, adjustments are all open).

## Sound (window 3): different shape

The wireframe has a song editor (tracks and clips on a timeline) above a piano roll or mixer, with an instrument and effects panel on the right. The app has the piano roll
as the main view, the track list on the left, and Notes, Loudness, Mixer, Tools and Arrange as tabs (the arrangement is one tab). Gaps: no header row of tempo, meter, loop,
snap and master loudness (they are in the toolbar); menus are File, Edit, View, Sound, Run, Window, Help (wireframe: Track, Clip, Mixer); no voices count in the status bar.

## Engine (windows 4 and 4b): different shape

The wireframe has a header row with the device and Play, On device and Hot reload; a project tree and an asset browser on the left; the editor in the middle; an Inspector and
an Outline on the right; Console, Problems and Profiler below. The app has one Resources tree on the left, the editor, and the bottom panel (Problems, Play, Debugger,
Objects, Assets, Sounds, Saves, Activity). Gaps: no device header row (the Play button has the device choice), no right-hand Inspector or Outline, no minimap, menus are
File, Edit, Code, View, Run, Window, Help (wireframe: Project, Device). The scene editor (4b) is a document tab in Engine as drawn.

## Header rows added later the same day

- **Sprites:** the options bar now starts with a tool list, and has Size, Pixel-perfect, Symmetry (off, left–right, up–down, both, diagonal) and Tiled (off, across, down, both) as in the wireframe's header, with zoom and size at the right. Still a long bar (onion skin, grid, rulers) and no floating Preview.
- **Sound:** the toolbar shows the tempo and meter (`♩ 120 · 4/4`), the loop region in bars, Snap (it was "New note"), and the master peak while playing. The wireframe's "Master −8 LUFS" is a measured figure in Tools, not live.
- **Sound layout:** the song editor (every track as a lane of clips) is now a band above the piano roll that folds away from its header ("Arrange" is no longer a tab in the lower part; the Show the arrangement command folds it). Seen in the browser preview. It is not resizable, and in a short window it takes a lot of height.
- **Sprites preview:** the animation preview now floats over the top right of the canvas with a ▶ Preview button (it was a box in the right panel); seen in the browser preview. The header bar is still three lines at this window width.
- **Menus:** each workspace now has the wireframe's menu names. Sprites: File, Edit, View, Tools, Image, Layer, Frame, Select, Run, Window, Help (Layer and Frame are new commands: new, duplicate, delete, move, merge; next and previous frame). Sound: Track, Clip, Mixer. Engine: Project (project settings, snapshots, languages, menus, Simulate, Store art), Code, Run, Device (play on the device used last, look for devices). Seen in the browser preview for Sprites (Layer menu) and Engine; Sound's and Model's menus only appear with a document open. A test (`lib/menus.test.ts`) checks the names and that no command is in two menus of a workspace. Extra to the wireframe: View, Tools and Code stay.
- **Engine:** a device row (device list, connected state, Look again, Play on device), and right-hand **Inspector** and **Outline** panels for the open file: an entity shows its sprite, model, pivot and settings; a scene its objects by kind; a script its problems; the outline lists the Lua file's functions and a click goes to the line (`lib/lua-outline.ts`, 2 tests; seen in the browser preview on the starter's player entity). The wireframe's "Hot reload on" is not shown: the studio has no such switch. No minimap.

Checked in the browser preview for Engine; the Sprites and Sound changes are type-checked and the component tests pass, not looked at.

- **Sprites header, shorter (2026-11-10):** onion skin, grid, rulers and Canvas size moved into a **View ▾** pop-over, so the options bar is two short rows plus the zoom row at 1000 px wide (seen working in the browser preview: the pop-over opened with all of them; before it was three long lines).

## Next

Every item in the first review's list is done except what the notes above say is missing: a resizable song editor band, a minimap in Engine, a Hot reload switch (none exists), and everything that needs the real app or a person looking.
