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
# Finishes whose faces are single open sheets, wound by hand: recalculating would guess their facing.
NO_RECALC = ('deckunder', 'slabtop')

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
            if mat not in NO_RECALC:
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

def wear3(key, base, metal, rough, edge=1.0, emit=None, deck=False, rust_all=False, tube=False, grime=1.0,
          mul=None, tone=(0.36, 0.82), rusty=0.0, chip=None, bloom=False, streaks=0.0):
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
        dark = g.mix(col.outputs['Color'], mul or P['deck_mul'], 1.0, 'MULTIPLY')
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
        if rusty:
            # a plate that has stood in the wet: rust in blotches and along one side, never all over
            blot = g.rng(g.noise(tc.outputs['Object'], 1.7, 4, 0.6), 0.44, 0.62)
            rt = _ramp(nt, [(0.3, (0.03, 0.013, 0.007)), (0.7, (0.12, 0.045, 0.018))])
            L.new(g.noise(tc.outputs['Object'], 11, 5), rt.inputs['Fac'])
            c0 = g.mix(c0, rt.outputs['Color'], g.m('MULTIPLY', blot, rusty))
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
    L.new(g.m('MULTIPLY_ADD', panel, tone[0], tone[1]), hsv.inputs['Value'])
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
    if streaks:
        # grime that has run down the faces of a standing part, whatever is above it
        run = g.m('MULTIPLY', g.m('MULTIPLY', streak, side), streaks)
        c = g.mix(c, P['grime_col'], g.m('MULTIPLY', run, 0.85))
        pale = g.rng(g.noise(mp.outputs['Vector'], 5.0, 3, 0.6), 0.6, 0.78)
        c = g.mix(c, (0.3, 0.3, 0.31), g.m('MULTIPLY', g.m('MULTIPLY', pale, side), 0.22 * streaks))
    if bloom:
        # rust that has come up through the finish in blooms
        where = g.rng(g.noise(tc.outputs['Object'], 1.3, 3, 0.6), 0.46, 0.6)
        btone = _ramp(nt, [(0.3, (0.035, 0.014, 0.007)), (0.7, (0.16, 0.06, 0.02))])
        L.new(g.noise(tc.outputs['Object'], 12, 5), btone.inputs['Fac'])
        c = g.mix(c, btone.outputs['Color'], g.m('MULTIPLY', where, g.rng(g.noise(tc.outputs['Object'], 16, 4), 0.3, 0.55)))
    c = g.mix(c, P['edge_col'], convex)
    worn_off = None
    if chip is not None:
        # paint that has been walked and scraped off in places, down to the dark steel under it
        wn = g.m('ADD', g.m('MULTIPLY', g.noise(tc.outputs['Object'], 4, 2, 0.5), 0.6), g.m('MULTIPLY', g.noise(tc.outputs['Object'], 1.6, 2), 0.4))
        worn_off = g.rng(wn, chip - 0.02, chip + 0.06)
        c = g.mix(c, (0.022, 0.022, 0.025), worn_off)
    r = g.m('ADD', r0, g.m('MULTIPLY', cavity, 0.3))
    r = g.m('ADD', r, g.m('MULTIPLY', drip, 0.2))
    r = g.m('SUBTRACT', r, g.m('MULTIPLY', convex, 0.24))
    r = g.m('ADD', r, g.m('MULTIPLY_ADD', panel, 0.14, -0.07), clamp=True)
    if rust_all:
        r = g.m('ADD', r, 0.25, clamp=True)
    if P.get('rmin'):
        # nothing on a deck is polished: a smooth, bright, finely patterned surface turns to sparkle under the sun
        r = g.m('MAXIMUM', r, P['rmin'])
    mt = g.m('MULTIPLY', g.m('MULTIPLY_ADD', cavity, -0.7 * metal, metal), g.m('MULTIPLY_ADD', drip, -0.5, 1.0), clamp=True)
    if worn_off is not None:
        mt = g.m('MAXIMUM', mt, g.m('MULTIPLY', worn_off, 0.4))
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
    'clean': dict(edge_k=1.2, gate=0.97, hot_rng=(0.74, 0.8), stain_k=0.0, bevel=0.06, rmin=0.56),
    'plain': dict(edge_k=1.8, gate=0.88, hot_rng=(0.62, 0.7), stain_k=0.0, bevel=0.065),
    'used': dict(edge_k=3.0, gate=0.7, hot_rng=(0.47, 0.56), stain_k=0.9, bevel=0.1, rmin=0.56),
    'legs': dict(edge_k=2.4, gate=0.55, hot_rng=(0.44, 0.56), stain_k=0.0, bevel=0.07),
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
        # the decks' own plates: a dark tread field, a pale brushed way across it, and plates put in later
        M['decktread'] = wear3('DeckTread', (0.022, 0.023, 0.027), 0.6, 0.7, edge=0.8, deck=True, mul=(0.17, 0.175, 0.19), tone=(0.5, 0.74))
        M['deckwalk'] = wear3('DeckWalk', (0.05, 0.052, 0.058), 0.75, 0.5, edge=0.5, deck=True, mul=(0.78, 0.79, 0.82), tone=(0.24, 0.88))
        M['deckold'] = wear3('DeckOld', (0.03, 0.03, 0.033), 0.5, 0.75, edge=0.9, deck=True, mul=(0.4, 0.385, 0.37), tone=(0.4, 0.8))
        M['deckrust'] = wear3('DeckRust', (0.03, 0.025, 0.022), 0.4, 0.8, edge=0.6, deck=True, mul=(0.3, 0.27, 0.25), tone=(0.3, 0.85), rusty=0.85)
        M['deckhide'] = wear3('DeckHide', (0.006, 0.006, 0.007), 0.2, 0.9, edge=0.0)
        # grating bars: thin, close together and seen against black, so dark, rough and hardly worn at all
        M['grillebar'] = wear3('GrilleBar', (0.045, 0.047, 0.053), 0.5, 0.82, edge=0.12)
        M['slabtop'] = wear3('SlabTop', (0.006, 0.006, 0.007), 0.2, 0.9, edge=0.0)
        M['deckunder'] = wear3('DeckUnder', (0.03, 0.032, 0.037), 0.8, 0.75, edge=0.9)
        M['hazard'] = wear3('Hazard', (0.78, 0.4, 0.012), 0.0, 0.6, edge=0.0, chip=0.53, grime=0.3)
        M['stencil'] = wear3('Stencil', (0.4, 0.4, 0.38), 0.0, 0.7, edge=0.0, chip=0.57, grime=0.3)
        # the legs: blackened sections, paler braces and ties, a concrete footing
        M['legsteel'] = wear3('LegSteel', (0.05, 0.052, 0.06), 0.9, 0.55, edge=1.25, streaks=0.9)
        M['leggalv'] = wear3('LegGalv', (0.21, 0.215, 0.225), 1.0, 0.5, edge=0.9, streaks=0.7)
        M['legbloom'] = wear3('LegBloom', (0.05, 0.05, 0.056), 0.85, 0.62, edge=1.1, streaks=0.9, bloom=True)
        M['footing'] = wear3('Footing', (0.1, 0.098, 0.094), 0.0, 0.92, edge=0.5, streaks=0.8)
        M['fixing'] = wear3('Fixing', (0.3, 0.3, 0.31), 1.0, 0.5, edge=0.6)
        M['paint'] = wear3('Paint', (0.75, 0.4, 0.015), 0.0, 0.62, edge=1.0)
        M['rustpart'] = wear3('Rust', (0.1, 0.04, 0.02), 0.25, 0.7, edge=0.25, rust_all=True)
        M['light'] = wear3('Light', (0.0, 0.0, 0.0), 0.0, 0.5, edge=0.0, emit=((0.982, 0.571, 0.0), 1.15), grime=0.0)
        M['cyan'] = wear3('Cyan', (0.0, 0.0, 0.0), 0.0, 0.5, edge=0.0, emit=((0.05, 0.9, 1.0), 3.0), grime=0.0)
        # a tube or mark that has gone out: dark glass, no glow
        M['dim'] = wear3('Dim', (0.045, 0.05, 0.058), 0.0, 0.6, edge=0.0, grime=0.4)
        M['magenta'] = wear3('Magenta', (0.0, 0.0, 0.0), 0.0, 0.5, edge=0.0, emit=((1.0, 0.08, 0.65), 3.0), grime=0.0)
        g['WP'] = dict(base, drip_k=0.0)
        M['beam'] = wear3('Beam', (0.17, 0.173, 0.182), 1.0, 0.6)
    finally:
        g.pop('WP', None)
    # How much of a part's atlas a finish is given for its size: what is looked at most gets most.
    for key, share in (('decktread', 1.5), ('deckwalk', 1.5), ('deckold', 1.5), ('deckrust', 1.5), ('slabtop', 0.1), ('deckunder', 0.4)):
        M[key]['nx_atlas'] = share
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
def slab3(b, poly, z0, z1, side='deck', under='deckunder', top='slabtop'):
    """A slab whose sides, underside and (unseen) top are three finishes, so each takes the atlas room it earns."""
    if area(poly) < 0:
        poly = list(reversed(poly))
    n = len(poly)
    bm = b.bm(side, True)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        bm.faces.new([bm.verts.new(c) for c in ((p[0], p[1], z0), (q[0], q[1], z0), (q[0], q[1], z1), (p[0], p[1], z1))])
    bm = b.bm(under, False)
    bm.faces.new([bm.verts.new((p[0], p[1], z0)) for p in reversed(poly)])
    bm = b.bm(top, False)
    bm.faces.new([bm.verts.new((p[0], p[1], z1)) for p in poly])

# Seven-segment strokes, so a number reads as if stencilled: a, b, c, d, e, f, g.
SEGMENTS = {'0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abfgcd'}

def stencil(b, text, M, h=0.7, mat='stencil', t=0.006):
    """A number laid flat in M's XY plane, reading along +X, centred on M's origin."""
    w, gap, k = h * 0.5, h * 0.2, h * 0.14
    x = -(len(text) * w + (len(text) - 1) * gap) / 2
    for ch in text:
        strokes = {'a': (w / 2, h, w - k * 1.6, k), 'd': (w / 2, 0, w - k * 1.6, k), 'g': (w / 2, h / 2, w - k * 1.6, k),
                   'f': (0, h * 0.75, k, h / 2 - k * 1.3), 'b': (w, h * 0.75, k, h / 2 - k * 1.3),
                   'e': (0, h * 0.25, k, h / 2 - k * 1.3), 'c': (w, h * 0.25, k, h / 2 - k * 1.3)}
        for seg in SEGMENTS[ch]:
            cx, cy, sx, sy = strokes[seg]
            box(b, mat, (sx, sy, t), M @ T(x + cx, cy - h / 2, t / 2), bevel=False)
        x += w + gap

def hazard_band(b, M, sx, sy, z, mat='hazard', pitch=0.42):
    """Slanted stripes filling a band sx by sy, centred on M's origin."""
    band = rect(-sx / 2, sx / 2, -sy / 2, sy / 2)
    x = -sx / 2 - sy
    while x < sx / 2:
        stripe = clip_convex([Vector((x, -sy / 2)), Vector((x + pitch / 2, -sy / 2)), Vector((x + pitch / 2 + sy, sy / 2)), Vector((x + sy, sy / 2))], band)
        if len(stripe) >= 3 and area(stripe) > 0.004:
            pts = [(M @ Vector((p.x, p.y, 0))) for p in stripe]
            prism(b, mat, [Vector((p.x, p.y)) for p in pts], z, z + 0.006, bevel=False)
        x += pitch

def chevrons(b, M, n, size, z, mat='hazard'):
    """n chevrons in a row along M's X, pointing along +X."""
    arm, wd = size, size * 0.3
    for i in range(n):
        x = (i - (n - 1) / 2) * size * 0.95
        for sgn in (-1, 1):
            poly = [Vector((x - arm / 2, sgn * arm)), Vector((x - arm / 2 + wd, sgn * arm)), Vector((x + arm / 2 + wd, 0)), Vector((x + arm / 2, 0))]
            pts = [(M @ Vector((p.x, p.y, 0))) for p in poly]
            prism(b, mat, [Vector((p.x, p.y)) for p in pts], z, z + 0.006, bevel=False)

# Where each deck's number goes (by the number it used to carry), filled in as the decks are built.
NUMBER_AT = {}

