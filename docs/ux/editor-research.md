# Sprite and model editor research (2026-11-02)

What Pixelorama (MIT) and Blockbench (GPL-3) do, read from their own documentation, and what Nova Studio does about
it. Neither program's code was read or copied; a clone of either is not on this machine. Sources:

- Pixelorama user manual (the Orama-Interactive/Pixelorama-Docs repository, `docs/user_manual/user_interface/timeline.md`, `import.md`, `save_and_export.md`).
- Blockbench guide "Blockbench Overview & Tips" (https://www.blockbench.net/wiki/guides/blockbench-overview-tips) and the project README.

## Pixelorama: animation

- **Timeline of frames, layers and cels.** Every frame has every layer; a cel is where they meet. Nova has the same grid in
  the sprite editor (layers panel, frame strip).
- **Frame tags** are named, coloured ranges of frames, created from a frame's right-click menu and resized by dragging
  their edges; they also limit playback and export. Nova's animations are stricter: each owns its frames (no overlap), shown
  one at a time, with a thumbnail list. The manual documents no per-tag direction; loop mode is one setting (cycle,
  ping-pong, none). Nova has direction and loop per animation, which suits `idle`, `run`, `die`.
- **Per-frame timing** is a multiplier of the timeline FPS (1x, 2x, 0.5x). Nova stores milliseconds per frame and can set
  one speed for a whole animation.
- **Onion skinning** has a count of past and future frames and a blue/red tint. Nova shows one previous frame; counts and
  tint are open.
- **Import dialog**: a preview, then a choice of what the picture becomes (new project, spritesheet in a new project or
  layer, new frame, replace cel, new layer, reference image, palette, brush, tileset); spritesheets are cut by a number
  of horizontal and vertical frames or by a "smart slice" that detects them. Nova's "Import sheet…" previews the cut with
  a grid, guesses the tile size, takes a gap and border, and adds one animation, one per row, or frames onto an
  animation. Open: a tile count instead of a size, true smart slice (find tiles by empty gutters), replacing one frame.
- **Other handy things**: multi-select cels (Ctrl, Shift), drag to reorder, linked cels, cel opacity, drawing while the
  animation plays, F5/F4 play forward and backward.

## Blockbench: modelling

- **Three modes** (Edit, Paint, Animate) so each task shows only its tools. Nova has Model, Texture and Animate.
- **Selecting**: click, Ctrl-click to add, Shift-click a range in the outliner, Shift-click a whole group, Ctrl+A.
  Nova selects one thing at a time.
- **Transform tools in the viewport**: Move, Resize, Rotate and Pivot gizmos with global, bone and local spaces, and Vertex
  Snap. Space toggles paired tools. Nova moves shapes with numbers and arrow keys only; gizmos are the biggest gap.
- **Pivots** belong at the joint between bones. Nova's part pivot is a number; a pivot tool is open.
- **Mirror**: a Flip command mirrors elements or bones and renames `_right` to `_left`. Nova has mirror copies (no renaming).
- **UV**: a UV panel with Box UV (a cross per cube, with Mirror UV) and per-face UV with sliders; Ctrl-click an island selects
  its element. Nova auto-unwraps and moves a shape's whole block; per-face editing is open.
- **Painting**: brush, bucket, eraser, colour picker (Alt or Space), shapes, gradient, size/opacity/softness, Shift for
  straight lines, mirror painting, lock alpha, a painting grid, painting on the model or in the UV window. Nova has
  pencil, eraser, fill, picker, brush size, Shift lines, both places. Open: opacity, mirror painting, lock alpha, shapes.
- **Viewport**: Z cycles textured, solid and wireframe; Ctrl+B hides the sidebars; automatic backups every ten minutes.
  Nova added the Z view modes; sidebars and backups are open.
- **Sliders** accept maths and double-click resets; hovering an action shows its shortcut.

## What this changed in Nova Studio

- The project tree is now a resource tree (Sprites, 3D Models, Scenes, Entities, Sounds, Music...), one item per thing, like
  Game Maker; the files behind each item move, rename and delete together. "Files" shows everything as on disk.
- Model editor: Z cycles textured, colours-only and wireframe views; Shift-click paints a straight line; Move, Turn and
  Resize handles in the viewport (W, E, R; snapping on by default) for parts and shapes; Ctrl, ⌘ or Shift picks several
  shapes, which move, copy, delete and recolour together; in point mode a yellow arrow pulls a face out, with Shrink %
  for tapers, Inset, Loop cut, and Symmetry for point moves; painting has opacity and Lock alpha.
- Sprite editor: onion skin shows up to three frames before and after, tinted blue and red; frames drag to reorder inside
  an animation; the import dialog cuts by tile size or by tile count, and Smart slice finds tiles separated by empty gaps.

- Model editor, second round: a Pivot tool (P) that moves the point a part turns about without moving anything you can see,
  with animation keys following; edges can be picked in point mode, bevelled (at box-like corners) and open edges pulled out.
- Sprite editor, second round: Ctrl, ⌘ and Shift pick several frames to copy, delete or move into another animation.
- The tree's create and rename boxes no longer log an error when they close.

- Third round: a dragged point can snap onto another point of the mesh; single faces of a painted box can be placed anywhere in
  the picture (face tool, by dragging or typing the rectangle); turning and resizing work on several shapes in one part, about
  the first one's middle (resizing is one factor on every axis).

## Still open, in the order that would help most

1. Mesh: bevel at corners that are not box-like, extruding a single point, a knife.
2. Painting: mirror painting, shapes and gradients; flipping or turning a placed face.
3. Sprites: linked cels, frame duration as a multiplier, drag several frames at once.
4. Resizing shapes in several parts at once.
