// Fernhollow's road network as road_make builds it (scripts/lib/roadnet.mjs), shared by the recipes: terrain.mjs makes the model and
// the junctions' data from it, scene.mjs places everything beside the roads by its real outline (junction patches, fillets, aprons
// and the rounded ends included), so nothing stands on a road.
import { buildNetwork, surfaceIndex } from "../../../scripts/lib/roadnet.mjs";
import { DECK_ENDS, ROADS, xz } from "./layout.mjs";

// (road_make's cross-section is 12 m with its verges; the surface itself is about two thirds of it, so the width is scaled up)
const whole = (r) => Math.round((r.width * 12) / (r.surface === "road_asphalt" ? 8.3 : 7.6) * 10) / 10;
export const NETWORK = {
  roads: ROADS.map((r) => ({ id: r.id, control: r.control.map(xz), road: r.surface, width: whole(r) })),
  // (Kettle Creek Road stops where the bridge's deck starts: layout.mjs DECK_ENDS)
  gaps: [{ road: "kettle_creek_road", from: xz(DECK_ENDS.a), to: xz(DECK_ENDS.b) }],
};

let built = null;
/// The network (its mesh and junctions) and where its surface is, in metres east and north (E, N) like layout.mjs: `clearance(en)`
/// from the surface's outer edge (negative on it) and `away(en)`, the way off it.
export function roads() {
  if (!built) {
    const net = buildNetwork(NETWORK), s = surfaceIndex(net.mesh);
    built = {
      net,
      clearance: ([e, n]) => s.clearance(-e, n),
      away: ([e, n]) => { const [x, z] = s.away(-e, n); return [-x, z]; },
    };
  }
  return built;
}

/// A point moved off the road (along the way off it) until it is `clear` metres from the surface's edge; a point already that far
/// stays where it is.
export function offRoad(en, clear) {
  const { clearance, away } = roads();
  let p = [...en];
  for (let k = 0; k < 40; k++) {
    const c = clearance(p);
    if (c >= clear - 0.01) break;
    const d = away(p), step = Math.max(0.05, clear - c);
    p = [p[0] + d[0] * step, p[1] + d[1] * step];
  }
  return p;
}
