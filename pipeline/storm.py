"""Find the typhoon's eye in Himawari-9 band-13 frames, track it back in time, and cut a 2 km close-up patch."""
import json, os, sys, urllib.request, concurrent.futures as cf
from datetime import datetime, timedelta
import numpy as np
import netCDF4 as nc

HERE = os.path.dirname(os.path.abspath(__file__))
BUCKET = "https://noaa-himawari9.s3.amazonaws.com"
A, B, HP, LON0 = 6378137.0, 6356752.31414, 35785831.0, 140.7
HS = HP + A
DX = 55.88799029559623e-6  # 2 km pixel in radians
X0 = -153719.91730803743e-6 + DX * 0  # placeholder, recomputed from a tile


def listing(prefix):
    keys, token = [], None
    while True:
        url = f"{BUCKET}/?list-type=2&prefix={prefix}&max-keys=1000" + (f"&continuation-token={urllib.parse.quote(token)}" if token else "")
        x = urllib.request.urlopen(url, timeout=60).read().decode()
        keys += [k.split("</Key>")[0] for k in x.split("<Key>")[1:]]
        if "<NextContinuationToken>" not in x:
            return keys
        token = x.split("<NextContinuationToken>")[1].split("<")[0]


import urllib.parse, glob
TILEMAP = {}
for _p in glob.glob(os.path.join(HERE, "hima", "*.nc")):
    _d = nc.Dataset(_p)
    TILEMAP[int(_p.split("-T")[1][:3])] = (int(_d.tile_row_offset) // 550, int(_d.tile_column_offset) // 550)


def fetch_tiles(when, rows, cols):
    """Download the band-13 tiles covering rows x cols (tile indices) at `when` and assemble them."""
    pre = f"AHI-L2-FLDK-ISatSS/{when:%Y/%m/%d/%H%M}/"
    keys = [k for k in listing(pre) if "M1C13" in k]
    out = os.path.join(HERE, "frames", f"{when:%H%M%d}")
    os.makedirs(out, exist_ok=True)
    need = []
    for k in keys:
        t = int(k.split("-T")[1][:3])
        rc = TILEMAP.get(t)
        if rc and rc[0] in rows and rc[1] in cols:
            need.append((t, k))
    def get(k):
        p = os.path.join(out, os.path.basename(k))
        if not os.path.exists(p):
            urllib.request.urlretrieve(f"{BUCKET}/{k}", p)
        return p
    # tile numbering skips space corners, so read offsets from the files themselves (cheap: tiles are small)
    with cf.ThreadPoolExecutor(16) as ex:
        paths = list(ex.map(get, [k for _, k in need]))
    r0, c0 = rows[0] * 550, cols[0] * 550
    img = np.full((len(rows) * 550, len(cols) * 550), np.nan, np.float32)
    xs = ys = None
    for p in paths:
        d = nc.Dataset(p)
        r, c = int(d.tile_row_offset), int(d.tile_column_offset)
        if r // 550 in rows and c // 550 in cols:
            img[r - r0:r - r0 + 550, c - c0:c - c0 + 550] = np.ma.filled(d["Sectorized_CMI"][:].astype(np.float32), np.nan)
            xx = d["x"][:] * 1e-6; yy = d["y"][:] * 1e-6
            xs = xx[0] - (c - c0) * DX; ys = yy[0] + (r - r0) * DX
    if xs is None:  # e.g. Himawari's daily housekeeping slot at 02:40 UTC has no data
        raise FileNotFoundError(f"no band-13 tiles at {when:%Y-%m-%d %H:%M}")
    return img, xs, ys  # x of column 0, y of row 0 (y decreases downward)


def to_scan(lat, lon):
    """Forward geostationary projection (sweep y): lat/lon in degrees to scan angles x, y in radians."""
    la, lo = np.radians(lat), np.radians(lon - LON0)
    e2 = 1 - B * B / (A * A); latc = np.arctan(B * B / (A * A) * np.tan(la)); rc = B / np.sqrt(1 - e2 * np.cos(latc) ** 2)
    sx = HS - rc * np.cos(latc) * np.cos(lo); sy = -rc * np.cos(latc) * np.sin(lo); sz = rc * np.sin(latc)
    return np.arctan(-sy / sx), np.arcsin(sz / np.sqrt(sx * sx + sy * sy + sz * sz))


def pix_to_latlon(col, row, x0, y0):
    from scipy.optimize import least_squares
    tx, ty = x0 + col * DX, y0 - row * DX
    r = least_squares(lambda p: np.array(to_scan(p[0], p[1])) - [tx, ty], [0.0, LON0], x_scale=[1, 1])
    return float(r.x[0]), float(r.x[1])


def find_eye(img, guess=None, search=120):
    """The eye: the warmest small spot that is ringed by very cold cloud tops."""
    from scipy.ndimage import uniform_filter, minimum_filter
    f = np.nan_to_num(img, nan=300.0)
    if guess is None:
        cold = uniform_filter((f < 220).astype(np.float32), 61)
        cy, cx = np.unravel_index(np.argmax(cold), f.shape)
    else:
        cx, cy = guess
    y0, y1 = max(cy - search, 0), min(cy + search, f.shape[0]); x0, x1 = max(cx - search, 0), min(cx + search, f.shape[1])
    sub = f[y0:y1, x0:x1]
    ring = minimum_filter(sub, size=31)  # coldest top within ~30 km
    local = uniform_filter(sub, 3)
    score = local - ring  # warm centre, cold surroundings
    score[ring > 240] = -1
    ey, ex = np.unravel_index(np.argmax(score), sub.shape)
    return x0 + ex, y0 + ey, float(local[ey, ex]), float(ring[ey, ex]), float(score[ey, ex])


if __name__ == "__main__":
    t_end = datetime.strptime(os.environ["FRAME"], "%Y-%m-%dT%H:%M")
    rows, cols = [int(v) for v in os.environ.get("ROWS", "2,3,4").split(",")], [int(v) for v in os.environ.get("COLS", "2,3,4,5,6").split(",")]  # tiles around the storm
    track = []
    guess = None
    frames = []
    pts = []
    for h in range(0, 49, 3):
        img = None
        for dm in (0, -10, 10):  # a missing slot falls back to its neighbour 10 minutes away
            when = t_end - timedelta(hours=h, minutes=dm)
            try:
                img, x0, y0 = fetch_tiles(when, rows, cols); break
            except Exception as e:
                print("skip", when, e)
        if img is None:  # a missing fix is left out, not filled in
            continue
        if len(pts) >= 2:  # extrapolate the motion of the last two fixes
            guess = (2 * pts[-1][0] - pts[-2][0], 2 * pts[-1][1] - pts[-2][1])
        ex, ey, teye, tring, score = find_eye(img, guess, search=120 if guess is None else 40)
        if tring > 240 and track:  # no deep convection near the centre: too weak to fix reliably, so the track ends here
            print("stop", when, "ring", round(tring, 1)); break
        clear = teye > 260 and score > 50
        if not clear and guess is not None:  # no eye yet: centre of the coldest cloud mass near the expected spot
            from scipy.ndimage import gaussian_filter
            f = np.nan_to_num(img, nan=300.0); gx, gy = guess
            sub = gaussian_filter(f, 12)[gy - 60:gy + 60, gx - 60:gx + 60]
            dy, dx = np.unravel_index(np.argmin(sub), sub.shape); ex, ey = gx - 60 + dx, gy - 60 + dy
        pts.append((ex, ey)); guess = (ex, ey)
        lat, lon = pix_to_latlon(ex, ey, x0, y0)
        track.append({"t": when.strftime("%Y-%m-%dT%H:%MZ"), "lat": round(lat, 2), "lon": round(lon, 2),
                      "eyeK": round(teye, 1), "ringK": round(tring, 1), "eyeClear": bool(clear)})
        print(track[-1])
        if h == 0:
            np.savez_compressed(os.path.join(HERE, "storm_patch.npz"), bt=img, x0=x0, y0=y0, ex=ex, ey=ey)
    json.dump(track[::-1], open(os.path.join(HERE, "track.json"), "w"), indent=1)
