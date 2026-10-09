"""
Model the settlement kit: the parts a workspace's platforms, stacks and ways between are put
together from. Run inside Blender with nodexeus-buildings.blend open:

    exec(open("/path/to/design/campus/build_settlement.py").read())

or, for some of them only, set `ONLY = ["deck-a", "frame"]` first.

Each part lands in its own `NX_Set_<Name>` collection in the scene `NX_Settlement`, as a
handful of objects, one a finish, ready for `bake_settlement.py`. Everything is in metres with
z up; a part's origin and facing are in `settlement.md`. Nothing here touches the buildings'
own collections or materials: every material this makes is named `NX_Set_...`.

The finishes are the campus's (blackened plate, mid steel, amber light and paint) and their
wear comes from each part's own shape: bright where an edge sticks out, dirty where a corner
does not, streaked below what hangs over it, each plate a little its own tone. Wear is
uneven on purpose and absent from most of a surface. Deck plates each carry one whole plate
of the app's own deck maps, read from `public/assets/campus/`.

Running it again builds the same parts: every random choice is seeded.
"""
import math
import os
import random

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.getcwd()
DECK_MAPS = os.path.join(os.path.dirname(os.path.dirname(HERE)), "public", "assets", "campus")

TAU = math.pi * 2

# ---------------------------------------------------------------- materials
def _mat(name):
    name = 'NX_Set_' + name
    old = bpy.data.materials.get(name)
    if old:
        bpy.data.materials.remove(old)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    return m, nt

def _ramp(nt, stops):
    n = nt.nodes.new('ShaderNodeValToRGB')
    el = n.color_ramp.elements
    el[0].position, el[0].color = stops[0][0], (*stops[0][1], 1)
    el[1].position, el[1].color = stops[-1][0], (*stops[-1][1], 1)
    for pos, col in stops[1:-1]:
        e = el.new(pos)
        e.color = (*col, 1)
    return n

# ---------------------------------------------------------------- geometry bins
class Bins:
    """Geometry gathered by material, turned into one object a material at the end."""
    def __init__(self):
        self.b = {}
    def bm(self, mat, bevel=True):
        key = (mat, bevel)
        if key not in self.b:
            self.b[key] = bmesh.new()
        return self.b[key]
    def flush(self, name, coll, M):
        made = []
        for (mat, bevel), bm in self.b.items():
            me = bpy.data.meshes.new(f'{name}_{mat}')
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(me)
            bm.free()
            ob = bpy.data.objects.new(me.name, me)
            me.materials.append(M[mat])
            coll.objects.link(ob)
            if bevel:
                mod = ob.modifiers.new('bevel', 'BEVEL')
                mod.width = 0.014
                mod.segments = 1
                mod.limit_method = 'ANGLE'
                mod.angle_limit = math.radians(40)
                mod.harden_normals = False
            made.append(ob)
        self.b = {}
        return made

I4 = Matrix.Identity(4)

