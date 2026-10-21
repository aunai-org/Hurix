"""True-colour close-ups: the visible channels of the satellite that tracks each storm, on the storm's tangent grid.

Writes data/storms/sN/storm_vis.jpg (2048 px over 2048 km, 1 km pixels): red, green and blue reflectance divided by the
cosine of the solar zenith angle, so the picture reads as surface and cloud colour whatever the sun angle. The page fades
it out where the sun was low or down at the frame time and shows infrared there instead.

Himawari-9 has real blue, green and red bands (1, 2, 3). GOES has blue and red (1, 2) plus a near-infrared "veggie" band
(3); its green is synthesised from the three the way CIMSS does it.

It also cuts a true-colour frame (1024 px) for each infrared loop frame, loop/vNN.jpg, so the loop plays in true colour.

Usage: FRAME=YYYY-MM-DDTHH:MM python3 visible.py OUT_DIR      (after storms.py has written OUT_DIR/meta.json)
"""
import json, os, sys
import concurrent.futures as cf
from datetime import datetime, timedelta
import numpy as np
import netCDF4 as nc
from PIL import Image
from scipy import ndimage

import storms as S

NV, KMV = 2048, 2048.0  # 1 km pixels over the same 2048 km square as the infrared close-up


def subsolar(when):
    """Subsolar latitude and longitude (degrees), good to a few tenths of a degree."""
    d = (when - datetime(2000, 1, 1, 12)).total_seconds() / 86400
    g, q = np.radians(357.529 + 0.98560028 * d), np.radians(280.459 + 0.98564736 * d)
    lam = q + np.radians(1.915) * np.sin(g) + np.radians(0.020) * np.sin(2 * g)
    eps = np.radians(23.439 - 0.00000036 * d)
    dec = np.arcsin(np.sin(eps) * np.sin(lam))
    ra = np.arctan2(np.cos(eps) * np.sin(lam), np.cos(lam))
    gmst = (280.46061837 + 360.98564736629 * d) % 360
    return np.degrees(dec), (np.degrees(ra) - gmst + 540) % 360 - 180


def cos_sza(lat, lon, when):
    dec, lon_s = subsolar(when)
    la, de = np.radians(lat), np.radians(dec)
    return np.sin(la) * np.sin(de) + np.cos(la) * np.cos(de) * np.cos(np.radians(lon - lon_s))


