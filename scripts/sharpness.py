"""sharpness.py STILL LOOP  -> variance of the Laplacian over the centre 400x400 px of each image, and the loop/still ratio.
A loop frame as sharp as the still scores about 1; a blurred or double-exposed one scores less. Compare images of the same
scene: two screenshots minutes apart in the loop differ in cloud cover, which moves the score more than the blur does, so
for the true-colour loop compare storm_vis.jpg with a loop frame (or a blend of two) scaled to the same size."""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage


def sharpness(path):
    a = np.asarray(Image.open(path).convert("L"), dtype=np.float32)
    h, w = a.shape
    c = a[h // 2 - 200:h // 2 + 200, w // 2 - 200:w // 2 + 200]
    return float(ndimage.laplace(c).var())


if __name__ == "__main__":
    s, l = sharpness(sys.argv[1]), sharpness(sys.argv[2])
    print(f"still {s:.1f}  loop {l:.1f}  ratio {l / s:.2f}")