def plating_k(b, poly, z, rng, a, lane, cross=None, grille=0.07, hatch=0.04, old=0.14, marks=('chevron', 'number'), number='07'):
    """
    A deck's plates: a dark tread field laid to one grid, a pale brushed way across it (`lane`: the
    band of the grid it takes, low and high), a few plates put in later, grilles that are holes, a
    hatch or two, and one or two painted marks.
    """
    if area(poly) < 0:
        poly = list(reversed(poly))
    ca, sa = math.cos(a), math.sin(a)
    def w(x, y):
        return Vector((x * ca - y * sa, x * sa + y * ca))
    def back(p):
        return p.x * ca + p.y * sa, -p.x * sa + p.y * ca
    # the rows are cut so that the way is whole rows
    ys = [lane[0]]
    while ys[0] > -8:
        ys.insert(0, ys[0] - rng.choice([1.4, 1.8, 2.0, 2.4]))
    ys.append(lane[1])
    while ys[-1] < 8:
        ys.append(ys[-1] + rng.choice([1.4, 1.8, 2.0, 2.4]))
    marks = list(marks)
    rusted = False
    free = []                                      # whole plates of the way with nothing painted on them
    cells = []
    for j in range(len(ys) - 1):
        on_lane = abs(ys[j] - lane[0]) < 1e-6
        xs = [-8.4 + rng.uniform(0, 1)]
        while xs[-1] < 8:
            xs.append(xs[-1] + (rng.choice([2.0, 2.4, 2.8]) if on_lane else rng.choice([1.6, 2.0, 2.0, 2.4, 2.8])))
        for i in range(len(xs) - 1):
            cells.append((i, j, xs[i], xs[i + 1], ys[j], ys[j + 1], on_lane))
    for i, j, xa, xb, ya, yb, on_lane in cells:
        g = 0.02
        x0, x1, y0, y1 = xa + g, xb - g, ya + g, yb - g
        cut = clip_convex([w(x0, y0), w(x1, y0), w(x1, y1), w(x0, y1)], poly)
        if len(cut) < 3 or area(cut) < 0.05:
            continue
        sx, sy = x1 - x0, y1 - y0
        whole = abs(area(cut) - sx * sy) < 0.01
        on_cross = cross is not None and not on_lane and cross[0] < (x0 + x1) / 2 < cross[1]
        M = T(0, 0, z) @ RZ(a) @ T((x0 + x1) / 2, (y0 + y1) / 2, 0)
        roll = rng.random()
        mid = math.hypot((x0 + x1) / 2, (y0 + y1) / 2)
        if whole and not on_lane and not on_cross and roll < grille:
            # a grille: a real hole with bars over it and a frame round it, black from any distance
            n = max(3, int(sx / 0.2))
            for k in range(n):
                box(b, 'grillebar', (0.045, sy - 0.1, 0.03), M @ T(-sx / 2 + (k + 0.5) * sx / n, 0, -0.016), bevel=False)
            for e in (-1, 1):
                box(b, 'steel', (sx, 0.08, 0.06), M @ T(0, e * (sy / 2 - 0.04), -0.014))
                box(b, 'steel', (0.08, sy, 0.06), M @ T(e * (sx / 2 - 0.04), 0, -0.014))
            continue
        if on_lane or on_cross:
            mat, quads = 'deckwalk', [(0.5, 0.5), (0, 0)]       # the brushed plates of the app's map
        elif not rusted and whole and roll > 0.9:
            mat, quads, rusted = 'deckrust', [(0, 0.5), (0.5, 0)], True
        elif roll > 1.0 - old:
            mat, quads = 'deckold', [(0, 0.5), (0.5, 0), (0.5, 0.5)]
        else:
            mat, quads = 'decktread', [(0, 0.5), (0.5, 0)]      # the tread plates
        qu, qv = rng.choice(quads)
        flip = rng.random() < 0.5
        uvs = []
        for p in cut:
            lx, ly = back(p)
            u, v = (lx - x0) / sx, (ly - y0) / sy
            if flip:
                u, v = 1 - u, 1 - v
            uvs.append((qu + (0.01 + 0.98 * u) * 0.5, qv + (0.01 + 0.98 * v) * 0.5))
        lift = rng.choice([0, 0, 0.007]) + (0.004 if mat == 'deckwalk' else 0)
        plate_uv(b, mat, cut, uvs, z - 0.05, z + lift)
        top = lift + 0.001
        if whole and mat == 'deckwalk' and not (on_lane and marks and mid > 2.2):
            free.append((mid, M @ Vector((0, 0, 0)), sx, sy))
        if whole and on_lane and marks and mid > 2.2:
            kind = marks.pop(0)
            if kind == 'chevron':
                chevrons(b, M, 3, min(sx, sy) * 0.3, z + top)
            elif kind == 'band':
                hazard_band(b, M, sx - 0.2, 0.36, z + top)
            elif kind == 'number':
                # The number is not painted here: the app lays it on, so every deck can carry its own.
                # What is kept is where it goes: the plate's middle, the way it reads, a digit's height.
                at = M @ Vector((0, 0, 0))
                NUMBER_AT[number] = dict(x=at.x, y=at.y, turn=a, h=min(sx, sy) * 0.55, plate=(sx, sy))
            elif kind == 'lines':
                for e in (-1, 1):
                    box(b, 'hazard', (sx - 0.16, 0.09, 0.006), M @ T(0, e * (sy / 2 - 0.16), top + 0.003), bevel=False)
            continue
        if whole and mat == 'decktread' and rng.random() < hatch:
            hs = min(sx, sy) * 0.3
            for e in (-1, 1):
                box(b, 'steel', (hs * 2 + 0.14, 0.09, 0.07), M @ T(0, e * hs, 0.03))
                box(b, 'steel', (0.09, hs * 2 + 0.14, 0.07), M @ T(e * hs, 0, 0.03))
            box(b, 'black', (hs * 2 - 0.1, hs * 2 - 0.1, 0.034), M @ T(0, 0, 0.015))
            box(b, 'steel', (0.3, 0.06, 0.05), M @ T(0, hs * 0.5, 0.05))
            continue
        if rng.random() < 0.3:
            c = sum(cut, Vector((0, 0))) / len(cut)
            for p in cut:
                q = p + (c - p).normalized() * 0.13
                cyl(b, 'fixing', 0.04, 0.02, T(q.x, q.y, z + lift), 5, bevel=False, cap=True)
    _number_fallback(number, free, a)

def _number_fallback(number, free, a):
    """A deck whose way had no second plate far enough out still needs a place for its number: the farthest free one."""
    if number not in NUMBER_AT and free:
        mid, at, sx, sy = max(free, key=lambda f: f[0])
        NUMBER_AT[number] = dict(x=at.x, y=at.y, turn=a, h=min(sx, sy) * 0.55, plate=(sx, sy))

def _corner_frame(i):
    if not isinstance(i, int):                     # a place and a way out of the deck, given outright
        c, u = i
        return c, u, Vector((-u.y, u.x))
    u = Vector((math.cos(TAU * i / 6), math.sin(TAU * i / 6)))
    return HEX[i], u, Vector((-u.y, u.x))

def _F(c, u, t):
    """Local X along u (outward through the corner), local Y along t, origin at c, at the deck top."""
    return Matrix(((u.x, t.x, 0, c.x), (u.y, t.y, 0, c.y), (0, 0, 1, 0), (0, 0, 0, 1)))

BALCONY, SHELF, STEP_OUT, DROP = 0.9, 0.85, 0.7, 0.8     # how far each corner piece reaches (see settlement.md)

def corner_drop(b, i):
    """The corner cut back to a step: the plates stop short and a dark grating lies a little lower."""
    c, u, t = _corner_frame(i)
    F = _F(c, u, t)
    half = DROP * math.tan(math.pi / 3)
    tri = [c, c - u * DROP + t * half, c - u * DROP - t * half]
    n = 7
    for k in range(n):
        x = -DROP + 0.08 + k * (DROP - 0.16) / (n - 1)
        hw = (-x) * math.tan(math.pi / 3) - 0.05
        if hw > 0.05:
            box(b, 'grillebar', (0.04, hw * 2, 0.03), F @ T(x, 0, -0.03), bevel=False)
    box(b, 'steel', (0.1, half * 2 - 0.05, 0.12), F @ T(-DROP - 0.05, 0, -0.01))

def corner_notch(b, i):
    """A square grille let into the corner, with a raised frame."""
    c, u, t = _corner_frame(i)
    F = _F(c, u, t) @ T(-1.15, 0, 0)
    s = 0.46
    box(b, 'deckhide', (s * 2, s * 2, 0.012), F @ T(0, 0, 0.012), bevel=False)
    for e in (-1, 1):
        box(b, 'steel', (s * 2 + 0.1, 0.09, 0.07), F @ T(0, e * s, 0.035))
        box(b, 'steel', (0.09, s * 2 + 0.1, 0.07), F @ T(e * s, 0, 0.035))
    for k in range(5):
        box(b, 'grillebar', (0.04, s * 2 - 0.08, 0.03), F @ T(-s + (k + 0.5) * s * 2 / 5, 0, 0.04), bevel=False)
    hazard_band(b, F @ T(-s - 0.24, 0, 0) @ RZ(math.pi / 2), s * 2, 0.16, 0.014)

def corner_balcony(b, i):
    """A small platform carried out past the corner on brackets, railed on its three open sides. Nobody walks on it."""
    c, u, t = _corner_frame(i)
    F = _F(c, u, t)
    x0, x1, hw, top = -0.42, BALCONY, 0.75, -0.08
    box(b, 'deck', (x1 - x0, hw * 2, 0.12), F @ T((x0 + x1) / 2, 0, top - 0.06))
    box(b, 'deckhide', (x1 - x0 - 0.16, hw * 2 - 0.16, 0.01), F @ T((x0 + x1) / 2, 0, top + 0.004), bevel=False)
    n = 9
    for k in range(n):
        box(b, 'grillebar', (0.035, hw * 2 - 0.16, 0.03), F @ T(x0 + 0.1 + (k + 0.5) * (x1 - x0 - 0.2) / n, 0, top + 0.02), bevel=False)
    for e in (-1, 1):
        box(b, 'steel', (x1 - x0, 0.08, 0.1), F @ T((x0 + x1) / 2, e * (hw - 0.04), top + 0.03))
        beam(b, 'beam', F @ Vector((x1 - 0.1, e * (hw - 0.12), top - 0.12)), F @ Vector((-0.5, e * (hw - 0.12), -0.82)), 0.07, 0.09)
    box(b, 'steel', (0.08, hw * 2, 0.1), F @ T(x1 - 0.04, 0, top + 0.03))
    pts = [F @ Vector((0.12, -hw + 0.05, top + 0.06)), F @ Vector((x1 - 0.05, -hw + 0.05, top + 0.06)),
           F @ Vector((x1 - 0.05, hw - 0.05, top + 0.06)), F @ Vector((0.12, hw - 0.05, top + 0.06))]
    for p, q in zip(pts, pts[1:]):
        rails(b, p, q, n=1, h=0.9)
    # something to be out there for
    box(b, 'black', (0.34, 0.5, 0.42), F @ T(x1 - 0.32, 0.3, top + 0.22))
    box(b, 'light', (0.02, 0.2, 0.05), F @ T(x1 - 0.5, 0.3, top + 0.32), bevel=False)
    tube(b, 'tube', F @ Vector((x1 - 0.32, -0.35, top)), F @ Vector((x1 - 0.32, -0.35, top + 1.35)), 0.03, 6)

def corner_shelf(b, i):
    """A lower shelf of plant hung off the corner: a unit, a tank and their pipes."""
    c, u, t = _corner_frame(i)
    F = _F(c, u, t)
    x0, x1, hw, top = -0.36, SHELF, 0.7, -0.3
    box(b, 'deck', (x1 - x0, hw * 2, 0.1), F @ T((x0 + x1) / 2, 0, top - 0.05))
    for e in (-1, 1):
        box(b, 'steel', (x1 - x0, 0.07, 0.07), F @ T((x0 + x1) / 2, e * (hw - 0.035), top + 0.035))
        beam(b, 'beam', F @ Vector((x1 - 0.08, e * (hw - 0.1), top - 0.1)), F @ Vector((-0.45, e * (hw - 0.1), -0.84)), 0.07, 0.08)
    box(b, 'steel', (0.07, hw * 2, 0.07), F @ T(x1 - 0.035, 0, top + 0.035))
    box(b, 'black', (0.62, 0.62, 0.56), F @ T(0.4, -0.3, top + 0.28))
    for k in range(4):
        box(b, 'recess', (0.5, 0.02, 0.05), F @ T(0.4, -0.62, top + 0.14 + k * 0.1), bevel=False)
    box(b, 'steel', (0.7, 0.7, 0.04), F @ T(0.4, -0.3, top + 0.58))
    cyl(b, 'leggalv', 0.2, 0.62, F @ T(0.42, 0.4, top), 10)
    cyl(b, 'leggalv', 0.2, 0.1, F @ T(0.42, 0.4, top + 0.62), 10, r2=0.08)
    tube(b, 'tube', F @ Vector((0.42, 0.4, top + 0.5)), F @ Vector((0.42, 0.05, top + 0.5)), 0.035, 6)
    tube(b, 'tube', F @ Vector((0.05, 0.4, top + 0.25)), F @ Vector((-0.34, 0.4, top + 0.25)), 0.045, 6)
    tube(b, 'tube', F @ Vector((-0.34, 0.4, top + 0.25)), F @ Vector((-0.34, 0.4, -0.8)), 0.045, 6)
    box(b, 'light', (0.16, 0.02, 0.04), F @ T(0.4, -0.62, top + 0.5), bevel=False)

