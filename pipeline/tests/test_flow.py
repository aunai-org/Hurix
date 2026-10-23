import pathlib, sys
import numpy as np
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
import flow as F  # noqa: E402


def blob(x, y, n=256, sigma=12):
    yy, xx = np.mgrid[:n, :n]
    return (np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * sigma ** 2)) * 200 + 20).astype(np.uint8)


def test_motion_finds_a_shift():
    a, b = blob(100, 120), blob(106, 116)
    f = F.motion(a, b, (256, 256))
    region = f[105:135, 85:115]
    assert abs(np.median(region[..., 0]) - 6) <= 1 and abs(np.median(region[..., 1]) + 4) <= 1


def test_encode_round_trip():
    rng = np.random.default_rng(1)
    f = rng.uniform(-48, 48, (16, 32, 2)).astype(np.float32)
    back = F.decode(F.encode(f, 48), 48)
    assert back.shape == f.shape and np.abs(back - f).max() <= 48 / 127


def test_encode_clips():
    f = np.zeros((4, 4, 2), np.float32); f[..., 0] = 3 * 48; f[..., 1] = -3 * 48
    back = F.decode(F.encode(f, 48), 48)
    assert np.allclose(back[..., 0], 48) and np.allclose(back[..., 1], -48)


def test_interpolate_moves_the_blob_halfway():
    a, b = blob(100, 120), blob(106, 116)
    f = F.motion(a, b, (256, 256))
    mid = F.interpolate(a.astype(np.float32), b.astype(np.float32), f, 0.5)
    y, x = np.unravel_index(np.argmax(mid), mid.shape)
    assert abs(x - 103) <= 1 and abs(y - 118) <= 1
    assert mid.max() - 20 >= 0.9 * (a.max() - 20.0)
