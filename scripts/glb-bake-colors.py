#!/usr/bin/env python3
"""Flattens a textured .glb (several materials, several pictures) to one mesh with vertex colours, the way Nova's own models are made.

The runtime reads one base-colour texture per model, so a model with several materials shows its extra parts white. This samples each
material's base-colour picture at every vertex's UV (times the material's colour factor), applies the node transforms, and writes one
mesh with COLOR_0 (linear light, 16-bit) and one white material.

  python3 scripts/glb-bake-colors.py in.glb out.glb [--scale 1.0]

Needs Pillow (PIL). Written 2026-11-09 for the CC0 MomusPark pack (github.com/ToxSam/cc0-models-Polygonal-Mind, projects/MomusPark; Polygonal Mind, CC0).
"""
import io
import json
import math
import struct
import sys

from PIL import Image

COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_glb(path):
    b = open(path, "rb").read()
    assert b[:4] == b"glTF", "not a GLB"
    n = struct.unpack_from("<I", b, 12)[0]
    j = json.loads(b[20:20 + n])
    off = 20 + n
    binchunk = b""
    while off < len(b):
        ln, kind = struct.unpack_from("<I4s", b, off)
        if kind == b"BIN\0":
            binchunk = b[off + 8:off + 8 + ln]
            break
        off += 8 + ln
    return j, binchunk


def accessor(j, binb, idx):
    a = j["accessors"][idx]
    bv = j["bufferViews"][a["bufferView"]]
    fmt, size = COMP[a["componentType"]]
    nc = NCOMP[a["type"]]
    stride = bv.get("byteStride") or size * nc
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    out = []
    for i in range(a["count"]):
        vals = struct.unpack_from("<" + fmt * nc, binb, base + i * stride)
        if a.get("normalized"):
            div = {"B": 255.0, "H": 65535.0, "b": 127.0, "h": 32767.0}[fmt]
            vals = tuple(max(v / div, -1.0) for v in vals)
        out.append(vals if nc > 1 else vals[0])
    return out


def mat_mul(a, b):  # column-major 4x4
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]


def node_matrix(n):
    if "matrix" in n:
        return list(n["matrix"])
    t = n.get("translation", [0, 0, 0])
    q = n.get("rotation", [0, 0, 0, 1])
    s = n.get("scale", [1, 1, 1])
    x, y, z, w = q
    r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
         2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
         2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1]
    m = [r[0] * s[0], r[1] * s[0], r[2] * s[0], 0, r[4] * s[1], r[5] * s[1], r[6] * s[1], 0, r[8] * s[2], r[9] * s[2], r[10] * s[2], 0, t[0], t[1], t[2], 1]
    return m


def xform(m, p):
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]


def xform_dir(m, d):
    v = [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]]
    l = math.sqrt(sum(c * c for c in v)) or 1
    return [c / l for c in v]


