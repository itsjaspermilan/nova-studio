// engine_make and driving_sounds_make: a car's engine as looping bands (throttle down and lifted) from a short recipe, and the sounds of
// driving (tyres, wind, turbo, whine, scrapes, knocks, gear changes, pops), as plain WAV files a game plays through the runtime's Lua library
// nova.engine_sound (crates/nova-runtime/lua/engine_sound.lua).

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Host } from "./index";
import { ASPIRATIONS, bandFiring, CHARACTERS, FUELS, LAYOUTS, makeEngine, profileLua } from "./engine-make";
// @ts-ignore (plain JavaScript)
import { engineLoop, LOOP, patternOrder, spectrum, wavBytes } from "./engine.mjs";
// @ts-ignore
import { DRIVING_SOUNDS, makeDriving } from "./driving.mjs";

type Args = Record<string, any>;
type Result = string | { text: string; images?: string[] };
const text = (r: Result) => (typeof r === "string" ? r : r.text);
const images = (r: Result) => (typeof r === "string" ? [] : (r.images ?? []));

/// What a loop fires at, from the sound alone (as scripts/rally/sound-check.mjs measures it): a periodic sound's energy sits on lines a fixed
/// distance apart, and that distance is its fundamental. The 24 strongest lines under 6 kHz, and the widest spacing (up to 900 Hz) whose
/// multiples hold three quarters of their energy. Also the share of all the energy on the firing harmonics (rpm x cylinders / 120 and its
/// multiples) and on the half-orders between (the burr of unequal cylinders and banks).
export function firingOf(x: Float64Array | number[], cycles: number, layout: Args, rate = 44100): { fired: number; firing: number; half: number } {
  const n = x.length, s = spectrum(x), hz = rate / n, p: number[] = [];
  let e = 0;
  for (let k = 0; k <= n / 2; k++) { p.push(s.re[k] * s.re[k] + s.im[k] * s.im[k]); if (k) e += p[k]!; }
  const top: number[] = [];
  for (let k = 2; k < p.length && k * hz < 6000; k++) top.push(k);
  top.sort((i, j) => p[j]! - p[i]!);
  top.length = Math.min(top.length, 24);
  const among = top.reduce((m, k) => m + p[k]!, 0);
  let spacing = 0;
  for (let b = Math.floor(900 / hz); b >= 2 && !spacing; b--) { let on = 0; for (const k of top) if (k % b === 0) on += p[k]!; if (on >= 0.75 * among) spacing = b; }
  const inFile = (cycles * n) / LOOP, order = patternOrder(layout);
  let firing = 0, half = 0;
  for (let hh = 1; hh * inFile < p.length; hh++) { if (hh % order === 0) firing += p[hh * inFile]!; else half += p[hh * inFile]!; }
  return { fired: Math.round(spacing * hz * 10) / 10, firing: firing / e, half: half / e };
}

