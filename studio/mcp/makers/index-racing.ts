// The makers that came out of Pine Ridge Rally's scripts (scripts/rally), as tools any game can call: car_make (and the
// blueprint tracing tools), surface_make, road_make, land_make, engine_make, driving_sounds_make. Like the other makers they
// write ordinary files through the ordinary tools (model_write for models) and answer with a picture or a sound report.

import type { Host } from "./index";
import { CAR_OPTION_KEYS, CAR_TYPES, carType, carTypeSays, LIMITS, makeCar, type Car } from "./car";
import { registerTrace } from "./trace";
import { registerGround } from "./index-ground";
import { registerEngine } from "./index-engine";

type Args = Record<string, any>;
type Result = string | { text: string; images?: string[] };
const text = (r: Result) => (typeof r === "string" ? r : r.text);
const images = (r: Result) => (typeof r === "string" ? [] : (r.images ?? []));
const r2 = (v: number) => Math.round(v * 100) / 100;

/// The paint variants asked for: { "red": "#b3202a" } or { "red": { "paint": ..., "rim": ..., "accents": [...] } } -> <name>_red; a list -> <name>_2, <name>_3.
function variantsOf(given: unknown, name: string): { name: string; o: Args }[] {
  if (given === undefined) return [];
  const one = (v: unknown, where: string): Args => {
    if (typeof v === "string") return { paint: v };
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const bad = Object.keys(v).filter((k) => !["paint", "rim", "accents", "trim"].includes(k));
      if (bad.length) throw new Error(`${where} has ${bad.join(", ")}; a paint variant takes paint, rim, accents, trim`);
      return v as Args;
    }
    throw new Error(`${where} is a colour or { "paint", "rim", "accents", "trim" }`);
  };
  if (Array.isArray(given)) return given.map((v, i) => ({ name: `${name}_${i + 2}`, o: one(v, `paints[${i}]`) }));
  if (given && typeof given === "object") return Object.entries(given).map(([k, v]) => ({ name: `${name}_${k.replace(/[^A-Za-z0-9_]/g, "_")}`, o: one(v, `paints.${k}`) }));
  throw new Error('paints is { "red": "#b3202a", ... } (named <name>_red) or a list of colours (<name>_2, <name>_3...)');
}