def s2l(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def main():
    src, dst = sys.argv[1], sys.argv[2]
    scale = float(sys.argv[sys.argv.index("--scale") + 1]) if "--scale" in sys.argv else 1.0
    j, binb = read_glb(src)
    images = {}

    def image_of(tex_index):
        tex = j["textures"][tex_index]
        src_i = tex["source"]
        if src_i not in images:
            im = j["images"][src_i]
            bv = j["bufferViews"][im["bufferView"]]
            data = binb[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
            images[src_i] = Image.open(io.BytesIO(data)).convert("RGBA")
        return images[src_i]

    P, N, C, I = [], [], [], []

    def visit(ni, parent):
        n = j["nodes"][ni]
        m = mat_mul(parent, node_matrix(n))
        if "mesh" in n:
            for prim in j["meshes"][n["mesh"]]["primitives"]:
                if prim.get("mode", 4) != 4:
                    continue
                # (a primitive with no material, or on a mesh called a collider, is a helper for the pack's own engine, not part of the model)
                if "material" not in prim or any(w in (j["meshes"][n["mesh"]].get("name", "") + n.get("name", "")).lower() for w in ("collider", "collision")):
                    continue
                pos = accessor(j, binb, prim["attributes"]["POSITION"])
                nrm = accessor(j, binb, prim["attributes"]["NORMAL"]) if "NORMAL" in prim["attributes"] else None
                uv = accessor(j, binb, prim["attributes"]["TEXCOORD_0"]) if "TEXCOORD_0" in prim["attributes"] else None
                vc = accessor(j, binb, prim["attributes"]["COLOR_0"]) if "COLOR_0" in prim["attributes"] else None
                idx = accessor(j, binb, prim["indices"]) if "indices" in prim else list(range(len(pos)))
                mat = j["materials"][prim["material"]] if "material" in prim else {}
                pbr = mat.get("pbrMetallicRoughness", {})
                factor = pbr.get("baseColorFactor", [1, 1, 1, 1])
                tex = pbr.get("baseColorTexture")
                img = image_of(tex["index"]) if tex else None
                base = len(P)
                for k, p in enumerate(pos):
                    P.append([c * scale for c in xform(m, p)])
                    N.append(xform_dir(m, nrm[k]) if nrm else [0, 1, 0])
                    col = [1.0, 1.0, 1.0]
                    if img is not None and uv is not None:
                        u, v = uv[k]
                        x = min(img.width - 1, max(0, int((u % 1.0) * img.width)))
                        y = min(img.height - 1, max(0, int((v % 1.0) * img.height)))
                        px = img.getpixel((x, y))
                        col = [s2l(px[0]), s2l(px[1]), s2l(px[2])]
                    col = [col[0] * factor[0], col[1] * factor[1], col[2] * factor[2]]
                    if vc:
                        col = [col[0] * vc[k][0], col[1] * vc[k][1], col[2] * vc[k][2]]
                    C.append(col)
                I.extend(base + i for i in idx)
        for ch in n.get("children", []):
            visit(ch, m)

    ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    for ni in j["scenes"][j.get("scene", 0)]["nodes"]:
        visit(ni, ident)

    pos_b = b"".join(struct.pack("<3f", *p) for p in P)
    nrm_b = b"".join(struct.pack("<3f", *n) for n in N)
    col_b = b"".join(struct.pack("<4H", *[int(max(0, min(1, c)) * 65535 + 0.5) for c in col], 65535) for col in C)
    idx_b = b"".join(struct.pack("<I", i) for i in I)
    chunks = [pos_b, nrm_b, col_b, idx_b]
    views, accs, off = [], [], 0
    blob = b""
    for ch in chunks:
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(ch)})
        blob += ch
        off += len(ch)
    mn = [min(p[i] for p in P) for i in range(3)]
    mx = [max(p[i] for p in P) for i in range(3)]
    accs = [
        {"bufferView": 0, "componentType": 5126, "count": len(P), "type": "VEC3", "min": mn, "max": mx},
        {"bufferView": 1, "componentType": 5126, "count": len(P), "type": "VEC3"},
        {"bufferView": 2, "componentType": 5123, "normalized": True, "count": len(P), "type": "VEC4"},
        {"bufferView": 3, "componentType": 5125, "count": len(I), "type": "SCALAR"},
    ]
    doc = {
        "asset": {"version": "2.0", "generator": "nova scripts/glb-bake-colors.py"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2}, "indices": 3, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 1}}],
        "buffers": [{"byteLength": len(blob)}], "bufferViews": views, "accessors": accs,
    }
    js = json.dumps(doc).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    blob += b"\0" * ((4 - len(blob) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(dst, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<I4s", len(js), b"JSON") + js)
        f.write(struct.pack("<I4s", len(blob), b"BIN\0") + blob)
    print(f"{dst}: {len(P)} points, {len(I) // 3} triangles, {total // 1024} KB")


main()
