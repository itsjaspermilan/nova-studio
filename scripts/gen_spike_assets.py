#!/usr/bin/env python3
"""Generates the original low-poly rally car used by the M1 runtime spike.

Writes crates/nova-runtime/assets/spike/car.glb: one mesh, one material with a
palette texture (flat colours picked by UV, the usual low-poly trick), no skins,
animations or extensions. Run with: ASDF_PYTHON_VERSION=3.11.0 python3 -I scripts/gen_spike_assets.py
"""
import json
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "crates/nova-runtime/assets/spike/car.glb"

PALETTE = [
    (214, 56, 48),    # 0 body red
    (240, 240, 232),  # 1 off-white stripe
    (36, 38, 44),     # 2 tyre / trim
    (120, 190, 235),  # 3 glass
    (250, 214, 74),   # 4 lamps
    (92, 96, 104),    # 5 bumper grey
]
CELL = 8  # texels per palette cell, so mip-free nearest sampling stays flat


def png(width, height, rgba):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    raw = b"".join(b"\x00" + bytes(rgba[y * width * 4:(y + 1) * width * 4]) for y in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def palette_png():
    width, height = CELL * len(PALETTE), CELL
    pixels = []
    for _ in range(height):
        for r, g, b in PALETTE:
            pixels += [r, g, b, 255] * CELL
    return png(width, height, pixels)


def uv(index):
    return ((index + 0.5) / len(PALETTE), 0.5)


FACES = [  # normal, four corners (counter-clockwise seen from outside)
    ((0, 0, 1), [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]),
    ((0, 0, -1), [(1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)]),
    ((1, 0, 0), [(1, -1, 1), (1, -1, -1), (1, 1, -1), (1, 1, 1)]),
    ((-1, 0, 0), [(-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)]),
    ((0, 1, 0), [(-1, 1, 1), (1, 1, 1), (1, 1, -1), (-1, 1, -1)]),
    ((0, -1, 0), [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)]),
]


def box(center, half, color, top_color=None):
    verts, idx = [], []
    for normal, corners in FACES:
        base = len(verts)
        c = top_color if (top_color is not None and normal == (0, 1, 0)) else color
        for sx, sy, sz in corners:
            pos = (center[0] + sx * half[0], center[1] + sy * half[1], center[2] + sz * half[2])
            verts.append((pos, normal, uv(c)))
        idx += [base, base + 1, base + 2, base, base + 2, base + 3]
    return verts, idx


def build_car():
    parts = [
        box((0, 0.45, 0), (0.9, 0.3, 1.9), 0, top_color=0),          # body
        box((0, 0.45, 0), (0.92, 0.07, 1.92), 1),                    # stripe (slightly proud)
        box((0, 0.95, -0.2), (0.75, 0.25, 0.95), 3, top_color=1),    # cabin: glass sides, white roof
        box((0, 0.35, 1.95), (0.85, 0.2, 0.08), 5),                  # front bumper
        box((0, 0.35, -1.95), (0.85, 0.2, 0.08), 5),                 # rear bumper
        box((-0.6, 0.5, 1.93), (0.18, 0.1, 0.06), 4),                # lamps
        box((0.6, 0.5, 1.93), (0.18, 0.1, 0.06), 4),
    ]
    for x in (-1.0, 1.0):
        for z in (-1.2, 1.2):
            parts.append(box((x, 0.32, z), (0.16, 0.32, 0.32), 2))   # wheels
    verts, idx = [], []
    for v, i in parts:
        base = len(verts)
        verts += v
        idx += [base + n for n in i]
    return verts, idx


def pad4(data, fill=b"\x00"):
    return data + fill * (-len(data) % 4)


def main():
    verts, idx = build_car()
    pos = b"".join(struct.pack("<3f", *v[0]) for v in verts)
    nor = b"".join(struct.pack("<3f", *v[1]) for v in verts)
    tex = b"".join(struct.pack("<2f", *v[2]) for v in verts)
    ind = b"".join(struct.pack("<H", i) for i in idx)
    img = palette_png()

    blob = bytearray()
    views = []

    def add(data, target=None):
        while len(blob) % 4:
            blob.append(0)
        view = {"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)}
        if target:
            view["target"] = target
        views.append(view)
        blob.extend(data)
        return len(views) - 1

    v_pos, v_nor, v_tex = add(pos, 34962), add(nor, 34962), add(tex, 34962)
    v_ind, v_img = add(ind, 34963), add(img)
    xs, ys, zs = zip(*(v[0] for v in verts))
    doc = {
        "asset": {"version": "2.0", "generator": "nova gen_spike_assets.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "rally_car"}],
        "meshes": [{"primitives": [{
            "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
            "indices": 3, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {
            "baseColorTexture": {"index": 0}, "metallicFactor": 0.0, "roughnessFactor": 1.0}}],
        "textures": [{"source": 0, "sampler": 0}],
        "samplers": [{"magFilter": 9728, "minFilter": 9728}],
        "images": [{"bufferView": v_img, "mimeType": "image/png"}],
        "accessors": [
            {"bufferView": v_pos, "componentType": 5126, "count": len(verts), "type": "VEC3",
             "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]},
            {"bufferView": v_nor, "componentType": 5126, "count": len(verts), "type": "VEC3"},
            {"bufferView": v_tex, "componentType": 5126, "count": len(verts), "type": "VEC2"},
            {"bufferView": v_ind, "componentType": 5123, "count": len(idx), "type": "SCALAR"},
        ],
        "bufferViews": views,
        "buffers": [{"byteLength": len(blob)}],
    }
    js = pad4(json.dumps(doc, separators=(",", ":")).encode(), b" ")
    bin_chunk = pad4(bytes(blob))
    total = 12 + 8 + len(js) + 8 + len(bin_chunk)
    glb = (struct.pack("<III", 0x46546C67, 2, total)
           + struct.pack("<II", len(js), 0x4E4F534A) + js
           + struct.pack("<II", len(bin_chunk), 0x004E4942) + bin_chunk)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(glb)
    print(f"wrote {OUT} ({len(glb)} bytes, {len(verts)} vertices, {len(idx) // 3} triangles)")


if __name__ == "__main__":
    main()
