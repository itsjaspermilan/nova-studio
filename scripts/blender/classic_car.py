"""A classic road car, modelled in Blender and exported as a game-ready .glb (Switch-class detail, PBR materials).

  blender -b --python scripts/blender/classic_car.py -- <spec name> <out.glb> [--subdiv 2]

The body is a cage of cross-sections (stations along the car) that Subdivision Surface smooths, with creased edges where the paint has a
hard line (the belt line, the roof edge, the ends of the screens); the wheel arches are boolean cuts; trim is bevelled boxes; tyres and
rims are lathes. Everything is in metres, the car's nose points along glTF +z (Blender -Y), and the parts are named the way the game moves
them: `body`, `wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr` (fl is on the -x side), each wheel with its origin on its axle and the body
with its origin at the height it leans about. Materials carry the PBR numbers (paint is glossy, chrome is metal, glass is dark and
smooth, lamps glow); the runtime lights them with `"materials": true` in nova.json (docs/materials.md).
Written 2026-11-09 for the art direction in TODO.md (Switch 1-class graphics at 60 fps).
"""
import bpy
import bmesh
import json
import math
import sys
from mathutils import Vector

# ---- the cars ---------------------------------------------------------------------------------------------------------------------
# Sizes in metres. z runs from the tail (negative) to the nose; `top` is the line of the top (z, y); `front` and `rear` are the screens
# (z ranges), `glass` the side windows, `wheels` the front and rear axle z.
SPECS = {
    "boxy": dict(
        zr=-2.35, zf=2.35, hw=0.91, yb=0.24, ys=0.96, roof=1.39, pivot=0.36, R=0.36, tw=0.41, track=0.74, wheels=(1.40, -1.45),
        top=[(-2.35, 0.925), (-1.66, 0.955), (-1.25, 1.38), (-1.06, 1.39), (0.38, 1.39), (0.84, 0.925), (1.5, 0.90), (2.35, 0.85)],
        front=(0.38, 0.84), rear=(-1.66, -1.25), glass=((0.09, 0.73), (-1.51, -0.06)), tumble=0.1,
        paint=(0.78, 0.17, 0.10), name="car_sedan",
    ),
}

BEVEL = 0.012


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


_materials = {}


def material(name, color, metallic=0.0, roughness=0.5, emission=0.0):
    if name in _materials:
        return _materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if emission > 0:
        b.inputs["Emission Color"].default_value = (emission, emission, emission, 1)
        b.inputs["Emission Strength"].default_value = 1.0
    m.diffuse_color = (color[0], color[1], color[2], 1)
    _materials[name] = m
    return m


def srgb(c):
    """sRGB triple (0-1) to the linear one Blender wants."""
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)


def lerp(a, b, t):
    return a + (b - a) * t


def clamp(v, a, b):
    return max(a, min(b, v))


def along(nodes, z):
    if z <= nodes[0][0]:
        return nodes[0][1]
    for i in range(1, len(nodes)):
        if z <= nodes[i][0]:
            return lerp(nodes[i - 1][1], nodes[i][1], (z - nodes[i - 1][0]) / ((nodes[i][0] - nodes[i - 1][0]) or 1))
    return nodes[-1][1]


