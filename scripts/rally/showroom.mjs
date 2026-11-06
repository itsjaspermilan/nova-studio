// The backdrop of the title, menu and results screens: a bit of road with the start arch, the pit tower, trees and barriers,
// and a car on show (the show_car entity, which wears the car the player picked). Written as scene files with the Nova MCP server's `scene_write`, like the circuits.
import { withServer } from "./mcp.mjs";

const o = (kind, x, z, ry = 0, props = {}) => ({ kind, x, y: 0, z, ...(ry || Object.keys(props).length ? { props: { ...(ry ? { ry } : {}), ...props } } : {}) });

function showroom() {
  const objects = [];
  for (let z = -40; z <= 40; z += 5) objects.push(o("road_asphalt", 0, z));
  objects.push(o("start_arch", 0, 24));
  objects.push(o("tower", -17, 14, Math.PI / 2));
  for (const side of [-1, 1]) {
    for (let z = -35; z <= 35; z += 6) objects.push(o("guardrail", side * 8.4, z));
    // (the trees, cacti and rocks beside the road are drawn by lib/backdrop.lua, dressed like the chosen circuit)
  }
  objects.push(o("tires", 9.5, -12), o("tires", 9.5, -12.8), o("hay_bale", -9.5, -6, 0.2), o("hay_bale", -9.8, -3.5, -0.1), o("sign_chevron", 9.2, 8, Math.PI));
  objects.push(o("show_car", 0, 0, 0));
  return {
    version: 1,
    background: [138, 182, 224],
    camera: { eye: [7, 2.6, 8], target: [0, 1, 0], fov: 50 },
    objects,
  };
}

await withServer(async (nova) => {
  console.log(await nova.call("scene_write", { name: "title", scene: showroom() }));
  console.log(await nova.call("scene_write", { name: "results", scene: showroom() }));
});
