import pathlib
import sys
from datetime import datetime

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import storms as S  # noqa: E402


def off(sid, lat, lon, wind=50):
    return {"id": sid, "name": sid, "kind": "Tropical storm", "windKt": wind, "pressureMb": None,
            "lat": lat, "lon": lon, "agency": "JTWC", "advisory": "2026-10-22T18:00Z"}


def sees(lat, lon):
    return None if 40 <= lon <= 100 else "goes19"


def test_seed_fixes_without_ir_track():
    o = off("AL10", 40.0, -65.8)
    frame = datetime(2026, 10, 22, 20, 40)
    fixes = S.seed_fixes(o, [], frame)
    assert len(fixes) == 1
    assert fixes[0]["lat"] == 40.0 and fixes[0]["lon"] == -65.8 and fixes[0]["t"] == "2026-10-22T20:40Z"
    fix = {"t": "2026-10-22T20:40Z", "lat": 39.9, "lon": -65.7, "eyeK": 260.0, "ringK": 230.0, "eyeClear": False}
    assert S.seed_fixes(o, [fix], frame) == [fix]


def test_choose_splits_unseen():
    storms = [off("WP29", 21.9, 124.3, 95), off("AL10", 40.0, -65.8, 55), off("EP22", 10.0, -101.5, 55),
              off("SH02", -6.7, 49.7, 50)]
    imaged, others = S.choose(storms, sees)
    assert [s["id"] for s in imaged] == ["WP29", "AL10", "EP22"]
    assert [s["id"] for s in others] == ["SH02"]


def test_choose_caps_at_max():
    storms = [off(f"WP{i:02d}", 15.0, 130.0 + i) for i in range(10)]
    imaged, others = S.choose(storms, sees)
    assert len(imaged) == 8 and len(others) == 2


def test_choose_storms_falls_back_to_ir():
    assert S.choose([], sees) == ([], [])


def test_official_now_extrapolates_along_track():
    o = off("WP29", 21.9, 124.3, 95)
    o["advisory"] = "2026-10-22T18:00Z"
    o["history"] = [("2026-10-22T12:00Z", 21.2, 124.9, 100), ("2026-10-22T18:00Z", 21.9, 124.3, 95)]
    la, lo = S.official_now(o, datetime(2026, 10, 22, 21, 0))
    assert abs(la - 22.25) < 0.01 and abs(lo - 124.0) < 0.01
    o["history"] = o["history"][-1:]
    assert S.official_now(o, datetime(2026, 10, 22, 21, 0)) == (21.9, 124.3)


def test_trusted_fixes_drop_a_far_or_eyeless_ir_fix():
    now = (22.25, 124.0)
    eye = {"t": "2026-10-22T21:40Z", "lat": 22.3, "lon": 124.05, "eyeK": 280.0, "ringK": 200.0, "eyeClear": True}
    mass = dict(eye, lat=20.63, lon=124.16, eyeClear=False)
    assert S.trusted(now, [mass, eye]) == [mass, eye]
    assert S.trusted(now, [eye, mass]) == []
    assert S.trusted(now, [dict(eye, lat=21.0)]) == []