# ---- the body ---------------------------------------------------------------------------------------------------------------------
def body_mesh(s, mats):
    zr, zf = s["zr"], s["zf"]
    keys = {zr, zf}
    for z in (zr + 0.12, zf - 0.12):
        keys.add(round(z, 3))
    for a, b in (s["front"], s["rear"], *s["glass"]):
        keys.update((a, b))
    for wz in s["wheels"]:
        keys.update((round(wz - 0.5, 3), round(wz, 3), round(wz + 0.5, 3)))
    for z, _ in s["top"]:
        keys.add(z)
    zs = sorted(keys)
    # (a station every 0.5 m or so between the key ones, so long flat stretches still have a shape)
    dense = [zs[0]]
    for z in zs[1:]:
        while z - dense[-1] > 0.62:
            dense.append(round(dense[-1] + 0.5, 3))
        if z - dense[-1] > 0.02:
            dense.append(z)
    zs = dense
    n = len(zs)

    def profile(z):
        dEnd = min(z - zr, zf - z)
        k = 1.0 if dEnd >= 0.22 else math.sqrt(max(0.0, 1 - (1 - dEnd / 0.22) ** 2))
        hw = s["hw"] * (0.95 + 0.05 * k)
        yb0 = s["yb"]
        yt = max(along(s["top"], z), s["ys"] + 0.09)
        ym = (yb0 + yt) / 2
        hs = 0.86 + 0.14 * k
        yb = ym + (yb0 - ym) * hs
        yt = ym + (yt - ym) * hs
        ys = min(s["ys"], yt - 0.09)
        f = clamp((yt - ys) / (s["roof"] - ys), 0, 1)
        hwt = hw * (0.94 - s["tumble"] * f)
        hb = hw * 0.92
        return [
            (0, yb), (hb * 0.6, yb), (hb, yb + 0.06), (hw * 0.995, yb + (ys - yb) * 0.38), (hw, yb + (ys - yb) * 0.8), (hw * 0.998, ys),
            (lerp(hw, hwt, 0.45), ys + (yt - ys) * 0.45), (hwt, ys + (yt - ys) * 0.86), (hwt - min(0.07, hwt * 0.06), yt - 0.03),
            (min(0.1, hwt * 0.4), yt - 0.003), (0, yt),
        ], yb, yt

    bm = bmesh.new()
    rings = []
    for z in zs:
        p, yb, yt = profile(z)
        right = [bm.verts.new((x, -z, y)) for x, y in p]                       # (Blender: y is forward, so the nose, +z, is at -y)
        left = [bm.verts.new((-p[j][0], -z, p[j][1])) for j in range(9, 0, -1)]
        rings.append((right, left))
    crease = bm.edges.layers.float.new("crease_edge")

    def L(i, m):  # the left side's point m
        right, left = rings[i]
        return right[0] if m == 0 else right[10] if m == 10 else left[9 - m]

    def R(i, m):
        return rings[i][0][m]

    def in_range(z, r):
        return r and r[0] - 1e-6 <= z <= r[1] + 1e-6

    def region(i, j):
        z = (zs[i] + zs[i + 1]) / 2
        dEnd = min(z - zr, zf - z)
        if j == 0:
            return "under"
        if j == 1:
            return "trim"
        if j == 2:
            return "trim" if dEnd < 0.2 else "paint"
        if j in (3, 4):
            return "paint"
        if j in (5, 6):
            return "glass" if any(in_range(z, g) for g in s["glass"]) else "paint"
        if j == 7:
            return "paint"
        return "glass" if (in_range(z, s["front"]) or in_range(z, s["rear"])) else "paint"

    def add(verts, mat):
        try:
            f = bm.faces.new(verts)
        except ValueError:
            return None
        f.material_index = mats.index(mat)
        f.smooth = True
        return f

    for i in range(n - 1):
        for j in range(10):
            mat = region(i, j)
            add([R(i, j), R(i, j + 1), R(i + 1, j + 1), R(i + 1, j)], mat)
            add([L(i, j), L(i + 1, j), L(i + 1, j + 1), L(i, j + 1)], mat)
    # the two ends: a bumper strip below, a panel above
    for i in (0, n - 1):
        lower = [R(i, m) for m in range(0, 4)] + [L(i, m) for m in (3, 2, 1)]
        upper = [R(i, m) for m in range(3, 11)] + [L(i, m) for m in (9, 8, 7, 6, 5, 4, 3)]
        add(lower, "trim")
        add(upper, "paint")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # creases: the belt line, the roof edge and the underside corners along the car; across it at the ends of the screens and at the ends
    hard_z = {zr, zf, *s["front"], *s["rear"]}
    for e in bm.edges:
        a, b = e.verts
        if abs(a.co.y - b.co.y) < 1e-6:                     # across the car, in one station
            if any(abs(-a.co.y - z) < 1e-4 for z in hard_z):
                e[crease] = 1.0
        else:                                               # along the car
            pts = [i for i in range(1, 9) if abs(abs(a.co.x) - 1) < 99]
            e[crease] = 0.0
    for i in range(n):
        for j in (2, 5, 7, 8):
            for side in (R, L):
                if i < n - 1:
                    for e in side(i, j).link_edges:
                        if side(i + 1, j) in e.verts:
                            e[crease] = 1.0
    mesh = bpy.data.meshes.new("body")
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new("body", mesh)
    bpy.context.collection.objects.link(ob)
    for m in mats:
        ob.data.materials.append(material_by_key[m])
    return ob


