// Fernhollow's road network as road_make builds it (scripts/lib/roadnet.mjs), shared by the recipes: terrain.mjs makes the model and
// the junctions' data from it, scene.mjs places everything beside the roads by its real outline (junction patches, fillets, aprons
// and the rounded ends included), so nothing stands on a road. The driveways (layout.mjs DRIVES) are part of it: the post office's leaves
// Post Road at a junction of its own; Hazel's and Pip's carry on from their lane's end; each ends in its gravel yard (a pad).
import { buildNetwork, surfaceIndex } from "../../../scripts/lib/roadnet.mjs";
import { centreline } from "../../../scripts/lib/trackgen.mjs";
import { DECK_ENDS, DRIVES, ROADS, xz } from "./layout.mjs";

// (road_make's cross-section is 12 m with its verges; the surface itself is about two thirds of it, so the width is scaled up)
const whole = (r) => Math.round((r.width * 12) / (r.surface === "road_asphalt" ? 8.3 : 7.6) * 10) / 10;

/// A drive's control points in metres east and north: one that leaves a road (`from`) starts exactly on that road's middle line, at
/// the point of it nearest its first given point.
export function driveControl(d) {
  if (!d.from) return d.control;
  const r = ROADS.find((q) => q.id === d.from);
  const line = centreline(r.control, 0.5, true);
  let best = null;
  for (const p of line) { const dd = Math.hypot(p.x - d.control[0][0], p.z - d.control[0][1]); if (!best || dd < best.d) best = { d: dd, p: [p.x, p.z] }; }
  return [best.p.map((v) => Math.round(v * 100) / 100), ...d.control.slice(1)];
}

export const NETWORK = {
  roads: [
    ...ROADS.map((r) => ({ id: r.id, control: r.control.map(xz), road: r.surface, width: whole(r) })),
    ...DRIVES.map((d) => ({ id: d.id, control: driveControl(d).map(xz), road: "road_gravel", width: whole({ width: d.width, surface: "road_gravel" }) })),
  ],
  // the drives' yards: round gravel turning spaces (their `radius` the carriageway's; the verge round it)
  pads: DRIVES.map((d) => ({ id: `${d.id}_yard`, at: xz(d.yard.at), radius: d.yard.radius, road: "road_gravel", width: whole({ width: d.width, surface: "road_gravel" }) })),
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
