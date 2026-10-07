"""
Model the node core, the first of the campus's own buildings. Run inside Blender with
nodexeus-buildings.blend open (it carries the `NX_*` materials the gate was made with):

    exec(open("/path/to/design/campus/build_core.py").read())

A node core is what a workspace is built round: a lit column of machinery inside a shroud of
blackened plate, braced to a hexagonal plinth by three buttresses. Everything is measured in
metres with the ground at z = 0, and the whole of it fits inside a circle 1.6 across from the
middle, which is the room a building gets on a campus deck.

The parts are grouped by material into a handful of objects in the `NX_Core` collection, so
they can be baked to one atlas the way the gate is.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

COLLECTION = "NX_Core"
TAU = math.pi * 2

collection = bpy.data.collections.get(COLLECTION) or bpy.data.collections.new(COLLECTION)
if collection.name not in [c.name for c in bpy.context.scene.collection.children]:
    bpy.context.scene.collection.children.link(collection)
for old in list(collection.objects):
    bpy.data.objects.remove(old, do_unlink=True)

groups = {}


def group(name):
    return groups.setdefault(name, bmesh.new())


def at(angle=0.0, radius=0.0, z=0.0, tilt=0.0, turn=0.0):
    """Out from the middle along `angle`, then up; `tilt` leans it inward about its own side."""
    return (
        Matrix.Rotation(angle, 4, "Z")
        @ Matrix.Translation((radius, 0, z))
        @ Matrix.Rotation(turn, 4, "Z")
        @ Matrix.Rotation(tilt, 4, "Y")
    )


def box(bm, sx, sy, sz, matrix):
    verts = bmesh.ops.create_cube(bm, size=1.0)["verts"]
    bmesh.ops.transform(bm, matrix=matrix @ Matrix.Diagonal((sx, sy, sz, 1.0)), verts=verts)


def prism(bm, sides, r0, r1, z0, z1, matrix=Matrix.Identity(4)):
    verts = bmesh.ops.create_cone(
        bm, cap_ends=True, segments=sides, radius1=r0, radius2=r1, depth=z1 - z0
    )["verts"]
    # Blender starts a cone's first corner on +Y; ours start on +X, which is where `at(0)` points.
    quarter = Matrix.Rotation(-math.pi / 2, 4, "Z")
    bmesh.ops.transform(bm, matrix=matrix @ Matrix.Translation((0, 0, (z0 + z1) / 2)) @ quarter, verts=verts)


def plate(bm, profile, thickness, matrix):
    """A flat plate cut to `profile`, given as (out, up) pairs, standing on edge."""
    lower = [bm.verts.new((x, -thickness / 2, z)) for x, z in profile]
    face = bm.faces.new(lower)
    made = bmesh.ops.extrude_face_region(bm, geom=[face])
    upper = [v for v in made["geom"] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, thickness, 0), verts=upper)
    bmesh.ops.transform(bm, matrix=matrix, verts=lower + upper)


CORNERS = [i * TAU / 6 for i in range(6)]            # where the plinth's corners point
FACES = [a + TAU / 12 for a in CORNERS]              # and the middle of each side
BUTTRESSES = CORNERS[0::2]
SERVICES = CORNERS[1::2]

steel = group("Core_Structure")      # NX_Steel_Plate
black = group("Core_Shroud")         # NX_Steel_Black
recess = group("Core_Recess")        # NX_Steel_Recess
light = group("Core_Light")          # NX_Amber_Light
paint = group("Core_Paint")          # NX_Amber_Paint
fixing = group("Core_Fixings")       # NX_Fixing

# ---------- plinth ----------
prism(steel, 6, 1.56, 1.56, 0.0, 0.16)
prism(steel, 6, 1.36, 1.36, 0.16, 0.30)
prism(light, 6, 1.385, 1.385, 0.175, 0.215)          # a line of light under the upper step
prism(recess, 6, 1.20, 1.20, 0.30, 0.312)            # the floor round the core, set dark
for a in FACES:
    # Hazard bars on the lower step, either side of the middle of each side.
    for side in (-1, 1):
        box(paint, 0.07, 0.22, 0.006, at(a, 1.235, 0.163) @ Matrix.Translation((0, side * 0.42, 0)))
    # A tread plate up onto the step.
    box(steel, 0.20, 0.50, 0.05, at(a, 1.27, 0.185))
for a in CORNERS:
    for side in (-1, 1):
        prism(fixing, 6, 0.026, 0.026, 0.16, 0.185, at(a, 1.36) @ Matrix.Translation((0, side * 0.12, 0)))

# ---------- the core and its cage ----------
prism(light, 24, 0.40, 0.40, 0.30, 2.40)
for i in range(8):
    z = 0.66 + i * 0.225
    prism(black, 24, 0.445, 0.445, z, z + 0.055)
for a in [i * TAU / 12 for i in range(12)]:
    box(black, 0.035, 0.05, 1.72, at(a, 0.44, 1.42))

# ---------- collars ----------
prism(steel, 6, 0.95, 0.95, 0.30, 0.50)
prism(black, 6, 0.90, 0.90, 0.50, 0.58)
prism(black, 6, 0.90, 0.90, 2.18, 2.26)
prism(light, 6, 0.925, 0.925, 2.262, 2.296)          # a line of light under the cap
prism(steel, 6, 0.95, 0.95, 2.30, 2.44)

# ---------- shroud: one armoured panel a side, the core showing between them ----------
for a in FACES:
    box(black, 0.09, 0.64, 1.60, at(a, 0.775, 1.38))
    # Louvres over the upper half.
    box(recess, 0.02, 0.50, 0.62, at(a, 0.823, 1.78))
    for i in range(6):
        box(steel, 0.05, 0.50, 0.028, at(a, 0.842, 1.52 + i * 0.104, tilt=-0.5))
    # An access hatch below, with its status light.
    box(steel, 0.03, 0.46, 0.52, at(a, 0.832, 0.98))
    box(recess, 0.012, 0.36, 0.30, at(a, 0.851, 0.93))
    box(light, 0.014, 0.30, 0.03, at(a, 0.852, 1.165))
    box(steel, 0.03, 0.10, 0.035, at(a, 0.862, 0.80))                    # the handle
    for sy in (-0.19, 0.19):
        for sz in (0.76, 1.20):
            prism(fixing, 6, 0.018, 0.018, 0, 0.018, at(a, 0.847, sz, tilt=math.pi / 2) @ Matrix.Translation((0, sy, 0)))

# ---------- buttresses ----------
SLOPE = (Vector((1.33, 0.62)), Vector((1.00, 2.24)))
run = SLOPE[1] - SLOPE[0]
lean = -math.atan2(-run.x, run.y)   # inward as it rises
middle = (SLOPE[0] + SLOPE[1]) / 2
for a in BUTTRESSES:
    web = [(1.31, 0.30), (1.31, 0.66), (0.99, 2.22), (0.86, 2.22), (0.86, 0.30)]
    plate(black, web, 0.07, at(a))
    # The spar along the outside edge carries the load and the colour.
    box(steel, 0.11, 0.16, run.length + 0.06, at(a, middle.x, middle.y, tilt=lean))
    box(paint, 0.008, 0.07, run.length * 0.62, at(a, middle.x, middle.y, tilt=lean) @ Matrix.Translation((0.059, 0, 0)))
    # The foot it stands on, bolted down.
    box(steel, 0.30, 0.26, 0.34, at(a, 1.20, 0.47))
    box(steel, 0.34, 0.34, 0.05, at(a, 1.19, 0.325))
    for sx in (-0.15, 0.15):
        for sy in (-0.135, 0.135):
            prism(fixing, 6, 0.022, 0.022, 0.35, 0.375, at(a, 1.19) @ Matrix.Translation((sx * 0.87, sy, 0)))
    # A stiffener across the web, and the head where it meets the collar.
    box(steel, 0.30, 0.10, 0.05, at(a, 1.02, 1.30))
    box(steel, 0.22, 0.20, 0.16, at(a, 0.96, 2.20))
    # Lightening holes are read as dark insets either side of the web.
    for side in (-1, 1):
        box(recess, 0.26, 0.012, 0.46, at(a, 1.05, 0.86) @ Matrix.Translation((0, side * 0.036, 0)))
        box(recess, 0.12, 0.012, 0.36, at(a, 0.96, 1.68) @ Matrix.Translation((0, side * 0.036, 0)))

# ---------- services, on the corners between ----------
for i, a in enumerate(SERVICES):
    if i == 0:
        # A terminal: somewhere for whoever works here to stand.
        box(black, 0.30, 0.44, 0.78, at(a, 1.10, 0.69))
        box(steel, 0.34, 0.48, 0.06, at(a, 1.10, 0.33))
        box(steel, 0.20, 0.46, 0.05, at(a, 1.21, 1.06, tilt=0.6))
        box(light, 0.012, 0.34, 0.20, at(a, 1.253, 0.86))
        box(light, 0.012, 0.10, 0.02, at(a, 1.253, 0.66) @ Matrix.Translation((0, -0.12, 0)))
        box(recess, 0.012, 0.34, 0.18, at(a, 1.253, 0.50))
    else:
        # A coolant tank, with its line up to the cap.
        prism(steel, 16, 0.21, 0.21, 0.30, 0.38, at(a, 1.08))
        prism(black, 16, 0.19, 0.19, 0.38, 1.02, at(a, 1.08))
        prism(steel, 16, 0.205, 0.205, 0.62, 0.68, at(a, 1.08))
        prism(paint, 16, 0.193, 0.193, 0.80, 0.90, at(a, 1.08))
        prism(steel, 16, 0.21, 0.13, 1.02, 1.12, at(a, 1.08))
        prism(fixing, 8, 0.07, 0.07, 1.12, 1.18, at(a, 1.08))
    # Lines up the corner to the cap, clipped to the shroud as they go.
    for side in (-1, 1):
        prism(steel, 8, 0.034, 0.034, 0.50, 2.20, at(a, 0.93) @ Matrix.Translation((0, side * 0.07, 0)))
    for z in (0.78, 1.34, 1.90):
        box(fixing, 0.07, 0.24, 0.045, at(a, 0.93, z))

# ---------- cap and crown ----------
prism(black, 6, 0.95, 0.62, 2.44, 2.78)
prism(steel, 6, 0.66, 0.66, 2.78, 2.84)
for a in FACES:
    # Vents let into each face of the cap.
    slope = math.atan2((0.95 - 0.62) * math.cos(math.pi / 6), 2.78 - 2.44)
    box(recess, 0.014, 0.34, 0.22, at(a, 0.688, 2.61, tilt=-slope))
    for i in range(3):
        box(steel, 0.03, 0.36, 0.022, at(a, 0.742 - i * 0.054, 2.553 + i * 0.064, tilt=-slope))
prism(steel, 12, 0.30, 0.26, 2.84, 2.94)
prism(light, 12, 0.24, 0.24, 2.94, 2.975)
prism(steel, 12, 0.27, 0.20, 2.975, 3.04)
prism(steel, 8, 0.045, 0.035, 3.04, 3.52)                                   # the mast
prism(steel, 8, 0.10, 0.10, 3.20, 3.23)
prism(light, 10, 0.055, 0.055, 3.52, 3.60)
prism(fixing, 8, 0.07, 0.03, 3.60, 3.63)
for a, tall in ((0.9, 0.42), (3.3, 0.30)):
    prism(steel, 6, 0.018, 0.012, 3.04, 3.04 + tall, at(a, 0.17))

# ---------- into the scene ----------
SETUP = {
    "Core_Structure": ("NX_Steel_Plate", 0.012),
    "Core_Shroud": ("NX_Steel_Black", 0.014),
    "Core_Recess": ("NX_Steel_Recess", None),
    "Core_Light": ("NX_Amber_Light", None),
    "Core_Paint": ("NX_Amber_Paint", None),
    "Core_Fixings": ("NX_Fixing", None),
}
triangles = 0
for name, bm in groups.items():
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    material, bevel = SETUP[name]
    mesh.materials.append(bpy.data.materials[material])
    made = bpy.data.objects.new(name, mesh)
    collection.objects.link(made)
    if bevel:
        modifier = made.modifiers.new("Bevel", "BEVEL")
        modifier.width = bevel
        # One segment: a chamfer catches the light as well as a round does at this size, for
        # less than half the triangles, and there are dozens of these on screen.
        modifier.segments = 1
        modifier.limit_method = "ANGLE"
        modifier.angle_limit = math.radians(40)
        modifier.harden_normals = True
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    mesh.set_sharp_from_angle(angle=math.radians(40))
    mesh.calc_loop_triangles()
    triangles += len(mesh.loop_triangles)

result = {"objects": sorted(SETUP), "triangles_before_bevel": triangles}
