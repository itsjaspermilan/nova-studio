// engine_make's recipe: a layout, a displacement, aspiration, fuel, idle and limit, a character -> an engine spec for engine.mjs (the engine model
// first made for Pine Ridge Rally) and the profile nova.engine_sound plays it with. The recipe starts from the nearest of the twelve engines
// modelled for that game, and moves it: a bigger engine has longer pipes (its resonances lower by the cube root of the displacement ratio),
// a turbine softens the exhaust, a raspy engine has a sharper pulse and a freer pipe, a burbly one unequal cylinders and a lumpy idle. The
// recipe of one of those twelve with nothing changed is exactly that engine, with that game's seeds, so it writes the same bytes.

// @ts-ignore (plain JavaScript)
import { bandRpm, ENGINES, firingHz, mixer, RPM_PER_CYCLE } from "./engine.mjs";

type Args = Record<string, any>;

export const LAYOUTS = ["three", "four", "five", "six", "v6", "v8"] as const;
export const ASPIRATIONS = ["none", "turbo", "twin"] as const;
export const FUELS = ["petrol", "diesel"] as const;
export const CHARACTERS = ["smooth", "raspy", "burbly"] as const;

/// The twelve engines: what each is, its first seed (Pine Ridge Rally numbered the bands of all its engines in one run), and the profile
/// lib/audio.lua plays it with (the same fields nova.engine_sound takes).
const BASES: Record<string, { layout: string; disp: number; asp: string; fuel: string; character: string; seed: number; says: string; profile: Args }> = {
  car_gt: { layout: "six", disp: 3.0, asp: "turbo", fuel: "petrol", character: "smooth", seed: 12, says: "a 3.0 turbo straight six", profile: { rise: 26, fall: 18, load_rise: 30, load_fall: 22, gain: 1.0, quiet: 0.4, off: 0.5, wander: 0.002, limiter: "cut", shift: "quick", shift_cut: 0.07, shift_volume: 0.5, turbo: { level: 1.0, lo: 0.7, hi: 1.15, from: 1400, full: 3200 }, bov: 0.8, pops: 0.7 } },
  car_offroad: { layout: "six", disp: 4.2, asp: "none", fuel: "diesel", character: "smooth", seed: 19, says: "a 4.2 straight-six diesel", profile: { rise: 7, fall: 5, load_rise: 9, load_fall: 7, gain: 1.0, quiet: 0.6, off: 0.7, wander: 0.006, limiter: "governor", shift: "clunk", shift_cut: 0.34, shift_volume: 0.6, whine: 0.1 } },
  car_s15: { layout: "four", disp: 2.0, asp: "turbo", fuel: "petrol", character: "smooth", seed: 25, says: "a 2.0 turbo four", profile: { rise: 24, fall: 17, load_rise: 28, load_fall: 20, gain: 0.95, quiet: 0.4, off: 0.5, wander: 0.003, limiter: "cut", shift: "stick", shift_cut: 0.14, shift_volume: 0.55, turbo: { level: 1.0, lo: 0.8, hi: 1.25, from: 2200, full: 4000 }, bov: 1.0, pops: 0.3 } },
  car_hatch_r: { layout: "four", disp: 2.0, asp: "turbo", fuel: "petrol", character: "raspy", seed: 32, says: "a hard-edged 2.0 turbo four", profile: { rise: 26, fall: 19, load_rise: 30, load_fall: 22, gain: 1.0, quiet: 0.4, off: 0.55, wander: 0.002, limiter: "cut", shift: "quick", shift_cut: 0.1, shift_volume: 0.5, turbo: { level: 0.8, lo: 0.75, hi: 1.2, from: 1600, full: 3200 }, bov: 0.7, pops: 1.0 } },
  car_hatch: { layout: "four", disp: 2.0, asp: "none", fuel: "petrol", character: "smooth", seed: 39, says: "a quiet 2.0 four", profile: { rise: 18, fall: 13, load_rise: 22, load_fall: 16, gain: 0.7, quiet: 0.35, off: 0.45, wander: 0.002, limiter: "soft", shift: "stick", shift_cut: 0.18, shift_volume: 0.45 } },
  car_city: { layout: "three", disp: 0.8, asp: "none", fuel: "petrol", character: "smooth", seed: 45, says: "a 0.8 three", profile: { rise: 20, fall: 14, load_rise: 24, load_fall: 18, gain: 0.7, quiet: 0.45, off: 0.5, wander: 0.004, limiter: "soft", shift: "stick", shift_cut: 0.22, shift_volume: 0.45 } },
  car_rally: { layout: "four", disp: 2.4, asp: "none", fuel: "petrol", character: "raspy", seed: 51, says: "a 2.4 four on open carburettors", profile: { rise: 30, fall: 22, load_rise: 34, load_fall: 24, gain: 1.1, quiet: 0.45, off: 0.6, wander: 0.004, limiter: "cut", shift: "stick", shift_cut: 0.13, shift_volume: 0.6, pops: 0.6 } },
  car_gt2: { layout: "five", disp: 2.5, asp: "turbo", fuel: "petrol", character: "raspy", seed: 57, says: "a 2.5 turbo five with a racing exhaust", profile: { rise: 32, fall: 24, load_rise: 34, load_fall: 26, gain: 1.1, quiet: 0.5, off: 0.6, wander: 0.005, limiter: "cut", shift: "quick", shift_cut: 0.05, shift_volume: 0.6, turbo: { level: 1.0, lo: 0.7, hi: 1.15, from: 2500, full: 4500 }, bov: 1.0, pops: 1.0 } },
  car_muscle: { layout: "v8", disp: 5.6, asp: "none", fuel: "petrol", character: "burbly", seed: 63, says: "a 5.6 cross-plane V8", profile: { rise: 14, fall: 9, load_rise: 16, load_fall: 11, gain: 1.1, quiet: 0.55, off: 0.65, wander: 0.007, limiter: "soft", shift: "clunk", shift_cut: 0.26, shift_volume: 0.55 } },
  car_suv: { layout: "four", disp: 2.8, asp: "turbo", fuel: "diesel", character: "smooth", seed: 69, says: "a 2.8 turbo-diesel four", profile: { rise: 10, fall: 7, load_rise: 12, load_fall: 9, gain: 0.85, quiet: 0.5, off: 0.65, wander: 0.004, limiter: "governor", shift: "stick", shift_cut: 0.2, shift_volume: 0.4, turbo: { level: 0.45, lo: 0.65, hi: 1.0, from: 1200, full: 2400 } } },
  car_truck: { layout: "six", disp: 7.2, asp: "turbo", fuel: "diesel", character: "smooth", seed: 75, says: "a 7.2 turbo-diesel six", profile: { rise: 5, fall: 3.5, load_rise: 7, load_fall: 5, gain: 1.05, quiet: 0.65, off: 0.75, wander: 0.006, limiter: "governor", shift: "clunk", shift_cut: 0.38, shift_volume: 0.7, turbo: { level: 0.5, lo: 0.55, hi: 0.9, from: 900, full: 1700 }, whine: 0.1 } },
  car_pickup: { layout: "v6", disp: 3.4, asp: "twin", fuel: "petrol", character: "smooth", seed: 80, says: "a 3.4 twin-turbo V6", profile: { rise: 16, fall: 11, load_rise: 20, load_fall: 14, gain: 0.95, quiet: 0.45, off: 0.55, wander: 0.003, limiter: "soft", shift: "quick", shift_cut: 0.1, shift_volume: 0.4, turbo: { level: 0.6, lo: 0.8, hi: 1.2, from: 1500, full: 3000 }, bov: 0.4 } },
};
export const ENGINE_BASES = Object.keys(BASES);

