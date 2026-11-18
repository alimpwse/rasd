"""Generate the app's simple geometric home-screen mark, without dependencies."""
from pathlib import Path
import struct
import zlib

root = Path(__file__).resolve().parents[1] / 'dist' / 'icons'
def chunk(tag, data):
    return struct.pack('!I', len(data)) + tag + data + struct.pack('!I', zlib.crc32(tag + data) & 0xffffffff)
for size in (192, 512):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            px, py = (x + .5) * 512 / size, (y + .5) * 512 / size
            radius = ((px-256)**2 + (py-256)**2)**.5
            ring = 55 <= radius <= 73 or radius <= 14
            corners = ((129 <= px <= 147 or 365 <= px <= 383) and (129 <= py <= 196 or 316 <= py <= 383)) or ((129 <= py <= 147 or 365 <= py <= 383) and (129 <= px <= 196 or 316 <= px <= 383))
            rows.extend((255,196,74) if ring or corners else (23,27,27))
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B',size,size,8,2,0,0,0)) + chunk(b'IDAT',zlib.compress(rows)) + chunk(b'IEND',b'')
    (root / f'icon-{size}.png').write_bytes(png)
