"""
Draw the foundry floor: the ground the campus stands over. Run inside Blender (for its numpy
and image writer):

    exec(open("/path/to/design/campus/bake_foundry.py").read())

Sixteen metres to a repeat: sixteen plates of blackened steel, four metres square, and two
service channels crossing in the middle of them. Each channel is a grated trench with a line of
amber running down it, and where they cross there is a junction plate ringed in light. Laid
end to end the channels make a grid of conduits out to the horizon.

It is darker and rougher than the decks, which are the thing to look at; this is what they
stand on. Drawn as a height field first, with everything else read off it, and every layer
wraps so the sheet tiles with no seam (see bake_deck.py, which works the same way).

Writes four maps to `public/assets/campus/`:

    floor_basecolor.jpg   sRGB colour
    floor_orm.jpg         occlusion, roughness and metalness in R, G and B
    floor_normal.jpg      tangent-space normal, +Y up
    floor_emission.jpg    the conduits' light, sRGB
"""
import os

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(bpy.data.filepath)) if bpy.data.filepath else os.getcwd()
ROOT = globals().get("FLOOR_ROOT") or os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "public", "assets", "campus")
SIZE = 2048
METRES = 16.0
PX = SIZE / METRES                      # texels to a metre
rng = np.random.default_rng(0xF100)

os.makedirs(OUT, exist_ok=True)
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
    field = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((SIZE, SIZE))) * falloff))
    field -= field.mean()
    return (field / (np.abs(field).max() + 1e-9)).astype(np.float32)


