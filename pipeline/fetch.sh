#!/bin/sh
# fetch.sh YYYY-MM-DDTHH:MM  -> GOES-19/18 band 13 + cloud-top height and the Himawari-9 band 13 tiles for that 10-minute slot
set -e
cd "$(dirname "$0")"
F=$1; Y=$(date -u -d "$F" +%Y); J=$(date -u -d "$F" +%j); H=$(date -u -d "$F" +%H); M=$(date -u -d "$F" +%M)
# Himawari tiles go in a folder per slot (hima/current names it), so nothing has to be deleted between runs
S=$(date -u -d "$F" +%Y%m%d%H%M); mkdir -p hima/$S; echo $S > hima/current
for sat in 19 18; do
  for p in ABI-L2-CMIPF ABI-L2-ACHAF; do
    k=$(curl -sS "https://noaa-goes$sat.s3.amazonaws.com/?list-type=2&prefix=$p/$Y/$J/$H/" | grep -oE '<Key>[^<]+' | sed 's/<Key>//' | grep -E "(C13_|ACHAF-M6_)G$sat" | grep "_s$Y$J$H$M" | head -1)
    [ -n "$k" ] || { echo "missing $p G$sat $F"; exit 1; }
    case $p in *CMIP*) o=g${sat}_c13.nc;; *) o=g${sat}_acha.nc;; esac
    curl -sS -o $o "https://noaa-goes$sat.s3.amazonaws.com/$k" &
  done
done
P="AHI-L2-FLDK-ISatSS/$(date -u -d "$F" +%Y/%m/%d/%H%M)/"
{ curl -sS "https://noaa-himawari9.s3.amazonaws.com/?list-type=2&prefix=$P&max-keys=1000"; curl -sS "https://noaa-himawari9.s3.amazonaws.com/?list-type=2&prefix=$P&max-keys=1000&start-after=${P}OR_HFD-020-B12-M1C12"; } | grep -oE '<Key>[^<]+' | sed 's/<Key>//' | grep M1C13 | sort -u | xargs -P 16 -I{} sh -c 'curl -sS -o hima/'$S'/$(basename {}) "https://noaa-himawari9.s3.amazonaws.com/{}"'
wait
n=$(ls hima/$S | wc -l); echo "hima tiles: $n"
[ "$n" -ge 80 ] || { echo "too few Himawari tiles at $F"; exit 1; }
