// Longer, calmer strides for the cast (the owner, after the second play: "the animation needs to slow down a bit and the player should
// be able to move faster"). character3d_make's chibi walk, run and trot swing the stubby legs a little way quickly; here each leg
// swings further (so each step covers more ground) and each cycle lasts longer, so a faster walker takes calmer steps and the feet
// still keep to the ground (the hips held level so the soles do not sink). Each clip's new length is
// the one at which it does not slide at the speed given (TARGET): played at its own pace there, the standing foot moves back under the
// body exactly as fast as the body goes forward.
//
// The change is made in both of the model's files, the same way: the clips of `models/<name>.model.json` (the studio's source) and the
// animations of `models/<name>.glb` (what the game draws), patched in place. (model_write would rebuild the .glb and its texture from the
// .model.json, and the painted faces character3d_make bakes into them would be lost.)
//
// Run after tools/cast.mjs (which calls it at its end): it changes the clips only while they are still character3d_make's own (a walk
// of 0.56 s), so running it twice changes nothing.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GAME, tool } from "./lib.mjs";

// The speeds (m/s) the clips are made for, and how far each leg swings: forward (negative, the leg's front up) and back, in degrees.
export const TARGET = { walk: 1.6, run: 3.0, trot: 2.2 };
const OLD = { walk: { fwd: 26, back: 26, speed: 0.767 }, run: { fwd: 42, back: 18, speed: 1.633 }, trot: { fwd: 28, back: 20, speed: 0.997 } };
const NEW = { walk: { fwd: 48, back: 48 }, run: { fwd: 66, back: 38 }, trot: { fwd: 50, back: 36 } };
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
      } else if (track.prop === "position" && part === "hips") {
        const top = Math.max(...track.keys.map((key) => key.value[1]));
        for (const key of track.keys) key.value[1] = Math.round(hips(name, key.value[1], top) * 1000) / 1000;
      }
    }
    clip.duration = p[name].duration;
    for (const e of clip.events ?? []) e.t = Math.round(e.t * k * 10000) / 10000;
  }
  return changed;
}

// The .glb's animations (quaternions, metres): each sampler's times, the legs' turns about x, the hips' height.
function restrideGlb(bytes) {
  const jsonLen = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString("utf8"));
  const binStart = 20 + jsonLen + 8;
  const view = (accessor) => {
    const a = doc.accessors[accessor], bv = doc.bufferViews[a.bufferView];
    const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
    const stride = bv.byteStride ?? width * 4;
    const at = (i, c) => binStart + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * stride + c * 4;
    return { a, width, get: (i, c) => bytes.readFloatLE(at(i, c)), set: (i, c, v) => bytes.writeFloatLE(v, at(i, c)) };
  };
  const bounds = (v) => {
    const min = Array(v.width).fill(Infinity), max = Array(v.width).fill(-Infinity);
    for (let i = 0; i < v.a.count; i++) for (let c = 0; c < v.width; c++) { const x = v.get(i, c); min[c] = Math.min(min[c], x); max[c] = Math.max(max[c], x); }
    if (v.a.min) v.a.min = min;
    if (v.a.max) v.a.max = max;
  };
  const p = plan();
  for (const anim of doc.animations) {
    const name = anim.name;
    if (!p[name]) continue;
    const times = view(anim.samplers[anim.channels[0].sampler].input);
    const last = Math.max(...Array.from({ length: times.a.count }, (_, i) => times.get(i, 0)));
    if (Math.abs(last - ORIGINAL[name]) > 1e-4) continue;
    const k = p[name].duration / last;
    for (const ch of anim.channels) {
      const s = anim.samplers[ch.sampler];
      const t = view(s.input);
      for (let i = 0; i < t.a.count; i++) t.set(i, 0, t.get(i, 0) * k);
      bounds(t);
      const node = doc.nodes[ch.target.node].name;
      const out = view(s.output);
      if (ch.target.path === "rotation" && (node === "leg_l" || node === "leg_r")) {
        for (let i = 0; i < out.a.count; i++) {
          const [x, y, z, w] = [0, 1, 2, 3].map((c) => out.get(i, c));
          if (Math.abs(y) > 1e-3 || Math.abs(z) > 1e-3) throw new Error(`${name} ${node}: a turn not about x`);
          const a = leg(name, (2 * Math.atan2(x, w) * 180) / Math.PI);
          out.set(i, 0, Math.sin(rad(a) / 2));
          out.set(i, 3, Math.cos(rad(a) / 2));
        }
        bounds(out);
      } else if (ch.target.path === "translation" && node === "hips") {
        let top = -Infinity;
        for (let i = 0; i < out.a.count; i++) top = Math.max(top, out.get(i, 1));
        for (let i = 0; i < out.a.count; i++) out.set(i, 1, hips(name, out.get(i, 1), top));
        bounds(out);
      }
    }
  }
  // the JSON chunk again (padded with spaces to a multiple of four, as the format asks), the binary chunk as it was
  let json = Buffer.from(JSON.stringify(doc), "utf8");
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  const bin = bytes.subarray(20 + jsonLen);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + json.length + bin.length, 8);
  head.writeUInt32LE(json.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, json, bin]);
}

export function longStrides(names = ["postmaster", "hazel", "pip"]) {
  for (const name of names) {
    const file = join(GAME, "models", `${name}.model.json`);
    const model = JSON.parse(readFileSync(file, "utf8"));
    if (!restrideJson(model)) { console.log(`${name}: strides already long`); continue; }
    // the source through model_write (its own layout of the file), then the drawn files put back as they were and patched
    const glb = join(GAME, "models", `${name}.glb`), png = join(GAME, "models", `${name}.texture.png`);
    const keepGlb = readFileSync(glb), keepPng = readFileSync(png);
    tool("model_write", { name, model });
    writeFileSync(png, keepPng);
    writeFileSync(glb, restrideGlb(keepGlb));
  }
  console.log("no-slide speeds (m/s):", JSON.stringify(plan()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  longStrides();
  tool("model_preview", { name: "postmaster", clip: "walk", strip: 8, image_out: "build/look/walk-strip.png" });
  tool("model_preview", { name: "postmaster", clip: "run", strip: 8, image_out: "build/look/run-strip.png" });
  tool("model_preview", { name: "postmaster", clip: "trot", strip: 8, image_out: "build/look/trot-strip.png" });
}
