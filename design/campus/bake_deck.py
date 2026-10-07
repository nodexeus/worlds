"""
Draw the campus deck plate. Run inside Blender (for its numpy and image writer):

    exec(open("/path/to/design/campus/bake_deck.py").read())

The campus floor is blackened steel: four plates to a repeat, two brushed and two of raised
tread, bolted at the corners, worn bright along every edge a boot or a crate would catch and
dull where grime settles. It is drawn as a height field first, and everything else is read off
that: where the surface is high and exposed it is polished, where it is low it holds dirt.

Every layer wraps, so the sheet tiles with no seam: noise is shaped in the frequency domain,
which is periodic by construction, and anything placed by hand is placed modulo the sheet.

Writes three maps straight to `public/assets/campus/`, at the size they ship:

    deck_basecolor.jpg   sRGB colour
    deck_orm.jpg         occlusion, roughness and metalness in R, G and B
    deck_normal.png      tangent-space normal, +Y up
"""
import os

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(bpy.data.filepath)) if bpy.data.filepath else os.getcwd()
ROOT = globals().get("DECK_ROOT") or os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "public", "assets", "campus")
SIZE = 1024
PANELS = 2
rng = np.random.default_rng(0x5EED)

os.makedirs(OUT, exist_ok=True)
step = SIZE // PANELS
ys, xs = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)