const turboOf = (a: string) => (a === "none" ? "none" : "turbo");
/// The base nearest a recipe: the layout first, then the fuel, then a turbo or not, then the character; the displacement breaks ties.
function nearest(r: { layout: string; fuel: string; asp: string; character?: string; disp?: number }): string {
  let best = "", score = -Infinity;
  for (const [id, b] of Object.entries(BASES)) {
    const s = (b.layout === r.layout ? 1000 : (r.layout === "v6" && b.layout === "six") || (r.layout === "six" && b.layout === "v6") ? 300 : 0) + (b.fuel === r.fuel ? 100 : 0) + (b.asp === r.asp ? 20 : turboOf(b.asp) === turboOf(r.asp) ? 15 : 0) + (r.character === undefined || b.character === r.character ? 8 : 0) - Math.abs(Math.log((r.disp ?? b.disp) / b.disp));
    if (s > score) [best, score] = [id, s];
  }
  return best;
}

const LAYOUT_OF: Record<string, Args> = {
  three: { order: [1, 2, 3] }, four: { order: [1, 3, 4, 2] }, five: { order: [1, 2, 4, 5, 3] }, six: { order: [1, 5, 3, 6, 2, 4] },
  v6: { order: [1, 4, 2, 5, 3, 6], banks: [0, 0, 0, 1, 1, 1] }, v8: { order: [1, 8, 4, 3, 6, 5, 7, 2], banks: [0, 1, 0, 1, 0, 1, 0, 1] },
};

