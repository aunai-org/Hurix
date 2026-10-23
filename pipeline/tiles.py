"""The HD cloud tiles: the stitched IR map at 16384 x 8192 (about 2.4 km a pixel) cut into 32 x 16 tiles of 512 px,
written as tiles/{row}_{col}.jpg (row 0 at the north, col 0 at 180 W; same code as ir_global.jpg). Tiles no
geostationary satellite sees are skipped; meta.json lists the rest in tiles.have. The page loads the ones around
where you look when HD is on and you zoom in.

Usage: python3 tiles.py OUT_DIR      (after storms.py has written OUT_DIR/meta.json)
"""
import json, os, sys
import concurrent.futures as cf
import numpy as np
from PIL import Image

import reproject as R

HERE = os.path.dirname(os.path.abspath(__file__))
COLS, ROWS, SIZE = 32, 16, 512
code = lambda bt: np.clip((320 - bt) / 140, 0, 1)


def tile_lonlat(r, c, cols=COLS, rows=ROWS, size=SIZE):
    """Pixel-centre longitudes and latitudes (degrees) of tile (r, c) on the cols*size x rows*size world grid."""
    W, H = cols * size, rows * size
    lon = -180 + (c * size + np.arange(size) + 0.5) * 360 / W
    lat = 90 - (r * size + np.arange(size) + 0.5) * 180 / H
    return lon, lat


def main(out_dir):
    folder = os.path.join(out_dir, "tiles")
    os.makedirs(folder, exist_ok=True)
    for f in os.listdir(folder):  # last run's tiles, so a tile gone dark is not served stale
        if f.endswith(".jpg"):
            os.remove(os.path.join(folder, f))
    sats = R.load_sats(HERE)
    arch_img = Image.open(os.path.join(HERE, "cache", "clouds.png")).convert("RGBA").getchannel("A")
    aw, ah = arch_img.size
    W = COLS * SIZE
    lon = -180 + (np.arange(W) + 0.5) * 360 / W

    def band(r):
        """Row r of tiles as IR code (uint8) and live coverage, or None where no satellite sees it."""
        _, lat = tile_lonlat(r, 0)
        halves = [R.stitch(*R.grid(lon, part), sats) for part in np.split(lat, 2)]  # half the working memory per thread
        bt = np.concatenate([h[0] for h in halves]); live = np.nan_to_num(np.concatenate([h[2] for h in halves]))
        if not live.any():
            return None
        # archival clouds in the gap, as export.py does for ir_global.jpg
        arch = np.asarray(arch_img.resize((W, SIZE), Image.BILINEAR, box=(0, r * ah / ROWS, aw, (r + 1) * ah / ROWS)), np.float32) / 255
        archbt = 292 - arch * 87
        blend = live * np.where(np.isfinite(bt), bt, archbt) + (1 - live) * archbt
        return (code(blend) * 255 + 0.5).astype(np.uint8), live

    have = []
    with cf.ThreadPoolExecutor(2) as ex:  # numpy's trig releases the GIL; two bands at a time stay under 3 GB
        for r, out in enumerate(ex.map(band, range(ROWS))):
            if out is None:
                continue
            img, live = out
            for c in range(COLS):
                if live[:, c * SIZE:(c + 1) * SIZE].any():
                    Image.fromarray(img[:, c * SIZE:(c + 1) * SIZE]).save(os.path.join(folder, f"{r}_{c}.jpg"), quality=85)
                    have.append(f"{r}_{c}")
            print("tiles row", r, sum(h.startswith(f"{r}_") for h in have))
    path = os.path.join(out_dir, "meta.json")
    if os.path.exists(path):
        meta = json.load(open(path)); meta["tiles"] = {"cols": COLS, "rows": ROWS, "size": SIZE, "have": have}
        json.dump(meta, open(path, "w"))
    return have


if __name__ == "__main__":
    main(sys.argv[1])