def smooth(edge0, edge1, value):
    t = np.clip((value - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def noise(scale_x, scale_y, power=1.6):
    """Wrapping noise in -1..1. A larger scale along an axis stretches the grain that way."""
    fy = np.fft.fftfreq(SIZE)[:, None] * scale_y
    fx = np.fft.fftfreq(SIZE)[None, :] * scale_x
    falloff = 1.0 / np.power(1e-4 + fx * fx + fy * fy, power / 2.0)
    falloff[0, 0] = 0.0
    spectrum = np.fft.fft2(rng.standard_normal((SIZE, SIZE))) * falloff
    field = np.real(np.fft.ifft2(spectrum))
    field -= field.mean()
    return (field / (np.abs(field).max() + 1e-9)).astype(np.float32)


def wrapped(delta):
    """Shortest distance round the sheet."""
    delta = np.abs(delta) % SIZE
    return np.minimum(delta, SIZE - delta)


# ---------- where things are ----------
# Within its own panel, how far a texel is from the nearest edge.
px = xs % step
py = ys % step
to_edge = np.minimum(np.minimum(px, step - px), np.minimum(py, step - py))
panel_x = (xs // step).astype(int)
panel_y = (ys // step).astype(int)
tread = (panel_x + panel_y) % 2 == 1

SEAM = 3.5        # half the gap between two plates
BEVEL = 7.0       # how far the plate's edge is rolled over
seam = 1.0 - smooth(SEAM - 1.0, SEAM + 1.0, to_edge)
bevel = 1.0 - smooth(SEAM, SEAM + BEVEL, to_edge)

# A shallow pressed border a hand in from the edge, which is what makes a plate read as made.
BORDER = 30.0
border = np.exp(-((to_edge - BORDER) / 2.2) ** 2)

# Bolts: each corner, and the middle of each side.
bolt = np.zeros((SIZE, SIZE), np.float32)
slot = np.zeros((SIZE, SIZE), np.float32)
INSET = 15.0
RADIUS = 6.5
for gx in range(PANELS):
    for gy in range(PANELS):
        spots = []
        for sx in (INSET, step / 2, step - INSET):
            for sy in (INSET, step / 2, step - INSET):
                if sx == step / 2 and sy == step / 2:
                    continue
                spots.append((gx * step + sx, gy * step + sy))
        for bx, by in spots:
            dx = wrapped(xs - bx)
            dy = wrapped(ys - by)
            distance = np.hypot(dx, dy)
            bolt = np.maximum(bolt, 1.0 - smooth(RADIUS - 1.5, RADIUS + 0.5, distance))
            turn = rng.uniform(0, np.pi)
            across = np.abs((xs - bx) * np.sin(turn) - (ys - by) * np.cos(turn))
            slot = np.maximum(slot, (1.0 - smooth(0.6, 1.6, across)) * (distance < RADIUS - 1.5))

# Tread: rows of raised lozenges, each row turned the other way to the last.
PITCH = 32.0
MARGIN = 46.0
lugs = np.zeros((SIZE, SIZE), np.float32)
cell_x = np.floor(px / PITCH)
cell_y = np.floor(py / PITCH)
local_x = px - (cell_x + 0.5) * PITCH
local_y = py - (cell_y + 0.5) * PITCH
turn = np.where((cell_x + cell_y) % 2 == 0, np.pi / 4, -np.pi / 4)
along = local_x * np.cos(turn) + local_y * np.sin(turn)
across = -local_x * np.sin(turn) + local_y * np.cos(turn)
lozenge = np.sqrt((along / 11.0) ** 2 + (across / 3.4) ** 2)
lugs = (1.0 - smooth(0.55, 1.0, lozenge)) * tread * smooth(MARGIN - 6.0, MARGIN, to_edge)

# ---------- height ----------
grain = np.where(tread, noise(1.0, 26.0), noise(26.0, 1.0))   # brushed, each plate its own way
fine = noise(3.0, 3.0, 0.9)
dents = noise(1.0, 1.0, 2.6)

height = np.full((SIZE, SIZE), 0.5, np.float32)
height -= bevel * 0.10
height -= seam * 0.34
height -= border * 0.035
height += lugs * 0.20
height += bolt * 0.16 - slot * 0.10
height += grain * 0.012 + fine * 0.006 + dents * 0.03

# ---------- what the height says about the surface ----------
# Exposed and high: rubbed bright. The rolled edge, the tops of the tread, the bolt heads.
blur = np.real(np.fft.ifft2(np.fft.fft2(height) * np.exp(-((np.fft.fftfreq(SIZE)[:, None] * 60) ** 2 + (np.fft.fftfreq(SIZE)[None, :] * 60) ** 2))))
proud = np.clip((height - blur) * 14.0, -1.0, 1.0).astype(np.float32)
patchy = smooth(-0.25, 0.45, noise(1.0, 1.0, 2.0) + fine * 0.35)
wear = np.clip(np.maximum(proud, 0.0) * (0.35 + 0.65 * patchy) + (bevel * (1.0 - seam)) * 0.55 * patchy, 0.0, 1.0)
# Traffic polishes the open floor too, in wide soft patches.
wear = np.clip(wear + smooth(0.35, 0.9, noise(1.0, 1.0, 2.4)) * 0.22 * (1.0 - seam), 0.0, 1.0)

# Low and sheltered: grime. Round the tread, against the border, in the dents.
grime = np.clip(np.maximum(-proud, 0.0) * 1.3 + smooth(0.2, 0.8, noise(1.0, 1.0, 2.2)) * 0.35, 0.0, 1.0)
grime = np.clip(grime * (1.0 - wear), 0.0, 1.0)

# Scratches: long, thin, mostly one way, a few bright and most barely there.
scratches = np.zeros((SIZE, SIZE), np.float32)
for _ in range(150):
    x0, y0 = rng.uniform(0, SIZE, 2)
    angle = rng.normal(0.35, 0.5)
    length = rng.uniform(30, 240)
    strength = rng.uniform(0.15, 1.0) ** 2
    count = int(length)
    t = np.linspace(0, 1, count)
    sx = (x0 + np.cos(angle) * length * t + np.sin(t * 9) * 1.2).astype(int) % SIZE
    sy = (y0 + np.sin(angle) * length * t).astype(int) % SIZE
    scratches[sy, sx] = np.maximum(scratches[sy, sx], strength * np.sin(t * np.pi))
scratches *= 1.0 - seam

# ---------- the maps ----------
plate_shade = np.array([[0.0, -0.022], [0.016, -0.008]], np.float32)[panel_y % 2, panel_x % 2]
value = 0.150 + plate_shade + grain * 0.022 + fine * 0.012
value = value * (1.0 - grime * 0.55)
value = value + wear * 0.30 + scratches * 0.22
value = value * (1.0 - seam * 0.88)
value = np.clip(value, 0.0, 1.0)
# Blackened steel is a touch blue in the plate and warms where it is rubbed back to bare metal.
tint_cool = np.array([0.93, 0.98, 1.08], np.float32)
tint_warm = np.array([1.05, 1.0, 0.93], np.float32)
tint = tint_cool[None, None, :] * (1.0 - wear[..., None]) + tint_warm[None, None, :] * wear[..., None]
linear = np.clip(value[..., None] * tint, 0.0, 1.0)

roughness = 0.46 + grain * 0.10 + fine * 0.05
roughness = roughness - wear * 0.26 + grime * 0.34 - scratches * 0.12
roughness = np.clip(roughness * (1.0 - seam) + seam * 0.92, 0.08, 1.0)
metalness = np.clip(1.0 - grime * 0.45 - seam * 0.6, 0.0, 1.0)
occlusion = np.clip(1.0 - seam * 0.75 - bevel * 0.12 - np.maximum(-proud, 0.0) * 0.5, 0.0, 1.0)

RELIEF = 26.0
dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5 * RELIEF
dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5 * RELIEF
normal = np.dstack([-dx, -dy, np.ones_like(dx)])
normal /= np.linalg.norm(normal, axis=2, keepdims=True)


def to_srgb(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 1e-9), 1 / 2.4) - 0.055)


written = []
for name, rgb, fmt in (
    ("deck_basecolor", to_srgb(linear), "JPEG"),
    ("deck_orm", np.dstack([occlusion, roughness, metalness]), "JPEG"),
    ("deck_normal", normal * 0.5 + 0.5, "PNG"),
):
    # Every map is written as plain data: the colour is already encoded above, so nothing
    # between here and the file is allowed to apply a view transform to it.
    image = bpy.data.images.get(name)
    if image:
        bpy.data.images.remove(image)
    image = bpy.data.images.new(name, SIZE, SIZE, alpha=False, float_buffer=False)
    image.colorspace_settings.name = "Non-Color"
    rgba = np.ones((SIZE, SIZE, 4), np.float32)
    rgba[..., :3] = np.clip(rgb, 0.0, 1.0)
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = os.path.join(OUT, name + (".png" if fmt == "PNG" else ".jpg"))
    image.file_format = fmt
    image.save()
    written.append(image.filepath_raw)

result = {"written": written, "bytes": [os.path.getsize(p) for p in written]}