def hima_band(band, when, lat, lon):
    """One Himawari visible band around the storm. Tiles are 550 px at 2 km, so 1100 px at 1 km and 2200 px at 0.5 km."""
    hima = S.HIMA = S.HIMA or S.Himawari()
    la, lo = S.grid_latlon(lat, lon, 32, KMV)
    x, y = S.scan_angles(la, lo, hima.p)
    cols = (x[np.isfinite(x)] - hima.x0) / hima.dx; rows = (y[np.isfinite(y)] - hima.y0) / hima.dy
    if not cols.size:
        raise ValueError("storm is outside the Himawari disc")
    r0, r1 = int(max(rows.min(), 0)) // 550, int(min(rows.max(), 5499)) // 550
    c0, c1 = int(max(cols.min(), 0)) // 550, int(min(cols.max(), 5499)) // 550
    keys = [k for k in S.listing("noaa-himawari9", f"AHI-L2-FLDK-ISatSS/{when:%Y/%m/%d/%H%M}/") if f"M1C{band:02d}" in k]
    need = [k for k in keys if (rc := hima.tiles.get(int(k.split("-T")[1][:3]))) and r0 <= rc[0] // 550 <= r1 and c0 <= rc[1] // 550 <= c1]
    if not need:
        raise FileNotFoundError(f"no Himawari band {band} tiles at {when:%Y-%m-%d %H:%M}")
    folder = os.path.join(S.CACHE, "himawari9", f"{when:%Y%m%d%H%M}")
    with cf.ThreadPoolExecutor(16) as ex:
        paths = list(ex.map(lambda k: S.download("noaa-himawari9", k, os.path.join(folder, os.path.basename(k))), need))
    first = nc.Dataset(paths[0]); t = first["Sectorized_CMI"].shape[0]; f = t // 550
    xs, ys = first["x"][:] * 1e-6, first["y"][:] * 1e-6
    dx, dy = float(xs[1] - xs[0]), float(ys[1] - ys[0])
    x0 = float(xs[0]) - int(first.tile_column_offset) * dx; y0 = float(ys[0]) - int(first.tile_row_offset) * dy
    first.close()
    img = np.full(((r1 - r0 + 1) * t, (c1 - c0 + 1) * t), np.nan, np.float32)
    for path in paths:
        d = nc.Dataset(path); r, c = int(d.tile_row_offset), int(d.tile_column_offset)
        v = np.ma.filled(d["Sectorized_CMI"][:].astype(np.float32), np.nan)
        img[r - r0 * t:r - r0 * t + v.shape[0], c - c0 * t:c - c0 * t + v.shape[1]] = v
        d.close()
    if f == 4:  # 0.5 km red band: average 2x2 down to 1 km so it matches the other two
        img = img[: img.shape[0] // 2 * 2, : img.shape[1] // 2 * 2].reshape(img.shape[0] // 2, 2, img.shape[1] // 2, 2).mean((1, 3))
        x0, dx, y0, dy = x0 + dx / 2, dx * 2, y0 + dy / 2, dy * 2
    tw, th = img.shape[1] // (c1 - c0 + 1), img.shape[0] // (r1 - r0 + 1)  # tile size at the final resolution
    return S.Disc(img, x0 + c0 * tw * dx, dx, y0 + r0 * th * dy, dy, hima.p)


def goes_band(sat, band, when, lat, lon):
    """One GOES visible band around the storm, read as a window from the full-disk file (band 2 is 0.5 km)."""
    num = sat[-2:]
    keys = [k for k in S.listing(f"noaa-goes{num}", f"ABI-L2-CMIPF/{when:%Y/%j/%H}/") if f"C{band:02d}_G{num}" in k and f"_s{when:%Y%j%H%M}" in k]
    if not keys:
        raise FileNotFoundError(f"no GOES-{num} band {band} at {when:%Y-%m-%d %H:%M}")
    path = S.download(f"noaa-goes{num}", keys[0], os.path.join(S.CACHE, sat, f"{when:%Y%m%d%H%M}_C{band:02d}.nc"))
    d = nc.Dataset(path); p = d["goes_imager_projection"]
    proj = {"a": p.semi_major_axis, "b": p.semi_minor_axis, "h": p.perspective_point_height + p.semi_major_axis,
            "lon0": p.longitude_of_projection_origin, "sweep": p.sweep_angle_axis}
    xs, ys = d["x"][:], d["y"][:]
    dx, dy = float(xs[1] - xs[0]), float(ys[1] - ys[0])
    la, lo = S.grid_latlon(lat, lon, 32, KMV)
    x, y = S.scan_angles(la, lo, proj)
    cols = (x[np.isfinite(x)] - float(xs[0])) / dx; rows = (y[np.isfinite(y)] - float(ys[0])) / dy
    c0, c1 = int(max(cols.min() - 4, 0)), int(min(cols.max() + 4, len(xs) - 1))
    r0, r1 = int(max(rows.min() - 4, 0)), int(min(rows.max() + 4, len(ys) - 1))
    img = np.ma.filled(d["CMI"][r0:r1 + 1, c0:c1 + 1].astype(np.float32), np.nan)
    d.close()
    x0, y0 = float(xs[0]) + c0 * dx, float(ys[0]) + r0 * dy
    if band == 2:
        img = img[: img.shape[0] // 2 * 2, : img.shape[1] // 2 * 2].reshape(img.shape[0] // 2, 2, img.shape[1] // 2, 2).mean((1, 3))
        x0, dx, y0, dy = x0 + dx / 2, dx * 2, y0 + dy / 2, dy * 2
    return S.Disc(img, x0, dx, y0, dy, proj)


def sample(disc, la, lo):
    """Like Disc.sample, but reflectance (fill 0, not 300 K)."""
    x, y = S.scan_angles(la, lo, disc.p)
    ok = np.isfinite(x)
    fc = np.where(ok, (x - disc.x0) / disc.dx, -1); fr = np.where(ok, (y - disc.y0) / disc.dy, -1)
    h, w = disc.img.shape
    ok &= (fc >= 0) & (fc <= w - 1) & (fr >= 0) & (fr <= h - 1)
    out = ndimage.map_coordinates(np.nan_to_num(disc.img, nan=0.0), [np.where(ok, fr, 0), np.where(ok, fc, 0)], order=1)
    return np.where(ok, out, 0.0).astype(np.float32)


def true_colour(sat, when, lat, lon):
    la, lo = S.grid_latlon(lat, lon, NV, KMV)
    if sat == "himawari9":
        b, g, r = (sample(hima_band(k, when, lat, lon), la, lo) for k in (1, 2, 3))
    else:
        b, r, nir = (sample(goes_band(sat, k, when, lat, lon), la, lo) for k in (1, 2, 3))
        g = np.clip(0.45 * r + 0.1 * nir + 0.45 * b, 0, 1)
    mu = cos_sza(la, lo, when)
    norm = 1 / np.clip(mu, 0.12, 1)
    rgb = np.stack([r, g, b], -1) * norm[..., None]
    # take off some of the blue haze the atmosphere adds (more at low sun), then a gentle tone curve
    rgb -= np.array([0.02, 0.03, 0.06]) * (0.6 + 0.4 * norm[..., None]) * (1 - np.clip(rgb.mean(-1, keepdims=True) * 1.6, 0, 1))
    rgb = np.clip(rgb, 0, 1.2) / 1.2
    rgb = rgb ** (1 / 1.9)
    return (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8), float(np.mean(mu > 0.1))


def main():
    out = sys.argv[1]
    frame = datetime.strptime(os.environ["FRAME"], "%Y-%m-%dT%H:%M")
    path = os.path.join(out, "meta.json")
    meta = json.load(open(path))
    sat_of = {v: k for k, v in S.SAT_NAMES.items()}
    for st in meta["storms"]:
        sat = sat_of[st["satellite"]]
        img = None
        for dm in (0, -10, 10):
            try:
                img, day = true_colour(sat, frame - timedelta(minutes=dm), st["eye"]["lat"], st["eye"]["lon"]); break
            except (FileNotFoundError, OSError) as e:
                print("  skip", st["id"], dm, e)
        st.pop("visible", None)
        if img is None or day < 0.05:
            print(st["id"], "no daylight visible image"); continue
        Image.fromarray(img).save(os.path.join(out, "storms", st["id"], "storm_vis.jpg"), quality=88)
        st["visible"] = True
        print(st["id"], f"visible: {day:.0%} of the close-up in daylight")
        # the loop in true colour, frame for frame with the infrared loop; any frame that fails ends it (the page falls
        # back to infrared for the loop)
        st.pop("visLoop", None)
        n = 0
        for i, t in enumerate(st.get("loopTimes", [])):
            try:
                im, _ = true_colour(sat, datetime.strptime(t, "%Y-%m-%dT%H:%MZ"), st["eye"]["lat"], st["eye"]["lon"])
            except (FileNotFoundError, OSError) as e:
                print("  loop stop", t, e); break
            Image.fromarray(im).resize((1024, 1024), Image.LANCZOS).save(os.path.join(out, "storms", st["id"], "loop", f"v{i:02d}.jpg"), quality=88)
            n += 1
        if n == len(st.get("loopTimes", [])) and n > 1:
            st["visLoop"] = n
        print(st["id"], f"true-colour loop: {n} frames")
    json.dump(meta, open(path, "w"))


if __name__ == "__main__":
    main()
