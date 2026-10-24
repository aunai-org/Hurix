import pathlib
import sys
from datetime import datetime

import numpy as np
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import meteosat as M  # noqa: E402


def test_slot_rounds_down_to_each_cadence():
    assert M.slot("meteosat12", datetime(2026, 10, 24, 9, 17)) == datetime(2026, 10, 24, 9, 10)
    assert M.slot("meteosat9", datetime(2026, 10, 24, 9, 14)) == datetime(2026, 10, 24, 9, 0)
    assert M.slot("meteosat9", datetime(2026, 10, 24, 9, 15)) == datetime(2026, 10, 24, 9, 15)


def test_wms_params_lat_lon_order_and_raw_style():
    p = M.wms_params("mtg_fd:ir105_hrfi", datetime(2026, 10, 24, 9, 0), (-30, 30, -55, -25), 1000, 2000, True)
    assert p["bbox"] == "-30,-55,30,-25" and p["crs"] == "EPSG:4326" and p["version"] == "1.3.0"
    assert p["time"] == "2026-10-24T09:00:00.000Z" and p["width"] == "1000" and p["height"] == "2000"
    assert "SLD_BODY" in p and '<ColorMapEntry color="#ffffff" quantity="255"/>' in p["SLD_BODY"]
    assert "SLD_BODY" not in M.wms_params("msg_iodc:ir108", datetime(2026, 10, 24, 9, 0), (-30, 30, 80, 110), 10, 10, False)


def test_pieces_cover_the_request_exactly():
    ps = M.pieces((-70, 70, -75, 75), 6827, 6370)
    assert all(w <= 2048 and h <= 2048 for _, w, h, _, _ in ps)
    assert sum(w * h for _, w, h, _, _ in ps) == 6827 * 6370
    assert {(r, c) for *_, r, c in ps} >= {(0, 0)}


def test_raw_counts_to_bt_with_table():
    cal = {"ir": {"meteosat12": [float("nan")] + [195.0 + 0.43 * k for k in range(1, 256)]}}
    rgb = np.array([[[0, 0, 0], [1, 1, 1], [255, 255, 255]]], np.uint8)
    bt = M.to_bt("meteosat12", rgb, cal)
    assert np.isnan(bt[0, 0]) and bt[0, 1] == pytest.approx(195.43) and bt[0, 2] == pytest.approx(304.65)


def test_grey_to_bt_masks_coloured_pixels():
    cal = {"ir": {"meteosat9": list(np.linspace(299, 203, 256))}}
    rgb = np.array([[[0, 0, 0], [0, 0, 1], [255, 255, 255]]], np.uint8)
    bt = M.to_bt("meteosat9", rgb, cal)
    assert bt[0, 0] == pytest.approx(299) and np.isnan(bt[0, 1]) and bt[0, 2] == pytest.approx(203)


def test_decode_cth_known_unknown_and_clear():
    cal = {"cth": [[15, 0, 3, 12000.0], [0, 0, 0, None]]}
    rgb = np.array([[[255, 1, 63], [1, 1, 1], [128, 128, 128]]], np.uint8)
    h = M.decode_cth(rgb, cal)
    assert h[0, 0] == 12000.0 and np.isnan(h[0, 1]) and np.isnan(h[0, 2])


def test_griddisc_bilinear_inside_nan_outside():
    img = np.array([[0.0, 1.0], [2.0, 3.0]], np.float32)  # row 0 north
    d = M.GridDisc(img, -1, 1, -1, 1, 0.0)
    assert d.sample(np.array(0.0), np.array(0.0)) == pytest.approx(1.5)
    assert np.isnan(d.sample(np.array(5.0), np.array(0.0)))


def test_griddisc_masks_off_disc():
    d = M.GridDisc(np.full((10, 10), 250.0, np.float32), -80, 80, 60, 179, 0.0)
    assert np.isnan(d.sample(np.array(0.0), np.array(100.0)))  # beyond the 0° disc
