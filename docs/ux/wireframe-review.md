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

## Next, in order

1. The same header-row treatment for Sprites and Sound (one context header, the tools in an icon column).
2. Engine: a header row with the device and Play options, then an Inspector and Outline on the right.
3. Sound: the song editor above the piano roll as the default layout.
4. Menus split to the wireframe's names (Image, Layer, Frame; Track, Clip, Mixer; Project, Device) once each has the commands for it.
