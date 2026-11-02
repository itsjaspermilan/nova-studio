#!/usr/bin/env python3
"""Generates the original sample assets: the M1 spike car, and the rally-demo example
project's models (car, ground, crate) and sprites (cloud, pine, gauge).

Models are single-mesh GLBs with a palette texture (flat colours picked by UV, the usual
low-poly trick) and no skins, animations or extensions. Sprites are small PNGs drawn
procedurally. Everything here is original. Run with:
    ASDF_PYTHON_VERSION=3.11.0 python3 -I scripts/gen_spike_assets.py
"""
import json
import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPIKE_CAR = ROOT / "crates/nova-runtime/assets/spike/car.glb"
EXAMPLE = ROOT / "examples/rally-demo"
DASH = ROOT / "examples/crate-dash"

CELL = 8  # texels per palette cell, so nearest sampling stays flat

CAR_PALETTE = [
    (214, 56, 48),    # 0 body red
    (240, 240, 232),  # 1 off-white stripe
    (36, 38, 44),     # 2 tyre / trim
    (120, 190, 235),  # 3 glass
    (250, 214, 74),   # 4 lamps
    (92, 96, 104),    # 5 bumper grey
]
GROUND_PALETTE = [(128, 176, 96), (92, 130, 70)]  # grass top, darker rim
CRATE_PALETTE = [(196, 140, 78), (140, 96, 52)]


def png(width, height, rgba):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    raw = b"".join(b"\x00" + bytes(rgba[y * width * 4:(y + 1) * width * 4]) for y in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def palette_png(palette):
    width, height = CELL * len(palette), CELL
    pixels = []
    for _ in range(height):
        for r, g, b in palette:
            pixels += [r, g, b, 255] * CELL
    return png(width, height, pixels)


FACES = [  # normal, four corners (counter-clockwise seen from outside)
    ((0, 0, 1), [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]),
    ((0, 0, -1), [(1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)]),
    ((1, 0, 0), [(1, -1, 1), (1, -1, -1), (1, 1, -1), (1, 1, 1)]),
    ((-1, 0, 0), [(-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)]),
    ((0, 1, 0), [(-1, 1, 1), (1, 1, 1), (1, 1, -1), (-1, 1, -1)]),
    ((0, -1, 0), [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)]),
]


def box(center, half, color, count, top_color=None):
    def uv(index):
        return ((index + 0.5) / count, 0.5)

    verts, idx = [], []
    for normal, corners in FACES:
        base = len(verts)
        c = top_color if (top_color is not None and normal == (0, 1, 0)) else color
        for sx, sy, sz in corners:
            pos = (center[0] + sx * half[0], center[1] + sy * half[1], center[2] + sz * half[2])
            verts.append((pos, normal, uv(c)))
        idx += [base, base + 1, base + 2, base, base + 2, base + 3]
    return verts, idx


def merge(parts):
    verts, idx = [], []
    for v, i in parts:
        base = len(verts)
        verts += v
        idx += [base + n for n in i]
    return verts, idx


def build_car():
    n = len(CAR_PALETTE)
    parts = [
        box((0, 0.45, 0), (0.9, 0.3, 1.9), 0, n, top_color=0),          # body
        box((0, 0.45, 0), (0.92, 0.07, 1.92), 1, n),                    # stripe (slightly proud)
        box((0, 0.95, -0.2), (0.75, 0.25, 0.95), 3, n, top_color=1),    # cabin: glass sides, white roof
        box((0, 0.35, 1.95), (0.85, 0.2, 0.08), 5, n),                  # front bumper
        box((0, 0.35, -1.95), (0.85, 0.2, 0.08), 5, n),                 # rear bumper
        box((-0.6, 0.5, 1.93), (0.18, 0.1, 0.06), 4, n),                # lamps
        box((0.6, 0.5, 1.93), (0.18, 0.1, 0.06), 4, n),
    ]
    for x in (-1.0, 1.0):
        for z in (-1.2, 1.2):
            parts.append(box((x, 0.32, z), (0.16, 0.32, 0.32), 2, n))   # wheels
    return merge(parts)


def build_ground():
    n = len(GROUND_PALETTE)
    # A wide slab: top surface green, with a darker rim so the edge reads at a distance.
    return merge([box((0, -0.5, 0), (160, 0.5, 160), 1, n, top_color=0)])


def build_crate():
    n = len(CRATE_PALETTE)
    return merge([box((0, 0.5, 0), (0.5, 0.5, 0.5), 0, n, top_color=1)])


def pad4(data, fill=b"\x00"):
    return data + fill * (-len(data) % 4)


