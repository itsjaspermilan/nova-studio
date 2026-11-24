// Fernhollow's road network as road_make builds it (scripts/lib/roadnet.mjs), shared by the recipes: terrain.mjs makes the model and
// the junctions' data from it, scene.mjs places everything beside the roads by its real outline (junction patches, fillets, aprons
// and the rounded ends included), so nothing stands on a road. The driveways (layout.mjs DRIVES) are part of it: the post office's leaves
// Post Road at a junction of its own; Hazel's and Pip's carry on from their lane's end; each ends in its gravel yard (a pad).
import { buildNetwork, surfaceIndex } from "../../../scripts/lib/roadnet.mjs";
import { centreline } from "../../../scripts/lib/trackgen.mjs";
import { DECK_ENDS, DRIVES, ROADS, xz } from "./layout.mjs";

// (road_make's cross-section is 12 m with its verges; the surface itself is about two thirds of it, so the width is scaled up)
// (every road is gravel since the owner's ninth notes; asphalt's proportion is kept for a road that may be tarmac again)
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

// The gravel's colours, linear (sRGB 184, 167, 138 the carriageway; 168, 156, 122 its edge; 138, 156, 90 the verge, near the meadow's)
export const GRAVEL = { road: [0.479, 0.386, 0.254], edge: [0.392, 0.332, 0.195], verge: [0.254, 0.335, 0.102] };

export const NETWORK = {
  roads: [
    ...ROADS.map((r) => ({ id: r.id, control: r.control.map(xz), road: r.surface, width: whole(r) })),
    ...DRIVES.map((d) => ({ id: d.id, control: driveControl(d).map(xz), road: "road_gravel", width: whole({ width: d.width, surface: "road_gravel" }), ...(d.kerb ? { kerb: d.kerb } : {}) })),
  ],
  // the drives' yards: round gravel turning spaces (their `radius` the carriageway's; the verge round it)
  pads: DRIVES.map((d) => ({ id: `${d.id}_yard`, at: xz(d.yard.at), radius: d.yard.radius, road: "road_gravel", width: whole({ width: d.width, surface: "road_gravel" }) })),
  // (Kettle Creek Road stops where the bridge's deck starts: layout.mjs DECK_ENDS)
  gaps: [{ road: "kettle_creek_road", from: xz(DECK_ENDS.a), to: xz(DECK_ENDS.b) }],
  // every road is gravel (the owner's ninth notes: "All roads should just be gravel honestly"): a warm, light gravel, its edge band a little
  // darker (no pale stripe), its verge a soft olive going into the meadow; textures/road.png's gravel column (surface_make, gravel
  // "soft": terrain.mjs) adds the crown, the stones, the patchy wheel paths and the grass creeping in
  colours: { road_gravel: { road: GRAVEL.road, line: GRAVEL.edge, verge: GRAVEL.verge } },
  // (the lanes' junctions keep the generous 6 m corners they had as tarmac; the post office's short drive has 3.6 m ones, `kerb` on it, so
  // its yard can be close to the building)
  kerb: { road_gravel: 6 },
  // (an even picture: a junction's patch carries the through road's gravel on, mirrored, instead of blending two roads' pictures, which
  // drew the stones out into streaks; and a narrow road's picture runs faster along it, so its stones stay round)
  even: true,
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
