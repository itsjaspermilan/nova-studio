#!/usr/bin/env python3
"""Reproduce Nova's original geometric PNG and static GLB fixtures; no downloads."""

import json
import math
import pathlib
import struct
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DESTINATION = ROOT / "examples" / "assets" / "assets"


def chunk(kind, payload):
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(
        ">I", zlib.crc32(kind + payload) & 0xFFFFFFFF
    )


def sprite():
    rows = bytearray()
    for y in range(32):
        rows.append(0)
        for x in range(32):
            distance = abs(x - 15.5) + abs(y - 15.5)
            color = (77, 225, 201, 255) if distance < 14 else (0, 0, 0, 0)
            if distance < 9:
                color = (235, 243, 255, 255)
            if distance < 4:
                color = (77, 225, 201, 255)
            rows.extend(color)
    header = struct.pack(">IIBBBBB", 32, 32, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(
        b"IDAT", zlib.compress(bytes(rows), 9)
    ) + chunk(b"IEND", b"")


def tile_sprite(alpha):
    rows = bytearray()
    for y in range(16):
        rows.append(0)
        for x in range(16):
            if alpha:
                color = (255, 170, 68, 255) if abs(x - 7.5) + abs(y - 7.5) < 7 else (0, 0, 0, 0)
            else:
                color = (34, 52, 78) if (x // 4 + y // 4) % 2 else (55, 83, 112)
            rows.extend(color)
    header = struct.pack(">IIBBBBB", 16, 16, 8, 6 if alpha else 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(
        b"IDAT", zlib.compress(bytes(rows), 9)
    ) + chunk(b"IEND", b"")


def encode_glb(document, binary):
    encoded = json.dumps(document, separators=(",", ":")).encode("ascii")
    encoded += b" " * (-len(encoded) % 4)
    body = struct.pack("<I4s", len(encoded), b"JSON") + encoded
    body += struct.pack("<I4s", len(binary), b"BIN\x00") + binary
    return struct.pack("<4sII", b"glTF", 2, len(body) + 12) + body


def static_instances():
    cube = [(-.5, -.5, -.5), (.5, -.5, -.5), (.5, .5, -.5), (-.5, .5, -.5),
            (-.5, -.5, .5), (.5, -.5, .5), (.5, .5, .5), (-.5, .5, .5)]
    indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
               0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2,
               0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]
    pyramid = [(1, 0, -.5), (2, 0, -.5), (2, 0, .5), (1, 0, .5), (1.5, 1, 0)]
    triangles = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4, 0, 3, 2, 0, 2, 1]
    vertices = b"".join(struct.pack("<3f", *v) for v in cube)
    indexed = struct.pack("<36H", *indices)
    expanded = b"".join(struct.pack("<3f", *pyramid[i]) for i in triangles)
    binary = vertices + indexed + expanded
    document = {
        "asset": {"version": "2.0", "generator": "Nova original static fixture generator"},
        "extensionsUsed": ["KHR_materials_unlit"],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(vertices)},
            {"buffer": 0, "byteOffset": len(vertices), "byteLength": len(indexed)},
            {"buffer": 0, "byteOffset": len(vertices) + len(indexed), "byteLength": len(expanded)},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 8, "type": "VEC3",
             "min": [-.5, -.5, -.5], "max": [.5, .5, .5]},
            {"bufferView": 1, "componentType": 5123, "count": 36, "type": "SCALAR"},
            {"bufferView": 2, "componentType": 5126, "count": 18, "type": "VEC3",
             "min": [1, 0, -.5], "max": [2, 1, .5]},
        ],
        "materials": [
            {"extensions": {"KHR_materials_unlit": {}},
             "pbrMetallicRoughness": {"baseColorFactor": [.25, .5, 1, 1]}},
            {"extensions": {"KHR_materials_unlit": {}},
             "pbrMetallicRoughness": {"baseColorFactor": [1, .5, .25, 1]}},
        ],
        "meshes": [{"primitives": [
            {"mode": 4, "attributes": {"POSITION": 0}, "indices": 1, "material": 0},
            {"mode": 4, "attributes": {"POSITION": 2}, "material": 1},
        ]}],
        "nodes": [
            {"translation": [0, .5, 0], "children": [1, 2, 3]},
            {"mesh": 0, "translation": [-2, 0, 0]},
            {"mesh": 0, "translation": [1, 0, 0],
             "rotation": [0, 0, math.sqrt(.5), math.sqrt(.5)], "scale": [.5, .5, .5]},
            {"mesh": 0, "matrix": [-1, 0, 0, 0, 0, 1, 0, 0,
                                    0, 0, 1, 0, 3, 0, 0, 1]},
        ],
        "scenes": [{"nodes": [0]}], "scene": 0,
    }
    return encode_glb(document, binary)


def model():
    positions = [(0, 1, 0), (0, -1, 0), (1, 0, 0), (0, 0, 1),
                 (-1, 0, 0), (0, 0, -1)]
    indices = []
    for side in range(4):
        a, b = 2 + side, 2 + (side + 1) % 4
        indices.extend((0, b, a, 1, a, b))
    vertices = b"".join(struct.pack("<3f", *position) for position in positions)
    binary = vertices + struct.pack("<24I", *indices)
    document = {
        "asset": {"version": "2.0", "generator": "Nova original fixture generator"},
        "extensionsUsed": ["KHR_materials_unlit"],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(vertices)},
            {"buffer": 0, "byteOffset": len(vertices), "byteLength": 96},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 6, "type": "VEC3",
             "min": [-1, -1, -1], "max": [1, 1, 1]},
            {"bufferView": 1, "componentType": 5125, "count": 24, "type": "SCALAR"},
        ],
        "materials": [{
            "extensions": {"KHR_materials_unlit": {}},
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.302, 0.882, 0.788, 1],
                "metallicFactor": 0, "roughnessFactor": 1,
            },
        }],
        "meshes": [{"primitives": [{"mode": 4, "attributes": {"POSITION": 0},
                                   "indices": 1, "material": 0}]}],
        "nodes": [{"translation": [0.25, 1, 0], "children": [1]},
                  {"mesh": 0, "scale": [1, 1.25, 1]}],
        "scenes": [{"nodes": [0]}],
        "scene": 0,
    }
    return encode_glb(document, binary)


if __name__ == "__main__":
    DESTINATION.mkdir(parents=True, exist_ok=True)
    (DESTINATION / "badge.png").write_bytes(sprite())
    (DESTINATION / "gem.glb").write_bytes(model())
    sprites = ROOT / "examples" / "sprites" / "assets"
    sprites.mkdir(parents=True, exist_ok=True)
    (sprites / "token.png").write_bytes(tile_sprite(True))
    (sprites / "tile.png").write_bytes(tile_sprite(False))
    static = ROOT / "examples" / "static" / "assets"
    static.mkdir(parents=True, exist_ok=True)
    (static / "assembly.glb").write_bytes(static_instances())
