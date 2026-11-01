#!/usr/bin/env python3
"""Reproduce Nova's original geometric PNG and static GLB fixtures; no downloads."""

import json
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
    encoded = json.dumps(document, separators=(",", ":")).encode("ascii")
    encoded += b" " * (-len(encoded) % 4)
    body = struct.pack("<I4s", len(encoded), b"JSON") + encoded
    body += struct.pack("<I4s", len(binary), b"BIN\x00") + binary
    return struct.pack("<4sII", b"glTF", 2, len(body) + 12) + body


if __name__ == "__main__":
    DESTINATION.mkdir(parents=True, exist_ok=True)
    (DESTINATION / "badge.png").write_bytes(sprite())
    (DESTINATION / "gem.glb").write_bytes(model())