/// Bands from idle to the limit: engine cycles to 65536 samples, an even number from 16 up (those files are half a loop).
export function bandsFor(idle: number, max: number): number[] {
  const n = Math.max(5, Math.min(7, Math.round(Math.log(max / idle) / Math.log(1.45)) + 1));
  const c0 = idle * 0.97 / RPM_PER_CYCLE, c1 = max / RPM_PER_CYCLE, out: number[] = [];
  for (let i = 0; i < n; i++) {
    let c = Math.round(c0 * (c1 / c0) ** (i / (n - 1)));
    if (c >= 16 && c % 2) c += 1;
    if (out.length && c <= out[out.length - 1]!) c = out[out.length - 1]! + (c >= 16 ? 2 : 1);
    out.push(c);
  }
  return out;
}

export interface Engine {
  base: string;
  spec: Args;
  profile: Args;
  seed: number;
  /// What changed from the base, in words.
  says: string[];
  recipe: { layout: string; displacement: number; aspiration: string; fuel: string; idle: number; limit: number; character: string };
}

function choiceOf<T extends string>(v: unknown, list: readonly T[], what: string): T | undefined {
  if (v === undefined) return undefined;
  const s = String(v).toLowerCase().replace(/[\s-]+/g, "_");
  const alias: Record<string, string> = { straight_six: "six", inline_six: "six", i6: "six", i4: "four", inline_four: "four", i3: "three", i5: "five", cross_plane_v8: "v8", v_8: "v8", v_6: "v6", twin_turbo: "twin", na: "none", natural: "none", gasoline: "petrol", gas: "petrol", burble: "burbly" };
  const k = (alias[s] ?? s) as T;
  if (!list.includes(k)) throw new Error(`${what} is ${list.join(", ")}, not ${JSON.stringify(v)}`);
  return k;
}

