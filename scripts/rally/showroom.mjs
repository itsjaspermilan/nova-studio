// The backdrop of the title, menu and results screens: a bit of road with the start arch, the pit tower, trees and barriers,
// and a car on show (the show_car entity, which wears the car the player picked). Written as scene files with the Nova MCP server's `scene_write`, like the circuits.
import { withServer } from "./mcp.mjs";

const o = (kind, x, z, ry = 0, props = {}) => ({ kind, x, y: 0, z, ...(ry || Object.keys(props).length ? { props: { ...(ry ? { ry } : {}), ...props } } : {}) });

function showroom({ turn }) {
  const objects = [];
  for (let z = -40; z <= 40; z += 5) objects.push(o("road_asphalt", 0, z));
  objects.push(o("start_arch", 0, 24));
  objects.push(o("tower", -17, 14, Math.PI / 2));
  for (const side of [-1, 1]) {
    for (let z = -35; z <= 35; z += 6) objects.push(o("guardrail", side * 8.4, z));
    for (let i = 0; i < 18; i++) {
      const z = -48 + i * 5.2, d = 13 + ((i * 7) % 11);
      objects.push(o(i % 3 ? "pine" : "pine_dark", side * d, z + side, i * 0.7, { sx: 0.9 + ((i * 5) % 6) / 10 }));
      if (i % 4 === 0) objects.push(o("bush", side * (10.5 + (i % 3)), z + 2, i));
    }
  }
  objects.push(o("tires", 9.5, -12), o("tires", 9.5, -12.8), o("hay_bale", -9.5, -6, 0.2), o("hay_bale", -9.8, -3.5, -0.1), o("sign_chevron", 9.2, 8, Math.PI));
  objects.push(o("show_car", 0, 0, 0.6, { turn }));
  return {
    version: 1,
    background: [138, 182, 224],
    camera: { eye: [7, 2.6, 8], target: [0, 1, 0], fov: 50 },
    objects,
  };
}

await withServer(async (nova) => {
  console.log(await nova.call("scene_write", { name: "title", scene: showroom({ turn: 0.35 }) }));
  console.log(await nova.call("scene_write", { name: "results", scene: showroom({ turn: 0.2 }) }));
});
