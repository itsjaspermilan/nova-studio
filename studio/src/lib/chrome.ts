// The studio's window has no separate title bar: on macOS the window's own buttons sit over the left end of the studio's top bar
// (tauri.macos.conf.json), and on Windows the window has no frame at all and the studio draws minimise, maximise and close at the right
// end (tauri.windows.conf.json). The top bar is the handle the window is dragged by. In the browser preview nothing changes.

export type Chrome = "mac" | "windows" | "none";

/// Which kind of window the studio is in: the platform when it runs as the app, "none" in a browser.
export function chromeKind(): Chrome {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return "none";
  const ua = navigator.userAgent;
  if (/Mac/.test(ua)) return "mac";
  if (/Windows/.test(ua)) return "windows";
  return "none";
}

/// Marks the page (html[data-chrome]) so that the bars make room for the window's buttons.
export function markChrome(): Chrome {
  const kind = chromeKind();
  document.documentElement.dataset.chrome = kind;
  return kind;
}

async function win() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}
export const minimise = async () => (await win()).minimize();
export const toggleMaximise = async () => (await win()).toggleMaximize();
export const closeWindow = async () => (await win()).close();
