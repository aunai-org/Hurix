#!/bin/sh
# refresh-live.sh OUT_DIR  -> fetch the latest satellite slot, rebuild the site, and stage it for publishing in OUT_DIR.
# Writes OUT_DIR/site/ (the built page, no _headers) and OUT_DIR/batches/NN.json: maps of published path -> local path,
# at most 200 files each, so a host with a per-publish file limit can upload them in turns. Used by the hourly refresh.
set -e
cd "$(dirname "$0")/.."
OUT=$(mkdir -p "$1" && cd "$1" && pwd)
python3 -m pip install -q -r pipeline/requirements.txt
[ -d node_modules ] || npm ci --silent
sh pipeline/run.sh
npm run build --silent
rm -rf "$OUT/site" "$OUT/batches" && mkdir -p "$OUT/batches"
cp -r dist "$OUT/site" && rm -f "$OUT/site/_headers"
python3 - "$OUT" <<'EOF'
import json, os, sys
out = sys.argv[1]; site = os.path.join(out, "site")
paths = sorted(os.path.relpath(os.path.join(d, f), site) for d, _, fs in os.walk(site) for f in fs if f != "index.html")
# data first, so the page's new code never goes live before the frames it expects
paths.sort(key=lambda p: (not p.startswith("data/"), p))
for i in range(0, len(paths), 200):
    json.dump({p: p for p in paths[i:i + 200]}, open(os.path.join(out, "batches", f"{i // 200:02d}.json"), "w"), indent=0)
json.dump(paths, open(os.path.join(out, "files.json"), "w"))
print(f"{len(paths)} files in {(len(paths) + 199) // 200} batch(es); frame", json.load(open(os.path.join(site, "data", "meta.json")))["frame"])
EOF
