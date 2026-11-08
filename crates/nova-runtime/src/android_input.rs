//! Android through JNI for players and local co-op: the game controllers the system lists (so that each is its own player,
//! known by a descriptor that stays the same when it reconnects), shaking a controller (or the handheld itself, whose
//! built-in controls have no motor of their own), the wifi multicast lock that lets broadcast packets in (Android drops
//! them otherwise, and a host is found by broadcast), and the device's name as its owner set it.
//!
//! Everything here reads or asks; nothing changes a system setting. Failures are reported to the caller or logged; a game
//! carries on without rumble or without being found.

use std::sync::Mutex;

use jni::objects::{GlobalRef, JIntArray, JObject, JString, JValue};
use jni::{JNIEnv, JavaVM};

/// `InputDevice.SOURCE_GAMEPAD` and `SOURCE_JOYSTICK`.
const SOURCE_GAMEPAD: i32 = 0x0000_0401;
const SOURCE_JOYSTICK: i32 = 0x0100_0010;

#[derive(Clone, Debug, PartialEq)]
pub struct Controller {
    pub id: i32,
    /// `InputDevice.getDescriptor()`: the same for a device across reconnects and restarts.
    pub descriptor: String,
    pub name: String,
    /// It has a vibrator of its own.
    pub vibrator: bool,
    /// It is plugged in or paired, not part of the handheld.
    pub external: bool,
}

/// Runs `f` with a JNI environment on this thread and the activity. A Java exception is cleared and becomes the error.
fn with_env<T>(
    f: impl FnOnce(&mut JNIEnv, &JObject) -> jni::errors::Result<T>,
) -> Result<T, String> {
    let app = crate::android_ui::app().ok_or("the app is not ready")?;
    // SAFETY: the pointers are the process's JavaVM and the activity's global reference, valid for the life of the app.
    let vm = unsafe { JavaVM::from_raw(app.vm_as_ptr().cast()) }.map_err(|e| e.to_string())?;
    let mut env = vm
        .attach_current_thread_permanently()
        .map_err(|e| e.to_string())?;
    let activity = unsafe { JObject::from_raw(app.activity_as_ptr().cast()) };
    let result = env
        .with_local_frame(64, |env| f(env, &activity))
        .map_err(|e| e.to_string());
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
    }
    result
}

fn string(env: &mut JNIEnv, obj: JObject) -> jni::errors::Result<String> {
    if obj.is_null() {
        return Ok(String::new());
    }
    let s = JString::from(obj);
    Ok(env.get_string(&s)?.into())
}

/// A boolean method that may be missing on an older Android: `fallback` then (the exception is cleared).
fn bool_or(env: &mut JNIEnv, obj: &JObject, method: &str, fallback: bool) -> bool {
    match env.call_method(obj, method, "()Z", &[]).and_then(|v| v.z()) {
        Ok(v) => v,
        Err(_) => {
            let _ = env.exception_clear();
            fallback
        }
    }
}

/// The game controllers connected now.
pub fn controllers() -> Result<Vec<Controller>, String> {
    with_env(|env, _| {
        let ids = env
            .call_static_method("android/view/InputDevice", "getDeviceIds", "()[I", &[])?
            .l()?;
        let ids = JIntArray::from(ids);
        let n = env.get_array_length(&ids)?;
        let mut buf = vec![0i32; n as usize];
        env.get_int_array_region(&ids, 0, &mut buf)?;
        let mut list = Vec::new();
        for id in buf {
            let device = env
                .call_static_method(
                    "android/view/InputDevice",
                    "getDevice",
                    "(I)Landroid/view/InputDevice;",
                    &[JValue::Int(id)],
                )?
                .l()?;
            if device.is_null() {
                continue;
            }
            let sources = env.call_method(&device, "getSources", "()I", &[])?.i()?;
            let pad = sources & SOURCE_GAMEPAD == SOURCE_GAMEPAD
                || sources & SOURCE_JOYSTICK == SOURCE_JOYSTICK;
            if !pad || bool_or(env, &device, "isVirtual", false) {
                env.delete_local_ref(device)?;
                continue;
            }
            let name = env
                .call_method(&device, "getName", "()Ljava/lang/String;", &[])?
                .l()?;
            let name = string(env, name)?;
            let descriptor = env
                .call_method(&device, "getDescriptor", "()Ljava/lang/String;", &[])?
                .l()?;
            let descriptor = string(env, descriptor)?;
            let vib = env
                .call_method(&device, "getVibrator", "()Landroid/os/Vibrator;", &[])?
                .l()?;
            let vibrator = !vib.is_null() && bool_or(env, &vib, "hasVibrator", false);
            // isExternal is Android 10 and later; before it, call every controller external (it then needs its own motor)
            let external = bool_or(env, &device, "isExternal", true);
            env.delete_local_ref(vib)?;
            env.delete_local_ref(device)?;
            list.push(Controller {
                id,
                descriptor: if descriptor.is_empty() {
                    format!("android:{id}")
                } else {
                    descriptor
                },
                name,
                vibrator,
                external,
            });
        }
        Ok(list)
    })
}

