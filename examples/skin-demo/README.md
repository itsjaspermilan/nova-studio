# Skin demo

Two figures walk on the spot while the camera drifts round them. Both play the same `walk` clip made in the model editor
(Animate); the one on the left has **skinned** limbs (each arm and leg is a mesh with rings of points across the elbow or
knee, and each point follows the parts around it), the one on the right is the same model written without that, so its limbs
stay stiff.

```sh
scripts/env.sh cargo run --release -p nova-runtime --bin nova -- run examples/skin-demo
```

Open `models/walker.model.json` in the studio and pick a limb: "Bend with parts" lists the parts it follows, and clicking one
paints every point from blue (not held by that part) to red (held completely).

`scripts/walker/build.mjs` makes the models and the scene through the Nova MCP server; `model_write` with `bend: true` gives the
limbs their automatic weights, as the editor's "Bend with the parts around it" button does.
