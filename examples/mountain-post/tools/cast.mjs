// The cast, from character3d_make's chibi animal people: a squashed round head with the face painted on it (the expressions are
// painted drawings the game swaps: lib/face.lua), a small round body, stubby limbs whose round tops sit in the body (a shoulder and a
// hip that never open), trousers, in the game's flat warm colours, each with one thing that says what they do. Clips: idle, walk,
// run, trot, carry (laid over the arms while a parcel is held), talk (a gesture with each phrase) and work (busy hands: Hazel's saw,
// Pip's knobs).
import { tool } from "./lib.mjs";
import { CAST } from "./palette.mjs";

// the postmaster: a fox in a marigold knitted cardigan over a cream shirt, olive-brown cord trousers, a soft oatmeal postal cap with a
// deep teal band and peak and an envelope pin, a teal neckerchief, an envelope patch on the chest. (The owner's sixth notes: no
// messenger bag, nothing like a police uniform; then "a little drab"; then a red hat with blue near it was "too much like the
// Paddington colours"; then, at the eighth play, "I liked the post master cap that we had earlier. The bucket hat makes the character
// look like some kind of explorer". Of three caps pictured close and at the game's distance on the road and beside the blue van, the
// oatmeal crown reads best: it stands out against the grass, the road and the van where a soft teal crown ran into the neckerchief
// and the van's blue, and an olive band and peak looked khaki, the explorer again; docs/games/mountain-post.md)
tool("character3d_make", { name: "postmaster", species: "fox", build: "chibi", head_scale: 1.75, outfit: "cardigan", outfit_color: CAST.marigold, trim_color: CAST.cord, shoe_color: CAST.boot, hat: "peaked", hat_color: CAST.oatmeal, hat_band_color: CAST.tealDeep, hat_pin: "envelope", emblem: "envelope", accessory: "scarf", accent_color: CAST.tealBright });
// Hazel Brock: a bear, retired carpenter: a warm rust work shirt, olive trousers, a canvas apron with a pencil in its pocket
tool("character3d_make", { name: "hazel", species: "bear", build: "chibi", head_scale: 1.75, outfit: "shirt", outfit_color: CAST.hazelShirt, trim_color: CAST.hazelTrousers, accessory: "apron" });
// Pip Tansy: a young rabbit with a radio station: a sunny vest with a bolt on it, bright blue trousers, red headphones
tool("character3d_make", { name: "pip", species: "rabbit", build: "chibi", head_scale: 1.75, outfit: "vest", outfit_color: CAST.pipVest, trim_color: CAST.pipTrousers, accessory: "headphones", emblem: "bolt" });
tool("model_preview", { names: ["postmaster", "hazel", "pip"], fit: "each", yaw: 35, pitch: 12, width: 400, height: 520, image_out: "build/look/cast.png" });
tool("model_preview", { names: ["postmaster", "hazel", "pip"], fit: "each", yaw: 200, pitch: 12, width: 400, height: 520, image_out: "build/look/cast-back.png" });

// the longer, calmer strides of the walk, run and trot (the owner, after the second play): tools/strides.mjs
import { longStrides } from "./strides.mjs";
longStrides();
