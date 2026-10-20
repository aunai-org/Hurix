#!/bin/sh
# run.sh [YYYY-MM-DDTHH:MM]  -> refresh public/data from one 10-minute satellite slot (default: the slot 40 minutes ago,
# which NOAA has normally finished publishing). Needs Python 3 with the packages in requirements.txt.
set -e
cd "$(dirname "$0")"
F=${1:-$(date -u -d "@$(( $(date -u +%s) / 600 * 600 - 2400 ))" +%Y-%m-%dT%H:%M)}
# archival clouds for the part of the globe no geostationary satellite here covers (three-globe's example texture, MIT)
if [ ! -f cache/clouds.png ]; then
  mkdir -p cache
  curl -sS https://registry.npmjs.org/three-globe/-/three-globe-2.45.6.tgz | tar xz -C cache --strip-components=3 package/example/clouds/clouds.png
fi
echo "frame $F"
./fetch.sh "$F"
python3 -W ignore reproject.py 4096
python3 -W ignore export.py ../public/data
FRAME=$F python3 -W ignore storms.py ../public/data