# ---------- where things are ----------
PLATE = 4.0 * PX
px = xs % PLATE
py = ys % PLATE
to_edge = np.minimum(np.minimum(px, PLATE - px), np.minimum(py, PLATE - py))
plate_x = (xs // PLATE).astype(int)
plate_y = (ys // PLATE).astype(int)

seam = 1.0 - smooth(2.0, 4.5, to_edge)
bevel = 1.0 - smooth(4.0, 14.0, to_edge)

# The two channels cross at the middle of the sheet.
MID = SIZE / 2
across_x = np.abs(ys - MID)             # distance from the channel that runs along x
across_z = np.abs(xs - MID)
across = np.minimum(across_x, across_z)
along = np.where(across_x < across_z, xs, ys)

HALF = 0.28 * PX                        # half the trench
LIP = 0.11 * PX                         # the frame round it
trench = 1.0 - smooth(HALF - 2.0, HALF + 1.0, across)
frame = (1.0 - smooth(HALF + LIP - 1.5, HALF + LIP + 1.5, across)) * (1.0 - trench)
line = 1.0 - smooth(0.035 * PX, 0.075 * PX, across)
halo = np.exp(-(across / (0.20 * PX)) ** 2) * trench

# Grating bars over the trench, every twenty centimetres.
bars = (1.0 - smooth(0.28, 0.42, np.abs(((along / (0.2 * PX)) % 1.0) - 0.5))) * trench

# The junction where they cross: an octagonal plate, a ring of light, a hub.
dx, dy = np.abs(xs - MID), np.abs(ys - MID)
octagon = np.maximum(np.maximum(dx, dy), (dx + dy) * 0.7071)
node = 1.0 - smooth(0.62 * PX, 0.66 * PX, octagon)
radius = np.hypot(dx, dy)
ring = np.exp(-((radius - 0.40 * PX) / (0.035 * PX)) ** 2)
hub = 1.0 - smooth(0.16 * PX, 0.19 * PX, radius)
trench = trench * (1.0 - node)
frame = frame * (1.0 - node)
bars = bars * (1.0 - node)
line = line * (1.0 - node)
halo = halo * (1.0 - node)

# Bolts: plate corners, and round the junction.
bolt = np.zeros((SIZE, SIZE), np.float32)
for gx in range(4):
    for gy in range(4):
        for sx in (0.16, 3.84):
            for sy in (0.16, 3.84):
                bx, by = (gx * 4 + sx) * PX, (gy * 4 + sy) * PX
                bolt = np.maximum(bolt, 1.0 - smooth(0.035 * PX, 0.05 * PX, np.hypot(xs - bx, ys - by)))
for i in range(8):
    a = i * np.pi / 4 + np.pi / 8
    bx, by = MID + np.cos(a) * 0.54 * PX, MID + np.sin(a) * 0.54 * PX
    bolt = np.maximum(bolt, 1.0 - smooth(0.03 * PX, 0.045 * PX, np.hypot(xs - bx, ys - by)))
bolt *= 1.0 - np.maximum(trench, frame)

# Every other plate is pressed with a shallow anti-slip stud.
studded = ((plate_x + plate_y) % 2 == 1) & (to_edge > 0.30 * PX)
PITCH = 0.25 * PX
stud_d = np.hypot((px % PITCH) - PITCH / 2, (py % PITCH) - PITCH / 2)
studs = (1.0 - smooth(0.03 * PX, 0.05 * PX, stud_d)) * studded
studs *= 1.0 - np.maximum(np.maximum(trench, frame), node)

# ---------- height ----------
grain = noise(22.0, 1.0)
fine = noise(3.0, 3.0, 0.9)
dents = noise(1.0, 1.0, 2.6)

height = np.full((SIZE, SIZE), 0.5, np.float32)
height -= bevel * 0.06 + seam * 0.22
height += studs * 0.07 + bolt * 0.10
height += frame * 0.08
height -= trench * 0.30
height += bars * 0.26
height += node * 0.07 - ring * 0.05 * node + hub * 0.05
height += grain * 0.010 + fine * 0.006 + dents * 0.035

# ---------- what the height says about the surface ----------
freq_y = np.fft.fftfreq(SIZE)[:, None] * 110
freq_x = np.fft.fftfreq(SIZE)[None, :] * 110
blur = np.real(np.fft.ifft2(np.fft.fft2(height) * np.exp(-(freq_y ** 2 + freq_x ** 2))))
proud = np.clip((height - blur) * 14.0, -1.0, 1.0).astype(np.float32)
patchy = smooth(-0.2, 0.5, noise(1.0, 1.0, 2.0) + fine * 0.3)
wear = np.clip(np.maximum(proud, 0.0) * (0.25 + 0.5 * patchy) + bevel * (1.0 - seam) * 0.30 * patchy, 0.0, 1.0)
# A floor nobody polishes: more of it holds dirt than on a deck, and oil pools in the dents.
grime = np.clip(np.maximum(-proud, 0.0) * 1.2 + smooth(0.05, 0.75, noise(1.0, 1.0, 2.2)) * 0.5, 0.0, 1.0) * (1.0 - wear)
oil = smooth(0.45, 0.8, noise(1.0, 1.0, 2.8)) * (1.0 - np.maximum(trench, node))

# ---------- the maps ----------
shade = rng.uniform(-0.014, 0.014, (4, 4)).astype(np.float32)[plate_y % 4, plate_x % 4]
value = 0.085 + shade + grain * 0.014 + fine * 0.008
value = value * (1.0 - grime * 0.5) * (1.0 - oil * 0.35)
value = value + wear * 0.17 + frame * 0.05 + bars * 0.04
value = value * (1.0 - seam * 0.85) * (1.0 - trench * (1.0 - bars) * 0.8)
value = np.clip(value, 0.0, 1.0)
tint = np.array([0.94, 0.98, 1.07], np.float32)
linear = np.clip(value[..., None] * tint[None, None, :], 0.0, 1.0)
# Light throws no colour onto a surface that is already giving off its own.
glow = np.clip(line * (1.0 - bars * 0.75) + ring * node + halo * 0.20 * (1.0 - bars), 0.0, 1.0)
linear = linear * (1.0 - np.clip(glow * 1.5, 0.0, 1.0))[..., None]

roughness = 0.62 + grain * 0.08 + fine * 0.05 - wear * 0.22 + grime * 0.22 - oil * 0.36
roughness = np.clip(roughness * (1.0 - seam) + seam * 0.95, 0.10, 1.0)
metalness = np.clip(1.0 - grime * 0.5 - seam * 0.6, 0.0, 1.0)
occlusion = np.clip(1.0 - seam * 0.7 - trench * (1.0 - bars) * 0.6 - np.maximum(-proud, 0.0) * 0.4, 0.0, 1.0)

AMBER = np.array([0.982, 0.571, 0.0], np.float32)   # brand amber, linear
emission = glow[..., None] * AMBER[None, None, :]

RELIEF = 24.0
gx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5 * RELIEF
gy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5 * RELIEF
normal = np.dstack([-gx, -gy, np.ones_like(gx)])
normal /= np.linalg.norm(normal, axis=2, keepdims=True)


def to_srgb(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 1e-9), 1 / 2.4) - 0.055)


written = []
for name, rgb, fmt in (
    ("floor_basecolor", to_srgb(linear), "JPEG"),
    ("floor_orm", np.dstack([occlusion, roughness, metalness]), "JPEG"),
    # A lossless normal map of this size is six megabytes; the floor is never seen that close.
    ("floor_normal", normal * 0.5 + 0.5, "JPEG"),
    ("floor_emission", to_srgb(emission), "JPEG"),
):
    # Written as plain data: the colour is already encoded above, so nothing between here and
    # the file is allowed to apply a view transform to it.
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
