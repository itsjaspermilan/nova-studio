#!/bin/bash
# A memory soak of Pine Ridge Rally on a connected device: the computer drives race after race (as scripts/rally-soak.sh does) and, every 15 seconds,
# the app's memory is read with `dumpsys meminfo` (total PSS and RSS, the native heap, graphics memory) next to the system's MemAvailable, with the
# highest value of each seen so far, so the peak is known. At the end the process's own high-water marks (VmHWM, VmRSS) and any low-memory kills in the
# log are printed. A device with 8 GB reports about 7.4 GB total and 5 GB available when idle: that is the room to compare against.
#
#   scripts/mem-soak.sh [minutes]      (default 20)      ANDROID_SERIAL picks the device when several are connected
set -uo pipefail
cd "$(dirname "$0")/.."
ENV=scripts/env.sh
MINUTES="${1:-20}"
PKG=com.nova.games.pine_ridge_rally
KEY_ENTER=66; KEY_RIGHT=22; KEY_DOWN=20; KEY_F9=139
key() { "$ENV" adb shell input keyevent "$1"; sleep "${2:-0.4}"; }

start_race() {
    "$ENV" adb shell am force-stop "$PKG"
    "$ENV" adb logcat -c
    "$ENV" adb shell am start -n "$PKG/android.app.NativeActivity" >/dev/null
    sleep 9
    key $KEY_ENTER; key $KEY_ENTER
    for _ in $(seq 1 "$1"); do key $KEY_RIGHT; done
    for _ in 1 2 3 4; do key $KEY_DOWN; done
    key $KEY_ENTER
    sleep 2
    key $KEY_ENTER   # (the 'Ready to race' screen: Race)
    sleep 8
    key $KEY_F9
}

peak_pss=0; peak_rss=0; peak_native=0; peak_gfx=0; low_avail=99999999
sample() {
    local m pss rss native gfx avail
    m=$("$ENV" adb shell dumpsys meminfo "$PKG" 2>/dev/null | tr -d '\r')
    pss=$(echo "$m" | awk '/TOTAL PSS:/ {print $3}')
    rss=$(echo "$m" | awk '/TOTAL PSS:/ {for (i = 1; i <= NF; i++) if ($i == "RSS:") print $(i+1)}')
    native=$(echo "$m" | awk '/^ *Native Heap:/ {print $3}')
    gfx=$(echo "$m" | awk '/^ *Graphics:/ {print $2}')
    avail=$("$ENV" adb shell cat /proc/meminfo | tr -d '\r' | awk '/MemAvailable/ {print $2}')
    [ -z "$pss" ] && { echo "$(date +%H:%M:%S)  (no meminfo: the app is not running)"; return; }
    [ "$pss" -gt "$peak_pss" ] && peak_pss=$pss
    [ "${rss:-0}" -gt "$peak_rss" ] && peak_rss=${rss:-0}
    [ "${native:-0}" -gt "$peak_native" ] && peak_native=${native:-0}
    [ "${gfx:-0}" -gt "$peak_gfx" ] && peak_gfx=${gfx:-0}
    [ "${avail:-99999999}" -lt "$low_avail" ] && low_avail=$avail
    printf '%s  PSS %4d MB  RSS %4d MB  native %4d MB  graphics %4d MB  | system available %4d MB\n' "$(date +%H:%M:%S)" $((pss/1024)) $((${rss:-0}/1024)) $((${native:-0}/1024)) $((${gfx:-0}/1024)) $((avail/1024))
}

end=$(( $(date +%s) + MINUTES * 60 ))
echo "total RAM: $("$ENV" adb shell cat /proc/meminfo | tr -d '\r' | awk '/MemTotal/ {printf "%d MB", $2/1024}')"
cycle=0
while [ "$(date +%s)" -lt "$end" ]; do
    start_race $(( cycle % 4 == 0 ? 0 : 1 ))
    cycle=$((cycle + 1))
    for _ in $(seq 1 20); do
        [ "$(date +%s)" -ge "$end" ] && break
        sleep 15
        sample
    done
done
pid=$("$ENV" adb shell pidof "$PKG" | tr -d '\r')
[ -n "$pid" ] && "$ENV" adb shell grep -E 'VmHWM|VmRSS' /proc/"$pid"/status | tr -d '\r'
echo "peaks: PSS $((peak_pss/1024)) MB, RSS $((peak_rss/1024)) MB, native heap $((peak_native/1024)) MB, graphics $((peak_gfx/1024)) MB; lowest system available $((low_avail/1024)) MB"
echo "low-memory kills in the log: $("$ENV" adb logcat -d 2>/dev/null | grep -c -i -E 'lowmemorykiller|lmkd.*kill|Out of memory')"