def box(name, center, size, mat, bevel=BEVEL, rot=(0, 0, 0)):
    """A bevelled box (centre in game coordinates x, y, z; size x, y, z): one object, modifiers applied."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(center[0], -center[2], center[1]))
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (size[0], size[2], size[1])
    ob.rotation_euler = rot
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    ob.data.materials.append(mat)
    if bevel > 0:
        m = ob.modifiers.new("bevel", "BEVEL")
        m.width = min(bevel, min(size) * 0.45)
        m.segments = 2
        m.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier=m.name)
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob


def lathe(name, profile, steps=48, mat=None, axis_x=True):
    """A surface of revolution about the x axis from (x, radius) points; one object at the origin."""
    bm = bmesh.new()
    verts = [bm.verts.new((x, r, 0)) for x, r in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(1, 0, 0), angle=math.tau, steps=steps, use_merge=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    if mat:
        ob.data.materials.append(mat)
    return ob


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    return ob


material_by_key = {}


def build(spec_name, out, subdiv):
    clear()
    s = SPECS[spec_name]
    paint = srgb(s["paint"])
    M = material_by_key
    M["paint"] = material("paint", paint, 0.35, 0.28)
    M["glass"] = material("glass", srgb((0.07, 0.11, 0.16)), 0.0, 0.06)
    M["trim"] = material("trim", srgb((0.13, 0.13, 0.15)), 0.0, 0.7)
    M["under"] = material("under", srgb((0.05, 0.05, 0.06)), 0.0, 0.9)
    M["chrome"] = material("chrome", srgb((0.86, 0.87, 0.9)), 1.0, 0.16)
    M["rubber"] = material("rubber", srgb((0.04, 0.04, 0.045)), 0.0, 0.92)
    M["lamp"] = material("lamp", srgb((1.0, 0.95, 0.78)), 0.0, 0.2, emission=0.9)
    M["tail"] = material("tail", srgb((0.9, 0.08, 0.1)), 0.0, 0.2, emission=0.7)
    M["amber"] = material("amber", srgb((1.0, 0.65, 0.1)), 0.0, 0.2, emission=0.4)
    M["well"] = material("well", srgb((0.03, 0.03, 0.035)), 0.0, 0.95)
    M["hub"] = material("hub", srgb((0.7, 0.72, 0.76)), 1.0, 0.3)
    keys = ["paint", "glass", "trim", "under"]
    body = body_mesh(s, keys)
    # smooth it, cut the arches, round the cut edges
    sub = body.modifiers.new("subsurf", "SUBSURF")
    sub.levels = sub.render_levels = subdiv
    sub.use_creases = True
    # the arch cutters
    R, tw = s["R"], s["tw"]
    cutters = []
    ra = R * 1.17
    for side in (-1, 1):
        for wz in s["wheels"]:
            bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=ra, depth=0.7, location=(side * (s["track"] + 0.18), -wz, R), rotation=(0, math.radians(90), 0))
            c = bpy.context.active_object
            c.data.materials.append(M["well"])
            cutters.append(c)
    cut = join(cutters, "cutters")
    boolm = body.modifiers.new("arches", "BOOLEAN")
    boolm.operation = "DIFFERENCE"
    boolm.object = cut
    boolm.solver = "EXACT"
    bev = body.modifiers.new("bevel", "BEVEL")
    bev.width = 0.014
    bev.segments = 2
    bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(50)
    bpy.context.view_layer.objects.active = body
    for m in list(body.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(cut, do_unlink=True)
    for p in body.data.polygons:
        p.use_smooth = True
    parts = [body]
    ch, rub = M["chrome"], M["rubber"]
    hw = s["hw"]
    fz, rz = s["zf"], s["zr"]
    yb = s["yb"]
    # ---- the trim
    for z, d, nm in ((fz, 1, "front"), (rz, -1, "rear")):
        w = hw * 1.98
        parts.append(box(f"{nm} bumper", (0, yb + 0.17, z + d * 0.04), (w, 0.13, 0.11), ch))
        parts.append(box(f"{nm} bumper rubber", (0, yb + 0.07, z + d * 0.035), (w * 0.96, 0.07, 0.1), rub))
        for x in (-1, 1):
            parts.append(box(f"{nm} overrider", (x * w * 0.36, yb + 0.17, z + d * 0.09), (0.09, 0.15, 0.05), ch))
    gy = yb + 0.5
    gw = min(hw * 1.1, 1.0)
    parts.append(box("grille frame", (0, gy, fz + 0.012), (gw, 0.23, 0.05), ch, 0.01))
    parts.append(box("grille", (0, gy, fz + 0.03), (gw - 0.07, 0.17, 0.05), M["under"], 0.004))
    for k in range(-3, 4):
        parts.append(box("grille bar", (k * (gw - 0.12) / 7, gy, fz + 0.06), (0.02, 0.17, 0.025), ch, 0.003))
    for side in (-1, 1):
        x = side * (gw / 2 + 0.2)
        parts.append(box("headlight bezel", (x, gy, fz + 0.01), (0.3, 0.21, 0.05), ch, 0.01))
        parts.append(box("headlight", (x, gy, fz + 0.035), (0.25, 0.16, 0.05), M["lamp"], 0.01))
        parts.append(box("indicator", (x, gy - 0.19, fz + 0.01), (0.2, 0.07, 0.045), M["amber"], 0.01))
        parts.append(box("tail light", (side * hw * 0.66, s["ys"] - 0.2, rz - 0.01), (hw * 0.42, 0.1, 0.05), M["tail"], 0.01))
    parts.append(box("plate", (0, yb + 0.33, rz - 0.01), (0.34, 0.12, 0.04), material("plate", srgb((0.93, 0.93, 0.9)), 0, 0.5), 0.004))
    # a moulding between the arches, and mirrors
    z0, z1 = s["wheels"][1] + R * 1.4, s["wheels"][0] - R * 1.4
    for side in (-1, 1):
        parts.append(box("side moulding", (side * (hw + 0.012), yb + 0.4, (z0 + z1) / 2), (0.03, 0.04, z1 - z0), ch, 0.006))
        parts.append(box("side rubber", (side * (hw + 0.012), yb + 0.35, (z0 + z1) / 2), (0.03, 0.05, z1 - z0), rub, 0.006))
        parts.append(box("mirror", (side * (hw + 0.1), s["ys"] + 0.13, s["front"][1] - 0.15), (0.1, 0.09, 0.16), M["trim"], 0.02))
    body = join(parts, "body")
    body.location = (0, 0, 0)
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    # the origin of the body: where it leans about (the axle height)
    bpy.context.scene.cursor.location = (0, 0, s["pivot"])
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    # ---- the wheels
    for side, sn in ((-1, "l"), (1, "r")):
        for wz, fr in zip(s["wheels"], ("f", "r")):
            w = tw
            tyre = lathe("tyre", [(-w / 2, 0.7 * R), (-w / 2, 0.86 * R), (-w * 0.46, 0.96 * R), (-w * 0.3, R), (w * 0.3, R), (w * 0.46, 0.96 * R), (w / 2, 0.86 * R), (w / 2, 0.7 * R), (-w / 2, 0.7 * R)], 56, rub)
            o = side  # the outer side of the wheel is +x on the right, -x on the left
            # (the rim's chrome ring shows inside the tyre's inner radius, a dark dish inside it, a chrome cap in the middle)
            rim = lathe("rim", [(o * w * 0.5, 0.7 * R), (o * w * 0.46, 0.68 * R), (o * w * 0.44, 0.6 * R), (o * w * 0.36, 0.58 * R)], 40, ch)
            dish = lathe("dish", [(o * w * 0.36, 0.58 * R), (o * w * 0.28, 0.5 * R), (o * w * 0.28, 0.3 * R)], 40, M["trim"])
            cap = lathe("cap", [(o * w * 0.28, 0.3 * R), (o * w * 0.4, 0.28 * R), (o * w * 0.46, 0.2 * R), (o * w * 0.47, 0.0)], 32, M["hub"])
            whl = join([tyre, rim, dish, cap], f"wheel_f{sn}" if fr == "f" else f"wheel_r{sn}")
            whl.location = (side * s["track"], -wz, R)
            bpy.context.view_layer.objects.active = whl
            whl.select_set(True)
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    # ---- export
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True, export_apply=False, export_materials="EXPORT",
                              export_cameras=False, export_lights=False, export_texcoords=False, export_normals=True)
    tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)
    print(f"EXPORTED {out}: {tris} triangles, objects {[o.name for o in bpy.data.objects]}")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:]
    subdiv = int(args[args.index("--subdiv") + 1]) if "--subdiv" in args else 2
    build(args[0], args[1], subdiv)
