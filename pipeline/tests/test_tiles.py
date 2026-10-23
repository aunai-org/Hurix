import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import tiles as T  # noqa: E402


def test_tile_lonlat_corners():
    lon, lat = T.tile_lonlat(0, 0)
    assert len(lon) == 512 and len(lat) == 512
    assert np.isclose(lon[0], -180 + 360 / 16384 / 2) and np.isclose(lat[0], 90 - 180 / 8192 / 2)
    lon, lat = T.tile_lonlat(15, 31)
    assert np.isclose(lon[-1], 180 - 360 / 16384 / 2) and np.isclose(lat[-1], -90 + 180 / 8192 / 2)


def test_tile_lonlat_matches_global_grid():
    world = np.linspace(-180, 180, 16384, endpoint=False) + 180 / 16384
    lon, _ = T.tile_lonlat(7, 16)
    assert np.isclose(lon[0], world[16 * 512])


def test_tiles_live_in_a_folder_named_after_their_frame():
    # a page left open across a deploy then finds its old tiles gone (and falls back) instead of mixing in new ones
    assert T.tile_dir("2026-10-23T13:10Z") == "tiles/20261023T1310"