def corner_step(b, i):
    """The corner squared off: one edge's line carried on past the corner by a plate of its own."""
    c, u, t = _corner_frame(i)
    j = (i - 1) % 6
    e = (c - HEX[j]).normalized()                  # along the edge that arrives at this corner
    n = Vector((e.y, -e.x))                        # that edge's outward side
    F = _F(c, e, -n)
    L, D = STEP_OUT, 1.05
    box(b, 'deck', (L, D, 0.3), F @ T(L / 2, D / 2, -0.19))
    poly = [c, c + e * L, c + e * L - n * D, c - n * D]
    poly = [Vector((p.x, p.y)) for p in poly]
    plate_uv(b, 'deckold', poly, [(0.02, 0.52), (0.48, 0.52), (0.48, 0.98), (0.02, 0.98)], -0.05, 0.006)
    box(b, 'steel', (0.1, D, 0.14), F @ T(L - 0.05, D / 2, 0.05))
    box(b, 'steel', (L, 0.1, 0.14), F @ T(L / 2, 0.05, 0.05))
    beam(b, 'beam', F @ Vector((L - 0.1, D / 2, -0.34)), F @ Vector((-0.5, D / 2, -0.84)), 0.07, 0.09)
    cyl(b, 'black', 0.14, 0.5, F @ T(L - 0.3, 0.32, 0.006), 8)
    cyl(b, 'steel', 0.16, 0.04, F @ T(L - 0.3, 0.32, 0.5), 8)

CORNER = {'plain': None, 'drop': corner_drop, 'notch': corner_notch, 'balcony': corner_balcony, 'shelf': corner_shelf, 'step': corner_step}

def edge_beam(b, i, extras, rng):
    edge_beam_pq(b, HEX[i], HEX[(i + 1) % 6], extras, rng)

def edge_beam_pq(b, p, q, extras, rng):
    """One edge's beam: web, flange, stiffeners and a row of bolts in the slab's face, and whatever hangs off it."""
    e = (q - p).normalized()
    n = Vector((e.y, -e.x))                        # outward
    mid = (p + q) / 2
    F = _F(mid, e, n)                              # X along the edge, Y outward, origin at the edge's middle, z = deck top
    L = (q - p).length
    box(b, 'beam', (L - 0.16, 0.07, 0.4), F @ T(0, -0.2, -SLAB - 0.2))
    box(b, 'beam', (L - 0.1, 0.3, 0.05), F @ T(0, -0.2, -SLAB - 0.385))
    k = -L / 2 + 0.4
    while k < L / 2 - 0.3:
        box(b, 'beam', (0.05, 0.12, 0.33), F @ T(k, -0.11, -SLAB - 0.19), bevel=False)
        k += 0.86
    k = -L / 2 + 0.3
    while k < L / 2 - 0.2:
        cyl(b, 'fixing', 0.035, 0.03, F @ T(k, 0, -0.26) @ RX(-math.pi / 2), 5, bevel=False)
        k += 0.62
    for kind, side in extras:
        x = side * min(rng.uniform(1.55, 1.95), max(0.0, L / 2 - 0.75))
        if kind == 'conduit':
            for dz in (0.0, 0.1):
                tube(b, 'tube', F @ Vector((-L / 2 + 0.25, 0.05, -0.62 - dz)), F @ Vector((L / 2 - 0.25, 0.05, -0.62 - dz)), 0.033, 6)
            for cx in (-2.2, -0.75, 0.75, 2.2):
                box(b, 'steel', (0.07, 0.11, 0.22), F @ T(cx, 0.03, -0.67))
            box(b, 'black', (0.34, 0.16, 0.3), F @ T(x, 0.08, -0.3))
        elif kind == 'bracket':
            box(b, 'steel', (0.4, 0.34, 0.05), F @ T(x, 0.17, -0.12))
            beam(b, 'steel', F @ Vector((x, 0.32, -0.15)), F @ Vector((x, 0.0, -0.6)), 0.06, 0.06)
            cyl(b, 'leggalv', 0.1, 0.3, F @ T(x, 0.2, -0.445), 8)
        elif kind == 'catwalk':
            w = 1.25
            box(b, 'deckhide', (w - 0.1, 0.3, 0.01), F @ T(x, 0.15, -0.1), bevel=False)
            for m in range(7):
                box(b, 'grillebar', (0.035, 0.3, 0.03), F @ T(x - w / 2 + 0.09 + m * (w - 0.18) / 6, 0.15, -0.09), bevel=False)
            box(b, 'steel', (w, 0.06, 0.08), F @ T(x, 0.3, -0.1))
            for s in (-1, 1):
                box(b, 'steel', (0.06, 0.3, 0.08), F @ T(x + s * (w / 2 - 0.03), 0.15, -0.1))
                beam(b, 'beam', F @ Vector((x + s * (w / 2 - 0.1), 0.28, -0.15)), F @ Vector((x + s * (w / 2 - 0.1), 0.0, -0.55)), 0.05, 0.05)
        elif kind == 'box':
            box(b, 'black', (0.5, 0.2, 0.34), F @ T(x, 0.1, -0.27))
            box(b, 'steel', (0.56, 0.24, 0.03), F @ T(x, 0.1, -0.09))
            tube(b, 'tube', F @ Vector((x, 0.1, -0.44)), F @ Vector((x, 0.1, -0.84)), 0.03, 6)

def part_deck(seed, corners, lane_k, lane, cross, extras, number, marks, grille, hatch):
    """
    A deck. `corners`: what each of the six corners is. `lane_k`: which way the brushed way runs
    (30 + 60k degrees, edge to opposite edge). `extras`: for each edge, what hangs off its beam.
    Everything on top stays inside the hexagon except the corner pieces; everything that sticks
    out of an edge is below the deck top, clear of the middle third.
    """
    def build(b):
        rng = random.Random(seed)
        slab3(b, HEX, -SLAB, -0.05)
        area_poly = inset(HEX, 0.3)
        for i, kind in enumerate(corners):
            if kind == 'drop':
                c, u, t = _corner_frame(i)
                area_poly = clip_half(area_poly, c - u * (DROP + 0.1), u)
        plating_k(b, area_poly, 0.0, rng, math.radians(30 + 60 * lane_k), lane, cross, grille=grille, hatch=hatch, marks=marks, number=number)
        # the border the plates stop short of: a dark margin plate round the whole deck
        inner = inset(HEX, 0.3)
        for i in range(6):
            j = (i + 1) % 6
            quad = [HEX[i], HEX[j], inner[j], inner[i]]
            for k in (i, j):
                if corners[k] == 'drop':
                    c, u, t = _corner_frame(k)
                    quad = clip_half(quad, c - u * DROP, u)
            prism(b, 'deck', quad, -0.05, 0.0)
        for i in range(6):
            edge_beam(b, i, extras[i], rng)
            if CORNER[corners[i]]:
                CORNER[corners[i]](b, i)
        # joists under the slab, clear of the middle where a lamp may hang
        ja = math.radians(60 * rng.randrange(3))
        JF = RZ(ja)
        for y in (-3.5, -1.75, 1.75, 3.5):
            half = RAD - abs(y) / math.sqrt(3) - 0.45
            beam(b, 'beam', JF @ Vector((-half, y, -SLAB - 0.11)), JF @ Vector((half, y, -SLAB - 0.11)), 0.12, 0.22)
        tube(b, 'tube', JF @ Vector((-3.6, 2.6, -SLAB - 0.3)), JF @ Vector((3.6, 2.6, -SLAB - 0.3)), 0.05, 6)
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

# ====================================================================== decks that are not hexagons
# Three sizes of deck of their own shape. They still sit on the lattice: what they keep to is
# written out in settlement.md, and checked by the numbers here.
PORT_R = AP                 # a crossing meets a deck 5.146 from its cell's middle, at 30 + 60k degrees
MOUTH = 1.1                 # half the width left open at a port
CLEAR = 1.7                 # either side of a direction that is not a wing: nothing beyond PORT_R
WING_REACH, WING_HALF = 9.0, 1.7
REACH_CORNER = 7.0
BUILDING_R, STACK_SIZE = 1.6, (3.56, 2.36)
EDGE_ROOM, WALK_ROOM, LANE_ROOM, LANE_IN = 0.3, 0.8, 1.0, 2.0
POST_IN = 0.75              # a post's middle is at least this far in from the edge
CELL2 = Vector((PITCH * math.cos(math.pi / 6), PITCH * math.sin(math.pi / 6)))   # a large deck's second cell

def _dir(k):
    a = math.radians(30 + 60 * k)
    return Vector((math.cos(a), math.sin(a)))

def _cell(i):
    return CELL2 if i else Vector((0, 0))

def port_pt(cell, k, lat=0.0):
    """A point on a port's line: the edge's middle, moved `lat` along the edge (anticlockwise is positive)."""
    d = _dir(k)
    return _cell(cell) + d * PORT_R + Vector((-d.y, d.x)) * lat

def offset_poly(poly, d):
    """Every edge of an anticlockwise polygon (it may have hollows) moved in by d."""
    n = len(poly)
    out = []
    for i in range(n):
        a, p, c = poly[i - 1], poly[i], poly[(i + 1) % n]
        e1, e2 = (p - a).normalized(), (c - p).normalized()
        n1, n2 = Vector((-e1.y, e1.x)), Vector((-e2.y, e2.x))
        out.append(p + (n1 + n2) * (d / (1 + n1.dot(n2))))
    return out

def _seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L))
    return math.hypot(px - ax - dx * t, py - ay - dy * t)

def _inside(px, py, pts):
    c = False
    n = len(pts)
    for i in range(n):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % n]
        if (ay > py) != (by > py) and px < ax + (py - ay) * (bx - ax) / (by - ay):
            c = not c
    return c

def _edge_room(px, py, pts):
    """How far inside the outline a point is (negative: outside)."""
    d = min(_seg_dist(px, py, *pts[i], *pts[(i + 1) % len(pts)]) for i in range(len(pts)))
    return d if _inside(px, py, pts) else -d

def _rect_pts(x, y, turn, size=STACK_SIZE):
    c, s = math.cos(turn), math.sin(turn)
    hx, hy = size[0] / 2, size[1] / 2
    return [(x + c * a - s * b_, y + s * a + c * b_) for a, b_ in ((-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy))]

def _rect_dist(px, py, x, y, turn, size=STACK_SIZE):
    c, s = math.cos(turn), math.sin(turn)
    lx, ly = (px - x) * c + (py - y) * s, -(px - x) * s + (py - y) * c
    dx, dy = abs(lx) - size[0] / 2, abs(ly) - size[1] / 2
    if dx <= 0 and dy <= 0:
        return max(dx, dy)
    return math.hypot(max(dx, 0), max(dy, 0))

def _rect_rect(r1, r2):
    """How far apart two stacks are (negative when one's corner or side middle is inside the other)."""
    best = 1e9
    for a, b_ in ((r1, r2), (r2, r1)):
        pts = _rect_pts(*a)
        for i in range(4):
            (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % 4]
            for f in (0.0, 0.5):
                best = min(best, _rect_dist(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, *b_))
    return best

def footing_slack(circles, stacks, pts, lanes):
    """The least any margin has to spare with these footprints (negative: a rule is broken)."""
    s = 1e9
    for i, (x, y) in enumerate(circles):
        s = min(s, _edge_room(x, y, pts) - EDGE_ROOM - BUILDING_R)
        for a, b_ in lanes:
            s = min(s, _seg_dist(x, y, *a, *b_) - LANE_ROOM - BUILDING_R)
        for x2, y2 in circles[i + 1:]:
            s = min(s, math.hypot(x - x2, y - y2) - 2 * BUILDING_R - WALK_ROOM)
        for st in stacks:
            s = min(s, _rect_dist(x, y, *st) - BUILDING_R - WALK_ROOM)
    for i, st in enumerate(stacks):
        rp = _rect_pts(*st)
        for j in range(4):
            ax, ay = rp[j]
            bx, by = rp[(j + 1) % 4]
            for f in (0.0, 0.25, 0.5, 0.75):
                s = min(s, _edge_room(ax + (bx - ax) * f, ay + (by - ay) * f, pts) - EDGE_ROOM)
        for px, py in pts:
            s = min(s, _rect_dist(px, py, *st) - EDGE_ROOM)
        for a, b_ in lanes:
            for f in (0.0, 0.25, 0.5, 0.75, 1.0):
                s = min(s, _rect_dist(a[0] + (b_[0] - a[0]) * f, a[1] + (b_[1] - a[1]) * f, *st) - LANE_ROOM)
        for st2 in stacks[i + 1:]:
            s = min(s, _rect_rect(st, st2) - WALK_ROOM)
    return s

def place_footings(pts, lanes, nb, ns, seed, tries=None, steps=5000):
    """
    Buildings and stacks placed to leave every margin as much to spare as the deck can give.
    A search that starts in several places and is allowed to get worse for a while before it
    settles, so one footprint caught in a bad corner does not hold the rest back.
    """
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    best = None
    turns = [math.pi * i / 12 for i in range(12)]
    tries = tries or (8 if nb + ns <= 4 else 4)
    for attempt in range(tries):
        rng = random.Random(seed * 31 + attempt)
        def anywhere(room):
            for _ in range(4000):
                x, y = rng.uniform(min(xs), max(xs)), rng.uniform(min(ys), max(ys))
                if _edge_room(x, y, pts) > room:
                    return (x, y)
            return (sum(xs) / len(xs), sum(ys) / len(ys))
        circles = [anywhere(1.2) for _ in range(nb)]
        stacks = [(*anywhere(1.0), rng.choice(turns)) for _ in range(ns)]
        cur = footing_slack(circles, stacks, pts, lanes)
        top = (cur, circles, stacks)
        for it in range(steps):
            cool = 1 - it / steps
            step = 1.8 * cool + 0.03
            c2, s2 = list(circles), list(stacks)
            pick = rng.randrange(nb + 2 * ns)
            if pick < nb:
                x, y = circles[pick]
                c2[pick] = anywhere(1.2) if rng.random() < 0.03 * cool else (x + rng.gauss(0, step), y + rng.gauss(0, step))
            elif pick < nb + ns:
                x, y, t = stacks[pick - nb]
                s2[pick - nb] = (*anywhere(1.0), t) if rng.random() < 0.03 * cool else (x + rng.gauss(0, step), y + rng.gauss(0, step), t)
            else:
                x, y, t = stacks[pick - nb - ns]
                s2[pick - nb - ns] = (x, y, rng.choice(turns))
            new = footing_slack(c2, s2, pts, lanes)
            if new >= cur - 0.35 * cool * cool * rng.random():
                circles, stacks, cur = c2, s2, new
                if cur > top[0]:
                    top = (cur, circles, stacks)
        if best is None or top[0] > best[0]:
            best = top
        if best[0] > 0.1:
            break
    return best

