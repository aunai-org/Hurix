"""Turn the stitched map, the storm patch and the eye track into the files the page loads (data/ + data/meta.json).
Usage: FRAME=YYYY-MM-DDTHH:MM python3 export.py OUT_DIR"""
import json, os, sys
from datetime import datetime, timedelta
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]
FRAME = datetime.strptime(os.environ["FRAME"], "%Y-%m-%dT%H:%M")
os.makedirs(os.path.join(OUT, "loop"), exist_ok=True)
code = lambda bt: np.clip((320 - bt) / 140, 0, 1)

# global IR: live where a geostationary satellite sees well, archival clouds in the gap none of them covers
d = np.load(os.path.join(HERE, "stitched_4096.npz")); bt, live = d["bt"], np.nan_to_num(d["cov"])
arch = np.asarray(Image.open(os.path.join(HERE, "cache", "clouds.png")).convert("RGBA").getchannel("A"), np.float32) / 255
archbt = 292 - arch * 87
blend = live * np.where(np.isfinite(bt), bt, archbt) + (1 - live) * archbt
Image.fromarray((code(blend) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "ir_global.jpg"), quality=93)
Image.fromarray((live * 255).astype(np.uint8)).resize((1024, 512), Image.BILINEAR).save(os.path.join(OUT, "ir_live_mask.png"), optimize=True)

# 2 km close-up around the eye, and the eye's measurements
p = np.load(os.path.join(HERE, "storm_patch.npz")); img, ex, ey = p["bt"], int(p["ex"]), int(p["ey"])
half = 512
crop = np.pad(np.nan_to_num(img, nan=290), half, mode="edge")[ey:ey + 2 * half, ex:ex + 2 * half]
Image.fromarray((code(crop) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "storm_ir.png"), optimize=True)
lab, _ = ndimage.label(crop > 250)
eye_d = 2 * np.sqrt((lab == lab[half, half]).sum() * 4.0 / np.pi) if crop[half, half] > 250 else None
r = np.hypot(*np.mgrid[-half:half, -half:half]) * 2
cdo_r = float(np.sqrt(((crop < 210) & (r < 400)).sum() * 4 / np.pi))
eye_k = float(crop[half - 2:half + 3, half - 2:half + 3].max()); ring_k = float(ndimage.minimum_filter(crop, 31)[half, half])

# 3-hour, 10-minute loop of the same crop (the loop frames sit in frames/ from storm.py's tile cache, or are fetched)
sys.path.insert(0, HERE)
os.environ.setdefault("ROWS", "2,3,4"); os.environ.setdefault("COLS", "2,3,4,5,6")
import importlib.util
spec = importlib.util.spec_from_file_location("storm", os.path.join(HERE, "storm.py")); storm = importlib.util.module_from_spec(spec); spec.loader.exec_module(storm)
rows = [int(v) for v in os.environ["ROWS"].split(",")]; cols = [int(v) for v in os.environ["COLS"].split(",")]
n, times = 0, []
for k in range(17, -1, -1):
    when = FRAME - timedelta(minutes=10 * k)
    try:
        im, _, _ = storm.fetch_tiles(when, rows, cols)
    except Exception as e:
        print("loop skip", when, e); continue
    c = np.pad(np.nan_to_num(im, nan=290), half, mode="edge")[ey:ey + 2 * half, ex:ex + 2 * half]
    Image.fromarray((code(c) * 255 + .5).astype(np.uint8)).resize((768, 768), Image.LANCZOS).save(os.path.join(OUT, "loop", f"f{n:02d}.jpg"), quality=90); n += 1
    times.append(when.strftime("%Y-%m-%dT%H:%MZ"))
for old in os.listdir(os.path.join(OUT, "loop")):  # frames left over from a longer loop
    if old.endswith(".jpg") and int(old[1:3]) >= n:
        os.remove(os.path.join(OUT, "loop", old))

track = json.load(open(os.path.join(HERE, "track.json")))
# motion from the last ~21 h of clear-eye fixes
clear = [t for t in track if t["eyeClear"]]
a, b = clear[max(len(clear) - 8, 0)], clear[-1]
hrs = (datetime.strptime(b["t"], "%Y-%m-%dT%H:%MZ") - datetime.strptime(a["t"], "%Y-%m-%dT%H:%MZ")).total_seconds() / 3600
dy = (b["lat"] - a["lat"]) * 60; dx = (b["lon"] - a["lon"]) * 60 * np.cos(np.radians((a["lat"] + b["lat"]) / 2))
meta = {
    "frame": FRAME.strftime("%Y-%m-%dT%H:%MZ"), "loopFrames": n, "loopTimes": times,
    "eye": {"lat": track[-1]["lat"], "lon": track[-1]["lon"]},
    "eyeK": round(eye_k, 1), "ringK": round(ring_k, 1), "eyeDiameterKm": round(float(eye_d), 0) if eye_d else None,
    "cdoRadiusKm": round(cdo_r), "motion": {"kt": round(float(np.hypot(dx, dy) / hrs), 1), "bearing": round(float((np.degrees(np.arctan2(dx, dy)) + 360) % 360)), "hours": round(hrs)},
    "track": [[t["t"], t["lat"], t["lon"], int(t["eyeClear"])] for t in track],
}
json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"))
print(json.dumps({k: v for k, v in meta.items() if k != "track"}))
