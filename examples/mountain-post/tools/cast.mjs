// The cast, from character3d_make's chibi animal people: a squashed round head with the face painted on it (the expressions are
// painted drawings the game swaps: lib/face.lua), a small round body, stubby limbs, in the game's flat warm colours, each with one
// thing that says what they do. Clips: idle, walk, run, trot, carry (laid over the arms while a parcel is held), talk (a gesture
// with each phrase) and work (busy hands: Hazel's saw, Pip's knobs).
import { tool } from "./lib.mjs";

// the postmaster: a fox in a blue postal jacket and a peaked cap, an envelope on the chest, a satchel across it
tool("character3d_make", { name: "postmaster", species: "fox", build: "chibi", head_scale: 1.75, outfit: "tunic", outfit_color: "#2f5fa6", trim_color: "#2b3448", shoe_color: "#3a2a22", hat: "peaked", accessory: "satchel", emblem: "envelope" });
// Hazel Brock: a bear, retired carpenter: a rust work shirt, old green trousers, a canvas apron with a pencil in its pocket
tool("character3d_make", { name: "hazel", species: "bear", build: "chibi", head_scale: 1.75, outfit: "shirt", outfit_color: "#b0623a", trim_color: "#4a5a3a", accessory: "apron" });
// Pip Tansy: a young rabbit with a radio station: a mustard vest with a bolt on it, blue trousers, red headphones
tool("character3d_make", { name: "pip", species: "rabbit", build: "chibi", head_scale: 1.75, outfit: "vest", outfit_color: "#e0a92a", trim_color: "#4a6a8a", accessory: "headphones", emblem: "bolt" });
tool("model_preview", { names: ["postmaster", "hazel", "pip"], fit: "each", yaw: 35, pitch: 12, width: 400, height: 520, image_out: "build/look/cast.png" });
tool("model_preview", { names: ["postmaster", "hazel", "pip"], fit: "each", yaw: 200, pitch: 12, width: 400, height: 520, image_out: "build/look/cast-back.png" });

// the longer, calmer strides of the walk, run and trot (the owner, after the second play): tools/strides.mjs
import { longStrides } from "./strides.mjs";
longStrides();