def chords(pts, origin, direction):
    """Where a straight line lies inside an outline: pairs of distances along it from `origin`."""
    ox, oy = origin
    dx, dy = direction
    hits = []
    n = len(pts)
    for i in range(n):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % n]
        ex, ey = bx - ax, by - ay
        den = dx * ey - dy * ex
        if abs(den) < 1e-9:
            continue
        t = ((ax - ox) * ey - (ay - oy) * ex) / den
        u = ((ax - ox) * dy - (ay - oy) * dx) / den
        if 0 <= u < 1:
            hits.append(t)
    hits.sort()
    return [(hits[i], hits[i + 1]) for i in range(0, len(hits) - 1, 2)]

def plating_free(b, poly, z, rng, a, ways, grille, hatch, old, marks, note):
    """
    The plates of a deck of any shape, in the hexagon decks' language: one grid, a dark tread
    field, a pale brushed way wherever a plate lies on the way from the deck's hub to a port,
    plates put in later, grilles, hatches, one or two painted marks. Where the number goes is
    noted, not painted. `ways` are straight runs, each a pair of points.
    """
    ca, sa = math.cos(a), math.sin(a)
    def w(x, y):
        return Vector((x * ca - y * sa, x * sa + y * ca))
    def back(p):
        return p.x * ca + p.y * sa, -p.x * sa + p.y * ca
    lo = [min(back(p)[i] for p in poly) for i in (0, 1)]
    hi = [max(back(p)[i] for p in poly) for i in (0, 1)]
    ys = [lo[1] - rng.uniform(0.2, 1.4)]
    while ys[-1] < hi[1]:
        ys.append(ys[-1] + rng.choice([1.6, 1.8, 2.0, 2.4]))
    marks = list(marks)
    rusted = False
    free = []
    for j in range(len(ys) - 1):
        xs = [lo[0] - rng.uniform(0.2, 1.2)]
        while xs[-1] < hi[0]:
            xs.append(xs[-1] + rng.choice([1.6, 2.0, 2.0, 2.4, 2.8]))
        for i in range(len(xs) - 1):
            g = 0.02
            x0, x1, y0, y1 = xs[i] + g, xs[i + 1] - g, ys[j] + g, ys[j + 1] - g
            cut = clip_convex(poly, [w(x0, y0), w(x1, y0), w(x1, y1), w(x0, y1)])
            if len(cut) < 3 or area(cut) < 0.05:
                continue
            # points the clipping leaves doubled up would make faces of no size
            tidy = []
            for p in cut:
                if not tidy or (p - tidy[-1]).length > 1e-4:
                    tidy.append(p)
            if len(tidy) > 2 and (tidy[0] - tidy[-1]).length < 1e-4:
                tidy.pop()
            cut = tidy
            if len(cut) < 3:
                continue
            sx, sy = x1 - x0, y1 - y0
            whole = abs(area(cut) - sx * sy) < 0.01
            mid_w = w((x0 + x1) / 2, (y0 + y1) / 2)
            on_way = any(_seg_dist(mid_w.x, mid_w.y, p.x, p.y, q.x, q.y) < 0.82 for p, q in ways)
            M = T(0, 0, z) @ RZ(a) @ T((x0 + x1) / 2, (y0 + y1) / 2, 0)
            roll = rng.random()
            if whole and not on_way and roll < grille:
                n = max(3, int(sx / 0.2))
                for k in range(n):
                    box(b, 'grillebar', (0.045, sy - 0.1, 0.03), M @ T(-sx / 2 + (k + 0.5) * sx / n, 0, -0.016), bevel=False)
                for e in (-1, 1):
                    box(b, 'steel', (sx, 0.08, 0.06), M @ T(0, e * (sy / 2 - 0.04), -0.014))
                    box(b, 'steel', (0.08, sy, 0.06), M @ T(e * (sx / 2 - 0.04), 0, -0.014))
                continue
            if on_way:
                mat, quads = 'deckwalk', [(0.5, 0.5), (0, 0)]
            elif not rusted and whole and roll > 0.9:
                mat, quads, rusted = 'deckrust', [(0, 0.5), (0.5, 0)], True
            elif roll > 1.0 - old:
                mat, quads = 'deckold', [(0, 0.5), (0.5, 0), (0.5, 0.5)]
            else:
                mat, quads = 'decktread', [(0, 0.5), (0.5, 0)]
            qu, qv = rng.choice(quads)
            flip = rng.random() < 0.5
            uvs = []
            for p in cut:
                lx, ly = back(p)
                u, v = (lx - x0) / sx, (ly - y0) / sy
                if flip:
                    u, v = 1 - u, 1 - v
                uvs.append((qu + (0.01 + 0.98 * u) * 0.5, qv + (0.01 + 0.98 * v) * 0.5))
            lift = rng.choice([0, 0, 0.007]) + (0.004 if mat == 'deckwalk' else 0)
            plate_uv(b, mat, cut, uvs, z - 0.05, z + lift)
            big = note.get('biggest_area', 0.0)
            if area(cut) > big:
                c_ = sum(cut, Vector((0, 0))) / len(cut)
                span = [max(back(p)[i] for p in cut) - min(back(p)[i] for p in cut) for i in (0, 1)]
                note['biggest_area'] = area(cut)
                note['biggest'] = (False, c_, span[0], span[1])
            top = lift + 0.001
            if whole and on_way and marks:
                kind = marks.pop(0)
                if kind == 'chevron':
                    chevrons(b, M, 3, min(sx, sy) * 0.3, z + top)
                elif kind == 'band':
                    hazard_band(b, M, sx - 0.2, 0.36, z + top)
                elif kind == 'number':
                    note['number'] = dict(x=mid_w.x, y=mid_w.y, turn=a, plate=(sx, sy))
                elif kind == 'lines':
                    for e in (-1, 1):
                        box(b, 'hazard', (sx - 0.16, 0.09, 0.006), M @ T(0, e * (sy / 2 - 0.16), top + 0.003), bevel=False)
                continue
            if whole:
                free.append((mat == 'deckwalk', mid_w, sx, sy))
            if whole and mat == 'decktread' and rng.random() < hatch:
                hs = min(sx, sy) * 0.3
                for e in (-1, 1):
                    box(b, 'steel', (hs * 2 + 0.14, 0.09, 0.07), M @ T(0, e * hs, 0.03))
                    box(b, 'steel', (0.09, hs * 2 + 0.14, 0.07), M @ T(e * hs, 0, 0.03))
                box(b, 'black', (hs * 2 - 0.1, hs * 2 - 0.1, 0.034), M @ T(0, 0, 0.015))
                box(b, 'steel', (0.3, 0.06, 0.05), M @ T(0, hs * 0.5, 0.05))
                free.pop()
                continue
            if rng.random() < 0.3 and whole:
                c = sum(cut, Vector((0, 0))) / len(cut)
                for p in cut:
                    q = p + (c - p).normalized() * 0.13
                    cyl(b, 'fixing', 0.04, 0.02, T(q.x, q.y, z + lift), 5, bevel=False, cap=True)
    if 'number' not in note:
        # no whole plate of the way was left for it: any whole plate will do, one of the way's first;
        # and on a deck too narrow for any whole plate, the biggest piece of one
        pick = max(free, key=lambda f: (f[0], f[2] * f[3])) if free else note.get('biggest')
        if pick:
            on, at, sx, sy = pick
            note['number'] = dict(x=at.x, y=at.y, turn=a, plate=(sx, sy))
    note.pop('biggest', None)
    note.pop('biggest_area', None)

def _stretches(p, q, ports):
    """The lengths of an edge that take a kerb: all of it, less any port's mouth that lies on it."""
    L = (q - p).length
    e = (q - p) / L
    cuts = []
    for cell, k in ports:
        d, c = _dir(k), _cell(cell)
        if abs((p - c).dot(d) - PORT_R) < 1e-3 and abs((q - c).dot(d) - PORT_R) < 1e-3:
            m = (c + d * PORT_R - p).dot(e)
            if -MOUTH < m < L + MOUTH:
                cuts.append((m - MOUTH, m + MOUTH))
    out, at = [], 0.0
    for a_, c_ in sorted(cuts):
        if a_ > at:
            out.append((at, min(a_, L)))
        at = max(at, c_)
    if at < L:
        out.append((at, L))
    return [(a_, c_) for a_, c_ in out if c_ - a_ > 0.25]

def _F0(a, c, cell=0):
    """A point given along and across the line between a large deck's two cells (direction k = 0)."""
    d = _dir(0)
    return d * a + Vector((-d.y, d.x)) * c

def _shape(pts, frame=False):
    """An outline's points. In a frame-given outline, a point marked 'w' is already in the deck's own x, y."""
    return [Vector(p[1:]) if p[0] == 'w' else (_F0(*p) if frame else Vector(p)) for p in pts]

def wing_pt(cell, k, rad, lat):
    """A point out along direction k: `rad` from the cell's middle, `lat` across."""
    d = _dir(k)
    return _cell(cell) + d * rad + Vector((-d.y, d.x)) * lat

