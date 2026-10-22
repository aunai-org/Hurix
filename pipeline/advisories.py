"""The storms the warning centres are tracking right now, with their official names, positions and winds.

NHC (CurrentStorms.json) covers the Atlantic and the East and Central Pacific; JTWC (its RSS feed, and the JMV 3.0
.tcw file each warning links to) covers the West Pacific, the Indian Ocean and the Southern Hemisphere, and repeats the
East Pacific. A storm both warn on is kept once, from NHC. A feed that fails is skipped, so the hourly run never stops
on it.

Usage: python3 advisories.py      (prints the active storms)
"""
import json
import re
import sys
import urllib.request

NHC = "https://www.nhc.noaa.gov/CurrentStorms.json"
JTWC = "https://www.metoc.navy.mil/jtwc/rss/jtwc.rss"

NHC_KIND = {"TD": "Tropical depression", "STD": "Subtropical depression", "TS": "Tropical storm",
            "STS": "Subtropical storm", "HU": "Hurricane", "PTC": "Post-tropical cyclone", "PC": "Potential tropical cyclone"}
# JTWC basin letter -> ATCF basin
JTWC_BASIN = {"W": "WP", "E": "EP", "C": "CP", "L": "AL", "A": "IO", "B": "IO", "S": "SH", "P": "SH"}


def http_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "hurrix (github.com/aunai-org/Hurrix)"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def _num(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def parse_nhc(doc):
    out = []
    for s in doc.get("activeStorms", []):
        sid = s["id"]  # "al102026"
        wind = _num(s.get("intensity"))
        kind = NHC_KIND.get(s.get("classification"), "Tropical cyclone")
        if kind == "Hurricane" and wind is not None and wind >= 96:
            kind = "Major hurricane"
        out.append({"id": sid[:2].upper() + sid[2:4], "name": s["name"].title(), "kind": kind, "windKt": wind,
                    "pressureMb": _num(s.get("pressure")), "lat": float(s["latitudeNumeric"]),
                    "lon": float(s["longitudeNumeric"]), "agency": "NHC",
                    "advisory": s["lastUpdate"][:16] + "Z"})
    return out


def parse_jtwc_rss(xml):
    """(kind, tcw url) for each storm JTWC is warning on. Items without a warning (outlooks) are skipped."""
    out = []
    for item in re.findall(r"<item>(.*?)</item>", xml, re.S):
        tcws = re.findall(r"https://[^'\"\s]+\.tcw", item)
        for m, url in zip(re.finditer(r"([A-Za-z][A-Za-z ]*?)\s+\d\d[A-Z]\s+\([^)]+\)\s+Warning", item), tcws):
            out.append((" ".join(m.group(1).split()).capitalize(), url))
    return out


def _ll(lat, lon):
    """"219N", "1243E" (tenths of a degree) -> 21.9, 124.3, with south and west negative and longitude in -180..180."""
    la = int(lat[:-1]) / 10 * (-1 if lat[-1] == "S" else 1)
    lo = int(lon[:-1]) / 10 * (-1 if lon[-1] == "W" else 1)
    return la, round((lo + 180) % 360 - 180, 1)


def parse_tcw(text, kind):
    lines = text.splitlines()
    head = lines[2].split()  # "2026102218 29W CHAMPI 034 ..."
    t = head[0]
    num, letter = head[1][:-1], head[1][-1]
    t0 = next(l for l in lines if l.startswith("T000")).split()
    lat, lon = _ll(t0[1], t0[2])
    return {"id": JTWC_BASIN.get(letter, "XX") + num, "agencyId": head[1], "name": head[2].title(), "kind": kind,
            "windKt": _num(t0[3]), "pressureMb": None, "lat": lat, "lon": lon, "agency": "JTWC",
            "advisory": f"{t[:4]}-{t[4:6]}-{t[6:8]}T{t[8:10]}:00Z"}


def _feed(name, fn):
    try:
        return fn()
    except Exception as e:  # a feed that's down, slow or changed never stops the run
        print(f"advisories: {name} failed: {e}")
        return []


def active_storms(get=http_get):
    """Every storm with a current warning, once each, strongest first (no official wind last)."""
    nhc = _feed(NHC, lambda: parse_nhc(json.loads(get(NHC))))
    jtwc = []
    for kind, url in _feed(JTWC, lambda: parse_jtwc_rss(get(JTWC))):
        jtwc += _feed(url, lambda: [parse_tcw(get(url), kind)])
    seen = {s["id"] for s in nhc}
    storms = nhc + [s for s in jtwc if s["id"] not in seen]
    return sorted(storms, key=lambda s: -(s["windKt"] if s["windKt"] is not None else -1))


if __name__ == "__main__":
    for s in active_storms():
        print(json.dumps(s))
    sys.exit(0)