def write_glb(path, verts, idx, palette, name):
    pos = b"".join(struct.pack("<3f", *v[0]) for v in verts)
    nor = b"".join(struct.pack("<3f", *v[1]) for v in verts)
    tex = b"".join(struct.pack("<2f", *v[2]) for v in verts)
    ind = b"".join(struct.pack("<I" if len(verts) > 65535 else "<H", i) for i in idx)
    img = palette_png(palette)

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
        "nodes": [{"mesh": 0, "name": name}],
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
            {"bufferView": v_ind, "componentType": 5125 if len(verts) > 65535 else 5123,
             "count": len(idx), "type": "SCALAR"},
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
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(glb)
    print(f"wrote {path.relative_to(ROOT)} ({len(glb)} bytes, {len(verts)} vertices, {len(idx) // 3} triangles)")


def raster(width, height, shade):
    pixels = []
    for y in range(height):
        for x in range(width):
            pixels += list(shade(x + 0.5, y + 0.5))
    return png(width, height, pixels)


def cloud_sprite():
    blobs = [(20, 38, 14), (38, 30, 18), (58, 36, 15), (74, 40, 11), (46, 42, 20)]

    def shade(x, y):
        inside = any((x - bx) ** 2 + (y - by) ** 2 <= r * r for bx, by, r in blobs) and y < 54
        return (255, 255, 255, 255) if inside else (0, 0, 0, 0)

    return raster(88, 56, shade)


def pine_sprite():
    def shade(x, y):
        if 28 <= x <= 36 and 80 <= y < 96:  # trunk
            return (110, 74, 44, 255)
        for top, bottom, half in ((6, 40, 22), (24, 62, 28), (44, 86, 32)):
            if top <= y <= bottom and abs(x - 32) <= half * (y - top) / (bottom - top):
                shade_ = 44 + int(40 * (1 - (y - top) / (bottom - top)))
                return (30, 90 + shade_ // 2, 60, 255)
        return (0, 0, 0, 0)

    return raster(64, 96, shade)


def gauge_sprite():
    def shade(x, y):
        d = math.hypot(x - 48, y - 48)
        if 38 <= d <= 46:
            return (235, 235, 235, 255)
        if d < 38:
            return (20, 22, 28, 190)
        return (0, 0, 0, 0)

    return raster(96, 96, shade)


def player_sprite():
    def shade(x, y):
        # a little rounded robot: body, visor, feet
        if 6 <= x <= 26 and 4 <= y <= 24 and not ((x < 8 or x > 24) and (y < 6 or y > 22)):
            if 10 <= x <= 22 and 9 <= y <= 14:
                return (120, 220, 255, 255)  # visor
            return (232, 200, 80, 255) if y < 20 else (90, 96, 110, 255)
        if 8 <= x <= 13 and 25 <= y <= 30 or 19 <= x <= 24 and 25 <= y <= 30:
            return (60, 64, 76, 255)
        return (0, 0, 0, 0)

    return raster(32, 32, shade)


def crate2d_sprite():
    def shade(x, y):
        if not (2 <= x <= 29 and 2 <= y <= 29):
            return (0, 0, 0, 0)
        edge = x < 5 or x > 26 or y < 5 or y > 26
        plank = abs(x - y) < 2 or abs(x + y - 31) < 2
        if edge or plank:
            return (120, 80, 44, 255)
        return (190, 138, 76, 255)

    return raster(32, 32, shade)


def star_sprite():
    def shade(x, y):
        dx, dy = x - 12, y - 12
        d = math.hypot(dx, dy)
        angle = math.atan2(dy, dx)
        radius = 5.5 + 5.5 * abs(math.cos(2.5 * angle))
        return (255, 218, 74, 255) if d <= radius else (0, 0, 0, 0)

    return raster(24, 24, shade)


def main():
    car = build_car()
    write_glb(SPIKE_CAR, *car, CAR_PALETTE, "rally_car")
    write_glb(EXAMPLE / "models/car.glb", *car, CAR_PALETTE, "rally_car")
    write_glb(EXAMPLE / "models/ground.glb", *build_ground(), GROUND_PALETTE, "ground")
    write_glb(EXAMPLE / "models/crate.glb", *build_crate(), CRATE_PALETTE, "crate")
    for name, data in (("cloud", cloud_sprite()), ("pine", pine_sprite()), ("gauge", gauge_sprite())):
        path = EXAMPLE / f"sprites/{name}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        print(f"wrote {path.relative_to(ROOT)} ({len(data)} bytes)")
    for name, data in (("player", player_sprite()), ("crate", crate2d_sprite()), ("star", star_sprite())):
        path = DASH / f"sprites/{name}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        print(f"wrote {path.relative_to(ROOT)} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
