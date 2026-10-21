#!/bin/sh
# refresh-live.sh OUT_DIR  -> fetch the latest satellite slot, rebuild the site, and stage it for publishing.
# Each run stages into a fresh folder OUT_DIR/<frame>-<timestamp>/ (nothing is deleted): site/ (the built page, no
# _headers), batches/NN.json (maps of published path -> local path, at most 200 files each, so a host with a per-publish
# file limit can upload them in turns) and files.json (every published path). The last line printed is that folder.
# Used by the hourly refresh.
set -e
cd "$(dirname "$0")/.."
mkdir -p "$1"
OUT=$(cd "$1" && pwd)
python3 -m pip install -q -r pipeline/requirements.txt
[ -d node_modules ] || npm ci --silent
sh pipeline/run.sh
npm run build --silent
python3 - "$OUT" <<'EOF'
import json, os, shutil, sys, time
meta = json.load(open(os.path.join("dist", "data", "meta.json")))
stage = os.path.join(sys.argv[1], meta["frame"].replace(":", "") + time.strftime("-%Y%m%d%H%M%S"))
site = os.path.join(stage, "site")
shutil.copytree("dist", site, ignore=lambda d, names: ["_headers"] if os.path.samefile(d, "dist") else [])
os.makedirs(os.path.join(stage, "batches"))
paths = sorted(os.path.relpath(os.path.join(d, f), site) for d, _, fs in os.walk(site) for f in fs if f != "index.html")
# data first, so the page's new code never goes live before the frames it expects
paths.sort(key=lambda p: (not p.startswith("data/"), p))
for i in range(0, len(paths), 200):
    json.dump({p: p for p in paths[i:i + 200]}, open(os.path.join(stage, "batches", f"{i // 200:02d}.json"), "w"), indent=0)
json.dump(paths, open(os.path.join(stage, "files.json"), "w"))
print(f"{len(paths)} files in {(len(paths) + 199) // 200} batch(es); frame {meta['frame']}, {len(meta['storms'])} storm(s)")
print(stage)
EOF