export function registerEngine(h: Host, SEED: unknown): Record<string, Args> {
  h.tool(
    "engine_make",
    `Make a car's engine sound from a short recipe, as loops a game crossfades by the revs: \`sounds/eng_<name>_<band>.wav\` (the throttle down) and \`eng_<name>_off_<band>.wav\` (lifted), five to seven bands from idle to the limit, each band's two loops with the same firings at the same instants, every loop seamless; and \`engines/<name>.lua\`, the profile the runtime's library plays it with (how fast it revs, its limiter, gearbox, turbo, blow-off, pops). ` +
      `Recipe: \`layout\` (${LAYOUTS.join(", ")}: v8 is a cross-plane V8, six a straight six), \`displacement\` (litres), \`aspiration\` (${ASPIRATIONS.join(", ")}), \`fuel\` (${FUELS.join(", ")}), \`idle\` and \`limit\` (rpm), \`character\` (${CHARACTERS.join(", ")}). ` +
      "Made offline from a model of an engine (each cylinder's pulse through its pipe and the silencer, the intake, the block's knock, the valves, the flow, a diesel's fan; nothing recorded): the recipe starts from the nearest of twelve modelled engines (a 3.0 turbo six, a 4.2 diesel six, 2.0 turbo fours, a 2.0 four, a 0.8 three, a raspy 2.4 four, a 2.5 turbo five, a 5.6 V8, a 2.8 turbo-diesel four, a 7.2 turbo-diesel six, a 3.4 twin-turbo V6) and moves it. `seed` is another take of the same engine. " +
      "In Lua: local engine_sound = require(\"nova.engine_sound\"); self.engine = engine_sound.new(require(\"engines.<name>\")); and each step self.engine:update(dt, { rpm = rpm, throttle = 0..1, speed = metres a second }) (see the api tool, nova.engine_sound). The driving sounds the library also plays (tyres, wind, turbo, gear changes) come from driving_sounds_make. " +
      "The answer gives each band's revs and firing frequency (the engine's note: rpm x cylinders / 120) with what the loop is measured to fire at (the spacing of its strongest lines) and its share of energy on the firing harmonics, and the sound_report of the lowest, middle and top bands.",
    {
      name: { type: "string", description: 'The engine\'s name ("car"): the files are sounds/eng_<name>_*.wav and engines/<name>.lua.' },
      layout: { type: "string", description: LAYOUTS.join(", ") },
      displacement: { type: "number", description: "Litres (0.6 to 9)." },
      aspiration: { type: "string", description: ASPIRATIONS.join(", ") },
      fuel: { type: "string", description: FUELS.join(", ") },
      idle: { type: "number", description: "rpm at idle (400 to 2000)." },
      limit: { type: "number", description: "rpm at the limiter." },
      character: { type: "string", description: CHARACTERS.join(", ") },
      report: { type: "boolean", description: "false: no sound_report (quicker, for scripts that make many)." },
      profile: { type: "boolean", description: "false: do not write engines/<name>.lua (a game that keeps its profiles elsewhere)." },
      seed: SEED,
    },
    ["name"],
    (a) => {
      const root = h.root(a);
      const name = h.safeName(a.name, "Sound");
      const e = makeEngine(a);
      const firing = bandFiring(e);
      const wrote: string[] = [], rows: string[] = [];
      e.spec.cycles.forEach((cycles: number, j: number) => {
        const seed = e.seed + j;
        for (const layer of ["on", "off"]) {
          const x = engineLoop(e.spec, cycles, layer, seed);
          const file = `sounds/eng_${name}_${layer === "on" ? "" : "off_"}${j + 1}.wav`;
          h.put(root, file, wavBytes(x));
          wrote.push(file);
          if (layer === "on" && a.report !== false) {
            const f = firing[j]!, m = firingOf(x, cycles, e.spec.layout), share = f.hz / m.fired;
            rows.push(`  band ${j + 1}: ${f.rpm} rpm, fires at ${f.hz} Hz; its lines are ${m.fired} Hz apart${Math.abs(share - 1) < 0.01 ? " (the firing frequency)" : ` (a ${Math.round(share)}th of it: the burr of unequal cylinders or banks is part of the pattern)`}; ${Math.round(m.firing * 100)}% of its energy on the firing harmonics, ${Math.round(m.half * 100)}% on the half-orders between`);
          } else if (layer === "on") rows.push(`  band ${j + 1}: ${firing[j]!.rpm} rpm, firing ${firing[j]!.hz} Hz`);
        }
      });
      // (the bands of an earlier recipe that this one does not have are taken away)
      const dir = join(root, "sounds");
      const stale: string[] = [];
      if (existsSync(dir)) for (const f of readdirSync(dir)) if (new RegExp(`^eng_${name}_(off_)?\\d+\\.wav$`).test(f) && !wrote.includes(`sounds/${f}`)) { rmSync(join(dir, f)); stale.push(f); }
      if (a.profile !== false) h.put(root, `engines/${name}.lua`, profileLua(name, e));
      const r = e.recipe;
      const head = [
        `${wrote.length} loops in sounds/ (eng_${name}_1..${e.spec.cycles.length}.wav and eng_${name}_off_*.wav)${a.profile !== false ? ` and engines/${name}.lua` : ""}: a ${r.displacement}-litre ${r.layout} ${r.fuel}${r.aspiration === "none" ? "" : r.aspiration === "twin" ? " twin-turbo" : " turbo"}, ${r.character}, ${r.idle} to ${r.limit} rpm, made from the model of ${e.base}${e.says.length ? ` (${e.says.join("; ")})` : " as it is"}`,
        ...rows,
        ...(stale.length ? [`removed ${stale.join(", ")} (bands this recipe does not have)`] : []),
        `in Lua: local engine_sound = require("nova.engine_sound"); local engine = engine_sound.new(require("engines.${name}")); each step engine:update(dt, { rpm = rpm, throttle = throttle, speed = speed })`,
      ];
      if (a.report === false) return head.join("\n");
      const n = e.spec.cycles.length, pick = [...new Set([1, Math.ceil(n / 2), n])].map((k) => `eng_${name}_${k}`);
      const rep = h.call("sound_report", { project: a.project, sounds: pick, loop: true });
      return { text: [...head, "sound_report of the lowest, middle and top bands (throttle down):", text(rep)].join("\n"), images: images(rep) };
    },
  );

  h.tool(
    "driving_sounds_make",
    `Make the sounds of driving a game plays beside its engines, as plain files in sounds/: ${DRIVING_SOUNDS.join(", ")}. ` +
      "Loops (seamless: a game steers each one's volume and pitch): tyre_road (tread hiss on tarmac), tyre_gravel (a crunching bed and stones), tyre_dirt, tyre_snow (squeaks and creaks), tyre_sand, tyre_rough (grass and verge: a heavy drumming), tyre_squeal (two tyres sliding on tarmac), wind_loop, turbo_loop (the breath of the air it moves), whine_loop (an old gearbox's straight teeth), scrape_loop (the body along a barrier). " +
      "One-shots: thump (the suspension taking a bump) and impact (a barrier or a car), each three takes in a group (sounds/<name>.group.json: nova.sound.play(\"thump\") picks one), shift_quick (a twin-clutch or sequential box), shift_stick (a manual), shift_clunk (an old or heavy box), bov (a turbo's blow-off), pop (the exhaust on the overrun, three takes), whoosh (a car going by close). " +
      "nova.engine_sound plays them by these names (tyres by surface, squeal when sliding, wind with speed, turbo with boost, the shift sound of the profile's gearbox). Made sample by sample from noise and resonators (nothing recorded); `seed` 1 is the set first made for Pine Ridge Rally, another seed another take of every one. `sounds` writes only some (all are made, so each one is the same whatever else is asked). It returns the sound_report of the tyres on gravel and the squeal.",
    {
      sounds: { type: "array", items: { type: "string" }, description: `Only these (all when left out): ${DRIVING_SOUNDS.join(", ")}.` },
      report: { type: "boolean", description: "false: no sound_report." },
      seed: SEED,
    },
    [],
    (a) => {
      const root = h.root(a);
      const want: string[] = a.sounds ?? DRIVING_SOUNDS;
      for (const s of want) if (!DRIVING_SOUNDS.includes(s)) throw new Error(`there is no driving sound "${s}"; they are ${DRIVING_SOUNDS.join(", ")}`);
      const written: string[] = [];
      makeDriving(a.seed ?? 1, (file: string, bytes: Uint8Array | string) => {
        const base = file.replace(/\d*\.(wav|group\.json)$/, "");
        if (!want.includes(base) && !want.includes(file.replace(/\.wav$/, ""))) return;
        h.put(root, `sounds/${file}`, bytes);
        written.push(file);
      });
      const said = `wrote ${written.length} files in sounds/ (seed ${a.seed ?? 1}): ${written.join(", ")}`;
      if (a.report === false) return said;
      const pick = ["tyre_gravel", "tyre_squeal"].filter((s) => want.includes(s));
      if (!pick.length) return said;
      const rep = h.call("sound_report", { project: a.project, sounds: pick, loop: true });
      return { text: `${said}\n${text(rep)}`, images: images(rep) };
    },
  );

  return {
    engine_make: { name: "car", layout: "four", displacement: 2.0, aspiration: "turbo", fuel: "petrol", idle: 850, limit: 7200, character: "raspy" },
    driving_sounds_make: {},
  };
}