def box(bins, mat, size, M=I4, bevel=True):
    bm = bins.bm(mat, bevel)
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    vs = [bm.verts.new(M @ Vector((x * sx, y * sy, z * sz))) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        bm.faces.new([vs[i] for i in f])

def T(x=0, y=0, z=0):
    return Matrix.Translation((x, y, z))

def RZ(a):
    return Matrix.Rotation(a, 4, 'Z')

def RX(a):
    return Matrix.Rotation(a, 4, 'X')

def RY(a):
    return Matrix.Rotation(a, 4, 'Y')

def along(p0, p1):
    """A frame at the middle of p0..p1 with its local Z along it."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    q = d.to_track_quat('Z', 'Y')
    return Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4(), d.length

def beam(bins, mat, p0, p1, w, h, bevel=True):
    M, L = along(p0, p1)
    box(bins, mat, (w, h, L), M, bevel)

def tube(bins, mat, p0, p1, r, seg=6):
    M, L = along(p0, p1)
    cyl(bins, mat, r, L, M @ T(0, 0, -L / 2), seg, bevel=False)

def cyl(bins, mat, r, h, M=I4, seg=10, r2=None, bevel=True, cap=True):
    bm = bins.bm(mat, bevel)
    r2 = r if r2 is None else r2
    lo = [bm.verts.new(M @ Vector((math.cos(TAU * i / seg) * r, math.sin(TAU * i / seg) * r, 0))) for i in range(seg)]
    hi = [bm.verts.new(M @ Vector((math.cos(TAU * i / seg) * r2, math.sin(TAU * i / seg) * r2, h))) for i in range(seg)]
    for i in range(seg):
        j = (i + 1) % seg
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    if cap:
        bm.faces.new(list(reversed(lo)))
        bm.faces.new(hi)

def prism(bins, mat, poly, z0, z1, bevel=True):
    if len(poly) < 3 or abs(area(poly)) < 0.02:
        return
    if area(poly) < 0:
        poly = list(reversed(poly))
    bm = bins.bm(mat, bevel)
    lo = [bm.verts.new((p[0], p[1], z0)) for p in poly]
    hi = [bm.verts.new((p[0], p[1], z1)) for p in poly]
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bm.faces.new(list(reversed(lo)))
    bm.faces.new(hi)

# ---------------------------------------------------------------- 2D polygons
def area(poly):
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly))) / 2

def clip_half(poly, p, n):
    """Keep the part of a polygon where (x - p) . n <= 0."""
    out = []
    for i in range(len(poly)):
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % len(poly)])
        da, db = (a - p).dot(n), (b - p).dot(n)
        if da <= 0:
            out.append(a)
        if (da < 0 < db) or (db < 0 < da):
            out.append(a + (b - a) * (da / (da - db)))
    return out

def clip_convex(poly, clipper):
    """Clip a polygon to a convex, counter-clockwise one."""
    out = [Vector(p) for p in poly]
    for i in range(len(clipper)):
        a, b = Vector(clipper[i]), Vector(clipper[(i + 1) % len(clipper)])
        e = b - a
        n = Vector((e.y, -e.x))
        out = clip_half(out, a, n)
        if len(out) < 3:
            return []
    return out

def inset(poly, d):
    """Pull every edge of a convex counter-clockwise polygon in by d."""
    out = [Vector(p) for p in poly]
    for i in range(len(poly)):
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % len(poly)])
        e = (b - a).normalized()
        n = Vector((e.y, -e.x))
        out = clip_half(out, a - n * d, n)
        if len(out) < 3:
            return []
    return out

def inside(poly, p):
    for i in range(len(poly)):
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % len(poly)])
        e = b - a
        if e.x * (p.y - a.y) - e.y * (p.x - a.x) < 0:
            return False
    return True

def v3(p, z):
    return Vector((p[0], p[1], z))

def ladder(bins, foot, top, w=0.42):
    foot, top = Vector(foot), Vector(top)
    d = top - foot
    side = Vector((-d.y, d.x, 0))
    side = side.normalized() if side.length > 1e-4 else Vector((1, 0, 0))
    for s in (-1, 1):
        o = side * (w / 2) * s
        tube(bins, 'tube', foot + o, top + o + d.normalized() * 0.5, 0.025, 6)
    n = max(2, int(d.length / 0.28))
    for i in range(1, n):
        p = foot.lerp(top, i / n)
        tube(bins, 'tube', p - side * w / 2, p + side * w / 2, 0.016, 5)

def neon_sign(bins, M, rng, color, w=1.7, h=0.8):
    """A small sign on two posts: a dark board with a few lit bars."""
    for x in (-w / 2 + 0.1, w / 2 - 0.1):
        tube(bins, 'tube', M @ Vector((x, 0, 0)), M @ Vector((x, 0, 1.5 + h)), 0.04, 6)
    box(bins, 'frame', (w, 0.1, h), M @ T(0, 0, 1.5 + h / 2))
    rows = rng.randint(2, 4)
    for i in range(rows):
        L = rng.uniform(0.35, 0.9) * (w - 0.3)
        x = rng.uniform(-(w - 0.3 - L) / 2, (w - 0.3 - L) / 2)
        zz = 1.5 + h * (i + 0.5) / rows
        for s in (-1, 1):
            box(bins, color, (L, 0.03, h / rows * 0.32), M @ T(x, 0.06 * s, zz), bevel=False)

def dish(bins, M, r, rng):
    bm = bins.bm('plate_b', False)
    seg, rings = 16, 5
    f = r * 0.7
    grid = []
    for i in range(rings + 1):
        rr = r * i / rings
        grid.append([bm.verts.new(M @ Vector((math.cos(TAU * j / seg) * rr, math.sin(TAU * j / seg) * rr, rr * rr / (4 * f)))) for j in range(seg)] if i else [bm.verts.new(M @ Vector((0, 0, 0)))])
    for j in range(seg):
        bm.faces.new((grid[0][0], grid[1][j], grid[1][(j + 1) % seg]))
    for i in range(1, rings):
        for j in range(seg):
            k = (j + 1) % seg
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][k], grid[i][k]))
    rim = r * r / (4 * f)
    for j in range(seg):
        a, b = TAU * j / seg, TAU * (j + 1) / seg
        tube(bins, 'frame', M @ Vector((math.cos(a) * r, math.sin(a) * r, rim)), M @ Vector((math.cos(b) * r, math.sin(b) * r, rim)), 0.02, 5)
    focus = M @ Vector((0, 0, f))
    for j in range(3):
        a = TAU * j / 3
        tube(bins, 'tube', M @ Vector((math.cos(a) * r * 0.9, math.sin(a) * r * 0.9, rim * 0.8)), focus, 0.015, 5)
    box(bins, 'frame', (0.12, 0.12, 0.16), Matrix.Translation(focus) @ M.to_3x3().to_4x4())

def dish_on_mount(bins, base, r, rng):
    base = Vector(base)
    h = rng.uniform(0.5, 1.1)
    tube(bins, 'frame', base, base + Vector((0, 0, h)), 0.06, 8)
    box(bins, 'frame', (0.22, 0.22, 0.14), T(*(base + Vector((0, 0, h)))))
    M = T(*(base + Vector((0, 0, h + 0.12)))) @ RZ(rng.uniform(0, TAU)) @ RX(rng.uniform(0.6, 1.05))
    dish(bins, M, r, rng)

def extrude_x(bins, mat, profile, x0, x1, M, bevel=True):
    """A (y, z) outline run from x0 to x1."""
    bm = bins.bm(mat, bevel)
    if sum(profile[i][0] * profile[(i + 1) % len(profile)][1] - profile[(i + 1) % len(profile)][0] * profile[i][1] for i in range(len(profile))) < 0:
        profile = list(reversed(profile))
    a = [bm.verts.new(M @ Vector((x0, y, z))) for y, z in profile]
    b = [bm.verts.new(M @ Vector((x1, y, z))) for y, z in profile]
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))

# ------------------------------------------------------------------ Nodexeus modules
def _plinth(bins, M, L, W):
    box(bins, 'steel', (L + 0.12, W + 0.12, 0.1), M @ T(0, 0, 0.05))
    box(bins, 'light', (L - 0.02, W - 0.02, 0.03), M @ T(0, 0, 0.113), bevel=False)

def _louvres(bins, M, w, h):
    box(bins, 'recess', (0.02, w, h), M, bevel=False)
    n = max(3, int(h / 0.075))
    for i in range(n):
        box(bins, 'steel', (0.03, w - 0.02, 0.02), M @ T(0.012, 0, -h / 2 + (i + 0.5) * h / n) @ RY(0.5), bevel=False)

def _door(bins, M, h=0.95):
    box(bins, 'steel', (0.06, 0.62, h + 0.08), M @ T(0, 0, (h + 0.08) / 2))
    box(bins, 'recess', (0.02, 0.5, h), M @ T(0.03, 0, h / 2), bevel=False)
    box(bins, 'light', (0.02, 0.5, 0.03), M @ T(0.034, 0, h + 0.01), bevel=False)
    box(bins, 'steel', (0.3, 0.7, 0.06), M @ T(0.16, 0, -0.03))
    box(bins, 'paint', (0.3, 0.66, 0.006), M @ T(0.16, 0, 0.003), bevel=False)

def mod_cab(bins, M, L, W, H, rng):
    """A cabin: black body on a steel plinth, a glazed band lit from inside, a steel roof."""
    _plinth(bins, M, L, W)
    b = 0.128
    box(bins, 'black', (L - 0.08, W - 0.08, H), M @ T(0, 0, b + H / 2))
    zb = b + H * 0.6
    box(bins, 'light', (L - 0.064, W - 0.064, 0.2), M @ T(0, 0, zb), bevel=False)
    for dz in (-0.125, 0.125):
        box(bins, 'steel', (L - 0.02, W - 0.02, 0.035), M @ T(0, 0, zb + dz))
    n = int((L - 0.2) / 0.24)
    for i in range(n + 1):
        x = -(L - 0.2) / 2 + i * (L - 0.2) / n
        for s in (-1, 1):
            box(bins, 'steel', (0.045, 0.03, 0.26), M @ T(x, s * (W / 2 - 0.028), zb))
    n = int((W - 0.2) / 0.24)
    for i in range(n + 1):
        y = -(W - 0.2) / 2 + i * (W - 0.2) / n
        for s in (-1, 1):
            box(bins, 'steel', (0.03, 0.045, 0.26), M @ T(s * (L / 2 - 0.028), y, zb))
    top = b + H
    box(bins, 'steel', (L + 0.04, W + 0.04, 0.07), M @ T(0, 0, top + 0.035))
    end = rng.choice([-1, 1])
    _door(bins, M @ T(end * (L / 2 - 0.02), rng.uniform(-0.2, 0.2), b) @ RZ(0 if end > 0 else math.pi), min(0.6, H * 0.5))
    _louvres(bins, M @ T(-end * (L / 2 - 0.03), 0, b + H * 0.28) @ RZ(math.pi if end > 0 else 0), W * 0.5, H * 0.3)
    vx = rng.uniform(-L / 4, L / 4)
    cyl(bins, 'steel', 0.26, 0.1, M @ T(vx, 0.1, top + 0.07), 12, r2=0.2)
    cyl(bins, 'light', 0.18, 0.025, M @ T(vx, 0.1, top + 0.17), 12, bevel=False)
    cyl(bins, 'black', 0.2, 0.17, M @ T(vx, 0.1, top + 0.195), 12, r2=0.06)
    box(bins, 'steel', (0.3, 0.24, 0.14), M @ T(vx + 0.7 * (1 if vx < 0 else -1), -0.3, top + 0.14))
    return top + 0.07

def mod_drum(bins, M, L, W, H, rng):
    """A drum of plate, hooped in steel, with lit slits and a light under its cap."""
    r = W / 2 + 0.02
    cyl(bins, 'steel', r + 0.09, 0.1, M, 16)
    cyl(bins, 'light', r + 0.01, 0.03, M @ T(0, 0, 0.098), 16, bevel=False)
    b = 0.128
    cyl(bins, 'black', r, H, M @ T(0, 0, b), 16)
    for t in (0.22, 0.78):
        cyl(bins, 'steel', r + 0.03, 0.055, M @ T(0, 0, b + H * t), 16)
    a0 = rng.uniform(0, TAU)
    for k in range(3):
        a = a0 + k * TAU / 3 + rng.uniform(-0.3, 0.3)
        S = M @ RZ(a) @ T(r + 0.005, 0, b + H * 0.5)
        box(bins, 'light', (0.02, 0.09, H * 0.42), S, bevel=False)
        for e in (-1, 1):
            box(bins, 'steel', (0.035, 0.035, H * 0.48), S @ T(0.005, e * 0.065, 0))
    _door(bins, M @ RZ(a0 + 0.9) @ T(r - 0.02, 0, b), min(0.6, H * 0.5))
    top = b + H
    cyl(bins, 'steel', r + 0.05, 0.14, M @ T(0, 0, top), 16, r2=r - 0.22)
    cyl(bins, 'light', r - 0.26, 0.03, M @ T(0, 0, top + 0.14), 16, bevel=False)
    cyl(bins, 'black', r - 0.28, 0.24, M @ T(0, 0, top + 0.165), 16, r2=0.16)
    return top + 0.4

def mod_wedge(bins, M, L, W, H, rng):
    """A shed with one high side: a long light under the eave, ribs down the roof."""
    _plinth(bins, M, L, W)
    b = 0.128
    hi, lo = b + H * 1.12, b + H * 0.66
    w = W / 2 - 0.04
    side = rng.choice([-1, 1])
    prof = [(-w * side, b), (w * side, b), (w * side, lo), (-w * side, hi)]
    extrude_x(bins, 'black', prof, -L / 2 + 0.04, L / 2 - 0.04, M)
    frame = [(-(w + 0.03) * side, b), ((w + 0.03) * side, b), ((w + 0.03) * side, lo + 0.04), (-(w + 0.03) * side, hi + 0.04)]
    for x in (-L / 2, L / 2 - 0.07, -0.035):
        extrude_x(bins, 'steel', frame, x, x + 0.07, M)
    box(bins, 'light', (L - 0.3, 0.02, 0.07), M @ T(0, -side * (w + 0.008), hi - 0.2), bevel=False)
    box(bins, 'steel', (L - 0.2, 0.04, 0.03), M @ T(0, -side * (w + 0.012), hi - 0.14))
    box(bins, 'steel', (L - 0.2, 0.04, 0.03), M @ T(0, -side * (w + 0.012), hi - 0.26))
    slope = math.atan2(hi - lo, 2 * w)
    for x in (-L / 4, L / 4):
        box(bins, 'recess', (L * 0.28, w * 1.1, 0.02), M @ T(x, 0, (hi + lo) / 2 + 0.012) @ RX(side * slope), bevel=False)
        box(bins, 'light', (L * 0.2, 0.05, 0.022), M @ T(x, 0, (hi + lo) / 2 + 0.02) @ RX(side * slope), bevel=False)
    _door(bins, M @ T(L / 2 - 0.05, side * w * 0.3, b), min(0.6, H * 0.45))
    _louvres(bins, M @ T(-L / 2 + 0.03, 0, b + H * 0.3) @ RZ(math.pi), W * 0.45, H * 0.3)
    return hi + 0.04

def mod_pod(bins, M, L, W, H, rng):
    """A tank on cradles lying on its side: steel hoops, and a ring of light at one end."""
    r = min(W / 2, H / 2 + 0.1)
    zc = 0.22 + r
    for x in (-L * 0.3, L * 0.3):
        box(bins, 'steel', (0.16, r * 1.7, 0.1), M @ T(x, 0, 0.05))
        for s in (-1, 1):
            box(bins, 'steel', (0.14, 0.16, r * 0.9), M @ T(x, s * r * 0.72, 0.1 + r * 0.45))
        box(bins, 'light', (0.02, r * 1.2, 0.03), M @ T(x + 0.082, 0, 0.12), bevel=False)
    A = M @ T(-L / 2 + 0.1, 0, zc) @ RY(math.pi / 2) @ RZ(math.pi / 8)
    cyl(bins, 'black', r, L - 0.2, A, 8)
    for t in (0.12, 0.5, 0.88):
        cyl(bins, 'steel', r + 0.035, 0.07, A @ T(0, 0, (L - 0.2) * t - 0.035), 8)
    end = rng.choice([0, 1])
    E = M @ T((L / 2 - 0.1) if end else (-L / 2 + 0.1), 0, zc) @ RY(math.pi / 2 if end else -math.pi / 2)
    cyl(bins, 'steel', r * 0.82, 0.05, E, 16)
    cyl(bins, 'light', r * 0.68, 0.02, E @ T(0, 0, 0.05), 16, bevel=False)
    cyl(bins, 'black', r * 0.5, 0.035, E @ T(0, 0, 0.055), 16)
    F = M @ T((-L / 2 + 0.08) if end else (L / 2 - 0.08), 0, zc) @ RZ(math.pi if end else 0)
    _louvres(bins, F, r * 0.9, r * 0.7)
    box(bins, 'steel', (L * 0.7, 0.16, 0.06), M @ T(0, 0, zc + r * 0.93))
    for x in (-L * 0.25, 0, L * 0.25):
        box(bins, 'light', (0.1, 0.05, 0.03), M @ T(x, 0, zc + r * 0.93 + 0.04), bevel=False)
    return zc + r + 0.05

class G:
    """A few shorthands for wiring a node tree."""
    def __init__(self, nt):
        self.nt = nt
    def _in(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.nt.links.new(v, sock)
        else:
            sock.default_value = v
    def m(self, op, a, b=0.0, c=0.0, clamp=False):
        n = self.nt.nodes.new('ShaderNodeMath')
        n.operation = op
        n.use_clamp = clamp
        self._in(n.inputs[0], a); self._in(n.inputs[1], b); self._in(n.inputs[2], c)
        return n.outputs[0]
    def rng(self, x, a, b, c=0.0, d=1.0):
        n = self.nt.nodes.new('ShaderNodeMapRange')
        n.interpolation_type = 'SMOOTHSTEP'
        self._in(n.inputs['Value'], x)
        n.inputs['From Min'].default_value = a; n.inputs['From Max'].default_value = b
        n.inputs['To Min'].default_value = c; n.inputs['To Max'].default_value = d
        return n.outputs[0]
    def mix(self, a, b, f, kind='MIX'):
        n = self.nt.nodes.new('ShaderNodeMixRGB')
        n.blend_type = kind
        self._in(n.inputs['Fac'], f)
        for sock, v in ((n.inputs['Color1'], a), (n.inputs['Color2'], b)):
            if isinstance(v, tuple):
                sock.default_value = (*v, 1)
            else:
                self.nt.links.new(v, sock)
        return n.outputs[0]
    def noise(self, vec, scale, detail=3, rough=0.5):
        n = self.nt.nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough
        self.nt.links.new(vec, n.inputs['Vector'])
        return n.outputs['Fac']

def _img(path, name, colorspace):
    im = bpy.data.images.get(name)
    if im is None:
        im = bpy.data.images.load(path)
        im.name = name
    im.colorspace_settings.name = colorspace
    return im

def wear3(key, base, metal, rough, edge=1.0, emit=None, deck=False, rust_all=False, tube=False, grime=1.0):
    """
    One of the campus's finishes, worn by its own shape: bright on the edges that stick out,
    dirty in the corners that do not, streaked below whatever hangs over it, and each panel a
    little its own tone. No pattern laid over the whole surface.
    """
    P = dict(bevel=0.04, ao=0.5, grime_k=0.88, grime_col=(0.004, 0.004, 0.005), drip_k=0.8, edge_col=(0.3, 0.3, 0.32), edge_k=1.0,
             deck_mul=(0.2, 0.2, 0.21), lift=None, low=True, deck_rmin=0.62, name='W3_', over=1.3, drip_rng=(0.9, 0.35), patchy=False, gate=0.9, walk_mix=True, deck_normal=False, hot_rng=(0.62, 0.7), stain_k=0.9)
    P.update(globals().get('WP', {}))
    m, nt = _mat(P['name'] + key)
    g = G(nt)
    L = nt.links
    out = nt.nodes.new('ShaderNodeOutputMaterial'); out.name = 'OUT'
    pbr = nt.nodes.new('ShaderNodeBsdfPrincipled'); pbr.name = 'PBR'
    L.new(pbr.outputs[0], out.inputs['Surface'])
    tc = nt.nodes.new('ShaderNodeTexCoord')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    L.new(geo.outputs['Normal'], sep.inputs[0])
    upabs = g.m('ABSOLUTE', sep.outputs['Z'])
    side = g.m('SUBTRACT', 1.0, upabs, clamp=True)
    upf = g.rng(sep.outputs['Z'], 0.5, 0.95)

    bev = nt.nodes.new('ShaderNodeBevel')
    bev.samples = 4
    bev.inputs['Radius'].default_value = P['bevel']
    dot = nt.nodes.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'
    L.new(bev.outputs['Normal'], dot.inputs[0]); L.new(geo.outputs['Normal'], dot.inputs[1])
    e = g.rng(g.m('SUBTRACT', 1.0, dot.outputs['Value']), 0.008, 0.16)
    ao = nt.nodes.new('ShaderNodeAmbientOcclusion'); ao.samples = 8
    ao.inputs['Distance'].default_value = P['ao']
    opened = g.rng(ao.outputs['AO'], 0.62, 0.9)
    cavity = g.m('MULTIPLY', g.rng(ao.outputs['AO'], 0.8, 0.3), grime)
    over = nt.nodes.new('ShaderNodeAmbientOcclusion'); over.samples = 8
    over.inputs['Distance'].default_value = P['over']
    upv = nt.nodes.new('ShaderNodeCombineXYZ'); upv.inputs['Z'].default_value = 1.0
    L.new(upv.outputs[0], over.inputs['Normal'])
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (17, 17, 0.16)
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    streak = g.rng(g.noise(mp.outputs['Vector'], 3.0, 4, 0.6), 0.4, 0.68)
    drip = g.m('MULTIPLY', g.m('MULTIPLY', g.rng(over.outputs['AO'], P['drip_rng'][0], P['drip_rng'][1]), side), streak)
    breakup = g.rng(g.noise(tc.outputs['Object'], 26, 3), 0.32, 0.62, 0.3, 1.0)
    patch = None
    if P['patchy']:
        # wear happens in places: where things are done (the map), and on the odd part here and there
        hot = g.rng(g.noise(tc.outputs['Object'], 0.33, 2), P['hot_rng'][0], P['hot_rng'][1])
        gate = g.m('GREATER_THAN', geo.outputs['Random Per Island'], P['gate'])
        p = g.m('ADD', hot, g.m('MULTIPLY', gate, 0.55), clamp=True)
        runs = g.m('MAXIMUM', g.m('GREATER_THAN', g.noise(tc.outputs['Object'], 1.3, 2), 0.53), g.m('GREATER_THAN', hot, 0.55))
        chips = g.m('GREATER_THAN', g.noise(tc.outputs['Object'], 13, 5, 0.7), g.m('MULTIPLY_ADD', p, -0.3, 0.67))
        var = g.rng(g.noise(tc.outputs['Object'], 2.6, 2), 0.35, 0.65, 0.3, 1.0)
        patch = g.m('MULTIPLY', g.m('MULTIPLY', g.m('MULTIPLY', g.m('GREATER_THAN', p, 0.05), runs), chips), var)
        breakup = patch
    if tube:
        convex = g.m('MULTIPLY', g.m('MULTIPLY', upf, breakup), 0.45 * edge)
    else:
        convex = g.m('MULTIPLY', g.m('MULTIPLY', g.m('MULTIPLY', e, opened), breakup), edge * P['edge_k'], clamp=True)
    panel = geo.outputs['Random Per Island']

    use = None
    if deck:
        uv = nt.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'deck'
        col = nt.nodes.new('ShaderNodeTexImage'); col.image = _img(os.path.join(DECK_MAPS, 'deck_basecolor.jpg'), 'NX_Set_deck_basecolor', 'sRGB')
        orm = nt.nodes.new('ShaderNodeTexImage'); orm.image = _img(os.path.join(DECK_MAPS, 'deck_orm.jpg'), 'NX_Set_deck_orm', 'Non-Color')
        L.new(uv.outputs[0], col.inputs['Vector']); L.new(uv.outputs[0], orm.inputs['Vector'])
        sepo = nt.nodes.new('ShaderNodeSeparateColor'); L.new(orm.outputs['Color'], sepo.inputs[0])
        um = nt.nodes.new('ShaderNodeMapping')
        x0, y0, sx, sy = USE_BOX
        um.inputs['Location'].default_value = (-x0 / sx, -y0 / sy, 0)
        um.inputs['Scale'].default_value = (1 / sx, 1 / sy, 1)
        L.new(tc.outputs['Object'], um.inputs['Vector'])
        ui = nt.nodes.new('ShaderNodeTexImage'); ui.image = bpy.data.images['NX_Set_use']; ui.extension = 'EXTEND'
        L.new(um.outputs['Vector'], ui.inputs['Vector'])
        use = nt.nodes.new('ShaderNodeSeparateColor'); L.new(ui.outputs['Color'], use.inputs[0])
        walked, stain, low = use.outputs[0], use.outputs[1], use.outputs[2]
        # the app's own plate, held down to blackened steel; where it is walked it is rubbed back up
        dark = g.mix(col.outputs['Color'], P['deck_mul'], 1.0, 'MULTIPLY')
        if not P['walk_mix']:
            c0 = dark
        elif P['lift'] is None:
            lift = g.mix(col.outputs['Color'], (0.62, 0.62, 0.64), 1.0, 'MULTIPLY')
            c0 = g.mix(dark, lift, walked)
        else:
            c0 = g.mix(dark, P['lift'], walked)
        if P['deck_normal']:
            # the plate's own relief: tread and brushing, from the app's deck normal map
            nimg = nt.nodes.new('ShaderNodeTexImage'); nimg.image = _img(os.path.join(DECK_MAPS, 'deck_normal.png'), 'NX_Set_deck_normal', 'Non-Color')
            L.new(uv.outputs[0], nimg.inputs['Vector'])
            nmap = nt.nodes.new('ShaderNodeNormalMap'); nmap.uv_map = 'deck'
            L.new(nimg.outputs['Color'], nmap.inputs['Color'])
            L.new(upf, nmap.inputs['Strength'])
            L.new(nmap.outputs['Normal'], pbr.inputs['Normal'])
        c0 = g.mix(c0, (0.006, 0.006, 0.005), g.m('MULTIPLY', stain, P['stain_k']))
        if P['low']:
            c0 = g.mix(c0, (0.012, 0.012, 0.013), g.m('MULTIPLY', low, 0.6))
        c0 = g.mix((base[0], base[1], base[2]), c0, upf)
        r0 = g.m('MAXIMUM', sepo.outputs[1], P['deck_rmin'])
        if P['walk_mix']:
            r0 = g.m('SUBTRACT', r0, g.m('MULTIPLY', walked, 0.16))
        r0 = g.m('SUBTRACT', r0, g.m('MULTIPLY', stain, 0.3 * min(1.0, P['stain_k'] / 0.9)))
        if P['low']:
            r0 = g.m('SUBTRACT', r0, g.m('MULTIPLY', low, 0.38))
    else:
        rgb = nt.nodes.new('ShaderNodeRGB'); rgb.outputs[0].default_value = (*base, 1)
        c0 = rgb.outputs[0]
        r0 = rough
    hsv = nt.nodes.new('ShaderNodeHueSaturation')
    L.new(c0, hsv.inputs['Color'])
    L.new(g.m('MULTIPLY_ADD', panel, 0.36, 0.82), hsv.inputs['Value'])
    c = hsv.outputs['Color']
    if rust_all:
        tone = _ramp(nt, [(0.3, (0.016, 0.008, 0.005)), (0.7, (0.07, 0.028, 0.012))])
        L.new(g.noise(tc.outputs['Object'], 7, 6, 0.65), tone.inputs['Fac'])
        c = tone.outputs['Color']
    c = g.mix(c, P['grime_col'], g.m('MULTIPLY', cavity, P['grime_k']))
    c = g.mix(c, P['grime_col'], g.m('MULTIPLY', drip, P['drip_k']))
    if not rust_all and not emit:
        rare = g.rng(g.noise(tc.outputs['Object'], 0.21, 2), 0.63, 0.67)
        rtone = _ramp(nt, [(0.3, (0.02, 0.01, 0.006)), (0.7, (0.08, 0.032, 0.014))])
        L.new(g.noise(tc.outputs['Object'], 9, 5), rtone.inputs['Fac'])
        # only where water runs: in the streaks below an overhang, never in the middle of a plate
        wet = g.m('MULTIPLY', g.m('MULTIPLY', drip, rare), g.rng(g.noise(tc.outputs['Object'], 14, 4), 0.35, 0.6), clamp=True)
        c = g.mix(c, rtone.outputs['Color'], g.m('MULTIPLY', wet, 0.9))
    c = g.mix(c, P['edge_col'], convex)
    r = g.m('ADD', r0, g.m('MULTIPLY', cavity, 0.3))
    r = g.m('ADD', r, g.m('MULTIPLY', drip, 0.2))
    r = g.m('SUBTRACT', r, g.m('MULTIPLY', convex, 0.24))
    r = g.m('ADD', r, g.m('MULTIPLY_ADD', panel, 0.14, -0.07), clamp=True)
    if rust_all:
        r = g.m('ADD', r, 0.25, clamp=True)
    mt = g.m('MULTIPLY', g.m('MULTIPLY_ADD', cavity, -0.7 * metal, metal), g.m('MULTIPLY_ADD', drip, -0.5, 1.0), clamp=True)
    L.new(c, pbr.inputs['Base Color'])
    L.new(r, pbr.inputs['Roughness'])
    L.new(mt, pbr.inputs['Metallic'])
    def bake(name, value):
        n = nt.nodes.new('ShaderNodeEmission'); n.name = name
        if isinstance(value, tuple):
            n.inputs['Color'].default_value = (*value, 1)
        else:
            L.new(value, n.inputs['Color'])
        return n
    bake('BAKE_COLOR', c); bake('BAKE_ROUGH', r); bake('BAKE_METAL', mt)
    white = nt.nodes.new('ShaderNodeBsdfDiffuse'); white.name = 'BAKE_LIGHT'
    white.inputs['Color'].default_value = (1, 1, 1, 1)
    if emit:
        pbr.inputs['Emission Color'].default_value = (*emit[0], 1)
        pbr.inputs['Emission Strength'].default_value = emit[1]
        bake('BAKE_EMIT', emit[0])
    else:
        bake('BAKE_EMIT', (0, 0, 0))
    t = nt.nodes.new('ShaderNodeTexImage'); t.name = 'BAKE_TARGET'
    return m

# ------------------------------------------------------------------ decks whose plates carry the app's own plate map
def plate_uv(bins, mat, poly, uvs, z0, z1):
    if len(poly) < 3:
        return
    if area(poly) < 0:
        poly, uvs = list(reversed(poly)), list(reversed(uvs))
    bm = bins.bm(mat, True)
    layer = bm.loops.layers.uv.get('deck') or bm.loops.layers.uv.new('deck')
    lo = [bm.verts.new((p[0], p[1], z0)) for p in poly]
    hi = [bm.verts.new((p[0], p[1], z1)) for p in poly]
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
        for loop, k in zip(f.loops, (i, j, j, i)):
            loop[layer].uv = uvs[k]
    # no underside: it lies on the slab, is never seen, and would only take room in the atlas
    f = bm.faces.new(hi)
    for loop, k in zip(f.loops, range(n)):
        loop[layer].uv = uvs[k]

def plating_d3(bins, poly, z, rng):
    """Plates laid to a plan, each one a whole plate of the app's deck map: tread or brushed, worn at its own edges."""
    if area(poly) < 0:
        poly = list(reversed(poly))
    c = sum((Vector(p) for p in poly), Vector((0, 0))) / len(poly)
    a = rng.choice([0, math.pi / 6, math.pi / 3, math.pi / 2, 2 * math.pi / 3, 5 * math.pi / 6])
    ca, sa = math.cos(a), math.sin(a)
    def w(x, y):
        return Vector((c.x + x * ca - y * sa, c.y + x * sa + y * ca))
    def back(p):
        dx, dy = p.x - c.x, p.y - c.y
        return dx * ca + dy * sa, -dx * sa + dy * ca
    xs = [-8.4 + rng.uniform(0, 1)]
    while xs[-1] < 8:
        xs.append(xs[-1] + rng.choice([1.6, 2.0, 2.0, 2.4, 2.8]))
    for i in range(len(xs) - 1):
        ys = [-8.4 + rng.uniform(0, 1.2)]
        while ys[-1] < 8:
            ys.append(ys[-1] + rng.choice([1.4, 1.8, 2.0, 2.0, 2.4]))
        for j in range(len(ys) - 1):
            g = 0.018
            x0, x1, y0, y1 = xs[i] + g, xs[i + 1] - g, ys[j] + g, ys[j + 1] - g
            rect = [w(x0, y0), w(x1, y0), w(x1, y1), w(x0, y1)]
            cut = clip_convex(rect, poly)
            if len(cut) < 3 or area(cut) < 0.05:
                continue
            whole = abs(area(cut) - (x1 - x0) * (y1 - y0)) < 0.01
            roll = rng.random()
            sx, sy = x1 - x0, y1 - y0
            M = T(c.x, c.y, z) @ RZ(a) @ T((x0 + x1) / 2, (y0 + y1) / 2, 0)
            if whole and roll < globals().get('GRILLE_P', 0.06):
                prism(bins, 'recess', cut, z - 0.07, z - 0.035)
                n = int(sx / 0.17)
                for k in range(n):
                    box(bins, 'steel', (0.05, sy - 0.08, 0.03), M @ T(-sx / 2 + (k + 0.5) * sx / n, 0, -0.012), bevel=False)
                for e in (-1, 1):
                    box(bins, 'steel', (sx, 0.07, 0.05), M @ T(0, e * (sy / 2 - 0.035), -0.01))
                continue
            qu, qv = rng.choice([(0, 0), (0.5, 0), (0, 0.5), (0.5, 0.5)])
            flip = rng.random() < 0.5
            uvs = []
            for p in cut:
                lx, ly = back(p)
                u, v = (lx - x0) / sx, (ly - y0) / sy
                if flip:
                    u, v = 1 - u, 1 - v
                uvs.append((qu + (0.01 + 0.98 * u) * 0.5, qv + (0.01 + 0.98 * v) * 0.5))
            plate_uv(bins, 'decktop', cut, uvs, z - 0.07, z + rng.choice([0, 0, 0.006]))
            if whole and roll > 1.0 - globals().get('HATCH_P', 0.045):
                hs = min(sx, sy) * 0.28
                for e in (-1, 1):
                    box(bins, 'steel', (hs * 2 + 0.12, 0.07, 0.045), M @ T(0, e * hs, 0.02))
                    box(bins, 'steel', (0.07, hs * 2 + 0.12, 0.045), M @ T(e * hs, 0, 0.02))
                box(bins, 'steel', (hs * 2 - 0.1, hs * 2 - 0.1, 0.028), M @ T(0, 0, 0.012))
                if globals().get('HATCH_MARKS', True):
                    box(bins, 'paint', (hs * 2 + 0.5, 0.09, 0.006), M @ T(0, -hs - 0.16, 0.004), bevel=False)
                    box(bins, 'light', (0.07, 0.07, 0.03), M @ T(hs - 0.12, hs - 0.12, 0.04), bevel=False)
            if rng.random() < globals().get('BOLT_P', 0.3):
                mid = sum(cut, Vector((0, 0))) / len(cut)
                for p in cut:
                    q = p + (mid - p).normalized() * 0.12
                    cyl(bins, 'fixing', 0.04, 0.022, T(q.x, q.y, z + 0.004), 6, bevel=False)

class LightGate:
    """Lets one of a module's lights through and drops the rest: light marks what is alive, it does not outline."""
    def __init__(self, bins, allowed):
        self.bins, self.allowed, self.n, self.trash = bins, allowed, 0, bmesh.new()
    def bm(self, mat, bevel=True):
        if mat == 'light':
            self.n += 1
            if self.n not in self.allowed:
                return self.trash
        return self.bins.bm(mat, bevel)

# ====================================================================== the kit
# Measurements, from the app: src/world/plots.js (CELL, TILE, APOTHEM) and the campus world
# in src/world/planet.js (gap, levelStep).
CELL = 7.6
TILE = CELL * 0.992
CELL_APOTHEM = TILE * math.sqrt(3) / 2            # 6.529: middle of a cell to the middle of an edge
PULL = (2.07 / 1.01 * 1.35) / 2                   # 1.383: how far a platform's outside edges are pulled in
AP = CELL_APOTHEM - PULL                          # 5.146: middle of a platform to the middle of an edge
RAD = AP / math.cos(math.pi / 6)                  # 5.942: middle of a platform to a corner, and one edge's length
PITCH = CELL * math.sqrt(3)                       # 13.164: between the middles of two neighbouring cells
GAP = PITCH - 2 * AP                              # 2.872: clear distance between two neighbouring platforms
STEP = 1.35                                       # one level
LEVEL1 = 1.80                                     # the lowest deck's top above the ground
SLAB = 0.45                                       # a deck's depth, top to underside
HEX = [Vector((math.cos(TAU * i / 6) * RAD, math.sin(TAU * i / 6) * RAD)) for i in range(6)]
FRAME = (3.4, 2.2, 2.3)                           # a frame's footprint and its height
MOD = (3.0, 1.8, 1.4)                             # the room a module is given

# Blender to glTF: x stays, Blender z is up (glTF y), and glTF +z is Blender -y. So "forward",
# "outward" and "from the lower platform to the higher" are all Blender -y below.

BRAND = {'tube': 'frame3', 'frame': 'steel', 'plate_b': 'steel', 'plate_c': 'black', 'red': 'light', 'plank': 'black'}

class Kit(Bins):
    """A part's geometry, in the campus's finishes, with the odd bracket gone to rust."""
    def __init__(self, names=None, rust=0.0, seed=1):
        super().__init__()
        self.names, self.rust, self.rng = names or {}, rust, random.Random(seed)
    def bm(self, mat, bevel=True):
        mat = BRAND.get(mat, mat)
        mat = self.names.get(mat, mat)
        if self.rust and mat in ('steel', 'beam') and self.rng.random() < self.rust:
            mat = 'rustpart'
        return super().bm(mat, bevel)

FINISH = {
    # how worn: (edge strength, share of parts allowed wear, where wear gathers, stains)
    'clean': dict(edge_k=1.2, gate=0.97, hot_rng=(0.74, 0.8), stain_k=0.0, bevel=0.06),
    'plain': dict(edge_k=1.8, gate=0.88, hot_rng=(0.62, 0.7), stain_k=0.0, bevel=0.065),
    'used': dict(edge_k=3.0, gate=0.7, hot_rng=(0.47, 0.56), stain_k=0.9, bevel=0.1),
}
_made = {}
# The square of deck the stain map covers: left, bottom, width, height.
USE_BOX = (-6.5, -6.5, 13.0, 13.0)

def stain_map():
    """A few crisp oil stains over a deck, for the decks that are used."""
    size = 512
    rs = np.random.default_rng(909)
    px = np.zeros((size, size, 4), np.float32)
    px[..., 3] = 1
    ys, xs = np.mgrid[0:size, 0:size].astype(np.float32)
    X, Y = -6.5 + (xs + 0.5) / size * 13, -6.5 + (ys + 0.5) / size * 13
    for _ in range(7):
        cx, cy, rad = rs.uniform(-4, 4), rs.uniform(-4, 4), rs.uniform(0.18, 0.5)
        ang = np.arctan2(Y - cy, X - cx)
        edge = rad * (1 + 0.22 * np.sin(ang * 3 + rs.uniform(0, 6)) + 0.12 * np.sin(ang * 7 + rs.uniform(0, 6)))
        px[..., 1] = np.maximum(px[..., 1], (np.hypot(X - cx, Y - cy) < edge) * rs.uniform(0.6, 1.0))
    im = bpy.data.images.get('NX_Set_use')
    if im:
        bpy.data.images.remove(im)
    im = bpy.data.images.new('NX_Set_use', size, size, alpha=False, float_buffer=False)
    im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(px.ravel())
    im.pack()

def finishes(kind):
    """The campus's finishes at one degree of wear, made once."""
    if kind in _made:
        return _made[kind]
    if 'NX_Set_use' not in bpy.data.images:
        stain_map()
    g = globals()
    base = dict(ao=0.75, grime_k=0.96, grime_col=(0.012, 0.011, 0.01), drip_k=0.6, edge_col=(0.62, 0.62, 0.64),
                deck_mul=(0.23, 0.235, 0.26), lift=None, low=False, deck_rmin=0.68, over=0.7, drip_rng=(0.62, 0.2),
                patchy=True, hot_mode='noise', walk_mix=False, deck_normal=True, name='F_' + kind + '_')
    base.update(FINISH[kind])
    g['WP'] = base
    try:
        M = {}
        M['black'] = wear3('Black', (0.14, 0.143, 0.152), 1.0, 0.62)
        M['steel'] = wear3('Steel', (0.2, 0.203, 0.212), 1.0, 0.58)
        M['frame3'] = wear3('Frame', (0.19, 0.193, 0.2), 1.0, 0.6, tube=True, grime=0.7)
        M['recess'] = wear3('Recess', (0.05, 0.05, 0.055), 0.8, 0.72, edge=0.5)
        M['deck'] = wear3('DeckSide', (0.035, 0.037, 0.043), 0.8, 0.7, edge=0.9)
        M['decktop'] = wear3('DeckTop', (0.035, 0.037, 0.043), 0.6, 0.7, edge=0.75, deck=True)
        M['fixing'] = wear3('Fixing', (0.3, 0.3, 0.31), 1.0, 0.5, edge=0.6)
        M['paint'] = wear3('Paint', (0.75, 0.4, 0.015), 0.0, 0.62, edge=1.0)
        M['rustpart'] = wear3('Rust', (0.1, 0.04, 0.02), 0.25, 0.7, edge=0.25, rust_all=True)
        M['light'] = wear3('Light', (0.0, 0.0, 0.0), 0.0, 0.5, edge=0.0, emit=((0.982, 0.571, 0.0), 1.15), grime=0.0)
        M['cyan'] = wear3('Cyan', (0.0, 0.0, 0.0), 0.0, 0.5, edge=0.0, emit=((0.05, 0.9, 1.0), 3.0), grime=0.0)
        M['magenta'] = wear3('Magenta', (0.0, 0.0, 0.0), 0.0, 0.5, edge=0.0, emit=((1.0, 0.08, 0.65), 3.0), grime=0.0)
        g['WP'] = dict(base, drip_k=0.0)
        M['beam'] = wear3('Beam', (0.17, 0.173, 0.182), 1.0, 0.6)
    finally:
        g.pop('WP', None)
    _made[kind] = M
    return M

# ---------------------------------------------------------------------- small shared pieces
def rails(b, p0, p1, n=None, h=0.95):
    """A top rail and one mid rail between two 3D points, ending in a post at each."""
    p0, p1 = Vector(p0), Vector(p1)
    n = n or max(1, round((p1 - p0).length / 2.6))
    for i in range(n + 1):
        p = p0.lerp(p1, i / n)
        tube(b, 'tube', p, p + Vector((0, 0, h)), 0.04, 6)
    tube(b, 'tube', p0 + Vector((0, 0, h)), p1 + Vector((0, 0, h)), 0.04, 6)
    tube(b, 'tube', p0 + Vector((0, 0, h * 0.5)), p1 + Vector((0, 0, h * 0.5)), 0.03, 6)

def slab_walk(b, p0, p1, w, railed=True, marks=True):
    """A solid walking deck from p0 to p1 (its top surface), on two edge beams."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    side = Vector((-d.y, d.x, 0)).normalized()
    beam(b, 'steel', p0 - Vector((0, 0, 0.05)), p1 - Vector((0, 0, 0.05)), w, 0.1)
    for s in (-1, 1):
        o = side * (w / 2 - 0.05) * s
        beam(b, 'beam', p0 + o - Vector((0, 0, 0.17)), p1 + o - Vector((0, 0, 0.17)), 0.1, 0.22)
        if railed:
            rails(b, p0 + side * (w / 2 - 0.04) * s, p1 + side * (w / 2 - 0.04) * s)
    if marks:
        L = d.length
        for p in (p0 + d * (0.2 / L), p1 - d * (0.2 / L)):
            beam(b, 'paint', p - side * (w / 2 - 0.12) + Vector((0, 0, 0.005)), p + side * (w / 2 - 0.12) + Vector((0, 0, 0.005)), 0.16, 0.008, bevel=False)

def flight(b, lo, hi, w, rail_sides=(-1, 1), marks=True):
    """One flight of stairs from lo to hi (the walking line), with its stringers."""
    lo, hi = Vector(lo), Vector(hi)
    d = hi - lo
    side = Vector((-d.y, d.x, 0)).normalized()
    dn = Vector((d.x, d.y, 0)).normalized()
    steps = max(3, math.ceil(d.z / 0.2))
    for s in (-1, 1):
        o = side * (w / 2) * s
        beam(b, 'beam', lo + o - Vector((0, 0, 0.1)), hi + o - Vector((0, 0, 0.1)), 0.07, 0.26)
        if s in rail_sides:
            rails(b, lo + o, hi + o, n=1)
    a = math.atan2(d.y, d.x)
    for i in range(steps):
        p = lo.lerp(hi, (i + 0.5) / steps)
        box(b, 'steel', (d.xy.length / steps + 0.04, w - 0.1, 0.04), T(p.x, p.y, p.z) @ RZ(a))
    if marks:
        for p, back in ((lo, 1), (hi, -1)):
            q = p + dn * 0.12 * back
            beam(b, 'paint', q - side * (w / 2 - 0.08) + Vector((0, 0, 0.03)), q + side * (w / 2 - 0.08) + Vector((0, 0, 0.03)), 0.14, 0.008, bevel=False)

def rect(x0, x1, y0, y1):
    return [Vector((x0, y0)), Vector((x1, y0)), Vector((x1, y1)), Vector((x0, y1))]

# ---------------------------------------------------------------------- the parts
def part_deck(seed, grille, hatch):
    def build(b):
        rng = random.Random(seed)
        prism(b, 'deck', HEX, -SLAB, -0.07)
        g = globals()
        g['GRILLE_P'], g['HATCH_P'], g['HATCH_MARKS'], g['BOLT_P'] = grille, hatch, False, 0.12
        plating_d3(b, inset(HEX, 0.3), 0.0, rng)
        for i in range(6):
            a, c = HEX[i], HEX[(i + 1) % 6]
            inw = Vector((-(c - a).y, (c - a).x)).normalized() * 0.2
            beam(b, 'beam', v3(a + inw, -SLAB - 0.2), v3(c + inw, -SLAB - 0.2), 0.22, 0.42)
    return build

def part_join(b):
    # As wide as a deck's edge, so its sides run corner to corner and three of them leave exactly the
    # triangle that deck-fill covers. The ends lap 0.32 onto each deck, cut back to follow the corners.
    hw, hl, lap = RAD / 2, GAP / 2 + 0.32, 0.32
    cut = lap * math.tan(math.pi / 6)
    poly = [Vector((-hw + cut, -hl)), Vector((hw - cut, -hl)), Vector((hw, -GAP / 2)), Vector((hw, GAP / 2)),
            Vector((hw - cut, hl)), Vector((-hw + cut, hl)), Vector((-hw, GAP / 2)), Vector((-hw, -GAP / 2))]
    prism(b, 'deck', poly, -SLAB, -0.07)
    globals().update(GRILLE_P=0.0, HATCH_P=0.0, HATCH_MARKS=False, BOLT_P=0.12)
    plating_d3(b, inset(poly, 0.06), 0.004, random.Random(21))
    for s in (-1, 1):
        beam(b, 'beam', (s * (hw - 0.2), GAP / 2, -SLAB - 0.2), (s * (hw - 0.2), -GAP / 2, -SLAB - 0.2), 0.22, 0.42)

def part_fill(b):
    r = (CELL - RAD) + 0.02
    tri = [Vector((math.cos(TAU * (0.25 + k / 3)) * r, math.sin(TAU * (0.25 + k / 3)) * r)) for k in range(3)]
    prism(b, 'deck', tri, -SLAB, -0.07)
    globals().update(GRILLE_P=0.0, HATCH_P=0.0, HATCH_MARKS=False, BOLT_P=0.0)
    plating_d3(b, inset(tri, 0.05), 0.004, random.Random(22))

def part_edge_join(b):
    # The kerb for the open side of a deck-join: the same kerb as a deck's edge, as long as the gap.
    beam(b, 'steel', (-GAP / 2 + 0.06, 0.13, 0.05), (GAP / 2 - 0.06, 0.13, 0.05), 0.22, 0.14)

def _kerb(b):
    beam(b, 'steel', (-RAD / 2 + 0.12, 0.13, 0.05), (RAD / 2 - 0.12, 0.13, 0.05), 0.22, 0.14)

def part_edge(rail, lit):
    def build(b):
        _kerb(b)
        if rail:
            rails(b, (-RAD / 2 + 0.3, 0.13, 0.0), (RAD / 2 - 0.3, 0.13, 0.0), n=2)
        if lit:
            beam(b, 'light', (-RAD / 2 + 0.5, 0.27, 0.03), (RAD / 2 - 0.5, 0.27, 0.03), 0.06, 0.05, bevel=False)
            beam(b, 'steel', (-RAD / 2 + 0.45, 0.31, 0.015), (RAD / 2 - 0.45, 0.31, 0.015), 0.03, 0.03)
    return build

def part_legs(level):
    def build(b):
        h = LEVEL1 + STEP * (level - 1)
        s = 0.3 + 0.07 * h
        top, foot = -SLAB, -h
        legs = [Vector((2.7, 2.6)), Vector((-2.7, 2.6)), Vector((-2.7, -2.6)), Vector((2.7, -2.6))]
        for k, p in enumerate(legs):
            q = legs[(k + 1) % 4]
            box(b, 'beam', (s, s, top - foot), T(p.x, p.y, (top + foot) / 2))
            box(b, 'beam', (s * 2, s * 2, 0.1), T(p.x, p.y, foot + 0.05))
            box(b, 'beam', (s * 1.5, s * 1.5, 0.1), T(p.x, p.y, top - 0.05))
            beam(b, 'beam', v3(p, top - 0.5), v3(q, top - 0.5), s * 0.6, s * 0.8)
            beam(b, 'beam', v3(p, foot + 0.3), v3(q, top - 0.8), s * 0.4, s * 0.4)
    return build

def part_under_lamp(b):
    box(b, 'beam', (1.7, 1.7, 0.1), T(0, 0, -SLAB - 0.05))
    box(b, 'light', (1.3, 1.3, 0.04), T(0, 0, -SLAB - 0.12), bevel=False)

def part_gangway(b):
    e = GAP / 2 + 0.2
    slab_walk(b, (0, e, 0.02), (0, -e, 0.02), 1.5)

def part_stair1(b):
    flight(b, (0, GAP / 2 + 0.05, 0.02), (0, -GAP / 2 - 0.05, STEP + 0.02), 1.5)
    for s in (-1, 1):
        box(b, 'light', (0.09, 0.09, 0.07), T(s * 0.75, -GAP / 2 - 0.05, STEP + 1.01), bevel=False)

def part_stair2(b):
    w, lane = 1.1, 0.74
    e = GAP / 2
    # the way on, from the lower platform's edge
    slab_walk(b, (0, e + 0.1, 0.02), (0, 0.19, 0.02), 1.2, railed=False, marks=False)
    flight(b, (0.6, lane, 0.02), (3.0, lane, STEP), w, rail_sides=(-1,), marks=True)
    # the landing, across both lanes
    box(b, 'steel', (1.2, lane * 2 + w, 0.1), T(3.6, 0, STEP - 0.05))
    rails(b, (4.16, -lane - w / 2 + 0.04, STEP), (4.16, lane + w / 2 - 0.04, STEP), n=1)
    rails(b, (3.05, lane + w / 2 - 0.04, STEP), (4.16, lane + w / 2 - 0.04, STEP), n=1)
    rails(b, (3.05, -lane - w / 2 + 0.04, STEP), (4.16, -lane - w / 2 + 0.04, STEP), n=1)
    flight(b, (3.0, -lane, STEP), (0.6, -lane, STEP * 2), w, rail_sides=(-1,), marks=False)
    slab_walk(b, (0, -0.19, STEP * 2 + 0.02), (0, -e - 0.1, STEP * 2 + 0.02), 1.2, railed=False, marks=False)
    rails(b, (-0.58, -0.2, STEP * 2 + 0.02), (-0.58, -e, STEP * 2 + 0.02), n=1)
    beam(b, 'paint', (-0.45, -e + 0.1, STEP * 2 + 0.03), (0.45, -e + 0.1, STEP * 2 + 0.03), 0.14, 0.008, bevel=False)
    # what carries it: a base frame at the lower deck's level and two posts under the landing
    for y in (-lane - w / 2 + 0.06, lane + w / 2 - 0.06):
        beam(b, 'beam', (-0.6, y, -0.16), (4.2, y, -0.16), 0.12, 0.24)
        box(b, 'beam', (0.16, 0.16, STEP - 0.1), T(4.1, y, (STEP - 0.1) / 2 - 0.05))
    beam(b, 'beam', (0.0, -lane, -0.16), (0.0, -lane, STEP * 2 - 0.1), 0.16, 0.16)
    for s in (-1, 1):
        box(b, 'light', (0.09, 0.09, 0.07), T(s * 0.5, -e, STEP * 2 + 1.0), bevel=False)

def part_stair_ground(b):
    run = LEVEL1 * 1.25
    flight(b, (0, 0, 0.0), (0, -run, LEVEL1), 1.5)
    slab_walk(b, (0, -run, LEVEL1), (0, -run - 0.6, LEVEL1), 1.5, railed=True, marks=False)
    for s in (-1, 1):
        box(b, 'beam', (0.16, 0.16, LEVEL1 - 0.1), T(s * 0.68, -run - 0.1, (LEVEL1 - 0.1) / 2))
        box(b, 'beam', (0.4, 0.4, 0.08), T(s * 0.68, -run - 0.1, 0.04))

def part_frame(b):
    L, W, H = FRAME
    cs = [Vector((x * (L / 2 - 0.08), y * (W / 2 - 0.08))) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for i, p in enumerate(cs):
        q = cs[(i + 1) % 4]
        box(b, 'beam', (0.15, 0.15, H - 0.12), T(p.x, p.y, (H - 0.12) / 2))
        box(b, 'beam', (0.32, 0.32, 0.06), T(p.x, p.y, 0.03))
        beam(b, 'beam', v3(p, 0.2), v3(q, H - 0.3), 0.08, 0.08)
    box(b, 'steel', (L + 0.1, W + 0.1, 0.12), T(0, 0, H - 0.06))

LIT = {'mod_cab': {1, 2}, 'mod_drum': {1, 6}, 'mod_wedge': {1, 2}, 'mod_pod': {1, 2, 3}}

def part_module(fn, seed):
    def build(b):
        gate = LightGate(b, LIT[fn.__name__])
        fn(gate, I4, MOD[0], MOD[1], MOD[2], random.Random(seed))
        gate.trash.free()
    return build

def part_ladder(b):
    ladder(b, Vector((0, 0.42, 0)), Vector((0, 0.06, FRAME[2])))

def part_gantry(b):
    slab_walk(b, (0, 0, 0.0), (0, -2.0, 0.0), 0.9, railed=False, marks=False)
    for s in (-1, 1):
        rails(b, (s * 0.41, -0.06, 0.0), (s * 0.41, -1.94, 0.0), n=1)

def part_gantry_lamp(b):
    box(b, 'steel', (0.06, 0.06, 0.12), T(0, 0, 0.06))
    box(b, 'light', (0.11, 0.11, 0.08), T(0, 0, 0.16), bevel=False)

def part_sign(color, seed, w, h):
    def build(b):
        neon_sign(b, I4, random.Random(seed), color, w=w, h=h)
    return build

def part_dish(b):
    dish_on_mount(b, Vector((0, 0, 0)), 0.72, random.Random(5))

WALK_TOP, WALK_W = 0.45, 1.6

def _walk_piece(b, poly, rng, ends):
    prism(b, 'deck', poly, WALK_TOP - 0.2, WALK_TOP - 0.05)
    globals().update(GRILLE_P=0.0, HATCH_P=0.0, HATCH_MARKS=False, BOLT_P=0.25)
    plating_d3(b, inset(poly, 0.05), WALK_TOP, rng)
    for a, c in ends:
        beam(b, 'beam', v3(a, WALK_TOP - 0.16), v3(c, WALK_TOP - 0.16), 0.14, 0.24)
        beam(b, 'steel', v3(a, WALK_TOP + 0.03), v3(c, WALK_TOP + 0.03), 0.08, 0.07)
        for t in (0.15, 0.85):
            p = Vector(a).lerp(Vector(c), t)
            box(b, 'beam', (0.2, 0.2, WALK_TOP - 0.25), T(p.x, p.y, (WALK_TOP - 0.25) / 2))
            box(b, 'beam', (0.4, 0.4, 0.05), T(p.x, p.y, 0.025))

def part_walk(b):
    hw, L = WALK_W / 2, 2.76
    poly = rect(-hw, hw, -L, 0)
    _walk_piece(b, poly, random.Random(31), [(Vector((-hw + 0.07, 0)), Vector((-hw + 0.07, -L))), (Vector((hw - 0.07, 0)), Vector((hw - 0.07, -L)))])

WALK_R = 2.4

def part_walk_turn(deg):
    def build(b):
        rng = random.Random(deg)
        n = 2 if deg <= 30 else 3
        hw = WALK_W / 2
        def pt(theta, r):
            return Vector((WALK_R - r * math.cos(theta), -r * math.sin(theta)))
        for i in range(n):
            t0, t1 = math.radians(deg) * i / n, math.radians(deg) * (i + 1) / n
            poly = [pt(t0, WALK_R + hw), pt(t0, WALK_R - hw), pt(t1, WALK_R - hw), pt(t1, WALK_R + hw)]
            if area(poly) < 0:
                poly.reverse()
            _walk_piece(b, poly, rng, [(pt(t0, WALK_R + hw - 0.07), pt(t1, WALK_R + hw - 0.07)), (pt(t0, WALK_R - hw + 0.07), pt(t1, WALK_R - hw + 0.07))])
    return build

# name: (builder, finish, bake size, chance of a rusted bracket)
PARTS = {
    'deck-a': (part_deck(101, 0.08, 0.03), 'used', 1024, 0.0),
    'deck-b': (part_deck(102, 0.04, 0.06), 'clean', 1024, 0.0),
    'deck-c': (part_deck(103, 0.0, 0.05), 'used', 1024, 0.0),
    'deck-d': (part_deck(104, 0.1, 0.0), 'clean', 1024, 0.0),
    'legs-1': (part_legs(1), 'plain', 512, 0.0),
    'legs-2': (part_legs(2), 'plain', 512, 0.0),
    'legs-3': (part_legs(3), 'plain', 512, 0.0),
    'legs-4': (part_legs(4), 'plain', 512, 0.0),
    'legs-5': (part_legs(5), 'plain', 512, 0.0),
    'under-lamp': (part_under_lamp, 'plain', 512, 0.0),
    'deck-join': (part_join, 'plain', 512, 0.0),
    'deck-fill': (part_fill, 'plain', 512, 0.0),
    'edge-join': (part_edge_join, 'plain', 512, 0.0),
    'edge-kerb': (part_edge(False, False), 'plain', 512, 0.0),
    'edge-rail': (part_edge(True, False), 'plain', 512, 0.0),
    'edge-lit': (part_edge(False, True), 'plain', 512, 0.0),
    'edge-rail-lit': (part_edge(True, True), 'plain', 512, 0.0),
    'gangway': (part_gangway, 'plain', 512, 0.0),
    'stair-1': (part_stair1, 'used', 512, 0.0),
    'stair-2': (part_stair2, 'plain', 1024, 0.06),
    'stair-ground': (part_stair_ground, 'used', 512, 0.0),
    'frame': (part_frame, 'plain', 512, 0.12),
    'mod-cabin': (part_module(mod_cab, 11), 'plain', 1024, 0.0),
    'mod-drum': (part_module(mod_drum, 12), 'plain', 1024, 0.0),
    'mod-shed': (part_module(mod_wedge, 13), 'plain', 1024, 0.0),
    'mod-tank': (part_module(mod_pod, 14), 'plain', 1024, 0.0),
    'ladder': (part_ladder, 'plain', 512, 0.0),
    'gantry': (part_gantry, 'plain', 512, 0.0),
    'gantry-lamp': (part_gantry_lamp, 'plain', 512, 0.0),
    'sign-a': (part_sign('cyan', 1, 1.6, 0.75), 'plain', 512, 0.0),
    'sign-b': (part_sign('magenta', 2, 1.3, 0.6), 'plain', 512, 0.0),
    'sign-c': (part_sign('cyan', 3, 1.1, 0.9), 'plain', 512, 0.0),
    'sign-d': (part_sign('magenta', 4, 1.7, 0.55), 'plain', 512, 0.0),
    'dish': (part_dish, 'plain', 512, 0.0),
    'walk': (part_walk, 'used', 512, 0.0),
    'walk-turn-30': (part_walk_turn(30), 'plain', 512, 0.0),
    'walk-turn-60': (part_walk_turn(60), 'plain', 512, 0.0),
}

def collection_name(name):
    return 'NX_Set_' + name.replace('-', '_').title()

def scene_for_kit():
    scene = bpy.data.scenes.get(SCENE_NAME)
    if scene is None:
        scene = bpy.data.scenes.new(SCENE_NAME)
        scene.render.engine = 'BLENDER_EEVEE'
    return scene

def build(only=None):
    """Build the parts (all of them, or those named) into their collections. Returns what was built."""
    scene = scene_for_kit()
    out = {}
    for name, (fn, finish, size, rust) in PARTS.items():
        if only and name not in only:
            continue
        title = collection_name(name)
        coll = bpy.data.collections.get(title)
        if coll is None:
            coll = bpy.data.collections.new(title)
            scene.collection.children.link(coll)
        for old in list(coll.objects):
            bpy.data.objects.remove(old, do_unlink=True)
        b = Kit(rust=rust, seed=sum(ord(ch) * (i + 1) for i, ch in enumerate(name)))
        fn(b)
        made = b.flush(name, coll, finishes(finish))
        out[name] = len(made)
    return out

SCENE_NAME = 'NX_Settlement'
ONLY = globals().get('ONLY')
result = build(ONLY)
