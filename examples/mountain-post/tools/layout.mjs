// Fernhollow's piece of the valley, as data: the roads, the creek, the gorge, where each house and thing stands. Every other recipe
// reads it (terrain.mjs, scene.mjs, art.mjs). Written in metres east (E) and north (N) of the crossroads, because that is how a map is
// read; Nova's ground is x, z with +x to the LEFT of a viewer facing +z, so a point (E, N) is x = -E, z = N (`xz`).
//
// The plan (north up):
//
//              ~~~~~~~~~~~~ the gorge (the lake side beyond) ~~~~~~~~~~~~
//                    | BRIDGE OUT                              /
//                    |                         picnic        / Kettle Creek
//      overlook      |                                      |
//   No. 3 Hazel      | Post Road                       No. 7 Pip (mast)
//      \             |                  ___bridge______/
//       \ Fern Lane  +--- Kettle Creek Road ------/   |
//        \___________+                                |
//                    |                                 \
//              Post Office                              |
//
export const xz = ([e, n]) => [-e, n];
export const ry_facing = (de, dn) => Math.atan2(-de, dn); // the turn (ry) that faces a model's front along (dE, dN)

export const BOUNDS_EN = { e0: -250, e1: 250, n0: -265, n1: 300 };

// The roads, each from its start; elevations in metres along it (the terrain recipe holds the grade under 12 %).
export const ROADS = [
  {
    id: "post_road", name: "Post Road", surface: "road_asphalt", width: 6.4,
    control: [[8, -240], [4, -205], [0, -160], [-6, -110], [-9, -66], [-2, -18], [10, 24], [12, 62], [2, 108], [-14, 152], [-20, 190], [-20, 226]],
    profile: [[0, 4], [80, 4.5], [180, 9], [260, 8], [330, 9.5], [420, 15], [480, 15.5]],
  },
  {
    id: "fern_lane", name: "Fern Lane", surface: "road_gravel", width: 4.6,
    control: [[-9, -66], [-40, -78], [-78, -70], [-108, -46], [-124, -12], [-134, 18], [-148, 40]],
    profile: [[0, 8.5], [60, 11], [140, 19], [190, 22]],
  },
  {
    id: "kettle_creek_road", name: "Kettle Creek Road", surface: "road_gravel", width: 4.6,
    control: [[10, 24], [44, 26], [66, 38], [81.5, 46.7], [94.66, 51.49], [115.34, 59.01], [124.74, 62.43], [140, 66], [162, 84], [176, 102]],
    profile: [[0, 8.3], [40, 6], [68, 3.4], [114, 3.4], [200, 7]],
  },
];

// Where each road crosses the creek: the bridge (the road is cut there; the bridge's deck carries it).
export const BRIDGE = { a: [94.66, 51.49], b: [115.34, 59.01], deck: 3.4 + 0, width: 5.6 };
// Where the bridge's deck (22 m long, models.mjs, centred between a and b) ends: the road stops there with a threshold strip, and the
// bridge stands its deck level with the road at both.
export const DECK_ENDS = (() => {
  const d = [BRIDGE.b[0] - BRIDGE.a[0], BRIDGE.b[1] - BRIDGE.a[1]], l = Math.hypot(...d), over = (22 - l) / 2, u = [d[0] / l, d[1] / l];
  return { a: [BRIDGE.a[0] - u[0] * over, BRIDGE.a[1] - u[1] * over], b: [BRIDGE.b[0] + u[0] * over, BRIDGE.b[1] + u[1] * over] };
})();

// Kettle Creek, from the hills in the south-east down to the gorge; its bed in metres along it.
export const CREEK = {
  points: [[160, -262], [132, -160], [112, -70], [100, -8], [104, 55], [96, 120], [72, 190], [48, 252]],
  profile: [[0, 5], [300, 0.6], [330, 0.4], [420, -1.5], [560, -9]],
  width: 4.2, bank: 1.3,
};
// The gorge where the lake bridge was: a deep cut right across the north.
export const GORGE = {
  points: [[-270, 246], [-120, 250], [-20, 252], [80, 249], [270, 244]],
  profile: [[0, -12], [540, -12]], width: 16, bank: 0.9,
};

// The lake on the far side, seen across the gorge from the BRIDGE OUT barrier: a flat bed along the map's north edge.
export const LAKE = { points: [[-320, 300], [0, 300], [320, 300]], profile: [[0, -2], [640, -2]], width: 50, bank: 3.5, level: 0.7 };

// Level ground: the post office's yard and parking, each house's plot, the picnic spot, the end of Post Road.
export const PADS = [
  { id: "post_office", at: [-20, -186], radius: 15, blend: 16 },
  { id: "hazel", at: [-160, 50], radius: 14, blend: 16 },
  { id: "pip", at: [190, 112], radius: 13, blend: 16 },
  { id: "picnic", at: [30, 112], radius: 7, blend: 12 },
  { id: "overlook", at: [-104, -64], radius: 6, blend: 10 },
  { id: "barrier", at: [-20, 230], radius: 8, blend: 8 },
];

// The houses: where the building stands and which way its door faces (toward its road), the gate and mailbox, the door's step.
export const PLACES = {
  post_office: { building: [-21, -186], face: [1, 0], door: [-15.4, -186], parking: [-6.5, -177], parking_face: [0, 1] },
  hazel: { name: "Hazel Brock", number: 3, street: "Fern Lane", building: [-162, 54], face: [0.75, -0.66], door: [-158, 49.5], gate: [-147, 41], mailbox: [-144, 38], resident: [-155, 45], sawhorse: [-152, 52] },
  pip: { name: "Pip Tansy", number: 7, street: "Kettle Creek Road", building: [192, 114], face: [-0.62, -0.78], door: [188.5, 109.5], gate: [177, 101], mailbox: [174, 98], resident: [186, 106], mast: [199, 104] },
};


// The signposts at each junction: where the post stands and which roads its arms name. Every arm points along its road (the owner's
// seventh play: "they don't always follow the direction of the road"): the board is parallel to the road's direction at the post's foot
// and its point shows the way that road goes (`dir` +1 along the road as ROADS draws it, -1 back along it; tools/scene.mjs works out the
// angle), one arm for each way a road goes. Nothing is swung off its road to be read: the lettering is on both faces of every board, and
// each post stands in the corner of its junction (10 to 13 m from the crossing, 1.4 to 3 m off the road's edge) where the traffic coming
// in sees the boards at the widest angle (a search over the corners; tests `every_arm_points_along_its_road` and
// `every_signpost_board_is_seen_at_a_readable_angle_from_each_approach`).
export const SIGNS = [
  { at: [-15.5, -72], arms: [{ text: "FERN LANE", road: "fern_lane", dir: 1 }, { text: "POST ROAD", road: "post_road", dir: -1 }, { text: "POST ROAD", road: "post_road", dir: 1 }] },
  { at: [17, 16.5], arms: [{ text: "KETTLE CREEK RD", road: "kettle_creek_road", dir: 1 }, { text: "POST ROAD", road: "post_road", dir: -1 }, { text: "POST ROAD", road: "post_road", dir: 1 }] },
];
