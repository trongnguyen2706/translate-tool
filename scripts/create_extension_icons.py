"""Generate the Phrasebook book/letter mark as deterministic PNGs; no font dependency."""
import struct
import zlib
from pathlib import Path

root = Path(__file__).resolve().parents[1] / "extension" / "icons"
root.mkdir(parents=True, exist_ok=True)
for size in (16, 32, 48, 128):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            nx, ny = x / size, y / size
            # Open book with an upright spine and page lines.
            white = (0.23 <= nx <= 0.30 and 0.22 <= ny <= 0.78) or (0.30 <= nx <= 0.74 and (0.22 <= ny <= 0.29 or 0.48 <= ny <= 0.55)) or (0.67 <= nx <= 0.74 and 0.22 <= ny <= 0.55)
            rows.extend((255, 255, 255, 255) if white else (0, 47, 167, 255))
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
    (root / f"icon-{size}.png").write_bytes(png)
