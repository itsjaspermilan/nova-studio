// The cast, from character3d_make's chibi animal people: a squashed round head with the face painted on it (the expressions are
// painted drawings the game swaps: lib/face.lua), a small round body, stubby limbs whose round tops sit in the body (a shoulder and a
// hip that never open), trousers, in the game's flat warm colours, each with one thing that says what they do. Clips: idle, walk,
// run, trot, carry (laid over the arms while a parcel is held), talk (a gesture with each phrase) and work (busy hands: Hazel's saw,
// Pip's knobs).
import { tool } from "./lib.mjs";
import { CAST } from "./palette.mjs";

// the postmaster: a fox in a marigold knitted cardigan over a cream shirt, denim trousers, a tomato-red bucket hat with an envelope pin,
// a teal neckerchief, an envelope patch on the chest (the owner's sixth notes: no messenger bag, nothing like a police uniform; then
// "the colour scheme for the player seems a little drab": of three brighter outfits pictured in the valley, by the blue van and close,
// this one reads best: the marigold pops off the grass and the grey road and is not the fox's own orange, the denim legs read against
// the road and the fur, the tomato hat matches the van's red band, and the teal neckerchief is one bright accent; a teal hat sank into
// the grass at the game's distance and teal trousers did too; docs/games/mountain-post.md)
tool("character3d_make", { name: "postmaster", species: "fox", build: "chibi", head_scale: 1.75, outfit: "cardigan", outfit_color: CAST.marigold, trim_color: CAST.denim, shoe_color: CAST.boot, hat: "bucket", hat_color: CAST.tomato, hat_pin: "envelope", emblem: "envelope", accessory: "scarf", accent_color: CAST.tealBright });
// Hazel Brock: a bear, retired carpenter: a warm rust work shirt, olive trousers, a canvas apron with a pencil in its pocket
tool("character3d_make", { name: "hazel", species: "bear", build: "chibi", head_scale: 1.75, outfit: "shirt", outfit_color: CAST.hazelShirt, trim_color: CAST.hazelTrousers, accessory: "apron" });
// Pip Tansy: a young rabbit with a radio station: a sunny vest with a bolt on it, bright blue trousers, red headphones
tool("character3d_make", { name: "pip", species: "rabbit", build: "chibi", head_scale: 1.75, outfit: "vest", outfit_color: CAST.pipVest, trim_color: CAST.pipTrousers, accessory: "headphones", emblem: "bolt" });
tool("model_preview", { names: ["postmaster", "hazel", "pip"], fit: "each", yaw: 35, pitch: 12, width: 400, height: 520, image_out: "build/look/cast.png" });
tool("model_preview", { names: ["postmaster", "hazel", "pip"], fit: "each", yaw: 200, pitch: 12, width: 400, height: 520, image_out: "build/look/cast-back.png" });

// the longer, calmer strides of the walk, run and trot (the owner, after the second play): tools/strides.mjs
import { longStrides } from "./strides.mjs";
longStrides();