export function registerRacing(h: Host, SEED: unknown): Record<string, Args> {
  h.tool(
    "car_make",
    "Make a car as a studio model in one call: `models/<name>.model.json` and `.glb`, one smooth body (a subdivided cage, mirrored) with everything a real car has cut INTO its skin by the Cut-out modifier (glass, lamps, grilles, panel gaps, wheel openings) and only what is a separate piece on a real car as a separate shape (mirrors, bumpers, wings, wipers, exhausts), and four (six) wheels as parts named wheel_fl, wheel_fr, wheel_rl, wheel_rr (wheel_ml, wheel_mr) that a game turns and steers. Sizes in metres; the nose looks along +z; it stands on y = 0. " +
      `Two ways in. (1) \`type\`: ${CAR_TYPES.map((k) => `${k} (${carTypeSays(k)})`).join("; ")}. With nothing else it is exactly that car; the options reshape it as a whole (every point moves, the wheel openings stay round the wheels): \`length\`, \`width\`, \`height\`, \`wheelbase\` (axle to axle), \`wheel\` (the tyre's diameter), all metres, \`ride_height\` (metres added under the body, -0.06 to 0.2); each is clamped where the parts stop fitting (length ${LIMITS.length.join(" to ")} times the car's own, width ${LIMITS.width.join(" to ")}, height ${LIMITS.height.join(" to ")}, wheelbase ${LIMITS.wheelbase.join(" to ")}, wheel ${LIMITS.wheel.join(" to ")}), and the answer says when. \`wheelbase\` follows \`length\` when left out. ` +
      "`paint`, `rim`, `trim` (\"chrome\", \"black\", \"body\" or a colour: the window frames and pillars), `accents` (the rally coupe's two stripe colours), and style switches: `spoiler` (false takes it off; true adds a lip spoiler to a boot or a roof spoiler over a hatch), `flares` (false takes them off; true or \"black\" adds black ones, \"paint\" a wide body in the paint), `roof_rails`, `bed` (\"open\" or \"cover\", the pickup's). A `seed` other than 1 is a visibly different car of the type: another paint, other rims, the proportions a few per cent apart. " +
      "(2) `spec`: the whole car written out as the car files build one (the kit's body curves, then cut-outs, then pieces), for tracing a blueprint with blueprint_trace; docs/mcp.md shows one. " +
      "`paints`: the same car again in other paints in the same call, `{ \"red\": \"#b3202a\", \"white\": \"#e4e6e8\" }` (models <name>_red, <name>_white; a value may be { paint, rim, accents, trim }). " +
      "The answer gives the size, the wheel parts with their positions (metres from the origin) and the wheel radius, where the rear lamps are (for brake lights), the triangles, and a picture from the front three-quarter, the rear three-quarter and the side (and every paint side by side). The model is an ordinary one afterwards: read the .model.json, change it, give it to model_write.",
    {
      name: { type: "string", description: 'The model\'s name ("car").' },
      type: { type: "string", description: CAR_TYPES.join(", ") },
      spec: { type: "object", description: "The whole car as data (see docs/mcp.md, car_make): { paint, body, wheels, arches, cuts, pieces, tail }." },
      paint: { type: "string", description: '"#rrggbb" or a colour word (red, blue, white, black, grey, silver, yellow, orange, green, sand...).' },
      paints: { type: ["object", "array"], description: 'More models in other paints: { "red": "#b3202a" } -> <name>_red, or a list of colours -> <name>_2...' },
      rim: { type: "string", description: "The wheels' rims." },
      trim: { type: "string", description: '"chrome", "black", "body" or a colour: window frames, pillars.' },
      accents: { type: "array", items: { type: "string" }, description: "rally_coupe: the livery's two stripe colours." },
      length: { type: "number", description: "Metres, nose to tail." },
      width: { type: "number", description: "Metres, the widest point." },
      height: { type: "number", description: "Metres, the ground to the roof." },
      wheelbase: { type: "number", description: "Metres from the front axle to the rear one." },
      wheel: { type: "number", description: "The tyre's diameter in metres." },
      ride_height: { type: "number", description: "Metres added under the body (-0.06 to 0.2; 0 when left out)." },
      spoiler: { type: "boolean" },
      flares: { type: ["boolean", "string"], description: 'false, true or "black", "paint", or a colour.' },
      roof_rails: { type: "boolean" },
      bed: { type: "string", description: 'crew_cab_pickup: "open" or "cover".' },
      preview: { type: "boolean", description: "false: no pictures (quicker, for scripts that make many)." },
      seed: SEED,
    },
    ["name"],
    (a) => {
      const name = h.safeName(a.name, "Model");
      if (a.type === undefined && a.spec === undefined) throw new Error(`say what to make: \`type\` (${CAR_TYPES.join(", ")}) or the whole \`spec\``);
      if (a.type !== undefined && a.spec !== undefined) throw new Error("give `type` (and options) or `spec`, not both");
      const opts: Args = {};
      for (const k of CAR_OPTION_KEYS) if (a[k] !== undefined) opts[k] = a[k];
      if (a.type !== undefined) opts.type = carType(a.type);
      const made: { name: string; car: Car; wrote: string }[] = [];
      const write = (n: string, o: Args) => {
        const car = makeCar(o);
        const wrote = text(h.call("model_write", { project: a.project, name: n, model: car.model }));
        made.push({ name: n, car, wrote });
      };
      write(name, opts);
      for (const v of variantsOf(a.paints, name)) write(h.safeName(v.name, "Model"), { ...opts, ...v.o });
      const car = made[0]!.car;
      const tris = (w: string) => /(\d+) triangles/.exec(w)?.[1] ?? "?";
      const shown = a.preview !== false;
      const sheet = shown ? h.call("model_preview", { project: a.project, name, views: [35, 215, "side"], width: 640, height: 360, distance: r2(made[0]!.car.length * 2.2 + 1.5) }) : "";
      const all = shown && made.length > 1 ? h.call("model_preview", { project: a.project, names: made.map((m) => m.name), yaw: 35, pitch: 14 }) : null;
      const lines = [
        `models/${name}.model.json and .glb: ${car.type ? `${/^([aeiou]|suv)/.test(car.type) ? "an" : "a"} ${car.type === "suv" ? "SUV" : car.type.replace(/_/g, " ")}` : "a car from its spec"}, ${car.length} m long, ${car.width} m wide, ${car.height} m high, wheelbase ${car.wheelbase} m, track ${car.track} m; ${tris(made[0]!.wrote)} triangles`,
        `wheels (parts; metres from the origin, which is on the ground under the middle of the car): ${car.wheels.map((w) => `${w.name} at x ${w.x}, y ${w.y}, z ${w.z}`).join("; ")}; wheel radius ${car.wheelRadius} m`,
        `rear lamps: x ±${car.tail.x}, y ${car.tail.y}, z ${car.tail.z} (metres; for brake lights)`,
        ...car.says,
        ...made.slice(1).map((m) => `models/${m.name}.model.json and .glb: the same in another paint (${tris(m.wrote)} triangles)`),
        `in Lua: nova.model("${name}", x, y, z, { ry = heading, parts = { wheel_fl = { rx = spin, ry = steer }, wheel_fr = { rx = spin, ry = steer }, wheel_rl = { rx = spin }, wheel_rr = { rx = spin } } }) (spin in radians: distance / ${car.wheelRadius})`,
        shown ? `pictures: front three-quarter, rear three-quarter, side${all ? "; then every paint" : ""}` : "(no pictures: preview false)",
      ];
      return { text: lines.join("\n"), images: [...images(sheet), ...(all ? images(all) : [])] };
    },
  );

  const examples: Record<string, Args> = {
    car_make: { name: "car", type: "coupe_90s", paint: "#1f4fa8", paints: { white: "#e4e6e8" } },
  };
  Object.assign(examples, registerTrace(h), registerGround(h, SEED), registerEngine(h, SEED));
  return examples;
}
