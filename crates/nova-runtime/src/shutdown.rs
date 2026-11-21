//! Quitting cleanly. A game asks with `nova.quit()`; the system asks with SIGTERM, SIGINT or SIGHUP (a handheld's
//! "Exit game" under gamescope, Ctrl-C in a terminal, the terminal closing) or by closing the window. Each is the same
//! orderly shutdown in the host (`app.rs`): the save is written, the sound is stopped, the GPU surface and the window are
//! dropped, and the process ends with status 0.
//!
//! A shutdown must never hang (a stuck audio thread on a handheld froze the whole device): once it begins, a watchdog
//! ends the process after [`GRACE`] whatever is still running, and a second signal ends it at once.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;

/// How long an orderly shutdown may take before the watchdog ends the process anyway.
pub const GRACE: Duration = Duration::from_millis(800);

static SIGNALS: AtomicU32 = AtomicU32::new(0);
static WATCHED: AtomicBool = AtomicBool::new(false);

/// Catches SIGTERM, SIGINT and SIGHUP from now on (Unix; elsewhere nothing to do): the first asks for an orderly
/// shutdown ([`requested`]), a second ends the process at once.
pub fn install() {
    #[cfg(all(unix, not(target_os = "android")))]
    unsafe {
        let handler = on_signal as extern "C" fn(libc::c_int);
        for sig in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP] {
            libc::signal(sig, handler as libc::sighandler_t);
        }
    }
}

#[cfg(all(unix, not(target_os = "android")))]
extern "C" fn on_signal(_sig: libc::c_int) {
    // (only what is safe in a signal handler: an atomic add, and _exit)
    if SIGNALS.fetch_add(1, Ordering::SeqCst) >= 1 {
        unsafe { libc::_exit(130) };
    }
}

/// Whether the system asked the game to end (a signal arrived).
pub fn requested() -> bool {
    SIGNALS.load(Ordering::SeqCst) > 0
}

/// Starts the watchdog of a shutdown (once): if the process is still running after [`GRACE`], it ends with `code`.
pub fn watchdog(code: i32) {
    if WATCHED.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = std::thread::Builder::new()
        .name("nova-quit-watchdog".into())
        .spawn(move || {
            std::thread::sleep(GRACE);
            eprintln!(
                "nova: the shutdown took longer than {} ms; ending now",
                GRACE.as_millis()
            );
            hard_exit(code);
        });
}

/// Ends the process now, without running anything else (no destructors, no exit handlers that could hang).
pub fn hard_exit(code: i32) -> ! {
    #[cfg(unix)]
    unsafe {
        libc::_exit(code)
    }
    #[cfg(not(unix))]
    std::process::exit(code)
}
