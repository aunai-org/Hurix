"""Motion between consecutive replay frames, so the page can slide the clouds along it instead of fading one frame into
the next. DIS optical flow (OpenCV) on each pair, averaged down to a small grid and written as an RGB PNG:
R = 128 + dx/max*127, G = 128 + dy/max*127, in source pixels, dy pointing down the image (clipped at +-max).

  storms/<id>/loop/mNN.png   fNN -> fNN+1 (infrared, 128 x 128)
  storms/<id>/loop/wNN.png   vNN -> vNN+1 (true colour, 128 x 128)
  globe/mNN.png              gNN -> gNN+1, the last one to ir_global.jpg (256 x 128)

meta.json gets "flow": the max of each kind. A pair without a file falls back to the page's hold-then-fade.
Usage: python3 flow.py OUT_DIR      (last, after globe.py)
"""
import json, os, sys
import cv2
import numpy as np
from PIL import Image

MAX = {"ir": 48, "vis": 64, "globe": 16}
STORM_GRID, GLOBE_GRID = (128, 128), (256, 128)  # (width, height)


def motion(a, b, grid):
    """dx, dy (source pixels) carrying a to b, area-averaged to grid = (width, height)."""
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    return cv2.resize(dis.calc(a, b, None), grid, interpolation=cv2.INTER_AREA).astype(np.float32)


def encode(f, max_px):
    rg = np.clip(128 + f / max_px * 127, 1, 255)
    return Image.fromarray(np.dstack([rg, np.full(f.shape[:2], 128.0)]).round().astype(np.uint8))


def decode(img, max_px):
    return (np.asarray(img, np.float32)[..., :2] - 128) / 127 * max_px


def interpolate(a, b, f_full, t):
    """The in-between frame at t: a carried forward t of the way, b carried back the rest, then cross-faded."""
    h, w = a.shape
    f = cv2.resize(f_full, (w, h), interpolation=cv2.INTER_LINEAR)  # values stay in source pixels, as the shader reads them
    fx, fy = f[..., 0], f[..., 1]
    yy, xx = np.mgrid[:h, :w].astype(np.float32)
    wa = cv2.remap(a, xx - t * fx, yy - t * fy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    wb = cv2.remap(b, xx + (1 - t) * fx, yy + (1 - t) * fy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return wa * (1 - t) + wb * t


def grey(path, size=None):
    im = Image.open(path).convert("L")
    return np.asarray(im.resize(size, Image.BILINEAR) if size and im.size != size else im)


def pairs(frames, prefix, folder, max_px, grid):
    """Motion files for consecutive frames; returns how many were written."""
    n = 0
    for i, (a, b) in enumerate(zip(frames, frames[1:])):
        A = grey(a); B = grey(b, Image.open(a).size)
        encode(motion(A, B, grid), max_px).save(os.path.join(folder, f"{prefix}{i:02d}.png"), optimize=True)
        n += 1
    return n


def main(out_dir):
    meta_path = os.path.join(out_dir, "meta.json")
    meta = json.load(open(meta_path))
    for st in meta.get("storms", []):
        loop = os.path.join(out_dir, "storms", st["id"], "loop")
        try:  # one storm that fails falls back to hold-then-fade; the others still slide
            ir = pairs([os.path.join(loop, f"f{i:02d}.jpg") for i in range(st.get("loopFrames", 0))], "m", loop, MAX["ir"], STORM_GRID)
            vis = pairs([os.path.join(loop, f"v{i:02d}.jpg") for i in range(len(st.get("visTimes") or []))], "w", loop, MAX["vis"], STORM_GRID)
            print(st["id"], "motion:", ir, "infrared,", vis, "true colour")
        except Exception as e:
            print(st["id"], "motion skipped:", e)
    globe = os.path.join(out_dir, "globe")
    try:
        frames = [os.path.join(globe, f"g{i:02d}.jpg") for i in range(len(meta.get("globeTimes") or []))]
        frames += [os.path.join(out_dir, "ir_global.jpg")] if frames else []  # the page plays the frame itself last
        print("globe motion:", pairs(frames, "m", globe, MAX["globe"], GLOBE_GRID))
    except Exception as e:
        print("globe motion skipped:", e)
    meta["flow"] = MAX
    json.dump(meta, open(meta_path, "w"))


if __name__ == "__main__":
    main(sys.argv[1])
