# Studio UX: menus, toolbars, input, windows (2026-11-09)

Status: **design decisions, not yet built.** Companion to `docs/studio-workspaces.md` (what each workspace does). Existing UX material
stays valid where it does not conflict: `docs/ux/nova-studio-ux-assessment.md` (Lua-first, no visual code blocks) and
`docs/ux/editor-research.md`.

The owner's brief: one all-in-one studio, free, no strings attached, easy for beginners, **nothing quirky**. So: follow the conventions
people already know from their OS and from Blender, Pixelorama and LMMS, and spend originality only on making things simpler.

## Decisions taken (owner, 2026-11-09)

1. **One undo history per document.** A document (a sprite, a model, a song, a scene, a Lua file) opens in **at most one place at a
   time**. Asking to open it again focuses the existing tab or window. A document can still be torn off to its own window; two
   *different* documents can sit in two windows.
2. **No beginner mode: one full, advanced interface for everyone** (revised 2026-11-09: making a real game needs the whole toolset in front of you). Beginners are helped by learnability, not a reduced UI (section 6).
3. **The Model workspace defaults to the Blender keymap** (with Nova's simplified labels in menus; Blender stays the reference).
4. **Order of work (my call):** the common spine first (it is what every workspace needs), then Model, then Sound, then Sprites polish
   (closest to done). Reasons under "Order".

## 1. One command system drives everything

Every action is a **command** with an id, a plain-words name, an icon, a default shortcut per platform, an "enabled" rule and help text.
The menu bar, toolbars, context menus, the command palette (Cmd/Ctrl-K), shortcut editor, tooltips, tutorials and the Help search all read
the same registry. This is what makes the studio consistent and lets us add a feature once. A command is never reachable *only* by an icon
or *only* by a shortcut: it is always in a menu or the palette too.

## 2. Menus

**macOS:** the real system menu bar (Tauri's native menu API), because Mac users reach for it and VoiceOver, the Help search field and
standard shortcuts work for free. Menus: **Nova** (About, Settings Cmd+, , Services, Hide, Quit), **File**, **Edit**, **View**, a
workspace menu that changes per workspace (Model: Add, Object, Select, Mesh; Sprites: Image, Layer, Frame, Select; Sound: Track, Clip,
Mixer; Engine: Project, Run, Device), **Window** (workspaces, tear off, layouts), **Help** (search field). Standard items keep standard
shortcuts (Cmd+Z, Cmd+S, Cmd+W, Cmd+Q, Cmd+,).

**Windows:** the same menus drawn in the title bar area (File Edit View ...) because Windows has no global menu bar, with Alt-key access,
and Settings under Edit or File as Windows apps do (Ctrl+, also works). Linux, later, follows Windows.

**Window chrome** (the owner's earlier rule): macOS keeps the native traffic lights in an overlay title bar (Tauri `titleBarStyle:
Overlay`, hidden title; native lights keep working when the window is inactive). Windows uses `decorations: false` and our own caption
buttons. The Windows 11 snap-layout flyout on hover over Maximise needs a native hit-test overlay: a community plugin does this
(`tauri-plugin-frame`, `tauri-plugin-snap-layout`); evaluate it, but I cannot test Windows from this Mac, so Windows chrome is
**unverified until it is run on Windows**. Windows 10 gets the custom bar without the flyout. The existing `WindowButtons.svelte` is
the start. Sources: Tauri window-customization guide (v2.tauri.app), tauri-plugin-decorum, tauri-plugin-frame.

## 3. Toolbars and icons

Research summary (Apple HIG toolbar guidance, Blender and Aseprite practice): keep toolbars uncrowded, group related items, give icons
text labels where space allows, use verb labels, let people hide and customise the toolbar, and never rely on an icon alone.

Rules for Nova:
- **Three bar types, always in the same places.** Top: workspace tabs and global actions (Undo, Redo, Play). Under it: a *context
  header* for the active area (mode, snapping, view options). Left: a *tool shelf* (one column of tools). Nothing floats.
- **Icons: one family, one stroke weight**, drawn for 16, 20 and 24 px, with a **tooltip showing name, shortcut and a one-line what-it-does**
  after a short hover; a longer "?" page one click away. Tools with variants (select box, circle, lasso) show the active one with a small
  corner mark and open on long-press or right-click. No tool has two icons and no two tools share one.
- **Labels on demand:** a toolbar setting "Icons / Icons and labels".
- **Targets:** at least 24 px hit area (32 px default, 44 px on touch and the Retroid-sized layout), per WCAG 2.2 target size and Fitts's law.
- **Colour is not the only signal** (selected = filled background plus an indicator line); contrast 4.5:1 for text and 3:1 for icons.
- **Context menus** (right-click or Ctrl-click, two-finger tap on a trackpad) show the same commands, the likely ones first.
- Panels have a header with a title, a collapse chevron and a "..." menu; panels collapse, never vanish with no way back (View menu lists all).
- **Status bar:** the current tool's mouse and key hints (Blender's habit), selection counts, budgets, background tasks, device.
- **Feedback:** every long task shows progress and can be cancelled; errors say what happened and what to do, in plain words, with
  no codes (voice: sentence case, verbs first, no "please").

## 4. Input: mouse, trackpad, keyboard, pen, controller

Nova must be fully usable with **a trackpad and keyboard alone**, a **mouse** and a **pen tablet**. Blender's own manual notes the trouble:
3D navigation assumes a middle button. Findings: Blender offers "Emulate 3 Button Mouse" (Alt+left drag; not supported on Windows), and
"Multi-touch Gestures" for touchpads (pinch zoom, two-finger orbit); some touchpads send three-finger tap as middle click.

| Action in the 3D view | Mouse (3 button) | Trackpad (Mac) | Trackpad (Windows precision) | Keyboard-only |
| --- | --- | --- | --- | --- |
| Orbit | MMB drag | two-finger drag (gesture mode) or Alt+drag | two-finger drag, or Alt+drag | numpad 2/4/6/8, arrow keys with Ctrl |
| Pan | Shift+MMB | Shift+two-finger drag | same | Ctrl+numpad |
| Zoom | scroll wheel | pinch, or two-finger scroll with Cmd | pinch / Ctrl+scroll | numpad +/- , Z-F focus |
| Select | LMB | click | click | Tab through the outliner |
| Context menu | RMB | two-finger tap / Ctrl-click | right-tap | Shift+F10 / the menu key |

Rules:
- **Navigation scheme setting** on first launch (and in Settings): "Mouse (3 buttons)", "Trackpad (gestures)", "Pen tablet". The
  first-launch screen asks which you use and shows a short practice area. The default is picked by detecting a trackpad (large
  `deltaY` with `ctrlKey` pinch events; wheel with fractional deltas).
- **Always-on-screen navigation gizmos** in the 3D view (orbit sphere, pan hand, zoom magnifier you can drag) so nothing depends on a hidden
  gesture. The same for the sprite canvas (pan hand, zoom % field).
- **Natural scroll** direction follows the OS; an invert option exists.
- **Keyboard:** all commands bindable; shortcuts shown in menus; modifier conventions follow the OS (Cmd on Mac, Ctrl on Windows) except
  in Model where Blender's keys are kept as Blender has them (G, R, S, Tab, A, X, Shift+A, Ctrl+Z...) so Blender knowledge carries over
  (Cmd maps to Ctrl for the common editing keys on Mac). Every keymap has a printable cheat sheet. Conflicts are shown when rebinding.
- **No chorded combos that need three hands** for frequent actions, and no key that cannot be typed on a laptop keyboard (numpad
  actions always have a laptop alternative, as Blender's "Emulate Numpad").
- **Pen:** pressure sensitivity for brushes and sculpt (strength, size, with a curve), the barrel button as middle/right click, tilt
  later, eraser end switches tool. Where there is no pressure the brush works at full strength.
- **Controller:** only the games use it (decided). The studio can be driven from the keyboard and mouse only; a gamepad glyph set (Nintendo)
  appears in the Engine's input editor and in tutorials for the Retroid.
- **Accessibility:** full keyboard focus order and visible focus rings, screen-reader names on all controls, reduced-motion setting,
  text scaling (UI scale 75% to 200%), a high-contrast theme, colour-blind-safe palettes in graphs, and no hover-only functions.

## 5. Layout and windows

- **Workspace tabs** across the top (Model, Sprites, Sound, Engine); the project's open documents are tabs *inside* each workspace.
  Tear off a workspace *or* a document into its own window via right-click, drag out of the strip, or Window menu. Because a document
  lives in one place at a time (decision 1), the document tab shows where it lives ("open in another window" with a Jump button).
- **Areas are resizable, collapsible and swappable** (Blender): drag the border to resize, drag the corner to split or join, a header
  menu switches the area type. The default layout of each workspace is already the full one.
- **Saved layouts** per workspace (Reset layout is always in the Window menu). Layout restores per project.
- **Dialogs are rare.** Prefer inline panels, popovers and undo over confirmation boxes. Destructive actions use undo, not "Are you sure?",
  except deleting files from disk (move to Trash/Recycle Bin).
- **Autosave** with recovery (every minute, kept for each document; "Recover after crash" on next launch); explicit Save still exists.
- **Search everywhere** (command palette) finds commands, documents, assets, Lua symbols, help pages and settings.
- **Themes:** system, dark, light; one accent colour; a neutral grey palette that does not fight game art. No custom skins at first.

## 6. Helping beginners without a second interface

There is one interface, the full one. What makes it learnable instead:
- **Good defaults and templates:** a new project starts from a working template; every tool starts with sensible settings.
- **Guided first exercise per workspace** (`lib/tutorials`), a short "make a first X" that runs inside the real workspace, with highlights on the real controls; it can be skipped and re-run from Help.
- **Hints that go away:** the status bar shows what the active tool's mouse and keys do; tooltips show the shortcut and a one-line meaning; a "?" opens the page for a panel.
- **Plain words** for every label and message (voice rules above), and previews rather than numbers where a picture will do.
- **The command palette** finds anything by name, so a person need not know where a tool lives.
- **Panels collapse and the layout resets** (Window > Reset layout) so a busy screen is one click from calm.
- **Example project** (Pine Ridge Rally) to open, run, and take apart.

## 7. Testing the UX (needed before we claim it works)

- **Mockup pass first** (screens before code): wireframes for each workspace's three presets and first-launch; reviewed by the owner
  (`docs/ux/studio-wireframes.html`).
- **Task tests** with 3 to 5 people per workspace, scripted: "make a sprite with 4 frames", "draw a 40k-triangle car", "make a coin
  sound", "run a game on the Retroid". Measure time and stumbles, not opinions.
- **Input matrix** on: a Mac trackpad, a Windows precision touchpad, a 3-button mouse, a 2-button mouse, a tablet pen. Windows chrome
  needs a Windows machine; none is available here.
- **Accessibility audit** with VoiceOver and keyboard only before each workspace ships.
- Honest limit: none of this has been tested with a person yet; the Retroid is a play device, not an authoring device.

## 8. Order

1. **Spine:** command registry, native menus (macOS) and drawn menus (Windows), the command palette, keymap editor with Blender and
   default presets, area/layout system, tear-off windows with the one-document rule, autosave and recovery, first-launch screen
   (navigation scheme), icon set and tooltips. It touches every workspace, so everything else rides on it.
2. **Model**: viewport navigation (mouse and trackpad), gizmos, selection modes and edit tools, snapping, proportional edit, outliner and
   properties panels. This is the biggest felt gap (the owner called the current modeller below standard) and the Pine Ridge cars are
   the proving project.
3. **Sound**: mixer, piano roll, automation, effects. 4. **Sprites** polish, tilemaps, palettes. Engine improves along the way.

Sources read: Apple Human Interface Guidelines toolbars (developer.apple.com), Blender manual Preferences > Input (docs.blender.org),
Tauri window-customization guide (v2.tauri.app) and the Tauri plugins named above, plus the Blender, Pixelorama and LMMS documentation
sites. Menu bar details for macOS come from summaries of the HIG; check them against Apple's text before building.