P, W = port_pt, wing_pt
V = lambda p: (p.x, p.y)
PW = lambda cell, k, lat: ('w', *V(port_pt(cell, k, lat)))      # a port's point, for an outline given in the frame
TONGUE = 1.3                # half the width of floor at a mouth: the kerbs either side then leave 2.1 clear
# Outlines, anticlockwise, in Blender's x, y (glTF z is minus y). `frame`: given along and across the
# k = 0 direction instead. Ports and wings are (cell, k). `hub` is where the brushed way runs from.
SHAPED_DECKS = {
    # ---- small: one building and one stack
    'deck-s1': dict(size='small', ports=[(0, 0), (0, 1)], wings=[], want=(1, 1), posts=3, grid=30, finish='used', seed=301,
                    marks=('chevron', 'number'), hub=(0.8, 2.4),          # a tight landing in the corner between two ports
                    outline=[V(P(0, 0, -1.3)), V(P(0, 0, 1.3)), V(P(0, 1, -1.3)), V(P(0, 1, 1.3)), (-2.0, 5.146), (-3.2, 3.6),
                             (-3.2, -0.7), (-0.9, -1.5), (3.6, -1.0)]),
    'deck-s2': dict(size='small', ports=[(0, 2), (0, 5)], wings=[], want=(1, 1), posts=3, grid=0, finish='clean', seed=302,
                    marks=('lines', 'number'), hub=(-3.2, -2.6),          # an L: a port at the end of each arm
                    outline=[V(P(0, 5, -1.3)), V(P(0, 5, 1.3)), (-1.5, -0.9), (-1.5, 2.7), V(P(0, 2, -1.3)), V(P(0, 2, 1.3)),
                             (-5.0, -1.6), (-3.6, -4.0), (2.6, -4.3)]),
    'deck-s3': dict(size='small', ports=[(0, 3), (0, 4)], wings=[(0, 1)], want=(1, 1), posts=3, grid=90, finish='used', seed=303,
                    marks=('band', 'number'), hub=(0, -0.6),              # a pad out on a wing, reached by its own walkway
                    outline=[(-1.3, -5.146), (1.3, -5.146), (1.3, -2.4), (1.9, -2.4), (1.9, 1.4), (0.9, 1.4), (0.9, 4.7), (1.7, 4.7),
                             (1.7, 8.95), (-1.7, 8.95), (-1.7, 4.7), (-0.9, 4.7), (-0.9, 1.4), (-1.9, 1.4), (-1.9, 0.405),
                             V(P(0, 3, -1.3)), V(P(0, 3, 1.3)), (-1.557, -2.4), (-1.3, -2.4)]),
    # ---- medium: two buildings and two stacks
    'deck-m1': dict(size='medium', ports=[(0, 0), (0, 2), (0, 4)], wings=[(0, 1)], want=(2, 2), posts=5, grid=90, finish='used', seed=311,
                    marks=('chevron', 'number'), hub=(0.2, -0.4),         # a long pier with a bulb at one end
                    outline=[(-1.3, -5.146), (1.3, -5.146), (1.3, -3.4), (3.2, -3.4), (4.4, -2.0), V(P(0, 0, -1.3)), V(P(0, 0, 1.3)),
                             (1.7, 2.7), (1.7, 9.0), (-1.3, 9.0), (-1.3, 2.9), V(P(0, 2, -1.3)), V(P(0, 2, 1.3)), (-4.6, -1.4),
                             (-3.0, -3.4), (-1.3, -3.4)]),
    'deck-m2': dict(size='medium', ports=[(0, 3), (0, 1), (0, 5)], wings=[(0, 0)], want=(2, 2), posts=5, grid=30, finish='clean', seed=312,
                    marks=('lines', 'number'), hub=(0.0, 0.0), frame=True,  # a wedge running out to a point, with a jetty either side
                    outline=[(-5.146, -2.97), (-1.2, -4.1), (0.475, -3.423), PW(0, 5, -1.3), PW(0, 5, 1.3), (2.909, -2.439),
                             (3.5, -2.2), (5.146, -1.5), (9.0, -0.7), (9.0, 0.7), (5.146, 1.5), (3.5, 2.2), (2.909, 2.439),
                             PW(0, 1, -1.3), PW(0, 1, 1.3), (0.475, 3.423), (-1.2, 4.1), (-5.146, 2.97)]),
    'deck-m3': dict(size='medium', ports=[(0, 0), (0, 1), (0, 3), (0, 4)], wings=[(0, 5)], want=(2, 2), posts=5, grid=150, finish='used', seed=313,
                    marks=('band', 'number'), hub=(1.4, 0.2),             # a slab with a bite out of it, and a pier off one side
                    outline=[(5.942, 0), (2.971, 5.146), (-1.3, 5.146), (-1.3, 3.0), (0.057, 2.391), (-2.043, -1.246),
                             (-5.507, 0.754), (-5.942, 0), V(P(0, 3, 1.3)), (-1.3, -5.146), (2.971, -5.146), V(P(0, 5, -1.6)),
                             V(W(0, 5, 9.0, -1.6)), V(W(0, 5, 9.0, 1.6)), V(P(0, 5, 1.6))]),
    'deck-m4': dict(size='medium', ports=[(0, 0), (0, 1), (0, 2), (0, 3), (0, 4), (0, 5)], wings=[], want=(2, 2), posts=5, grid=90, finish='clean', seed=314,
                    marks=('chevron', 'number'), hub=(-1.2, 0.0),         # half a slab, and a forked jetty to the two far ports
                    outline=[(1.3, -5.146), (1.3, -2.252), V(P(0, 5, -1.3)), V(P(0, 5, 1.3)), (2.601, 0.0), V(P(0, 0, -1.3)),
                             V(P(0, 0, 1.3)), (1.3, 2.252), (1.3, 5.146), (-2.971, 5.146), (-5.942, 0), (-2.971, -5.146)]),
    # ---- more single-cell shapes, so a campus does not show the same few over and over
    'deck-s4': dict(size='small', ports=[(0, 0), (0, 3)], wings=[], want=(0, 1), posts=3, grid=30, finish='clean', seed=304,
                    marks=('lines', 'number'), hub=(0.0, 0.0), frame=True,   # an S: a strip between two ports, a pad hung off each side
                    outline=[(-5.146, -1.3), (-3.4, -2.9), (1.9, -2.9), (1.9, -1.3), (5.146, -1.3), (5.146, 2.9), (0.6, 2.9),
                             (0.6, 1.3), (-5.146, 1.3)]),
    'deck-s5': dict(size='small', ports=[(0, 1), (0, 2), (0, 4)], wings=[], want=(0, 1), posts=3, grid=90, finish='used', seed=305,
                    marks=('chevron', 'number'), hub=(0.0, 0.6),             # a spine with a branch one side and a pad the other
                    outline=[(-1.3, -5.146), (1.3, -5.146), (1.3, -2.8), (3.4, -2.8), (4.3, -1.9), (4.3, 1.4), (1.3, 1.4), (1.3, 5.146),
                             (-1.3, 5.146), (-1.3, 2.252), V(P(0, 2, -1.3)), V(P(0, 2, 1.3)), (-1.3, -0.751)]),
    'deck-s6': dict(prefer='buildings', size='small', ports=[(0, 0), (0, 2), (0, 3)], wings=[], want=(1, 1), posts=3, grid=30, finish='used', seed=306,
                    marks=('band', 'number'), hub=(-1.6, 0.0),               # a blunt block on two ports with one arm reaching for a third
                    outline=[V(P(0, 3, 1.3)), (-0.6, -2.6), (1.1, -2.0), (1.1, -0.866), V(P(0, 0, -1.3)), V(P(0, 0, 1.3)), (1.1, 2.136),
                             (-1.0, 3.0), V(P(0, 2, -1.3)), V(P(0, 2, 1.3)), (-5.942, 0), V(P(0, 3, -1.3))]),
    'deck-m5': dict(prefer='buildings', size='medium', ports=[(0, 0), (0, 1), (0, 3)], wings=[], want=(2, 2), posts=5, grid=0, finish='used', seed=315,
                    marks=('chevron', 'number'), hub=(1.0, 0.5),             # a cleaver: a broad blade and a handle to the third port
                    outline=[V(P(0, 3, 1.3)), (-1.2, -2.194), (-1.2, -4.6), (2.6, -4.6), (2.6, -3.4), (4.1, -3.0), (4.9, -1.0),
                             V(P(0, 0, -1.3)), V(P(0, 0, 1.3)), (2.971, 5.146), (-1.3, 5.146), (-3.4, 3.9), (-3.9, 2.6),
                             (-3.9, -0.750), V(P(0, 3, -1.3))]),
    'deck-m6': dict(size='medium', ports=[(0, 0), (0, 2), (0, 3)], wings=[], want=(2, 2), posts=5, grid=90, finish='clean', seed=316,
                    marks=('lines', 'number'), hub=(-1.6, 1.0),              # a slab with a long slot cut in from one side
                    outline=[V(P(0, 3, 1.3)), (-2.971, -5.146), (2.971, -5.146), (4.55, -2.4), (0.2, -2.4), (0.2, -0.6), (5.59, -0.6),
                             (5.942, 0), V(P(0, 0, 1.3)), (2.971, 5.146), (-2.971, 5.146), V(P(0, 2, 1.3)), (-5.942, 0),
                             V(P(0, 3, -1.3))]),
    'deck-m7': dict(size='medium', ports=[(0, 1), (0, 3), (0, 5)], wings=[], want=(2, 2), posts=5, grid=150, finish='used', seed=317,
                    marks=('band', 'number'), hub=(0.4, -0.4),               # one side sliced off on the slant, two corners stepped out
                    outline=[V(P(0, 5, -1.3)), V(P(0, 5, 1.3)), (2.0, 5.146), (-1.3, 5.146), (-1.3, 2.6), (-4.4, 2.6), (-5.942, 0),
                             V(P(0, 3, 1.3)), (-1.6, -3.699), (-1.6, -5.146), (2.971, -5.146)]),
    'deck-m8': dict(prefer='buildings', size='medium', ports=[(0, 0), (0, 1), (0, 2), (0, 4)], wings=[], want=(2, 2), posts=5, grid=90, finish='clean', seed=318,
                    marks=('chevron', 'number'), hub=(0.0, 2.4),             # a T: a bar across three ports and a broad stem to the fourth
                    outline=[(-2.9, -5.146), (2.9, -5.146), (2.9, 0.3), (5.6, 0.3), V(P(0, 0, -1.3)), V(P(0, 0, 1.3)), (2.971, 5.146), (-2.971, 5.146),
                             V(P(0, 2, 1.3)), (-5.942, 0), (-2.9, -0.5)]),
    'deck-m9': dict(prefer='stack', size='medium', ports=[(0, 0), (0, 3), (0, 4), (0, 5)], wings=[(0, 2)], want=(2, 2), posts=5, grid=150, finish='used', seed=319,
                    marks=('lines', 'number'), hub=(1.0, -1.0),              # a hammer: its top planed off, a pier out over the next cell
                    outline=[V(P(0, 3, 1.3)), (-2.971, -5.146), (2.971, -5.146), V(P(0, 5, 1.3)), V(P(0, 0, -1.3)), V(P(0, 0, 1.3)), (2.0, 2.6), (-0.4, 1.6),
                             V(P(0, 2, -1.6)), V(W(0, 2, 9.0, -1.6)), V(W(0, 2, 9.0, 1.6)), V(P(0, 2, 1.6)), (-5.942, 0),
                             V(P(0, 3, -1.3))]),
    'deck-m10': dict(prefer='buildings', size='medium', ports=[(0, 0), (0, 1), (0, 2), (0, 3), (0, 4)], wings=[], want=(2, 2), posts=5, grid=30, finish='clean', seed=320,
                     marks=('band', 'number'), hub=(-1.0, 1.0),              # a slab with a wedge taken out to its middle
                     outline=[(-2.971, -5.146), (1.3, -5.146), (0.9, -0.9), (5.5, -0.75), (5.942, 0), (2.971, 5.146), (-1.6, 5.146),
                              (-3.6, 4.057), (-5.942, 0)]),
    'deck-m11': dict(size='medium', ports=[(0, 0), (0, 2), (0, 3), (0, 5)], wings=[(0, 1)], want=(2, 2), posts=5, grid=90, finish='used', seed=324,
                     marks=('chevron', 'number'), hub=(0.0, 1.6),            # a butterfly: slotted from below, trimmed at the corners, a pier above
                     outline=[V(P(0, 3, 1.3)), (-2.971, -5.146), (-1.6, -5.146), (-1.0, -1.6), (1.0, -1.6), (1.6, -5.146),
                              (2.971, -5.146), V(P(0, 5, 1.3)), V(P(0, 0, -1.3)), V(P(0, 0, 1.3)), (1.7, 5.146), (1.7, 8.4),
                              (-1.5, 8.4), (-1.5, 5.146), V(P(0, 2, -1.3)), V(P(0, 2, 1.3)), V(P(0, 3, -1.3))]),
    # ---- large: two cells as one slab, four buildings and four stacks
    'deck-l1': dict(size='large', ports=[(0, 3), (0, 1), (1, 0), (1, 4)], wings=[], want=(4, 4), posts=8, grid=30, finish='used', seed=321,
                    marks=('chevron', 'number'), hub=(6.6, 0.0), frame=True,   # a dumbbell: two pads and a neck across the gap
                    outline=[(3.6, 1.5), (3.6, 3.0), PW(0, 1, -1.3), PW(0, 1, 1.3), (-1.5, 5.0), (-4.2, 3.4), (-5.146, 2.0),
                             (-5.146, -2.0), (-4.2, -3.4), (-1.0, -4.6), (2.4, -4.0), (3.6, -2.6), (3.6, -1.5), (9.764, -1.5),
                             (9.764, -3.0), PW(1, 4, -1.3), PW(1, 4, 1.3), (15.164, -4.6), (17.564, -2.6), (18.310, -1.6),
                             (18.310, 1.6), (17.164, 3.2), (14.164, 4.4), (10.964, 3.8), (9.764, 2.6), (9.764, 1.5)]),
    'deck-l2': dict(size='large', ports=[(0, 1), (0, 5), (1, 0), (1, 5)], wings=[(1, 1)], want=(4, 4), posts=8, grid=30, finish='clean', seed=322,
                    marks=('lines', 'number'), hub=(8.0, 0.0), frame=True,     # a broad yard with a pier
                    outline=[(-1.4, -4.5), PW(0, 5, -1.3), PW(0, 5, 1.3), (5.146, -2.9), (8.018, -2.9), (10.6, -4.2),
                             PW(1, 5, -1.3), PW(1, 5, 1.3), (18.310, -1.6), (18.310, 1.6), (17.2, 3.2), (16.863, 3.807),
                             (18.790, 7.144), (16.538, 8.444), (14.611, 5.107), (12.2, 4.6), (9.2, 3.4), (8.018, 2.9),
                             (5.146, 2.9), PW(0, 1, -1.3), PW(0, 1, 1.3), (-1.4, 4.5)]),
    'deck-l3': dict(size='large', ports=[(0, 2), (0, 4), (1, 0), (1, 1), (1, 5)], wings=[(0, 3)], want=(4, 4), posts=8, grid=30, finish='used', seed=323,
                    marks=('band', 'number'), hub=(3.4, 0.4), frame=True,      # a pad, a long arm to a far landing, a pier behind
                    outline=[(3.4, 1.9), (3.4, 3.6), (1.0, 4.9), PW(0, 2, -1.3), PW(0, 2, 1.3), (-5.146, 1.2), (-9.0, 1.2),
                             (-9.0, -1.2), (-5.146, -1.2), (-4.6, -2.4), PW(0, 4, -1.3), PW(0, 4, 1.3), (0.6, -4.4),
                             (0.6, -1.3), (11.0, -1.3), (11.0, -4.2), PW(1, 5, -1.3), PW(1, 5, 1.3), (17.4, -2.6),
                             (17.4, -1.3), (18.310, -1.3), (18.310, 1.9), (15.762, 1.9), PW(1, 1, -1.3), PW(1, 1, 1.3),
                             (12.759, 1.9)]),
}
DECK_DATA = {}

