"""Stitch GOES-19, GOES-18 and Himawari-9 band-13 IR into one equirectangular brightness-temperature map,
plus a cloud-top height map (GOES ACHA where available, IR-derived elsewhere)."""
import glob, os, sys
import numpy as np
import netCDF4 as nc

W, H = int(sys.argv[1]) if len(sys.argv) > 1 else 4096, None
H = W // 2
lon = np.linspace(-180, 180, W, endpoint=False) + 180 / W
lat = np.linspace(90, -90, H, endpoint=False) - 90 / H
LON, LAT = np.meshgrid(np.radians(lon), np.radians(lat))


def scan_angles(lon0, hsat, a, b, sweep):
    e2 = 1 - b * b / (a * a)
    latc = np.arctan((b * b) / (a * a) * np.tan(LAT))
    rc = b / np.sqrt(1 - e2 * np.cos(latc) ** 2)
    dl = LON - np.radians(lon0)
    sx = hsat - rc * np.cos(latc) * np.cos(dl)
    sy = -rc * np.cos(latc) * np.sin(dl)
    sz = rc * np.sin(latc)
    vis = hsat * (hsat - sx) >= sy * sy + (a * a) / (b * b) * sz * sz
    if sweep == "x":
        x = np.arcsin(-sy / np.sqrt(sx * sx + sy * sy + sz * sz)); y = np.arctan(sz / sx)
    else:
        x = np.arctan(-sy / sx); y = np.arcsin(sz / np.sqrt(sx * sx + sy * sy + sz * sz))
    # view angle weight: cosine of angle between local vertical and satellite direction
    nx, ny, nz = np.cos(LAT) * np.cos(dl), np.cos(LAT) * np.sin(dl), np.sin(LAT)
    px, py, pz = hsat - rc * np.cos(latc) * np.cos(dl), -rc * np.cos(latc) * np.sin(dl), -rc * np.sin(latc)
    cosz = (nx * px - ny * py + nz * pz) / np.sqrt(px * px + py * py + pz * pz)
    return x, y, vis, cosz


def sample(img, xs, ys, x, y):
    """Nearest-neighbour lookup of img (rows=ys, cols=xs, both monotonic) at scan angles x, y."""
    xi = np.rint((x - xs[0]) / (xs[1] - xs[0])).astype(np.int64)
    yi = np.rint((y - ys[0]) / (ys[1] - ys[0])).astype(np.int64)
    ok = (xi >= 0) & (xi < len(xs)) & (yi >= 0) & (yi < len(ys))
    out = np.full(x.shape, np.nan, np.float32)
    out[ok] = img[yi[ok], xi[ok]]
    return out


def goes(c13, acha):
    d = nc.Dataset(c13); p = d["goes_imager_projection"]
    a, b = p.semi_major_axis, p.semi_minor_axis; hs = p.perspective_point_height + a; lon0 = p.longitude_of_projection_origin
    x, y, vis, cosz = scan_angles(lon0, hs, a, b, p.sweep_angle_axis)
    bt = sample(np.ma.filled(d["CMI"][:].astype(np.float32), np.nan), d["x"][:], d["y"][:], x, y)
    e = nc.Dataset(acha)
    ht = sample(np.ma.filled(e["HT"][:].astype(np.float32), np.nan), e["x"][:], e["y"][:], x, y)
    bt[~vis] = np.nan; ht[~vis] = np.nan
    return bt, ht, np.where(vis, cosz, -1)


def himawari(folder):
    full = np.full((5500, 5500), np.nan, np.float32)
    xs = np.zeros(5500); ys = np.zeros(5500); proj = None
    for f in sorted(glob.glob(os.path.join(folder, "*.nc"))):
        d = nc.Dataset(f)
        r, c = int(d.tile_row_offset), int(d.tile_column_offset)
        v = np.ma.filled(d["Sectorized_CMI"][:].astype(np.float32), np.nan)
        full[r:r + v.shape[0], c:c + v.shape[1]] = v
        xs[c:c + v.shape[1]] = d["x"][:] * 1e-6; ys[r:r + v.shape[0]] = d["y"][:] * 1e-6
        known = (c, float(d["x"][0]) * 1e-6, float(d["x"][1] - d["x"][0]) * 1e-6, r, float(d["y"][0]) * 1e-6, float(d["y"][1] - d["y"][0]) * 1e-6)
        proj = d["fixedgrid_projection"]
        a, b, lon0, hp, sweep = proj.semi_major, proj.semi_minor, proj.longitude_of_projection_origin, proj.perspective_point_height, proj.sweep_angle_axis
    c0, x0, dx, r0, y0, dy = known
    xs = x0 + (np.arange(5500) - c0) * dx; ys = y0 + (np.arange(5500) - r0) * dy
    x, y, vis, cosz = scan_angles(lon0, hp + a, a, b, sweep)
    bt = sample(full, xs, ys, x, y); bt[~vis] = np.nan
    return bt, np.where(vis, cosz, -1)


here = os.path.dirname(os.path.abspath(__file__))
g19 = goes(f"{here}/g19_c13.nc", f"{here}/g19_acha.nc")
g18c, g18a = f"{here}/g18_c13.nc", f"{here}/g18_acha.nc"
g18 = goes(g18c, g18a)
hbt, hcos = himawari(f"{here}/hima")

# pick the satellite with the best view; feather seams by blending the two best within a small margin
cands = [(g19[0], g19[1], g19[2]), (g18[0], g18[1], g18[2]), (hbt, np.full_like(hbt, np.nan), hcos)]
cos = np.stack([np.where(np.isfinite(c[0]), c[2], -1) for c in cands])
bts = np.stack([c[0] for c in cands]); hts = np.stack([c[1] for c in cands])
order = np.argsort(-cos, axis=0)
best, second = order[0], order[1]
take = lambda arr, idx: np.take_along_axis(arr, idx[None], 0)[0]
c1, c2 = take(cos, best), take(cos, second)
w = np.clip((c1 - c2) / 0.08, 0, 1) * 0.5 + 0.5
b1, b2 = take(bts, best), take(bts, second)
bt = np.where(np.isfinite(b2) & (c2 > 0.05), w * b1 + (1 - w) * b2, b1)
bt = np.where(c1 > 0.05, bt, np.nan)
ht = take(hts, best)
coverage = np.clip((c1 - 0.05) / 0.15, 0, 1)  # fades out near the disc edges

np.savez_compressed(f"{here}/stitched_{W}.npz", bt=bt.astype(np.float32), ht=ht.astype(np.float32), cov=coverage.astype(np.float32))
print("bt range", np.nanmin(bt), np.nanmax(bt), "coverage", np.mean(coverage > 0), "acha", np.mean(np.isfinite(ht)))
