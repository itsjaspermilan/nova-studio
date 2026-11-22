// The cast, from character3d_make's animal people: big-headed, in the game's flat warm colours, each with idle, walk, run, carry
// (laid over the arms while a parcel is held), talk (a gesture with each phrase) and work (busy hands: Hazel's saw, Pip's knobs).
import { tool } from "./lib.mjs";

// the postmaster: a fox in a blue postal jacket and a peaked cap, a satchel across the chest
tool("character3d_make", { name: "postmaster", species: "fox", build: "child", head_scale: 1.7, outfit: "tunic", outfit_color: "#2f5fa6", trim_color: "#2b3448", shoe_color: "#3a2a22", hat: "peaked", accessory: "satchel" });
// Hazel Brock: a badger, retired carpenter: squat, a rust work shirt, old green trousers, round glasses
tool("character3d_make", { name: "hazel", species: "badger", build: "squat", head_scale: 1.7, outfit: "shirt", outfit_color: "#b0623a", trim_color: "#4a5a3a", accessory: "glasses" });
// Pip Tansy: a young rabbit with a radio station: a mustard vest, blue trousers, red headphones round his neck... on his ears
tool("character3d_make", { name: "pip", species: "rabbit", build: "child", head_scale: 1.7, outfit: "vest", outfit_color: "#e0a92a", trim_color: "#4a6a8a", accessory: "headphones" });
tool("model_preview", { names: ["postmaster", "hazel", "pip"], fit: "each", yaw: 35, pitch: 12, width: 400, height: 520, image_out: "build/look/cast.png" });
tool("model_preview", { names: ["postmaster", "hazel", "pip"], fit: "each", yaw: 200, pitch: 12, width: 400, height: 520, image_out: "build/look/cast-back.png" });
