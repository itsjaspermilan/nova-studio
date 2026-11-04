//! Android system bars: a game owns the whole screen, so the status bar and the navigation bar (the "home bar" of gesture
//! navigation) are hidden, and they come back for a moment with a swipe from the edge ("sticky immersive") rather than
//! staying. The theme only hides the status bar, so this asks the window itself, and asks again whenever the window gets focus
//! back (a dialog or the notification shade brings the bars back).

use std::sync::OnceLock;

use android_activity::AndroidApp;
use jni::JavaVM;
use jni::objects::{JObject, JValue};

static APP: OnceLock<AndroidApp> = OnceLock::new();

// View.SYSTEM_UI_FLAG_*: IMMERSIVE_STICKY, HIDE_NAVIGATION, FULLSCREEN, and the three layout flags that keep the content
// from jumping when the bars come and go.
const FLAGS: i32 = 0x1000 | 0x2 | 0x4 | 0x100 | 0x200 | 0x400;

/// Remembers the app, so that [`hide_system_bars`] can be called from anywhere.
pub fn init(app: &AndroidApp) {
    let _ = APP.set(app.clone());
}

/// Hides the status and navigation bars. Failures are logged and otherwise ignored (the game still runs, with bars).
pub fn hide_system_bars() {
    let Some(app) = APP.get() else { return };
    if let Err(e) = try_hide(app) {
        log::warn!("could not hide the system bars: {e}");
    }
}

fn try_hide(app: &AndroidApp) -> Result<(), String> {
    // SAFETY: the pointers are the process's JavaVM and the activity's global reference, valid for the life of the app.
    let vm = unsafe { JavaVM::from_raw(app.vm_as_ptr().cast()) }.map_err(|e| e.to_string())?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let activity = unsafe { JObject::from_raw(app.activity_as_ptr().cast()) };
    let result = (|| -> jni::errors::Result<()> {
        let window = env
            .call_method(&activity, "getWindow", "()Landroid/view/Window;", &[])?
            .l()?;
        let decor = env
            .call_method(&window, "getDecorView", "()Landroid/view/View;", &[])?
            .l()?;
        env.call_method(
            &decor,
            "setSystemUiVisibility",
            "(I)V",
            &[JValue::Int(FLAGS)],
        )?;
        Ok(())
    })();
    if result.is_err() && env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
    }
    result.map_err(|e| e.to_string())
}