export function makeEngine(a: Args): Engine {
  const layout = choiceOf(a.layout, LAYOUTS, "layout") ?? "four";
  const fuel = choiceOf(a.fuel, FUELS, "fuel") ?? "petrol";
  const asp = choiceOf(a.aspiration, ASPIRATIONS, "aspiration") ?? (fuel === "diesel" ? "turbo" : "none");
  const character = choiceOf(a.character, CHARACTERS, "character");
  const disp = a.displacement === undefined ? undefined : Math.max(0.6, Math.min(9, Number(a.displacement)));
  const id = nearest({ layout, fuel, asp, character, disp });
  const B = BASES[id]!, base = ENGINES[id];
  const says: string[] = [];
  // a copy of the base spec that can be changed without touching it
  const spec: Args = { ...base, layout: base.layout, cylGain: [...base.cylGain], cylDelay: [...base.cylDelay], exhaust: { ...base.exhaust, res: base.exhaust.res.map((r: number[]) => [...r]) }, intake: { ...base.intake, res: base.intake.res.map((r: number[]) => [...r]) }, block: { ...base.block, res: base.block.res.map((r: number[]) => [...r]) }, valves: { ...base.valves }, flow: { ...base.flow }, ...(base.fan ? { fan: { ...base.fan } } : {}) };
  let mix: Args = { ...base.mix.params };
  const profile: Args = JSON.parse(JSON.stringify(B.profile));
  // another layout than the base's (a V6 from a six, a six from a V6): the firing order and banks of the recipe
  if (layout !== B.layout) {
    const L = LAYOUT_OF[layout]!, n = L.order.length;
    spec.layout = L;
    const g = (i: number) => base.cylGain[i % base.cylGain.length], d = (i: number) => base.cylDelay[i % base.cylDelay.length];
    spec.cylGain = Array.from({ length: n }, (_, i) => g(i));
    spec.cylDelay = Array.from({ length: n }, (_, i) => d(i));
    if (L.banks) { spec.bankGain = base.bankGain ?? [1, 0.8]; spec.bankDelay = base.bankDelay ?? [0, 0.5]; spec.bankTune = base.bankTune ?? [1, 1.06]; }
    else { delete spec.bankGain; delete spec.bankDelay; delete spec.bankTune; delete spec.crowd; }
    says.push(`a ${layout} built on the ${B.says}`);
  }
  // the displacement: longer pipes, a bigger block, lower resonances
  if (disp !== undefined && Math.abs(disp - B.disp) > 1e-6) {
    const k = (B.disp / disp) ** (1 / 3), kb = Math.sqrt(k);
    for (const part of ["exhaust", "intake"]) spec[part].res = spec[part].res.map(([f, q, s]: number[]) => [Math.round(f! * k), q, s]);
    spec.block.res = spec.block.res.map(([f, q, s]: number[]) => [Math.round(f! * kb), q, s]);
    spec.exhaust.silencer = Math.round(spec.exhaust.silencer * k);
    spec.intake.top = Math.round(spec.intake.top * k);
    spec.flow.centre = Math.round(spec.flow.centre * k);
    if (spec.fan) spec.fan.centre = Math.round(spec.fan.centre * k);
    spec.tone = Math.round(spec.tone * kb);
    says.push(`${disp} litres where the base has ${B.disp}: its resonances ${k > 1 ? "higher" : "lower"} by ${Math.abs(Math.round((k - 1) * 100))}%`);
  }
  // a turbo or not
  if (turboOf(asp) !== turboOf(B.asp)) {
    if (asp === "none") {
      spec.exhaust.silencer = Math.round(spec.exhaust.silencer * 1.2);
      spec.exhaust.src = [spec.exhaust.src[0] * 1.06, spec.exhaust.src[1]];
      delete profile.turbo; delete profile.bov;
      says.push("no turbo: a freer exhaust");
    } else {
      spec.exhaust.silencer = Math.round(spec.exhaust.silencer * 0.8);
      spec.exhaust.direct = spec.exhaust.direct * 0.92;
      mix.crackle = (mix.crackle ?? 0) * 0.7;
      says.push("a turbo: the turbine softens the exhaust");
    }
  }
  if (asp !== "none" && !profile.turbo) profile.turbo = { level: fuel === "diesel" ? 0.5 : 0.8, lo: 0.75, hi: asp === "twin" ? 1.15 : 1.2, from: 0, full: 0 };
  if (asp !== "none" && fuel === "petrol" && profile.bov === undefined) profile.bov = 0.7;
  // the character, when it is not the base's own
  if (character && character !== B.character) {
    const dev = (f: number) => spec.cylGain.map((g: number) => Math.max(0.4, Math.min(1, 1 - (1 - g) * f)));
    if (character === "raspy") {
      spec.exhaust.src = [spec.exhaust.src[0] * 1.2, spec.exhaust.src[1] * 1.1]; spec.exhaust.silencer = Math.round(spec.exhaust.silencer * 1.3); spec.intake.direct = spec.intake.direct * 1.4; spec.tone = Math.round(spec.tone * 1.25);
      mix.intake = [mix.intake[0] * 1.3, mix.intake[1] * 1.3]; mix.crackle = (mix.crackle ?? 0) + 0.15; spec.burble = spec.burble + 0.15;
      profile.pops = Math.max(profile.pops ?? 0, 0.6); profile.limiter = fuel === "diesel" ? "governor" : "cut";
    } else if (character === "smooth") {
      spec.exhaust.src = [spec.exhaust.src[0] * 0.88, spec.exhaust.src[1]]; spec.exhaust.silencer = Math.round(spec.exhaust.silencer * 0.8); spec.tone = Math.round(spec.tone * 0.85);
      spec.cylGain = dev(0.5); mix.crackle = (mix.crackle ?? 0) * 0.5; spec.burble = spec.burble * 0.6; spec.vary = spec.vary * 0.8;
      delete profile.pops; profile.limiter = fuel === "diesel" ? "governor" : "soft";
    } else {
      spec.cylGain = dev(1.6); spec.burble = spec.burble + 0.3; spec.vary = spec.vary * 1.4; spec.exhaust.direct = spec.exhaust.direct * 1.1;
      mix.crackle = (mix.crackle ?? 0) + 0.2; profile.pops = Math.max(profile.pops ?? 0, 0.5); profile.wander = profile.wander * 1.6;
    }
    says.push(`${character} where the base is ${B.character}`);
  }
  if (Object.keys(mix).some((k) => mix[k] !== base.mix.params[k])) spec.mix = mixer(mix);
  // idle and the limit: the bands from one to the other
  const idle = a.idle === undefined ? base.idle : Math.max(400, Math.min(2000, Math.round(Number(a.idle))));
  const limit = a.limit === undefined ? base.max : Math.max(idle * 2, Math.min(12000, Math.round(Number(a.limit))));
  if (idle !== base.idle || limit !== base.max) {
    spec.idle = idle; spec.max = limit; spec.cycles = bandsFor(idle, limit);
    says.push(`idle ${idle}, limit ${limit} rpm (the base: ${base.idle} to ${base.max})`);
  }
  if (profile.turbo && !profile.turbo.from) { profile.turbo.from = Math.round(spec.idle * 2); profile.turbo.full = Math.round(spec.idle * 4.2); }
  const seed = a.seed === undefined ? B.seed : Math.round(Number(a.seed)) * 101 + 7;
  return { base: id, spec, profile: { idle: spec.idle, max: spec.max, cycles: [...spec.cycles], ...profile }, seed, says, recipe: { layout, displacement: disp ?? B.disp, aspiration: asp, fuel, idle: spec.idle, limit: spec.max, character: character ?? B.character } };
}