def deck_plan(name):
    """A deck's outline, what fits on it and where its posts go. Worked out once: the model and deck-shapes.json both read it."""
    if name in DECK_DATA:
        return DECK_DATA[name]
    spec = SHAPED_DECKS[name]
    cache = bpy.app.driver_namespace.setdefault('nx_plan_cache', {})
    outline = _shape(spec['outline'], spec.get('frame', False))
    if area(outline) < 0:
        outline = list(reversed(outline))
    pts = [(p.x, p.y) for p in outline]
    hub = _shape([spec['hub']], spec.get('frame', False))[0]
    lanes = []
    for cell, k in spec['ports']:
        d, c = _dir(k), _cell(cell)
        a, b_ = c + d * PORT_R, c + d * (PORT_R - LANE_IN)
        lanes.append(((a.x, a.y), (b_.x, b_.y)))
    key = repr(('search 2', pts, spec['ports'], spec['want'], spec['seed'], spec['posts'])) + spec.get('prefer', '') * 2
    if key not in cache:
        # what fits: the count asked for if it can be had with every margin kept, or else the most that can
        nb, ns = spec['want']
        tries = [(nb - i, ns - j) for total in range(nb + ns) for i in range(total + 1) for j in (total - i,)
                 if nb - i >= 0 and ns - j >= 0 and (nb - i) + (ns - j) > 0]
        # most footprints first; of equals, more stacks. A deck that asks for buildings gets more of those
        # instead, but still a stack where one fits, since a stack is where most sessions live
        if spec.get('prefer') == 'stack':
            # where two buildings fit but a stack and a building do not, the stack alone: it holds more
            tries.sort(key=lambda c: (-(c[0] + 3 * c[1]), -(c[0] + c[1])))
        elif spec.get('prefer') == 'buildings':
            tries.sort(key=lambda c: (-(c[0] + c[1]), -(c[1] > 0), -c[0]))
        else:
            tries.sort(key=lambda c: (-(c[0] + c[1]), -c[1]))
        found = None
        for cb, cs in tries:
            slack, circles, stacks = place_footings(pts, lanes, cb, cs, spec['seed'])
            if slack >= 0:
                found = (slack, circles, stacks)
                break
        if found is None:
            found = (0.0, [], [])
        # posts: under solid floor, well in from the edge, as far from each other as the shape allows
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        cand = []
        y = min(ys)
        while y < max(ys):
            x = min(xs)
            while x < max(xs):
                if _edge_room(x, y, pts) >= POST_IN:
                    cand.append((x, y))
                x += 0.35
            y += 0.35
        cx, cy = sum(c[0] for c in cand) / len(cand), sum(c[1] for c in cand) / len(cand)
        posts = [max(cand, key=lambda c: math.hypot(c[0] - cx, c[1] - cy))]
        while len(posts) < spec['posts']:
            posts.append(max(cand, key=lambda c: min(math.hypot(c[0] - p[0], c[1] - p[1]) for p in posts)
                             - 0.25 * max(0.0, _edge_room(c[0], c[1], pts) - 1.2)))
        ties = sorted({tuple(sorted((i, j))) for i in range(len(posts)) for j in sorted(
            (j for j in range(len(posts)) if j != i), key=lambda j: math.hypot(posts[i][0] - posts[j][0], posts[i][1] - posts[j][1]))[:2]
            if math.hypot(posts[i][0] - posts[j][0], posts[i][1] - posts[j][1]) <= 6.0})
        cache[key] = (found, posts, ties)
    (slack, circles, stacks), posts, ties = cache[key]
    DECK_DATA[name] = dict(spec=spec, outline=outline, pts=pts, lanes=lanes, hub=hub, buildings=circles, stacks=stacks, slack=slack,
                           posts=posts, ties=[list(t) for t in ties], area=area(outline), lit=[], note={})
    return DECK_DATA[name]

def _allowed(p, spec, grow=0.0):
    """Whether a point is somewhere this deck's floor may be (see settlement.md). `grow`: a little leeway."""
    cells = (0, 1) if spec['size'] == 'large' else (0,)
    for cell in cells:
        q = p - _cell(cell)
        rad = [q.dot(_dir(k)) for k in range(6)]
        lat = [(-q.x * _dir(k).y + q.y * _dir(k).x) for k in range(6)]
        if max(rad) <= PORT_R + grow:
            return True                             # inside the cell's hexagon
        for k in range(6):
            if (cell, k) in spec['wings'] and PORT_R - 0.01 <= rad[k] <= WING_REACH + grow and abs(lat[k]) <= WING_HALF + grow:
                return True                         # out on a declared wing
            if spec['size'] == 'large' and (cell, k) in ((0, 0), (1, 3)) and PORT_R - 0.01 <= rad[k] <= PITCH / 2 + 0.01 and abs(lat[k]) <= RAD / 2 + grow:
                return True                         # across the gap between its own two cells
        if q.length <= REACH_CORNER + grow and all(not (rad[k] > PORT_R + grow and abs(lat[k]) < CLEAR - grow) for k in range(6)):
            return True                             # in the corner of the cell, clear of every edge's middle
    return False

def part_deck_shaped(name):
    def build(b):
        plan = deck_plan(name)
        spec, outline, pts = plan['spec'], plan['outline'], plan['pts']
        rng = random.Random(spec['seed'])
        n = len(outline)
        slab3(b, outline, -SLAB, -0.05)
        inner = offset_poly(outline, 0.3)
        plan['note'].clear()
        ways = [(plan['hub'], _cell(cell) + _dir(k) * PORT_R) for cell, k in spec['ports']]
        grid = math.radians(spec['grid'])
        plating_free(b, inner, 0.0, rng, grid, ways, 0.07, 0.04, 0.14, spec['marks'], plan['note'])
        for i in range(n):
            prism(b, 'deck', [outline[i], outline[(i + 1) % n], inner[(i + 1) % n], inner[i]], -0.05, 0.0)
        # the beam under the edge, and what hangs off it where the edge is well inside its cell
        def deep(p):
            return any(max((p - _cell(c)).dot(_dir(k)) for k in range(6)) < PORT_R - 0.45 for c in ((0, 1) if spec['size'] == 'large' else (0,)))
        hang = ['conduit', 'bracket', 'box', 'conduit', 'catwalk', 'box']
        longest = None
        for i in range(n):
            p, q = outline[i], outline[(i + 1) % n]
            L = (q - p).length
            cutback = deep(p) and deep(q)
            extras = [(hang[i % len(hang)], rng.choice([-1, 1]))] if cutback and L > 2.4 else []
            edge_beam_pq(b, p, q, extras, rng)
            if cutback and L > 3.0 and (longest is None or L > longest[0]):
                longest = (L, p, q)
        # kerb all round but for the ports' mouths; rails on most of it; one or two lit strips
        runs = []
        for i in range(n):
            p, q = outline[i], outline[(i + 1) % n]
            e = (q - p).normalized()
            for a_, c_ in _stretches(p, q, spec['ports']):
                runs.append((c_ - a_, p + e * a_, p + e * c_, e))
        order = [r for r in sorted(range(len(runs)), key=lambda r: -runs[r][0]) if runs[r][0] >= 2.6]
        lit = set(order[:1] + order[2:3])
        plan['lit'].clear()
        for r, (L, p0, p1, e) in enumerate(runs):
            inw = Vector((-e.y, e.x))
            F = _F((p0 + p1) / 2, e, inw)          # X along the edge, Y into the deck
            beam(b, 'steel', F @ Vector((-L / 2 + 0.1, 0.13, 0.05)), F @ Vector((L / 2 - 0.1, 0.13, 0.05)), 0.22, 0.14)
            bare = r not in lit and L < 3.2 and rng.random() < 0.3
            if not bare and L > 0.9:
                rails(b, F @ Vector((-L / 2 + 0.22, 0.13, 0.0)), F @ Vector((L / 2 - 0.22, 0.13, 0.0)))
            if r in lit:
                beam(b, 'light', F @ Vector((-L / 2 + 0.5, 0.27, 0.03)), F @ Vector((L / 2 - 0.5, 0.27, 0.03)), 0.06, 0.05, bevel=False)
                beam(b, 'steel', F @ Vector((-L / 2 + 0.45, 0.31, 0.015)), F @ Vector((L / 2 - 0.45, 0.31, 0.015)), 0.03, 0.03)
                m = (p0 + p1) / 2 + inw * 0.27
                plan['lit'].append(dict(x=m.x, y=m.y, turn=math.atan2(e.y, e.x), length=L - 1.0))
        # a balcony or a shelf of plant off the longest edge that looks into the deck's own cell, if it stays in the cell
        if longest:
            L, p, q = longest
            e = (q - p).normalized()
            u = Vector((e.y, -e.x))
            c = p + e * (L * rng.choice([0.3, 0.7]))
            tip = [c + u * 0.95 + e * s for s in (-0.8, 0.0, 0.8)]
            if all(_allowed(t_, dict(spec, wings=[])) and deep(t_ - u * 0.3) and not _inside(t_.x, t_.y, pts) for t_ in tip):
                CORNER['balcony' if spec['seed'] % 2 else 'shelf'](b, (c, u))
        # joists under the slab, laid across the plates' grid wherever there is floor over them
        jd = Vector((math.cos(grid), math.sin(grid)))
        jn = Vector((-jd.y, jd.x))
        under = [(p.x, p.y) for p in offset_poly(outline, 0.45)]
        lo = min(Vector(p).dot(jn) for p in pts)
        hi = max(Vector(p).dot(jn) for p in pts)
        s = lo + 1.2
        while s < hi - 0.8:
            o = jn * s
            for t0, t1 in chords(under, (o.x, o.y), (jd.x, jd.y)):
                if t1 - t0 > 1.0:
                    beam(b, 'beam', v3(o + jd * t0, -SLAB - 0.11), v3(o + jd * t1, -SLAB - 0.11), 0.12, 0.22)
            s += 1.9
    return build

def write_deck_shapes(path=None):
    """deck-shapes.json: what the app needs to know about each shaped deck, in glTF axes (z is minus Blender's y)."""
    import json
    path = path or os.path.join(HERE, 'deck-shapes.json')
    try:
        data = json.load(open(path))
    except Exception:
        data = {}
    data = {k: v for k, v in data.items() if k in SHAPED_DECKS}
    r = lambda v: round(float(v), 3)
    for name, plan in DECK_DATA.items():
        if 'number' not in plan['note']:
            continue                                # planned but not built this time
        spec, num = plan['spec'], plan['note']['number']
        large = spec['size'] == 'large'
        data[name] = {
            'size': spec['size'], 'cells': 2 if large else 1,
            'ports': [[c, k] for c, k in spec['ports']] if large else [k for c, k in spec['ports']],
            'wings': [[c, k] for c, k in spec['wings']] if large else [k for c, k in spec['wings']],
            'outline': [[r(p.x), r(-p.y)] for p in plan['outline']],
            'area': r(plan['area']),
            'buildings': [[r(x), r(-y)] for x, y in plan['buildings']],
            'stacks': [{'x': r(x), 'z': r(-y), 'turn': r(t % math.pi)} for x, y, t in plan['stacks']],
            'posts': [[r(x), r(-y)] for x, y in plan['posts']],
            'ties': plan['ties'],
            'lit': [{'x': r(l['x']), 'z': r(-l['y']), 'turn': r(l['turn']), 'length': r(l['length'])} for l in plan['lit']],
            'number': {'x': r(num['x']), 'z': r(-num['y']), 'turn': r(num['turn'])},
        }
    with open(path, 'w') as f:
        json.dump(data, f, indent=1, sort_keys=True)
        f.write('\n')
    return path

def part_post(level):
    """
    One heavy leg for a deck on this level: a footing, a bolted base plate, an H section, a head
    plate under the slab and four knee braces, so it reads from any side.
    """
    def build(b):
        rng = random.Random(600 + level)
        h = LEVEL1 + STEP * (level - 1)
        s = 0.34 + 0.06 * h
        top, foot = -SLAB, -h
        p = Vector((0, 0))
        footing(b, p, foot, s, 0, bloom=level in (2, 5))
        z0 = foot + 0.17
        h_column(b, p, z0, z0 + 0.5, s, 0, 'legbloom' if level in (1, 4) else 'legsteel')
        h_column(b, p, z0 + 0.5, top - 0.06, s, 0)
        box(b, 'leggalv', (s * 1.7, s * 1.7, 0.06), T(0, 0, top - 0.03))
        reach = min(0.85, (top - z0) * 0.45)
        for a in range(4):
            d = Vector((math.cos(a * math.pi / 2), math.sin(a * math.pi / 2)))
            lo, hi = d * (s / 2), d * (s / 2 + reach)
            beam(b, 'leggalv', v3(lo, top - 0.1 - reach), v3(hi, top - 0.08), 0.06, 0.1, bevel=False)
            gusset(b, v3(lo, top - 0.1 - reach), d, s)
            box(b, 'leggalv', (0.24, 0.24, 0.03), T(hi.x, hi.y, top - 0.065), bevel=False)
        if level >= 3:
            # a collar part way up, where a brace could be bolted on
            zc = z0 + (top - z0) * 0.5
            box(b, 'leggalv', (s * 1.15, s * 1.15, 0.2), T(0, 0, zc))
        if level in (1, 3, 5):
            for a in (0, 2):
                R = T(0, 0, z0 + 0.36) @ RZ(a * math.pi / 2 + math.pi / 2)
                box(b, 'hazard', (s * 0.98, 0.012, 0.3), R @ T(0, s / 2 + 0.004, 0), bevel=False)
                box(b, 'black', (s * 0.98, 0.016, 0.06), R @ T(0, s / 2 + 0.004, 0), bevel=False)
        if level in (2, 4, 5):
            c = Vector((s * 0.5 + 0.1, 0.0)) if level != 4 else Vector((-(s * 0.5 + 0.1), 0.0))
            tube(b, 'leggalv', v3(c, z0 + 0.2), v3(c, top - 0.5), 0.06, 8)
            for f in (0.2, 0.6):
                box(b, 'legsteel', (0.2, 0.2, 0.05), T(c.x, c.y, z0 + (top - z0) * f))
    return build

