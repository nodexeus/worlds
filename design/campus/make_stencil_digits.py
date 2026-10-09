"""
The sheet of stencilled digits the app lays on a deck: stencil-digits.png.

Run it inside Blender (it uses Blender only to write the PNG):

    exec(compile(open("design/campus/make_stencil_digits.py").read(), "make_stencil_digits.py", "exec"))

Ten digits, 0 to 9, left to right in one row, each in a cell 128 wide by 192 tall. White, with the
paint in the alpha channel. Seven-segment strokes like a stencil, each digit chipped its own way.
In a cell the digit is 140 pixels from the middle of its top stroke to the middle of its bottom one.
"""
import os

import bpy
import numpy as np

HERE = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.getcwd()
CELL_W, CELL_H, OVER = 128, 192, 3          # drawn three times over and averaged down, for soft edges
DIGIT_H = 140
SEGMENTS = {"0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
            "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abfgcd"}


def noise(seed, cells, shape):
    """Smooth noise in 0..1: a few random grids of growing fineness, blended."""
    rng = np.random.default_rng(seed)
    out, amp, total = np.zeros(shape), 1.0, 0.0
    for c in cells:
        grid = rng.random((c + 2, c + 2))
        ys = np.linspace(0, c, shape[0], endpoint=False)
        xs = np.linspace(0, c, shape[1], endpoint=False)
        iy, ix = ys.astype(int), xs.astype(int)
        fy, fx = ys - iy, xs - ix
        fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
        a, b, c2, d = grid[iy][:, ix], grid[iy][:, ix + 1], grid[iy + 1][:, ix], grid[iy + 1][:, ix + 1]
        out += amp * ((a * (1 - fx[None, :]) + b * fx[None, :]) * (1 - fy[:, None])
                      + (c2 * (1 - fx[None, :]) + d * fx[None, :]) * fy[:, None])
        total += amp
        amp *= 0.5
    return out / total


def sheet():
    h = DIGIT_H * OVER
    w, k = h * 0.5, h * 0.14
    alpha = np.zeros((CELL_H * OVER, CELL_W * 10 * OVER), np.float32)
    for i in range(10):
        cell = np.zeros((CELL_H * OVER, CELL_W * OVER), np.float32)
        ox, oy = (CELL_W * OVER - w) / 2, (CELL_H * OVER - h) / 2
        strokes = {"a": (w / 2, h, w - k * 1.6, k), "d": (w / 2, 0, w - k * 1.6, k), "g": (w / 2, h / 2, w - k * 1.6, k),
                   "f": (0, h * 0.75, k, h / 2 - k * 1.3), "b": (w, h * 0.75, k, h / 2 - k * 1.3),
                   "e": (0, h * 0.25, k, h / 2 - k * 1.3), "c": (w, h * 0.25, k, h / 2 - k * 1.3)}
        for seg in SEGMENTS[str(i)]:
            cx, cy, sx, sy = strokes[seg]
            cell[int(round(oy + cy - sy / 2)):int(round(oy + cy + sy / 2)),
                 int(round(ox + cx - sx / 2)):int(round(ox + cx + sx / 2))] = 1.0
        # Each digit is chipped to its own degree: between 12 and 24 percent of the paint is gone.
        n = 0.6 * noise(100 + i, (6, 13, 28), cell.shape) + 0.4 * noise(200 + i, (2, 4), cell.shape)
        gone = 0.12 + 0.12 * ((i * 7) % 10) / 9
        limit = np.quantile(n[cell > 0], 1 - gone)
        keep = np.clip((limit + 0.012 - n) / 0.024, 0, 1)
        thin = 0.8 + 0.2 * np.clip((noise(300 + i, (3, 6), cell.shape) - 0.35) / 0.25, 0, 1)
        alpha[:, i * CELL_W * OVER:(i + 1) * CELL_W * OVER] = cell * keep * thin
    alpha = alpha.reshape(CELL_H, OVER, CELL_W * 10, OVER).mean(axis=(1, 3))
    pixels = np.ones((CELL_H, CELL_W * 10, 4), np.float32)
    pixels[..., 3] = alpha
    old = bpy.data.images.get("NX_Set_stencil_digits")
    if old:
        bpy.data.images.remove(old)
    image = bpy.data.images.new("NX_Set_stencil_digits", CELL_W * 10, CELL_H, alpha=True)
    image.alpha_mode = "STRAIGHT"
    image.pixels.foreach_set(pixels.ravel())
    image.filepath_raw = os.path.join(HERE, "stencil-digits.png")
    image.file_format = "PNG"
    image.save()
    return image.filepath_raw


result = {"sheet": sheet()}