/// The firing frequency of each band, Hz.
export const bandFiring = (e: Engine) => e.spec.cycles.map((c: number) => ({ cycles: c, rpm: Math.round(bandRpm(c)), hz: Math.round(firingHz(e.spec, bandRpm(c)) * 10) / 10 }));

/// The profile as the Lua table nova.engine_sound takes (written to engines/<name>.lua).
export function profileLua(name: string, e: Engine): string {
  const v = (x: unknown): string => (Array.isArray(x) ? `{ ${x.map(v).join(", ")} }` : x && typeof x === "object" ? `{ ${Object.entries(x).map(([k, y]) => `${k} = ${v(y)}`).join(", ")} }` : typeof x === "string" ? `"${x}"` : String(x));
  const p = e.profile, keys = ["idle", "max", "cycles", "rise", "fall", "load_rise", "load_fall", "gain", "quiet", "off", "wander", "limiter", "shift", "shift_cut", "shift_volume", "turbo", "bov", "pops", "whine"];
  const r = e.recipe;
  return `-- The engine "${name}" (engine_make): a ${r.displacement}-litre ${r.layout} ${r.fuel}${r.aspiration === "none" ? "" : r.aspiration === "twin" ? " twin-turbo" : " turbo"}, ${r.character}, idle ${r.idle} to ${r.limit} rpm.
-- Its loops are sounds/eng_${name}_<band>.wav (throttle down) and eng_${name}_off_<band>.wav (lifted); \`cycles\` are their bands (cycles x 80.75 rpm).
-- Play it with the runtime's library: local engine_sound = require("nova.engine_sound"); local e = engine_sound.new(require("engines.${name}"))
-- and every step e:update(dt, { rpm = rpm, throttle = 0..1, speed = metres a second, surface = "road" }). Change any number here.
return {
  sound = "${name}",
${keys.filter((k) => p[k] !== undefined).map((k) => `  ${k} = ${v(p[k])},`).join("\n")}
}
`;
}
