# Windows: what is planned, what is not known, and how to test it

Written 2026-11-10 from reading and memory. **Nothing here has been run on Windows**: there is no Windows machine in this project, so every
statement below that says "should" is a hypothesis to check, not a result.

## What the studio does now

- Tauri 2 window with `decorations: false` on Windows; the studio draws its own caption buttons (`WindowButtons.svelte`) and menu bar (`MenuBar.svelte`),
  with the same layout as the macOS system menu (`lib/menus.ts`). On macOS the overlay title bar keeps the system's traffic lights.
- Keyboard: `Ctrl` takes the place of `Cmd` (`lib/commands.ts`, `Mod`); the menus show Windows-style shortcuts (`Ctrl+Shift+Enter`).
- Not done: Alt-key menu access (Alt then a letter opens a menu), a keyboard way into the drawn caption buttons, high-DPI checks, touchpad gestures.

## Snap layouts (the flyout when hovering the maximise button on Windows 11)

Windows shows the snap-layout flyout only when it believes the pointer is over a *maximise button* of the window frame. A custom-drawn button inside a
frameless window is just web content to it, so the flyout does not appear unless the window answers the system's hit-test message (`WM_NCHITTEST`)
with `HTMAXBUTTON` for that rectangle. Options, in the order to try:

1. **A small native hook in `src-tauri`** (`windows` crate, `SetWindowSubclass`): answer `WM_NCHITTEST` with `HTMAXBUTTON` over the maximise button's
   rectangle, which the page reports through a Tauri command whenever the button moves or the window resizes. This is the same trick other frameless
   apps use. Risk: the page then stops getting mouse events over that rectangle, so the button's click must be handled by the window (`WM_NCLBUTTONUP`
   maps to maximise), and the hover highlight must be drawn from state sent by the hook.
2. **A community plugin** (for example one that adds a custom title bar with snap-layout support for Tauri 2). Each needs its licence and its Tauri
   version checked before it is added (`AGENTS.md`: check licences before adding a dependency), and its Windows behaviour tested.
3. **Keep the native caption** (decorations on) on Windows and draw only the menu inside the page. Snap layouts then work for free and the title bar looks
   like every other Windows app; the cost is that the app's own top bar (workspace tabs) has to sit below the system caption instead of in it.

Recommendation: try 3 first on a real machine (the cheapest and most native-looking), and move to 1 only if the tabs-in-the-title-bar layout matters.

## Test plan (to run on a Windows 10 and a Windows 11 machine)

For each, record the Windows build, display scaling, input device, and what happened. A box is ticked only after it was seen.

- [ ] The app starts; the window can be dragged by the top bar, resized from every edge and corner, minimised, maximised and restored; double-click on the
      bar maximises.
- [ ] Caption buttons: close, minimise and maximise work and show hover and press states; close asks about unsaved work.
- [ ] Windows 11: hovering the maximise button shows the snap-layout flyout (only if option 1 or 3 is chosen); snapping to halves works with `Win+Arrow`.
- [ ] Menus: open each by click, then move along the bar; `Alt` opens the first menu and arrows move between them (not built yet); shortcuts shown with `Ctrl`.
- [ ] Display scaling 100, 125, 150 and 200 percent: text and icons crisp, nothing clipped; moving the window between two screens of different scaling.
- [ ] Input: a precision touchpad two-finger scroll orbits the 3D view, pinch zooms (`Ctrl`+wheel arrives as zoom); a 3-button mouse; a pen (pressure arrives as
      pointer events with `pressure`).
- [ ] Tear-off windows (Window > Move this document to its own window): the second window has the same frame and buttons, and closing it frees the document.
- [ ] Files: a project path with spaces and non-ASCII letters; `exports/` writing; a path on a network or OneDrive folder.
- [ ] Play: the game window opens; the debugger link works; a game with a gamepad (an Xbox controller) sees it.
- [ ] Dark and light mode, and the high-contrast theme, follow the system setting where the studio promises to.
