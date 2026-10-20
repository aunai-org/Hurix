"""Write the global IR layer the globe shows: ir_global.jpg (live IR, archival clouds in the gap) and ir_live_mask.png.
Usage: python3 export.py OUT_DIR      (after reproject.py)"""
import os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
code = lambda bt: np.clip((320 - bt) / 140, 0, 1)

# live where a geostationary satellite sees well, archival clouds in the gap none of them covers
d = np.load(os.path.join(HERE, "stitched_4096.npz")); bt, live = d["bt"], np.nan_to_num(d["cov"])
arch = np.asarray(Image.open(os.path.join(HERE, "cache", "clouds.png")).convert("RGBA").getchannel("A"), np.float32) / 255
archbt = 292 - arch * 87
blend = live * np.where(np.isfinite(bt), bt, archbt) + (1 - live) * archbt
Image.fromarray((code(blend) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "ir_global.jpg"), quality=93)
Image.fromarray((live * 255).astype(np.uint8)).resize((1024, 512), Image.BILINEAR).save(os.path.join(OUT, "ir_live_mask.png"), optimize=True)
