# Studio test plan for people (and what has been checked by machine)

Written 2026-11-10. **No person has used the studio in a planned test yet**, and the input devices below have not been tried (only a synthetic scroll and a
mouse in the browser preview). This file is the protocol, so the first sessions can be run and written down the same way each time.

## Who and how

Three to five people per workspace, one at a time, 30 to 40 minutes. At least one has never made a game, one has used Blender, Aseprite or Pixelorama, one uses a
Mac trackpad, one a Windows touchpad, and, if possible, one a pen tablet. They think aloud; the observer does not help for the first two minutes on a task and notes
where the person stops, guesses wrong or says "I expected". Record: task, did it, time, where it went wrong, what they said.

## Tasks

**Model** (Blender keymap by default): 1) make a simple crate from a box and give it a different colour on its top; 2) turn the view to look from the top and from the
front; 3) pull one face out and move a point; 4) add a Mirror modifier and shape half a car body; 5) export it and say where the file is.
**Sprites**: 1) draw a 16 by 16 character; 2) make a three-frame walk and play it; 3) use a palette and lock to it; 4) select and move a part; 5) export a sheet and an animated GIF.
**Sound**: 1) make a jump sound effect and listen; 2) make a four-bar loop with a lead and drums; 3) change one track's loudness and add an echo; 4) mark a loop and export it.
**Engine**: 1) make a project, open the starter scene, change its text; 2) add a key to an action and a gamepad button; 3) run the game; 4) find where an error is and fix it.

## Input matrix (each cell: orbit, pan, zoom, select, drag, undo all work and feel right)

| | Model view | Sprite canvas | Song roll |
| --- | --- | --- | --- |
| Mac trackpad | | | |
| Windows precision touchpad | | | |
| 3-button mouse | | | |
| 2-button mouse (no middle) | | | |
| Pen (pressure, barrel button) | | | |
| Keyboard only | | | |

Known before testing: the 3D views have on-screen turn, move and zoom buttons (so nothing depends on a middle button); the sprite canvas zooms with a pinch or
Ctrl-scroll and pans with the hand tool or the middle button; **pen pressure and tilt are not used anywhere yet**.

## Accessibility audit (VoiceOver on macOS, Narrator on Windows, keyboard only)

- [ ] Every control has a name a screen reader says; icon buttons have text alternatives (the icon buttons were named on 2026-11-09; the rest not audited).
- [ ] Every dialog traps focus and returns it; Escape closes it.
- [ ] Tab order follows reading order in each workspace; the 3D view, the piano roll and the sprite canvas can be reached and operated from the keyboard (the canvases
      mostly cannot yet: they are pointer-first, with keyboard shortcuts for tools only).
- [ ] Nothing is conveyed by colour alone (the budget bar says its state in words; the palette lock and layer flags use icons and tooltips).
- [ ] Targets are at least 32 px (not done everywhere: small ghost buttons are about 22 px).
- [ ] Text stays readable at 200 percent UI size; the high-contrast theme passes (contrast tests cover the three themes' main text and accents).

## Already checked by machine (not a substitute)

`studio` unit tests (about 1,050), `cargo test` for the runtime and the backend, `svelte-check` with no errors or warnings, and the contrast tests of the themes.
Checks in a real window are listed per feature in `TODO.md`; where it says "browser preview", no native window or device was used.

## Results

Record each session here: date, workspace, person (role only), device, what failed, what was changed.
