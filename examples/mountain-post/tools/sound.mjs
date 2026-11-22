// The van's engine and the driving sounds (engine_make, driving_sounds_make). The effects, the voices, the ambience and the song are
// in sfx.mjs and music.mjs.
import { tool } from "./lib.mjs";

// a small, soft, slightly rattly engine: an old little three-cylinder, not revved hard (the van tops out at about 63 km/h)
console.log(tool("engine_make", { name: "van", layout: "three", displacement: 1.0, aspiration: "none", fuel: "petrol", idle: 820, limit: 5200, character: "smooth", seed: 2 }));
console.log(tool("driving_sounds_make", { report: true }));