def part_port_gate(b):
    """A swing gate between two short posts, to close a port that has no crossing. 2.0 wide."""
    y = 0.13
    for x in (-1.0, 1.0):
        box(b, 'steel', (0.1, 0.1, 0.98), T(x, y, 0.49))
        box(b, 'steel', (0.2, 0.2, 0.03), T(x, y, 0.015))
        box(b, 'steel', (0.14, 0.14, 0.03), T(x, y, 0.985))
    for z in (0.9, 0.52, 0.16):
        tube(b, 'tube', (-0.9, y, z), (0.88, y, z), 0.028, 6)
    for x in (-0.9, 0.0, 0.88):
        tube(b, 'tube', (x, y, 0.16), (x, y, 0.9), 0.024, 6)
    for z in (0.3, 0.8):                           # hinges
        box(b, 'black', (0.1, 0.07, 0.08), T(-0.95, y, z))
    box(b, 'black', (0.12, 0.09, 0.14), T(0.94, y, 0.56))   # latch
    box(b, 'hazard', (0.86, 0.02, 0.2), T(-0.02, y, 0.71), bevel=False)
    box(b, 'black', (0.9, 0.012, 0.24), T(-0.02, y, 0.71), bevel=False)

# ---------------------------------------------------------------------- legs
LEG_AT = [Vector((2.7, 2.6)), Vector((-2.7, 2.6)), Vector((-2.7, -2.6)), Vector((2.7, -2.6))]

def h_column(b, p, z0, z1, s, turn, mat='legsteel'):
    """An H section standing at p: two flanges and a web."""
    M = T(p.x, p.y, (z0 + z1) / 2) @ RZ(turn)
    tf = max(0.045, s * 0.11)
    for e in (-1, 1):
        box(b, mat, (s, tf, z1 - z0), M @ T(0, e * (s - tf) / 2, 0))
    box(b, mat, (max(0.04, s * 0.09), s - tf * 2, z1 - z0), M)

def box_column(b, p, z0, z1, s, turn, mat='legsteel'):
    """A box section with a bolted splice collar part way up."""
    M = T(p.x, p.y, (z0 + z1) / 2) @ RZ(turn)
    box(b, mat, (s * 0.86, s * 0.86, z1 - z0), M)
    zc = (z1 - z0) * 0.12
    box(b, 'leggalv', (s, s, 0.26), M @ T(0, 0, zc))
    for a in range(4):
        R = M @ RZ(a * math.pi / 2)
        for dx in (-0.28, 0.28):
            for dz in (-0.07, 0.07):
                cyl(b, 'fixing', 0.028, 0.025, R @ T(dx * s, s / 2, zc + dz) @ RX(-math.pi / 2), 5, bevel=False)

def footing(b, p, foot, s, turn, bloom):
    """A concrete pad, a base plate on it, four bolts."""
    M = T(p.x, p.y, foot) @ RZ(turn)
    box(b, 'footing', (s * 2, s * 2, 0.13), M @ T(0, 0, 0.065))
    box(b, 'legbloom' if bloom else 'leggalv', (s * 1.6, s * 1.6, 0.045), M @ T(0, 0, 0.152))
    for dx in (-1, 1):
        for dy in (-1, 1):
            cyl(b, 'fixing', 0.045, 0.07, M @ T(dx * s * 0.62, dy * s * 0.62, 0.17), 6, bevel=False)
    for a in range(4):
        # stiffeners from the plate up the column
        R = M @ RZ(a * math.pi / 2)
        box(b, 'legsteel', (0.035, s * 0.3, 0.26), R @ T(0, s * 0.62, 0.3), bevel=False)

def gusset(b, at, d, s, mat='leggalv'):
    """A plate in the plane of a face (d is the face's direction), where a brace meets a column or a tie."""
    M = Matrix(((d.x, -d.y, 0, at.x), (d.y, d.x, 0, at.y), (0, 0, 1, at.z), (0, 0, 0, 1)))
    g = 0.2 + s * 0.35
    box(b, mat, (g, 0.03, g), M, bevel=False)
    for dx in (-0.3, 0.3):
        for dz in (-0.3, 0.3):
            cyl(b, 'fixing', 0.025, 0.05, M @ T(dx * g, -0.025, dz * g) @ RX(-math.pi / 2), 5, bevel=False)

def brace(b, a, c, s, mat='leggalv', flat=True):
    """A brace from a to c with a gusset at each end."""
    a, c = Vector(a), Vector(c)
    d = Vector((c.x - a.x, c.y - a.y)).normalized()
    if flat:
        beam(b, mat, a, c, 0.035, 0.09 + s * 0.08, bevel=False)
    else:
        tube(b, mat, a, c, 0.035 + s * 0.02, 6)
    gusset(b, a, d, s)
    gusset(b, c, d, s)

def part_legs(level):
    """
    Four legs under a deck on this level. Each of the five sets is put together differently: the
    section, the bracing, the ties, and what runs up a leg.
    """
    def build(b):
        rng = random.Random(500 + level)
        h = LEVEL1 + STEP * (level - 1)
        s = 0.3 + 0.07 * h
        top, foot = -SLAB, -h
        col = box_column if level in (2, 4) else h_column
        z0 = foot + 0.17
        ties = {1: [], 2: [], 3: [0.5], 4: [0.42], 5: [0.34, 0.67]}[level]
        marked = rng.randrange(4)
        for k, p in enumerate(LEG_AT):
            turn = 0.0                                   # flanges face out from under the deck and in
            footing(b, p, foot, s, 0, bloom=(k == (marked + 2) % 4 or (level >= 4 and k == (marked + 1) % 4)))
            # the lowest stretch of one leg has rusted through its finish
            lowmat = 'legbloom' if k == (marked + 2) % 4 else 'legsteel'
            col(b, p, z0, z0 + 0.5, s, turn, lowmat)
            col(b, p, z0 + 0.5, top - 0.06, s, turn)
            box(b, 'leggalv', (s * 1.5, s * 1.5, 0.06), T(p.x, p.y, top - 0.03))
            if k == marked:
                # a hazard band near the foot, and on the taller sets the level stencilled above it
                bz = z0 + 0.36
                for a in (range(4) if col is box_column else (0, 2)):
                    R = T(p.x, p.y, bz) @ RZ(a * math.pi / 2)
                    k_ = 0.86 if col is box_column else 1.0
                    box(b, 'hazard', (s * k_ * 0.98, 0.012, 0.34), R @ T(0, s * k_ / 2 + 0.004, 0), bevel=False)
                    box(b, 'black', (s * k_ * 0.98, 0.016, 0.07), R @ T(0, s * k_ / 2 + 0.004, 0), bevel=False)
        # the face frames
        for k in range(4):
            p, q = LEG_AT[k], LEG_AT[(k + 1) % 4]
            d = (q - p).normalized()
            pa, qa = p + d * (s / 2), q - d * (s / 2)
            zt = top - 0.34
            # the head tie: an I beam between the legs
            beam(b, 'legsteel', v3(pa, zt), v3(qa, zt), s * 0.5, 0.05)
            beam(b, 'legsteel', v3(pa, zt - s * 0.55), v3(qa, zt - s * 0.55), s * 0.5, 0.05)
            beam(b, 'legsteel', v3(pa, zt - s * 0.275), v3(qa, zt - s * 0.275), 0.05, s * 0.55)
            zb = zt - s * 0.55
            levels = [z0 + 0.25] + [foot + (zb - foot) * f for f in ties] + [zb]
            for f in ties:
                zz = foot + (zb - foot) * f
                beam(b, 'leggalv', v3(pa, zz), v3(qa, zz), 0.09 + s * 0.1, 0.09 + s * 0.1)
            for bay in range(len(levels) - 1):
                lo, hi = levels[bay] + 0.08, levels[bay + 1] - 0.08
                if level == 1:
                    # knee braces: the bay is too low for anything else
                    for a_, c_ in ((pa, pa + d * 1.0), (qa, qa - d * 1.0)):
                        brace(b, v3(a_, lo + 0.1), v3(c_, hi), s)
                elif level == 2:
                    if k % 2 == 0:
                        brace(b, v3(pa, lo), v3(qa, hi), s, flat=False)
                    else:
                        m = (pa + qa) / 2
                        brace(b, v3(pa, lo), v3(m, hi), s)
                        brace(b, v3(qa, lo), v3(m, hi), s)
                elif level == 3:
                    if k % 2 == 0:
                        brace(b, v3(pa, lo), v3(qa, hi), s)
                        brace(b, v3(qa, lo), v3(pa, hi), s)
                    elif bay == 1:
                        brace(b, v3(pa, lo), v3(qa, hi), s, flat=False)
                elif level == 4:
                    if bay == 0:
                        brace(b, v3(pa if k % 2 else qa, lo), v3(qa if k % 2 else pa, hi), s, flat=False)
                    elif k % 2 == 1:
                        brace(b, v3(pa, lo), v3(qa, hi), s)
                        brace(b, v3(qa, lo), v3(pa, hi), s)
                    else:
                        m = (pa + qa) / 2
                        brace(b, v3(m, lo), v3(pa, hi), s)
                        brace(b, v3(m, lo), v3(qa, hi), s)
                else:
                    flip = (bay + k) % 2
                    brace(b, v3(qa if flip else pa, lo), v3(pa if flip else qa, hi), s, flat=(k % 2 == 0))
        # what runs up a leg
        def inward(k):
            p = LEG_AT[k]
            return p + Vector((-p.x, -p.y)).normalized() * (s * 0.5 + 0.16)
        if level in (2, 4, 5):
            k = (marked + 1) % 4
            r = inward(k)
            tube(b, 'leggalv', v3(r, z0 + 0.3), v3(r, top - 0.1), 0.075, 8)
            for f in (0.15, 0.5, 0.85):
                zz = z0 + (top - z0) * f
                box(b, 'legsteel', (0.24, 0.24, 0.05), T(r.x, r.y, zz))
                beam(b, 'legsteel', v3(r, zz), v3(LEG_AT[k], zz), 0.05, 0.04)
            o = Vector((-LEG_AT[k].x, 0)).normalized()
            tube(b, 'leggalv', v3(r, z0 + 0.3), v3(r + o * 0.9, z0 + 0.3), 0.075, 8)
            cyl(b, 'legsteel', 0.12, 0.05, T(r.x + o.x * 0.9, r.y, z0 + 0.3) @ RY(math.pi / 2 * o.x), 8)
        if level in (1, 4):
            k = (marked + 3) % 4
            p = LEG_AT[k]
            o = Vector((0, -p.y)).normalized()
            for i_, dx in enumerate((-0.07, 0.0, 0.07)):
                c = p + o * (s * 0.5 + 0.03) + Vector((dx, 0))
                tube(b, 'black', v3(c, z0 + 0.1), v3(c, top - 0.08), 0.018, 5)
            for f in (0.2, 0.5, 0.8):
                c = p + o * (s * 0.5 + 0.035)
                box(b, 'leggalv', (0.24, 0.05, 0.04), T(c.x, c.y, z0 + (top - z0) * f))
            c = p + o * (s * 0.5 + 0.07)
            box(b, 'black', (0.3, 0.12, 0.36), T(c.x, c.y, z0 + 0.75))
        if level in (3, 5):
            k = (marked + 3) % 4
            p = LEG_AT[k]
            o = Vector((0, -p.y)).normalized()
            c = p + o * (s * 0.5 + 0.12)
            ladder(b, v3(c, foot + 0.1), v3(c, top - 0.7), 0.4)
            for f in (0.3, 0.7):
                zz = foot + (top - foot) * f
                beam(b, 'leggalv', v3(c, zz), v3(p, zz), 0.44, 0.03)
        if level >= 3:
            p = LEG_AT[marked]
            o = Vector((0, p.y)).normalized()             # the face that looks out from under the deck
            k_ = 0.86 if col is box_column else 1.0
            F = Matrix(((-o.y, 0, 0, p.x), (0, 0, o.y, p.y + o.y * (s * k_ / 2 + 0.004)), (0, 1, 0, z0 + 1.0), (0, 0, 0, 1)))
            stencil(b, str(level), F, h=min(0.5, s * 0.8), t=0.008)
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

# ---------------------------------------------------------------------- signs
def glyph(b, mat, kind, M, s, t=0.13):
    """One abstract mark in M's XZ plane, s across, as bars that show on both faces of a board t thick or less."""
    k = s * 0.16
    def bar(x, z, w, h, turn=0.0):
        box(b, mat, (w, t, h), M @ T(x, 0, z) @ RY(turn), bevel=False)
    if kind == 'square':
        for e in (-1, 1):
            bar(0, e * (s - k) / 2, s, k); bar(e * (s - k) / 2, 0, k, s)
    elif kind == 'bars':
        for z, w in ((s * 0.34, s), (0, s * 0.6), (-s * 0.34, s * 0.8)):
            bar((w - s) / 2, z, w, k)
    elif kind == 'chev':
        for e in (-1, 1):
            bar(0, e * s * 0.2, s * 0.75, k, e * 0.6)
    elif kind == 'dot':
        bar(0, 0, s * 0.42, s * 0.42)
    elif kind == 'cross':
        bar(0, 0, s, k); bar(0, 0, k, s)
    elif kind == 'tee':
        bar(0, (s - k) / 2, s, k); bar(0, -k / 2, k, s - k)
    elif kind == 'ell':
        bar(-(s - k) / 2, 0, k, s); bar(0, -(s - k) / 2, s, k)
    elif kind == 'arrow':
        bar(-s * 0.1, 0, s * 0.8, k)
        for e in (-1, 1):
            bar(s * 0.28, e * s * 0.16, s * 0.5, k, e * 0.75)
    elif kind == 'slash':
        bar(0, 0, s * 1.1, k, 0.9)