/// Shakes the controller `id`, or the handheld itself (None), for `ms` milliseconds at `strength` (0 to 1).
pub fn vibrate(id: Option<i32>, strength: f32, ms: i64) {
    if strength <= 0.0 || ms <= 0 {
        return;
    }
    let result = with_env(|env, activity| {
        let vibrator = match id {
            Some(id) => {
                let device = env
                    .call_static_method(
                        "android/view/InputDevice",
                        "getDevice",
                        "(I)Landroid/view/InputDevice;",
                        &[JValue::Int(id)],
                    )?
                    .l()?;
                if device.is_null() {
                    return Ok(());
                }
                env.call_method(&device, "getVibrator", "()Landroid/os/Vibrator;", &[])?
                    .l()?
            }
            None => {
                let service = env.new_string("vibrator")?;
                env.call_method(
                    activity,
                    "getSystemService",
                    "(Ljava/lang/String;)Ljava/lang/Object;",
                    &[JValue::Object(&service)],
                )?
                .l()?
            }
        };
        if vibrator.is_null() || !bool_or(env, &vibrator, "hasVibrator", false) {
            return Ok(());
        }
        let amplitude = (strength.clamp(0.0, 1.0) * 255.0).round().max(1.0) as i32;
        let effect = env
            .call_static_method(
                "android/os/VibrationEffect",
                "createOneShot",
                "(JI)Landroid/os/VibrationEffect;",
                &[JValue::Long(ms), JValue::Int(amplitude)],
            )?
            .l()?;
        env.call_method(
            &vibrator,
            "vibrate",
            "(Landroid/os/VibrationEffect;)V",
            &[JValue::Object(&effect)],
        )?;
        Ok(())
    });
    if let Err(e) = result {
        log::warn!("cannot vibrate ({id:?}): {e}");
    }
}

static MULTICAST_LOCK: Mutex<Option<GlobalRef>> = Mutex::new(None);

/// Takes (or lets go of) the wifi multicast lock, which lets broadcast packets reach the game: needed to be found by
/// another device. It costs battery, so it is held only while hosting or looking for a game.
pub fn multicast_lock(on: bool) {
    let Ok(mut held) = MULTICAST_LOCK.lock() else {
        return;
    };
    if on == held.is_some() {
        return;
    }
    let result = with_env(|env, activity| {
        if let Some(lock) = held.take() {
            env.call_method(lock.as_obj(), "release", "()V", &[])?;
            return Ok(());
        }
        let context = env
            .call_method(
                activity,
                "getApplicationContext",
                "()Landroid/content/Context;",
                &[],
            )?
            .l()?;
        let service = env.new_string("wifi")?;
        let wifi = env
            .call_method(
                &context,
                "getSystemService",
                "(Ljava/lang/String;)Ljava/lang/Object;",
                &[JValue::Object(&service)],
            )?
            .l()?;
        if wifi.is_null() {
            return Ok(());
        }
        let tag = env.new_string("nova")?;
        let lock = env
            .call_method(
                &wifi,
                "createMulticastLock",
                "(Ljava/lang/String;)Landroid/net/wifi/WifiManager$MulticastLock;",
                &[JValue::Object(&tag)],
            )?
            .l()?;
        env.call_method(&lock, "setReferenceCounted", "(Z)V", &[JValue::Bool(0)])?;
        env.call_method(&lock, "acquire", "()V", &[])?;
        *held = Some(env.new_global_ref(&lock)?);
        Ok(())
    });
    match result {
        Ok(()) => log::info!(
            "wifi multicast lock {}",
            if on { "taken" } else { "let go" }
        ),
        Err(e) => log::warn!("wifi multicast lock: {e}"),
    }
}

/// The name the owner gave the device (Settings > About), else its model ("Retroid Pocket 6").
pub fn device_name() -> Option<String> {
    with_env(|env, activity| {
        let resolver = env
            .call_method(
                activity,
                "getContentResolver",
                "()Landroid/content/ContentResolver;",
                &[],
            )?
            .l()?;
        let key = env.new_string("device_name")?;
        let name = env
            .call_static_method(
                "android/provider/Settings$Global",
                "getString",
                "(Landroid/content/ContentResolver;Ljava/lang/String;)Ljava/lang/String;",
                &[JValue::Object(&resolver), JValue::Object(&key)],
            )
            .and_then(|v| v.l());
        let name = match name {
            Ok(n) => string(env, n)?,
            Err(_) => {
                let _ = env.exception_clear();
                String::new()
            }
        };
        if !name.is_empty() {
            return Ok(name);
        }
        let model = env
            .get_static_field("android/os/Build", "MODEL", "Ljava/lang/String;")?
            .l()?;
        string(env, model)
    })
    .ok()
    .filter(|n| !n.is_empty())
}
