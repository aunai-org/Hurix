import pathlib
import sys
from datetime import datetime

import numpy as np
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import meteosat as M  # noqa: E402
import reproject as R  # noqa: E402


def fake_grid(val, lon0):
    g = M.GridDisc(np.full((90, 180), val, np.float32), -75, 75, lon0 - 78, lon0 + 78, lon0)
    return {"grid": g, "ht": None, "lon0": lon0}


def test_stitch_fills_the_gap_with_a_grid_source():
    LON, LAT = R.grid(np.array([20.0, 60.0]), np.array([0.0]))
    bt, ht, cov = R.stitch(LON, LAT, [fake_grid(250.0, 0.0), fake_grid(260.0, 45.5)])
    assert bt[0, 0] == pytest.approx(250.0, abs=5) and bt[0, 1] == pytest.approx(260.0, abs=5) and (cov > 0.9).all()


def test_stitch_takes_height_from_the_runner_up_near_a_seam():
    a, b = fake_grid(250.0, 0.0), fake_grid(250.0, 45.5)
    b["ht"] = M.GridDisc(np.full((90, 180), 9000.0, np.float32), -75, 75, 45.5 - 78, 45.5 + 78, 45.5)
    LON, LAT = R.grid(np.array([22.0, 0.0]), np.array([0.0]))  # 22° E is almost as close to 45.5° E as to 0°
    _, ht, _ = R.stitch(LON, LAT, [a, b])
    assert ht[0, 0] == pytest.approx(9000.0) and np.isnan(ht[0, 1])


def test_load_sats_survives_wms_failure(monkeypatch):
    monkeypatch.setattr(R, "_base_sats", lambda here: [])
    monkeypatch.setattr(M, "world", lambda *a, **k: (_ for _ in ()).throw(OSError("timed out")))
    assert R.load_sats(".", datetime(2026, 10, 24, 9), 0.1) == []


def test_overlap_bias():
    a = np.full((50, 50), 250.0); b = np.full((50, 50), 247.0); c = np.full((50, 50), 0.5)
    assert R.overlap_bias(a, b, c, c) == pytest.approx(3.0)
    assert R.overlap_bias(a[:5, :5], b[:5, :5], c[:5, :5], c[:5, :5]) is None


def test_load_sats_steps_back_one_scan_when_the_latest_is_missing(monkeypatch):
    asked = []

    def world(sat, when, deg):
        asked.append((sat, when))
        if when == datetime(2026, 10, 24, 9):
            raise FileNotFoundError("not published yet")
        return "grid"
    monkeypatch.setattr(R, "_base_sats", lambda here: [])
    monkeypatch.setattr(M, "world", world)
    monkeypatch.setattr(M, "cth_world", lambda *a: None)
    sats = R.load_sats(".", datetime(2026, 10, 24, 9), 0.1)
    assert [s["name"] for s in sats] == ["meteosat12", "meteosat9"]
    assert ("meteosat9", datetime(2026, 10, 24, 8, 45)) in asked and ("meteosat12", datetime(2026, 10, 24, 8, 50)) in asked