def _base(b, w=0.42, d=0.34):
    """A base plate with four bolts, to stand on a roof."""
    box(b, 'steel', (w, d, 0.04), T(0, 0, 0.02))
    for x in (-1, 1):
        for y in (-1, 1):
            cyl(b, 'fixing', 0.025, 0.03, T(x * (w / 2 - 0.06), y * (d / 2 - 0.06), 0.04), 5, bevel=False)

def part_sign_strip(color):
    """A tall narrow strip of stacked marks hung off one side of a mast. One mark is out."""
    def build(b):
        _base(b)
        tube(b, 'tube', (0, 0, 0.04), (0, 0, 2.55), 0.04, 6)
        box(b, 'black', (0.2, 0.14, 0.26), T(0, 0.09, 0.42))                       # junction box
        tube(b, 'black', (0.05, 0.07, 0.55), (0.05, 0.07, 2.2), 0.014, 5)          # its cable up the mast
        bx, bw, z0, z1 = 0.34, 0.4, 0.78, 2.5
        box(b, 'black', (bw, 0.07, z1 - z0), T(bx, 0, (z0 + z1) / 2))
        for e in (-1, 1):
            box(b, 'steel', (0.035, 0.1, z1 - z0 + 0.06), T(bx + e * (bw / 2 + 0.01), 0, (z0 + z1) / 2))
        for z in (z0 + 0.12, (z0 + z1) / 2, z1 - 0.12):
            beam(b, 'steel', (0.0, 0, z), (bx - bw / 2, 0, z), 0.05, 0.04)
        marks = ['square', 'chev', 'bars', 'dot', 'tee']
        n = len(marks)
        for i, kind in enumerate(marks):
            z = z1 - (i + 0.5) * (z1 - z0) / n
            glyph(b, 'dim' if i == 3 else color, kind, T(bx, 0, z), 0.24)
        box(b, 'steel', (0.5, 0.12, 0.035), T(bx, 0, z1 + 0.03))
    return build

def part_sign_ring(color):
    """A broken ring of tube on a bracket arm from a short post, with a mark inside it. The lowest stretch is out."""
    def build(b):
        _base(b, 0.38, 0.38)
        box(b, 'steel', (0.09, 0.09, 1.0), T(0, 0, 0.54))
        cx, cz, R = 0.42, 1.5, 0.56
        beam(b, 'steel', (0, 0, 1.0), (cx, 0, cz - R - 0.03), 0.06, 0.06)
        beam(b, 'steel', (0, 0, 0.55), (cx + 0.3, 0, cz - R * 0.85), 0.035, 0.035)
        box(b, 'black', (0.16, 0.12, 0.2), T(-0.02, 0.1, 0.8))
        # a hoop of flat bar behind the tube carries it
        seg = 18
        for i in range(seg):
            a0, a1 = TAU * i / seg, TAU * (i + 1) / seg
            p0 = Vector((cx + math.cos(a0) * R, 0.0, cz + math.sin(a0) * R))
            p1 = Vector((cx + math.cos(a1) * R, 0.0, cz + math.sin(a1) * R))
            beam(b, 'black', p0, p1, 0.05, 0.03, bevel=False)
            deg = math.degrees((a0 + a1) / 2)
            if 20 < deg < 62:
                continue                                                           # the gap in the ring
            mat = 'dim' if 235 < deg < 305 else color
            for y in (-0.045, 0.045):
                tube(b, mat, p0 + Vector((0, y, 0)), p1 + Vector((0, y, 0)), 0.03, 6)
        glyph(b, color, 'arrow', T(cx - 0.02, 0, cz), 0.5, t=0.06)
        for e in (-1, 1):
            beam(b, 'steel', (cx + e * 0.3, 0, cz), (cx + e * (R - 0.03), 0, cz), 0.03, 0.03, bevel=False)
    return build

def part_sign_marquee(color):
    """A wide low board on two posts with a row of marks. One mark is out and one cell is bare, its cable hanging."""
    def build(b):
        w, z0, z1 = 2.0, 0.72, 1.24
        for x in (-0.72, 0.72):
            box(b, 'steel', (0.3, 0.26, 0.035), T(x, 0, 0.018))
            box(b, 'steel', (0.07, 0.07, z1 + 0.1), T(x, 0.07, (z1 + 0.1) / 2 + 0.03))
            beam(b, 'steel', (x, 0.07, 0.12), (x, 0.3, 0.035), 0.03, 0.03, bevel=False)
        box(b, 'black', (w, 0.07, z1 - z0), T(0, 0, (z0 + z1) / 2))
        for z in (z0 - 0.02, z1 + 0.02):
            box(b, 'steel', (w + 0.06, 0.11, 0.04), T(0, 0, z))
        for e in (-1, 1):
            box(b, 'steel', (0.04, 0.11, z1 - z0 + 0.08), T(e * (w / 2 + 0.01), 0, (z0 + z1) / 2))
        marks = ['chev', 'dot', None, 'cross', 'slash', 'square', 'arrow']
        n = len(marks)
        for i, kind in enumerate(marks):
            x = -w / 2 + (i + 0.5) * w / n
            if kind is None:
                # the cell whose mark has gone: four studs and a cable left hanging
                for dx in (-0.08, 0.08):
                    for dz in (-0.1, 0.1):
                        cyl(b, 'fixing', 0.014, 0.1, T(x + dx, 0.05, (z0 + z1) / 2 + dz) @ RX(math.pi / 2), 5, bevel=False)
                tube(b, 'black', (x, -0.05, (z0 + z1) / 2), (x + 0.05, -0.06, z0 - 0.3), 0.012, 5)
                continue
            glyph(b, 'dim' if i == 4 else color, kind, T(x, 0, (z0 + z1) / 2), 0.2)
        # a lit rail along the top, in two lengths with a dead stretch between
        for x0, x1, mat in ((-w / 2 + 0.05, -0.25, color), (-0.2, 0.3, 'dim'), (0.35, w / 2 - 0.05, color)):
            tube(b, mat, (x0, 0, z1 + 0.075), (x1, 0, z1 + 0.075), 0.025, 6)
        box(b, 'black', (0.24, 0.12, 0.16), T(-0.72, 0.16, 0.5))
    return build

def part_sign_cluster(color):
    """A mast with odd panels bolted on at their own angles: two lit, one only its border, one dark."""
    def build(b):
        _base(b, 0.44, 0.44)
        tube(b, 'tube', (0, 0, 0.04), (0, 0, 2.1), 0.045, 6)
        tube(b, 'tube', (0, 0, 0.9), (0.4, 0, 0.04), 0.022, 5)                      # a stay to the roof
        box(b, 'black', (0.18, 0.13, 0.22), T(0, -0.1, 0.5))
        tube(b, 'black', (-0.04, -0.07, 0.6), (-0.04, -0.07, 1.8), 0.013, 5)
        # panel: centre x, z, width, height, yaw, roll, what is on it
        panels = [(0.36, 1.72, 0.78, 0.44, 0.3, 0.05, 'chev', color),
                  (-0.4, 1.36, 0.46, 0.62, -0.42, -0.07, 'tee', color),
                  (0.34, 1.02, 0.52, 0.34, -0.16, 0.12, 'border', color),
                  (-0.3, 0.72, 0.36, 0.36, 0.5, 0.0, 'bars', 'dim')]
        for x, z, w, h, yaw, roll, kind, mat in panels:
            beam(b, 'steel', (0, 0, z), (x * 0.5, 0, z), 0.04, 0.04, bevel=False)
            M = T(x, 0, z) @ RZ(yaw) @ RY(roll)
            box(b, 'black', (w, 0.05, h), M)
            box(b, 'steel', (w + 0.04, 0.03, 0.03), M @ T(0, 0.03, h / 2 - 0.05), bevel=False)
            if kind == 'border':
                for e in (-1, 1):
                    box(b, mat, (w - 0.08, 0.1, 0.03), M @ T(0, 0, e * (h / 2 - 0.05)), bevel=False)
                    box(b, mat, (0.03, 0.1, h - 0.08), M @ T(e * (w / 2 - 0.05), 0, 0), bevel=False)
            else:
                glyph(b, mat, kind, M, min(w, h) * 0.62, t=0.1)
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
    # corners, which way the brushed way runs, the band of the grid it takes, a cross strip, what hangs off each edge
    'deck-a': (part_deck(101, ('balcony', 'plain', 'drop', 'notch', 'step', 'plain'), 0, (-0.9, 0.9), None,
                         ([('conduit', 1)], [], [('catwalk', -1)], [], [('bracket', 1)], [('box', -1)]), '04', ('chevron', 'number'), 0.07, 0.03), 'used', 1024, 0.0),
    'deck-b': (part_deck(102, ('shelf', 'drop', 'plain', 'balcony', 'plain', 'notch'), 1, (-1.1, 1.1), (-1.0, 1.0),
                         ([], [('box', 1)], [('conduit', -1)], [('bracket', -1)], [], [('catwalk', 1)]), '17', ('lines', 'number'), 0.05, 0.05), 'clean', 1024, 0.0),
    'deck-c': (part_deck(103, ('step', 'notch', 'shelf', 'plain', 'drop', 'drop'), 2, (0.9, 2.7), None,
                         ([('catwalk', 1)], [('conduit', 1)], [], [('box', 1)], [], [('bracket', -1)]), '23', ('band', 'number'), 0.09, 0.04), 'used', 1024, 0.0),
    'deck-d': (part_deck(104, ('drop', 'balcony', 'step', 'plain', 'shelf', 'plain'), 1, (-2.9, -1.1), (-0.9, 0.9),
                         ([('bracket', 1)], [], [('box', -1)], [('catwalk', -1)], [('conduit', 1)], []), '31', ('chevron', 'number'), 0.1, 0.02), 'clean', 1024, 0.0),
    'deck-s1': (part_deck_shaped('deck-s1'), 'used', 1024, 0.0),
    'deck-s2': (part_deck_shaped('deck-s2'), 'clean', 1024, 0.0),
    'deck-s3': (part_deck_shaped('deck-s3'), 'used', 1024, 0.0),
    'deck-m1': (part_deck_shaped('deck-m1'), 'used', 1024, 0.0),
    'deck-m2': (part_deck_shaped('deck-m2'), 'clean', 1024, 0.0),
    'deck-m3': (part_deck_shaped('deck-m3'), 'used', 1024, 0.0),
    'deck-m4': (part_deck_shaped('deck-m4'), 'clean', 1024, 0.0),
    'deck-s4': (part_deck_shaped('deck-s4'), 'clean', 1024, 0.0),
    'deck-s5': (part_deck_shaped('deck-s5'), 'used', 1024, 0.0),
    'deck-s6': (part_deck_shaped('deck-s6'), 'used', 1024, 0.0),
    'deck-m5': (part_deck_shaped('deck-m5'), 'used', 1024, 0.0),
    'deck-m6': (part_deck_shaped('deck-m6'), 'clean', 1024, 0.0),
    'deck-m7': (part_deck_shaped('deck-m7'), 'used', 1024, 0.0),
    'deck-m8': (part_deck_shaped('deck-m8'), 'clean', 1024, 0.0),
    'deck-m9': (part_deck_shaped('deck-m9'), 'used', 1024, 0.0),
    'deck-m10': (part_deck_shaped('deck-m10'), 'clean', 1024, 0.0),
    'deck-m11': (part_deck_shaped('deck-m11'), 'used', 1024, 0.0),
    'deck-l1': (part_deck_shaped('deck-l1'), 'used', 1024, 0.0),
    'deck-l2': (part_deck_shaped('deck-l2'), 'clean', 1024, 0.0),
    'deck-l3': (part_deck_shaped('deck-l3'), 'used', 1024, 0.0),
    'post-1': (part_post(1), 'legs', 512, 0.0),
    'post-2': (part_post(2), 'legs', 512, 0.0),
    'post-3': (part_post(3), 'legs', 512, 0.0),
    'post-4': (part_post(4), 'legs', 512, 0.0),
    'post-5': (part_post(5), 'legs', 512, 0.0),
    'port-gate': (part_port_gate, 'plain', 512, 0.0),
    'legs-1': (part_legs(1), 'legs', 1024, 0.0),
    'legs-2': (part_legs(2), 'legs', 1024, 0.0),
    'legs-3': (part_legs(3), 'legs', 1024, 0.0),
    'legs-4': (part_legs(4), 'legs', 1024, 0.0),
    'legs-5': (part_legs(5), 'legs', 1024, 0.0),
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
    'sign-a': (part_sign_strip('cyan'), 'plain', 512, 0.0),
    'sign-b': (part_sign_ring('cyan'), 'plain', 512, 0.0),
    'sign-c': (part_sign_marquee('magenta'), 'plain', 512, 0.0),
    'sign-d': (part_sign_cluster('magenta'), 'plain', 512, 0.0),
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
    if any(name in SHAPED_DECKS for name in out):
        out['deck-shapes.json'] = write_deck_shapes()
    return out

SCENE_NAME = 'NX_Settlement'
ONLY = globals().get('ONLY')
result = build(ONLY)
