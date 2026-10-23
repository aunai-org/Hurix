#!/bin/sh
# run.sh [YYYY-MM-DDTHH:MM]  -> refresh public/data from one 10-minute satellite slot (default: the slot 40 minutes ago,
# which NOAA has normally finished publishing). Needs Python 3 with the packages in requirements.txt.
# DATA=/some/folder writes the frame there instead of public/data (the hourly refresh uses a fresh folder per run).
set -e
cd "$(dirname "$0")"
D=${DATA:-../public/data}
F=${1:-$(date -u -d "@$(( $(date -u +%s) / 600 * 600 - 2400 ))" +%Y-%m-%dT%H:%M)}
# archival clouds for the part of the globe no geostationary satellite here covers (three-globe's example texture, MIT)
if [ ! -f cache/clouds.png ]; then
  mkdir -p cache
  curl -sS https://registry.npmjs.org/three-globe/-/three-globe-2.45.6.tgz | tar xz -C cache --strip-components=3 package/example/clouds/clouds.png
fi
# a slot without Himawari tiles (it skips 02:40 and 14:40 every day) or not yet published steps back 10 minutes, up to 3 times
for k in 1 2 3 4; do
  echo "frame $F"
  ./fetch.sh "$F" && [ -n "$(ls hima/$(cat hima/current))" ] && break
  [ $k -lt 4 ] || { echo "no complete slot from $F back 30 minutes"; exit 1; }
  F=$(date -u -d "@$(( $(date -u -d "$F" +%s) - 600 ))" +%Y-%m-%dT%H:%M)
done
python3 -W ignore reproject.py 4096
python3 -W ignore export.py "$D"
FRAME=$F python3 -W ignore storms.py "$D"
FRAME=$F python3 -W ignore visible.py "$D"
FRAME=$F python3 -W ignore globe.py "$D"
# the HD tiles and the replay motion are extras: if either fails, the page simply goes without it
python3 -W ignore tiles.py "$D" || echo "tiles: skipped"
python3 -W ignore flow.py "$D" || echo "flow: skipped"
