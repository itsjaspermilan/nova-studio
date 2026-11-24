// Longer, calmer strides for the cast (the owner, after the second play: "the animation needs to slow down a bit and the player should
// be able to move faster"). character3d_make's chibi walk, run and trot swing the stubby legs a little way quickly; here each leg
// swings further (so each step covers more ground) and each cycle lasts longer, so a faster walker takes calmer steps and the feet
// still keep to the ground (the hips held level so the soles do not sink). Each clip's new length is
// the one at which it does not slide at the speed given (TARGET): played at its own pace there, the standing foot moves back under the
// body exactly as fast as the body goes forward.
//
// The change is made in the clips of `models/<name>.model.json` (the studio's source); model_write then exports `models/<name>.glb` (what
// the game draws) from it with `picture` set to the model's own `models/<name>.texture.png`, the faces character3d_make painted, so the
// .glb is exactly the studio's export of the two (it was patched in place before 2026-11-22, and no longer matched).
//
// Run after tools/cast.mjs (which calls it at its end): it changes the clips only while they are still character3d_make's own (a walk
// of 0.56 s), so running it twice changes nothing (the .glb is exported again, the same).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GAME, tool } from "./lib.mjs";

// The speeds (m/s) the clips are made for, and how far each leg swings: forward (negative, the leg's front up) and back, in degrees.
export const TARGET = { walk: 1.6, run: 3.0, trot: 2.2 };
const OLD = { walk: { fwd: 26, back: 26, speed: 0.767 }, run: { fwd: 42, back: 18, speed: 1.633 }, trot: { fwd: 28, back: 20, speed: 0.997 } };
// (the owner's eighth play, "he kind of looks like he's shuffling": the walk a little longer again, 51 degrees each way, so each step
// covers more ground at a slightly calmer beat, 0.476 s a cycle at 1.6 m/s (0.455 before); and the arms swing further against the legs, ARMS)
const NEW = { walk: { fwd: 51, back: 51 }, run: { fwd: 66, back: 38 }, trot: { fwd: 50, back: 36 } };
const ARMS = { walk: 40 / 26 };
const ORIGINAL = { walk: 0.56, run: 0.3, trot: 0.4 };
const rad = (d) => (d * Math.PI) / 180;
const reach = (s) => Math.sin(rad(s.fwd)) + Math.sin(rad(s.back));   // (how far the ankle travels in a step, per leg length)


/// The new length of each clip and the speed at which it does not slide (which is TARGET, by construction).
export function plan() {
  const out = {};
  for (const name of Object.keys(TARGET)) {
    const o = OLD[name], n = NEW[name];
    const speedAtOldLength = o.speed * reach(n) / reach(o);
    out[name] = { duration: Math.round(ORIGINAL[name] * speedAtOldLength / TARGET[name] * 1000) / 1000, speed: TARGET[name] };
  }
  return out;
}

// A leg's swing (degrees about x, positive back) on the longer stride.
const leg = (name, a) => (a < 0 ? (a * NEW[name].fwd) / OLD[name].fwd : (a * NEW[name].back) / OLD[name].back);
// The hips held level: with the longer swing the sole's heel and toe already reach down as the leg tips, and the old dip on top sank
// the feet up to 8 cm into the ground at the end of each step; level, the soles stay within 2 cm of it all through the cycle (measured
// with nova.model_pose). STRIDE_HIPS={"walk":0.3} tries another share of the old dip.
const HIPS = { walk: 0, run: 0, trot: 0, ...JSON.parse(process.env.STRIDE_HIPS ?? "{}") };
const hips = (name, y, top) => top - (top - y) * HIPS[name];

// The .model.json's clips (degrees, model units).
function restrideJson(model) {
  const p = plan();
  let changed = false;
  for (const clip of model.clips) {
    const name = clip.name;
    if (!p[name] || Math.abs(clip.duration - ORIGINAL[name]) > 1e-6) continue;
    changed = true;
    const k = p[name].duration / clip.duration;
    for (const track of clip.tracks) {
      const part = track.part[track.part.length - 1];
      for (const key of track.keys) key.t = Math.round(key.t * k * 10000) / 10000;
      if (track.prop === "rotation" && (part === "leg_l" || part === "leg_r")) {
        for (const key of track.keys) key.value[0] = Math.round(leg(name, key.value[0]) * 1000) / 1000;
      } else if (track.prop === "rotation" && ARMS[name] && (part === "arm_l" || part === "arm_r")) {
        for (const key of track.keys) key.value[0] = Math.round(key.value[0] * ARMS[name] * 1000) / 1000;
      } else if (track.prop === "position" && part === "hips") {
        const top = Math.max(...track.keys.map((key) => key.value[1]));
        for (const key of track.keys) key.value[1] = Math.round(hips(name, key.value[1], top) * 1000) / 1000;
      }
    }
    clip.duration = p[name].duration;
    // (the ground one cycle covers, which the game's animator plays it by: entities/postmaster.lua, lib/resident.lua)
    clip.stride = Math.round(TARGET[name] * clip.duration * 1000) / 1000;
    for (const e of clip.events ?? []) e.t = Math.round(e.t * k * 10000) / 10000;
  }
  return changed;
}

export function longStrides(names = ["postmaster", "hazel", "pip"]) {
  for (const name of names) {
    const file = join(GAME, "models", `${name}.model.json`);
    const model = JSON.parse(readFileSync(file, "utf8"));
    console.log(`${name}: ${restrideJson(model) ? "strides made longer" : "strides already long"}`);
    // the source through model_write, which exports the .glb from it with the painted picture character3d_make made (the faces),
    // so the .glb is exactly what the studio exports from the .model.json and that picture (studio/src/lib/examples.test.ts)
    tool("model_write", { name, model, picture: `models/${name}.texture.png` });
  }
  console.log("no-slide speeds (m/s):", JSON.stringify(plan()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  longStrides();
  tool("model_preview", { name: "postmaster", clip: "walk", strip: 8, image_out: "build/look/walk-strip.png" });
  tool("model_preview", { name: "postmaster", clip: "run", strip: 8, image_out: "build/look/run-strip.png" });
  tool("model_preview", { name: "postmaster", clip: "trot", strip: 8, image_out: "build/look/trot-strip.png" });
}
