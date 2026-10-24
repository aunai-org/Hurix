"""Meteosat-12 (0°) and Meteosat-9 (45.5° E) from EUMETSAT's public map service (EUMETView WMS, no account), so the
gap between the GOES and Himawari discs, Europe, Africa and the Indian Ocean, gets live imagery too. © EUMETSAT.

The service hands out pictures, not data: Meteosat-12 IR as raw 8-bit counts (an identity colour ramp), Meteosat-9 IR as
its default grey, cloud-top height as a colour picture. meteosat_cal.json turns them back into kelvin and metres; it is
fitted against GOES-19 and Himawari-9 where the discs overlap (python3 meteosat.py calibrate DATE).

The rest of the pipeline gets a GridDisc: a regular lat/lon raster with the same sample(lat, lon) as storms.Disc.
"""
import math
from datetime import datetime, timedelta
import numpy as np
from scipy import ndimage

import storms as S

URL = "https://view.eumetsat.int/geoserver/ows"
MAX_PX = 2048  # the service is quick up to 2048 px a side and refuses much more

SATS = {
    "meteosat12": {"name": "Meteosat-12", "lon0": 0.0, "step": 10, "ir": "mtg_fd:ir105_hrfi", "raw": True,
                   "cth": "msg_fes:cth", "true": "mtg_fd:rgb_truecolour", "natural": None},
    "meteosat9": {"name": "Meteosat-9", "lon0": 45.5, "step": 15, "ir": "msg_iodc:ir108", "raw": False,
                  "cth": "msg_iodc:cth", "true": "mtg_fd:rgb_truecolour", "natural": "msg_iodc:rgb_natural"},
}

# the raw 8-bit value of each pixel: a ramp from black at 0 to white at 255
RAW_SLD = ('<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc">'
           '<NamedLayer><Name>{layer}</Name><UserStyle><FeatureTypeStyle><Rule><RasterSymbolizer><ColorMap type="ramp">'
           '<ColorMapEntry color="#000000" quantity="0"/><ColorMapEntry color="#ffffff" quantity="255"/>'
           '</ColorMap></RasterSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>')


def slot(sat, when):
    """The latest scan at or before when (every 10 minutes for Meteosat-12, 15 for Meteosat-9)."""
    step = SATS[sat]["step"]
    when = when.replace(second=0, microsecond=0)
    return when - timedelta(minutes=when.minute % step)


def wms_params(layer, when, box, w, h, raw):
    """A GetMap request for box = (lat0, lat1, lon0, lon1); WMS 1.3.0 with EPSG:4326 wants the bbox in lat,lon order."""
    lat0, lat1, lon0, lon1 = box
    p = {"service": "WMS", "version": "1.3.0", "request": "GetMap", "layers": layer, "styles": "", "crs": "EPSG:4326",
         "bbox": ",".join(f"{v:g}" for v in (lat0, lon0, lat1, lon1)), "width": str(w), "height": str(h),
         "format": "image/png", "time": f"{when:%Y-%m-%dT%H:%M}:00.000Z"}
    if raw:
        p["SLD_BODY"] = RAW_SLD.format(layer=layer)
    return p


def pieces(box, w, h, max_px=MAX_PX):
    """Split a w x h request into pieces of at most max_px a side: (box, w, h, row, col) with each piece's pixel offset."""
    lat0, lat1, lon0, lon1 = box
    nc, nr = math.ceil(w / max_px), math.ceil(h / max_px)
    cols = [w * i // nc for i in range(nc + 1)]; rows = [h * i // nr for i in range(nr + 1)]
    out = []
    for r0, r1 in zip(rows, rows[1:]):
        for c0, c1 in zip(cols, cols[1:]):
            sub = (lat1 - (lat1 - lat0) * r1 / h, lat1 - (lat1 - lat0) * r0 / h, lon0 + (lon1 - lon0) * c0 / w, lon0 + (lon1 - lon0) * c1 / w)
            out.append((sub, c1 - c0, r1 - r0, r0, c0))
    return out


def to_bt(sat, rgb, cal):
    """Brightness temperature (K) from a picture: a count or grey level looked up in the calibration table."""
    table = np.asarray(cal["ir"][sat], np.float32)
    rgb = np.asarray(rgb)
    v = rgb[..., 0]
    if SATS[sat]["raw"]:
        return np.where(v > 0, table[v], np.nan).astype(np.float32)
    grey = (rgb[..., 0] == rgb[..., 1]) & (rgb[..., 1] == rgb[..., 2])  # coastlines and labels are coloured
    return np.where(grey, table[v], np.nan).astype(np.float32)


def decode_cth(rgb, cal):
    """Cloud-top height (m) from the colour picture: each 4-bit colour bucket has a height (null = clear sky)."""
    lut = np.full(16 ** 3, np.nan, np.float32)
    for r4, g4, b4, m in cal["cth"]:
        if m is not None:
            lut[(r4 * 16 + g4) * 16 + b4] = m
    rgb = np.asarray(rgb).astype(np.int32) >> 4
    return lut[(rgb[..., 0] * 16 + rgb[..., 1]) * 16 + rgb[..., 2]]


def _interp(img, fr, fc):
    """Bilinear lookup at fractional rows and columns of any shape (map_coordinates wants at least one dimension)."""
    return ndimage.map_coordinates(img, [fr.ravel(), fc.ravel()], order=1).reshape(fr.shape)


class GridDisc:
    """One satellite picture on a lat/lon grid: img[row, col], row 0 at lat1, pixel centres spread evenly over the box."""
    def __init__(self, img, lat0, lat1, lon0, lon1, lon_sub):
        self.img, self.lat0, self.lat1, self.lon0, self.lon1, self.lon_sub = img, lat0, lat1, lon0, lon1, lon_sub

    def _rows_cols(self, lat, lon):
        lat, lon = np.broadcast_arrays(np.asarray(lat, np.float64), np.asarray(lon, np.float64))
        lon = (lon - self.lon0) % 360 + self.lon0
        h, w = self.img.shape[:2]
        fr = (self.lat1 - lat) / (self.lat1 - self.lat0) * h - 0.5
        fc = (lon - self.lon0) / (self.lon1 - self.lon0) * w - 0.5
        ok = (lat >= self.lat0) & (lat <= self.lat1) & (lon <= self.lon1) & (S.view_cos(lat, lon, self.lon_sub) >= 0.05)
        return np.clip(fr, 0, h - 1), np.clip(fc, 0, w - 1), ok

    def sample(self, lat, lon):
        fr, fc, ok = self._rows_cols(lat, lon)
        img = self.img.astype(np.float32)
        out = _interp(np.nan_to_num(img, nan=0.0), fr, fc)
        bad = _interp(np.isnan(img).astype(np.float32), fr, fc) > 0  # any NaN neighbour
        return np.where(ok & ~bad, out, np.nan).astype(np.float32)


class GridRGB(GridDisc):
    """A colour picture on the same grid; sample() gives uint8 (..., 3), black outside the box or off the disc."""
    def sample(self, lat, lon):
        fr, fc, ok = self._rows_cols(lat, lon)
        chans = [_interp(self.img[..., k].astype(np.float32), fr, fc) for k in range(3)]
        out = np.stack(chans, -1) * ok[..., None]
        return (out + 0.5).clip(0, 255).astype(np.uint8)


def box_for(lat, lon, km):
    """The lat/lon bounds around a storm close-up of km across, with 10% to spare."""
    la, lo = S.grid_latlon(lat, lon, 32, km * 1.1)
    return float(la.min()), float(la.max()), float(lo.min()), float(lo.max())
