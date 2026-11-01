#!/usr/bin/python3
"""Reproduce only the original services demo's PNG/PCM WAV assets; no downloads."""

import argparse
import math
import pathlib
import struct
import zlib

DESTINATION = pathlib.Path(__file__).resolve().parent.parent / "examples/services/assets"


def chunk(kind, payload):
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(
        ">I", zlib.crc32(kind + payload) & 0xFFFFFFFF
    )


def sprite(blink):
    rows = bytearray()
    for y in range(24):
        rows.append(0)
        for x in range(24):
            color = (0, 0, 0, 0)
            if 3 <= x <= 20 and 3 <= y <= 19 and abs(x - 11.5) + abs(y - 11) < 16:
                color = (77, 225, 201, 255)
            if x in (8, 15) and (y == 10 or (not blink and y == 9)):
                color = (18, 24, 41, 255)
            if y == 14 and 9 <= x <= 14:
                color = (235, 243, 255, 255)
            if y in (20, 21) and x in ((6, 7, 16, 17) if blink else (5, 6, 17, 18)):
                color = (235, 243, 255, 255)
            rows.extend(color)
    header = struct.pack(">IIBBBBB", 24, 24, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(
        b"IDAT", zlib.compress(bytes(rows), 9)
    ) + chunk(b"IEND", b"")


def chime():
    rate, frames = 16000, 2560
    samples = bytearray()
    for frame in range(frames):
        t = frame / rate
        envelope = math.sin(math.pi * frame / (frames - 1)) ** 2
        signal = (math.sin(2 * math.pi * 440 * t) + math.sin(2 * math.pi * 660 * t)) / 2
        samples.extend(struct.pack("<h", round(32767 * 0.15 * envelope * signal)))
    fmt = struct.pack("<HHIIHH", 1, 1, rate, rate * 2, 2, 16)
    body = b"WAVEfmt " + struct.pack("<I", len(fmt)) + fmt
    body += b"data" + struct.pack("<I", len(samples)) + samples
    return b"RIFF" + struct.pack("<I", len(body)) + body


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check bytes without writing")
    options = parser.parse_args()
    files = {"awake.png": sprite(False), "blink.png": sprite(True), "chime.wav": chime()}
    if options.check:
        for name, content in files.items():
            path = DESTINATION / name
            if not path.is_file() or path.read_bytes() != content:
                parser.exit(1, "Generated asset differs: " + str(path) + "\n")
        print("Original services demo assets match their generator.")
    else:
        DESTINATION.mkdir(parents=True, exist_ok=True)
        for name, content in files.items():
            (DESTINATION / name).write_bytes(content)


if __name__ == "__main__":
    main()
