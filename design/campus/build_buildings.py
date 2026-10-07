"""
Model the campus's own buildings. Run inside Blender with nodexeus-buildings.blend open (it
carries the `NX_*` materials the gate was made with):

    exec(open("/path/to/design/campus/build_buildings.py").read())

or, for some of them only, set `ONLY = ["hall", "mast"]` first.

Ten buildings, one for each kind of thing a thread can put up. They share a language, which is
the gate's: blackened plate over a lighter steel frame, amber light where something is alive
inside, amber paint where a person should watch their step. Each is its own silhouette, so a
workspace can be read from across the campus.

Everything is measured in metres with the ground at z = 0 and the building's middle at the
origin, and every one fits inside a circle 1.6 from the middle, which is the room a building
gets on a campus deck.

Each building lands in its own `NX_<Name>` collection as a handful of objects, one per
material, ready for `bake_model.py`.
"""
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

TAU = math.pi * 2


# ---------- the parts everything is made from ----------
def at(angle=0.0, radius=0.0, z=0.0, tilt=0.0, turn=0.0):
    """Out from the middle along `angle`, then up; `tilt` leans it inward about its own side."""
    return (
        Matrix.Rotation(angle, 4, "Z")
        @ Matrix.Translation((radius, 0, z))
        @ Matrix.Rotation(turn, 4, "Z")
        @ Matrix.Rotation(tilt, 4, "Y")
    )


def xyz(x=0.0, y=0.0, z=0.0, rz=0.0, rx=0.0, ry=0.0):
    """At a point, turned about z, then leaned about y, then about x."""
    return (
        Matrix.Translation((x, y, z))
        @ Matrix.Rotation(rz, 4, "Z")
        @ Matrix.Rotation(ry, 4, "Y")
        @ Matrix.Rotation(rx, 4, "X")
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


def rod(bm, start, end, radius, sides=6):
    """A straight bar from one point to another."""
    start, end = Vector(start), Vector(end)
    run = end - start
    verts = bmesh.ops.create_cone(
        bm, cap_ends=True, segments=sides, radius1=radius, radius2=radius, depth=run.length
    )["verts"]
    turn = Vector((0, 0, 1)).rotation_difference(run.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((start + end) / 2) @ turn, verts=verts)


def polar(angle, radius, z=0.0):
    return Vector((math.cos(angle) * radius, math.sin(angle) * radius, z))


class Parts:
    """One building's geometry, sorted by what it is made of."""

    # group: (material, bevel width)
    GROUPS = {
        "steel": ("NX_Steel_Plate", 0.012),
        "frame": ("NX_Steel_Plate", None),      # bars and tubes: too many edges to chamfer
        "black": ("NX_Steel_Black", 0.014),
        "recess": ("NX_Steel_Recess", None),
        "light": ("NX_Amber_Light", None),
        "paint": ("NX_Amber_Paint", None),
        "fixing": ("NX_Fixing", None),
    }

    def __init__(self):
        for name in self.GROUPS:
            setattr(self, name, bmesh.new())
        # Glass is not baked: the game draws it see-through, with a material of its own. It
        # goes to a collection beside the model's and is exported bare, as `<name>_glass`.
        self.glass = bmesh.new()

    def finish(self, name):
        """Hand the parts to the scene as the `NX_<Name>` collection. Returns the triangle count."""
        title = "NX_" + name.capitalize()
        collection = bpy.data.collections.get(title) or bpy.data.collections.new(title)
        if collection.name not in [c.name for c in bpy.context.scene.collection.children]:
            bpy.context.scene.collection.children.link(collection)
        collection.hide_render = collection.hide_viewport = False
        for old in list(collection.objects):
            bpy.data.objects.remove(old, do_unlink=True)

        triangles = 0
        self._glass(name)
        for group, (material, bevel) in self.GROUPS.items():
            bm = getattr(self, group)
            if not bm.verts:
                bm.free()
                continue
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            mesh = bpy.data.meshes.new(f"{name}_{group}")
            bm.to_mesh(mesh)
            bm.free()
            mesh.materials.append(bpy.data.materials[material])
            made = bpy.data.objects.new(f"{name}_{group}", mesh)
            collection.objects.link(made)
            if bevel:
                modifier = made.modifiers.new("Bevel", "BEVEL")
                modifier.width = bevel
                # One segment: a chamfer catches the light as well as a round does at this
                # size, for less than half the triangles, and there are dozens on screen.
                modifier.segments = 1
                modifier.limit_method = "ANGLE"
                modifier.angle_limit = math.radians(40)
                modifier.harden_normals = True
            for polygon in mesh.polygons:
                polygon.use_smooth = True
            mesh.set_sharp_from_angle(angle=math.radians(40))
            evaluated = made.evaluated_get(bpy.context.evaluated_depsgraph_get())
            counted = evaluated.to_mesh()
            counted.calc_loop_triangles()
            triangles += len(counted.loop_triangles)
            evaluated.to_mesh_clear()
        return triangles


def _glass(self, name):
    title = "NX_" + name.capitalize() + "_Glass"
    existing = bpy.data.collections.get(title)
    if existing:
        for old in list(existing.objects):
            bpy.data.objects.remove(old, do_unlink=True)
    if not self.glass.verts:
        self.glass.free()
        return
    collection = existing or bpy.data.collections.new(title)
    if collection.name not in [c.name for c in bpy.context.scene.collection.children]:
        bpy.context.scene.collection.children.link(collection)
    bmesh.ops.recalc_face_normals(self.glass, faces=self.glass.faces)
    mesh = bpy.data.meshes.new(name + "_glass")
    self.glass.to_mesh(mesh)
    self.glass.free()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    made = bpy.data.objects.new(name + "_glass", mesh)
    collection.objects.link(made)
    collection.hide_render = collection.hide_viewport = False
    bpy.ops.object.select_all(action="DESELECT")
    made.select_set(True)
    bpy.context.view_layer.objects.active = made
    here = os.path.dirname(bpy.data.filepath)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(here, "nodexeus-%s-glass.glb" % name), use_selection=True, export_format="GLB",
        export_apply=True, export_yup=True, export_materials="NONE", export_texcoords=False,
    )
    # Out of the way of the bake, which lights the model with nothing else in the scene.
    collection.hide_render = True


Parts._glass = _glass


def tube(bm, start, end, radius, sides=20):
    """An open sleeve from one point to another: glass has no ends to cap."""
    start, end = Vector(start), Vector(end)
    run = end - start
    verts = bmesh.ops.create_cone(
        bm, cap_ends=False, segments=sides, radius1=radius, radius2=radius, depth=run.length
    )["verts"]
    turn = Vector((0, 0, 1)).rotation_difference(run.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((start + end) / 2) @ turn, verts=verts)


def hex_plinth(p, radius, step=0.2, sides=6):
    """The two-step base most of the set stands on, with a line of light under the upper step."""
    prism(p.steel, sides, radius, radius, 0.0, 0.16)
    prism(p.steel, sides, radius - step, radius - step, 0.16, 0.30)
    prism(p.light, sides, radius - step + 0.025, radius - step + 0.025, 0.175, 0.215)


def dish(p, angle, radius, z, size=0.3, lift=0.25):
    """A dish on a short arm, looking outward and a little up."""
    lean = math.pi / 2 - lift
    prism(p.steel, 12, size * 0.2, size, 0.0, size * 0.42, at(angle, radius, z, tilt=lean))
    prism(p.recess, 12, size * 0.86, size * 0.86, size * 0.42, size * 0.43, at(angle, radius, z, tilt=lean))
    prism(p.frame, 6, 0.014, 0.014, size * 0.42, size * 0.8, at(angle, radius, z, tilt=lean))
    prism(p.light, 6, 0.035, 0.035, size * 0.8, size * 0.88, at(angle, radius, z, tilt=lean))
    rod(p.frame, polar(angle, radius - 0.22, z - 0.05), polar(angle, radius + 0.03, z), 0.03)


def bolts(p, matrix, spots, radius=0.02, height=0.022):
    for x, y in spots:
        prism(p.fixing, 6, radius, radius, 0.0, height, matrix @ Matrix.Translation((x, y, 0)))


# ---------- core: a lit column of machinery inside a shroud of plate ----------
def core(p):
    corners = [i * TAU / 6 for i in range(6)]
    faces = [a + TAU / 12 for a in corners]

    prism(p.steel, 6, 1.56, 1.56, 0.0, 0.16)
    prism(p.steel, 6, 1.36, 1.36, 0.16, 0.30)
    prism(p.light, 6, 1.385, 1.385, 0.175, 0.215)
    prism(p.recess, 6, 1.20, 1.20, 0.30, 0.312)
    for a in faces:
        for side in (-1, 1):
            box(p.paint, 0.07, 0.22, 0.006, at(a, 1.235, 0.163) @ Matrix.Translation((0, side * 0.42, 0)))
        box(p.steel, 0.20, 0.50, 0.05, at(a, 1.27, 0.185))
    for a in corners:
        bolts(p, at(a, 1.36, 0.16), [(0, -0.12), (0, 0.12)], 0.026, 0.025)

    # The core and its cage.
    prism(p.light, 24, 0.40, 0.40, 0.30, 2.40)
    for i in range(8):
        z = 0.66 + i * 0.225
        prism(p.black, 24, 0.445, 0.445, z, z + 0.055)
    for a in [i * TAU / 12 for i in range(12)]:
        box(p.black, 0.035, 0.05, 1.72, at(a, 0.44, 1.42))

    prism(p.steel, 6, 0.95, 0.95, 0.30, 0.50)
    prism(p.black, 6, 0.90, 0.90, 0.50, 0.58)
    prism(p.black, 6, 0.90, 0.90, 2.18, 2.26)
    prism(p.light, 6, 0.925, 0.925, 2.262, 2.296)
    prism(p.steel, 6, 0.95, 0.95, 2.30, 2.44)

    # One armoured panel a side, the core showing between them.
    for a in faces:
        box(p.black, 0.09, 0.64, 1.60, at(a, 0.775, 1.38))
        box(p.recess, 0.02, 0.50, 0.62, at(a, 0.823, 1.78))
        for i in range(6):
            box(p.steel, 0.05, 0.50, 0.028, at(a, 0.842, 1.52 + i * 0.104, tilt=-0.5))
        box(p.steel, 0.03, 0.46, 0.52, at(a, 0.832, 0.98))
        box(p.recess, 0.012, 0.36, 0.30, at(a, 0.851, 0.93))
        box(p.light, 0.014, 0.30, 0.03, at(a, 0.852, 1.165))
        box(p.steel, 0.03, 0.10, 0.035, at(a, 0.862, 0.80))
        for sy in (-0.19, 0.19):
            for sz in (0.76, 1.20):
                bolts(p, at(a, 0.847, sz, tilt=math.pi / 2), [(0, sy)], 0.018, 0.018)

    # Three buttresses.
    foot, head = Vector((1.33, 0.62)), Vector((1.00, 2.24))
    run = head - foot
    lean = -math.atan2(-run.x, run.y)
    middle = (foot + head) / 2
    for a in corners[0::2]:
        plate(p.black, [(1.31, 0.30), (1.31, 0.66), (0.99, 2.22), (0.86, 2.22), (0.86, 0.30)], 0.07, at(a))
        box(p.steel, 0.11, 0.16, run.length + 0.06, at(a, middle.x, middle.y, tilt=lean))
        box(p.paint, 0.008, 0.07, run.length * 0.62, at(a, middle.x, middle.y, tilt=lean) @ Matrix.Translation((0.059, 0, 0)))
        box(p.steel, 0.30, 0.26, 0.34, at(a, 1.20, 0.47))
        box(p.steel, 0.34, 0.34, 0.05, at(a, 1.19, 0.325))
        bolts(p, at(a, 1.19, 0.35), [(sx, sy) for sx in (-0.13, 0.13) for sy in (-0.135, 0.135)], 0.022, 0.025)
        box(p.steel, 0.30, 0.10, 0.05, at(a, 1.02, 1.30))
        box(p.steel, 0.22, 0.20, 0.16, at(a, 0.96, 2.20))
        for side in (-1, 1):
            box(p.recess, 0.26, 0.012, 0.46, at(a, 1.05, 0.86) @ Matrix.Translation((0, side * 0.036, 0)))
            box(p.recess, 0.12, 0.012, 0.36, at(a, 0.96, 1.68) @ Matrix.Translation((0, side * 0.036, 0)))

    # Services on the corners between: a terminal, and two coolant tanks.
    for i, a in enumerate(corners[1::2]):
        if i == 0:
            box(p.black, 0.30, 0.44, 0.78, at(a, 1.10, 0.69))
            box(p.steel, 0.34, 0.48, 0.06, at(a, 1.10, 0.33))
            box(p.steel, 0.20, 0.46, 0.05, at(a, 1.21, 1.06, tilt=0.6))
            box(p.light, 0.012, 0.34, 0.20, at(a, 1.253, 0.86))
            box(p.light, 0.012, 0.10, 0.02, at(a, 1.253, 0.66) @ Matrix.Translation((0, -0.12, 0)))
            box(p.recess, 0.012, 0.34, 0.18, at(a, 1.253, 0.50))
        else:
            prism(p.steel, 16, 0.21, 0.21, 0.30, 0.38, at(a, 1.08))
            prism(p.black, 16, 0.19, 0.19, 0.38, 1.02, at(a, 1.08))
            prism(p.steel, 16, 0.205, 0.205, 0.62, 0.68, at(a, 1.08))
            prism(p.paint, 16, 0.193, 0.193, 0.80, 0.90, at(a, 1.08))
            prism(p.steel, 16, 0.21, 0.13, 1.02, 1.12, at(a, 1.08))
            prism(p.fixing, 8, 0.07, 0.07, 1.12, 1.18, at(a, 1.08))
        for side in (-1, 1):
            prism(p.frame, 8, 0.034, 0.034, 0.50, 2.20, at(a, 0.93) @ Matrix.Translation((0, side * 0.07, 0)))
        for z in (0.78, 1.34, 1.90):
            box(p.fixing, 0.07, 0.24, 0.045, at(a, 0.93, z))

    # Cap and crown.
    prism(p.black, 6, 0.95, 0.62, 2.44, 2.78)
    prism(p.steel, 6, 0.66, 0.66, 2.78, 2.84)
    slope = math.atan2((0.95 - 0.62) * math.cos(math.pi / 6), 2.78 - 2.44)
    for a in faces:
        box(p.recess, 0.014, 0.34, 0.22, at(a, 0.688, 2.61, tilt=-slope))
        for i in range(3):
            box(p.steel, 0.03, 0.36, 0.022, at(a, 0.742 - i * 0.054, 2.553 + i * 0.064, tilt=-slope))
    prism(p.steel, 12, 0.30, 0.26, 2.84, 2.94)
    prism(p.light, 12, 0.24, 0.24, 2.94, 2.975)
    prism(p.steel, 12, 0.27, 0.20, 2.975, 3.04)
    prism(p.frame, 8, 0.045, 0.035, 3.04, 3.52)
    prism(p.frame, 8, 0.10, 0.10, 3.20, 3.23)
    prism(p.light, 10, 0.055, 0.055, 3.52, 3.60)
    prism(p.fixing, 8, 0.07, 0.03, 3.60, 3.63)
    for a, tall in ((0.9, 0.42), (3.3, 0.30)):
        prism(p.frame, 6, 0.018, 0.012, 3.04, 3.04 + tall, at(a, 0.17))


# ---------- hall: a long shed of racks, lit from inside ----------
def hall(p):
    box(p.steel, 2.60, 1.70, 0.14, xyz(z=0.07))
    box(p.steel, 2.40, 1.50, 0.10, xyz(z=0.19))
    box(p.light, 2.44, 1.54, 0.03, xyz(z=0.158))
    box(p.black, 2.20, 1.30, 1.05, xyz(z=0.765))
    # The roof: a shallow hip along the length, on a steel eave.
    box(p.steel, 2.30, 1.40, 0.07, xyz(z=1.32))
    plate(p.black, [(-0.66, 1.355), (0.66, 1.355), (0.66, 1.41), (0.36, 1.62), (-0.36, 1.62), (-0.66, 1.41)], 2.24, xyz(rz=math.pi / 2))
    box(p.light, 1.70, 0.05, 0.03, xyz(z=1.63))
    box(p.steel, 1.80, 0.16, 0.03, xyz(z=1.615))
    for x in (-0.72, 0.0, 0.72):
        box(p.steel, 0.40, 0.46, 0.16, xyz(x, 0, 1.69))
        box(p.recess, 0.32, 0.38, 0.012, xyz(x, 0, 1.772))
        prism(p.frame, 12, 0.13, 0.13, 1.772, 1.80, xyz(x))
        prism(p.fixing, 8, 0.04, 0.04, 1.80, 1.815, xyz(x))

    # Each long side: six ribs, and between them a slot onto the racks.
    ribs = [-1.10 + i * 0.44 for i in range(6)]
    for side in (-1, 1):
        y = side * 0.65
        for x in ribs:
            box(p.steel, 0.07, 0.07, 1.05, xyz(x, y + side * 0.02, 0.765))
            bolts(p, xyz(x, y + side * 0.055, 0.34, rx=-side * math.pi / 2), [(0, 0)], 0.018, 0.016)
            bolts(p, xyz(x, y + side * 0.055, 1.20, rx=-side * math.pi / 2), [(0, 0)], 0.018, 0.016)
        for a, b in zip(ribs, ribs[1:]):
            x = (a + b) / 2
            box(p.recess, 0.31, 0.02, 0.52, xyz(x, y + side * 0.006, 0.88))
            for z in (0.70, 0.82, 0.94, 1.06):
                box(p.light, 0.25, 0.012, 0.034, xyz(x, y + side * 0.018, z))
            for z in (0.40, 0.48):
                box(p.steel, 0.31, 0.04, 0.024, xyz(x, y + side * 0.02, z, rx=side * 0.5))
        box(p.steel, 2.24, 0.05, 0.06, xyz(0, y + side * 0.03, 0.27))
        box(p.paint, 0.9, 0.006, 0.05, xyz(-0.6, y + side * 0.057, 0.27))

    # The door end.
    box(p.steel, 0.06, 0.64, 0.92, xyz(1.12, 0, 0.70))
    box(p.recess, 0.02, 0.50, 0.80, xyz(1.146, 0, 0.66))
    box(p.light, 0.02, 0.50, 0.035, xyz(1.152, 0, 1.085))
    box(p.light, 0.02, 0.05, 0.30, xyz(1.152, 0.20, 0.66))
    box(p.steel, 0.24, 0.72, 0.10, xyz(1.20, 0, 0.29))
    box(p.paint, 0.20, 0.72, 0.006, xyz(1.21, 0, 0.343))
    for sy in (-0.48, 0.48):
        box(p.steel, 0.05, 0.10, 0.16, xyz(1.12, sy, 1.10))
        box(p.light, 0.02, 0.07, 0.04, xyz(1.15, sy, 1.04))
    # The plant end: a wall of louvres, and the lines that feed it.
    box(p.steel, 0.05, 1.00, 0.70, xyz(-1.115, 0, 0.80))
    box(p.recess, 0.02, 0.90, 0.60, xyz(-1.142, 0, 0.80))
    for i in range(6):
        box(p.steel, 0.05, 0.90, 0.028, xyz(-1.155, 0, 0.56 + i * 0.096, ry=0.5))
    for sy in (-0.56, 0.56):
        rod(p.frame, (-1.16, sy, 0.24), (-1.16, sy, 1.30), 0.035, 8)
        box(p.fixing, 0.08, 0.10, 0.04, xyz(-1.15, sy, 0.6))
        box(p.fixing, 0.08, 0.10, 0.04, xyz(-1.15, sy, 1.05))
    rod(p.frame, (1.02, -0.55, 1.36), (1.02, -0.55, 2.05), 0.014)
    rod(p.frame, (0.94, -0.55, 1.36), (0.94, -0.55, 1.80), 0.012)


# ---------- array: a field of panels turned to the sun ----------
def array(p):
    tilt = math.radians(28)
    for y in (-0.62, 0.62):
        box(p.steel, 2.50, 0.12, 0.08, xyz(0, y - 0.30, 0.04))
        box(p.steel, 2.50, 0.12, 0.08, xyz(0, y + 0.30, 0.04))
        # The torque tube the panels turn on, and the legs under it.
        rod(p.frame, (-1.22, y, 0.62), (1.22, y, 0.62), 0.04, 8)
        for x in (-0.80, 0.0, 0.80):
            rod(p.frame, (x, y - 0.30, 0.08), (x, y, 0.62), 0.03)
            rod(p.frame, (x, y + 0.30, 0.08), (x, y, 0.62), 0.03)
            box(p.steel, 0.14, 0.12, 0.10, xyz(x, y, 0.62))
            bolts(p, xyz(x, y - 0.30, 0.08), [(-0.07, 0), (0.07, 0)], 0.02, 0.02)
            bolts(p, xyz(x, y + 0.30, 0.08), [(-0.07, 0), (0.07, 0)], 0.02, 0.02)
        for x in (-0.80, 0.0, 0.80):
            panel = xyz(x, y, 0.70, rx=tilt)
            box(p.steel, 0.76, 0.92, 0.035, panel)
            box(p.recess, 0.70, 0.86, 0.012, panel @ Matrix.Translation((0, 0, 0.02)))
            for gx in (-0.175, 0.0, 0.175):
                box(p.fixing, 0.008, 0.86, 0.006, panel @ Matrix.Translation((gx, 0, 0.027)))
            for gy in (-0.215, 0.0, 0.215):
                box(p.fixing, 0.70, 0.008, 0.006, panel @ Matrix.Translation((0, gy, 0.027)))
            box(p.light, 0.50, 0.018, 0.012, panel @ Matrix.Translation((0, -0.445, 0.02)))
    # The inverter between the rows, and the runs out to each.
    box(p.steel, 0.56, 0.40, 0.06, xyz(-1.0, 0, 0.03))
    box(p.black, 0.48, 0.32, 0.50, xyz(-1.0, 0, 0.31))
    box(p.steel, 0.52, 0.36, 0.04, xyz(-1.0, 0, 0.58))
    box(p.light, 0.012, 0.20, 0.12, xyz(-0.754, 0, 0.40))
    for i in range(4):
        box(p.steel, 0.03, 0.26, 0.02, xyz(-0.752, 0, 0.14 + i * 0.045, ry=-0.5))
    box(p.paint, 0.48, 0.006, 0.07, xyz(-1.0, 0.163, 0.20))
    box(p.paint, 0.48, 0.006, 0.07, xyz(-1.0, -0.163, 0.20))
    box(p.frame, 2.0, 0.07, 0.05, xyz(0.2, 0, 0.025))
    for y in (-0.62, 0.62):
        box(p.frame, 0.07, 0.34, 0.05, xyz(0.6, y * 0.5, 0.025))
    # A mast with the array's beacon.
    rod(p.frame, (1.12, 0, 0), (1.12, 0, 1.30), 0.03, 8)
    box(p.steel, 0.16, 0.16, 0.05, xyz(1.12, 0, 0.025))
    prism(p.light, 8, 0.05, 0.05, 1.30, 1.38, xyz(1.12))
    prism(p.fixing, 8, 0.06, 0.03, 1.38, 1.41, xyz(1.12))


# ---------- mast: a lattice tower carrying the campus's links ----------
def mast(p):
    hex_plinth(p, 1.10)
    legs = [i * TAU / 3 + TAU / 12 for i in range(3)]
    base, top = 0.58, 0.15
    z0, z1 = 0.30, 3.50

    def leg(a, z):
        t = (z - z0) / (z1 - z0)
        return polar(a, base + (top - base) * t, z)

    levels = [z0 + (z1 - z0) * i / 7 for i in range(8)]
    for a in legs:
        rod(p.frame, leg(a, z0), leg(a, z1), 0.04, 8)
        box(p.steel, 0.20, 0.20, 0.08, at(a, base, 0.34))
        bolts(p, at(a, base, 0.38), [(-0.07, -0.07), (0.07, 0.07), (-0.07, 0.07), (0.07, -0.07)], 0.018, 0.02)
    for i, z in enumerate(levels):
        for j in range(3):
            a, b = legs[j], legs[(j + 1) % 3]
            rod(p.frame, leg(a, z), leg(b, z), 0.022)
            if i < len(levels) - 1:
                up = levels[i + 1]
                rod(p.frame, leg(a, z), leg(b, up), 0.016) if i % 2 == 0 else rod(p.frame, leg(b, z), leg(a, up), 0.016)
    # The riser up the middle, lit where it passes each level.
    rod(p.frame, (0, 0, 0.30), (0, 0, 3.50), 0.05, 8)
    for z in levels[1:-1:2]:
        prism(p.light, 8, 0.065, 0.065, z - 0.05, z + 0.05)
    # A working platform two thirds of the way up.
    prism(p.steel, 6, 0.52, 0.52, 2.36, 2.41)
    prism(p.light, 6, 0.50, 0.50, 2.335, 2.36)
    for i in range(6):
        a = i * TAU / 6
        rod(p.frame, polar(a, 0.48, 2.41), polar(a, 0.48, 2.66), 0.014)
        rod(p.frame, polar(a, 0.48, 2.66), polar(a + TAU / 6, 0.48, 2.66), 0.014)
    dish(p, legs[0] + 0.5, 0.50, 2.05, 0.30)
    dish(p, legs[1] + 0.4, 0.44, 2.95, 0.24)
    dish(p, legs[2] + 0.7, 0.52, 1.50, 0.26, lift=0.1)
    # The head: a collar, the beacon, and the whips.
    prism(p.steel, 6, 0.22, 0.22, 3.50, 3.58)
    prism(p.light, 8, 0.10, 0.10, 3.58, 3.70)
    prism(p.steel, 8, 0.13, 0.06, 3.70, 3.76)
    rod(p.frame, (0, 0, 3.76), (0, 0, 4.30), 0.016)
    rod(p.frame, (0.12, 0.05, 3.58), (0.12, 0.05, 4.05), 0.012)
    rod(p.frame, (-0.1, -0.09, 3.58), (-0.1, -0.09, 3.92), 0.012)
    # The cabinet at its foot, and the stays.
    cab = legs[0] + TAU / 6
    box(p.black, 0.34, 0.46, 0.66, at(cab, 0.62, 0.63))
    box(p.steel, 0.38, 0.50, 0.05, at(cab, 0.62, 0.325))
    box(p.steel, 0.38, 0.50, 0.04, at(cab, 0.62, 0.975))
    box(p.light, 0.012, 0.30, 0.14, at(cab, 0.793, 0.76))
    box(p.recess, 0.012, 0.34, 0.20, at(cab, 0.793, 0.50))
    for a in legs:
        stay = a + TAU / 6
        box(p.steel, 0.16, 0.16, 0.12, at(stay, 0.98, 0.22))
        rod(p.frame, polar(stay, 0.98, 0.28), leg(a, 2.36) * 0.5 + leg(a + TAU / 3, 2.36) * 0.5, 0.012)
        box(p.paint, 0.10, 0.30, 0.006, at(a, 0.98, 0.163))


# ---------- vault: a drum of plate with one heavy door ----------
def vault(p):
    prism(p.steel, 8, 1.54, 1.54, 0.0, 0.14)
    prism(p.black, 16, 1.15, 1.15, 0.14, 1.50)
    for z0, z1 in ((0.14, 0.26), (0.80, 0.88), (1.40, 1.52)):
        prism(p.steel, 16, 1.185, 1.185, z0, z1)
    prism(p.light, 16, 1.170, 1.170, 1.352, 1.386)
    prism(p.steel, 16, 1.17, 0.74, 1.52, 1.80)
    prism(p.steel, 16, 0.74, 0.70, 1.80, 1.86)
    prism(p.light, 12, 0.36, 0.36, 1.86, 1.885)
    prism(p.black, 12, 0.31, 0.31, 1.86, 1.94)
    prism(p.fixing, 8, 0.13, 0.13, 1.94, 1.97)
    for i in range(4):
        rod(p.frame, polar(i * TAU / 8, -0.2, 1.985), polar(i * TAU / 8, 0.2, 1.985), 0.016)
    for i in range(16):
        a = i * TAU / 16 + TAU / 32
        if abs(math.atan2(math.sin(a), math.cos(a))) < 0.5:
            continue  # the door is here
        box(p.steel, 0.06, 0.09, 1.14, at(a, 1.17, 0.83))
        bolts(p, at(a, 1.20, 0.50, tilt=math.pi / 2), [(0, 0)], 0.018, 0.016)
        bolts(p, at(a, 1.20, 1.14, tilt=math.pi / 2), [(0, 0)], 0.018, 0.016)
    # The door: a round plug in a square frame, haloed.
    box(p.steel, 0.16, 0.96, 1.06, at(0, 1.13, 0.71))
    prism(p.light, 20, 0.44, 0.44, 0.0, 0.02, at(0, 1.205, 0.74, tilt=math.pi / 2))
    prism(p.black, 20, 0.39, 0.39, 0.0, 0.10, at(0, 1.21, 0.74, tilt=math.pi / 2))
    prism(p.steel, 20, 0.30, 0.30, 0.0, 0.03, at(0, 1.31, 0.74, tilt=math.pi / 2))
    prism(p.recess, 20, 0.24, 0.24, 0.0, 0.008, at(0, 1.34, 0.74, tilt=math.pi / 2))
    prism(p.fixing, 8, 0.09, 0.09, 0.0, 0.05, at(0, 1.34, 0.74, tilt=math.pi / 2))
    for i in range(3):
        a = i * TAU / 6
        rod(p.frame, Vector((1.36, 0, 0.74)) + Vector((0, math.cos(a), math.sin(a))) * 0.27,
            Vector((1.36, 0, 0.74)) - Vector((0, math.cos(a), math.sin(a))) * 0.27, 0.018)
    for i in range(8):
        a = i * TAU / 8 + TAU / 16
        bolts(p, at(0, 1.31, 0.74, tilt=math.pi / 2) @ Matrix.Translation((math.sin(a) * 0.345, math.cos(a) * 0.345, 0)), [(0, 0)], 0.02, 0.02)
    box(p.steel, 0.30, 1.00, 0.06, at(0, 1.30, 0.17))
    for side in (-1, 1):
        box(p.paint, 0.006, 0.10, 0.9, at(0, 1.212, 0.71) @ Matrix.Translation((0, side * 0.42, 0)))
    box(p.light, 0.012, 0.30, 0.03, at(0, 1.213, 1.20))
    # A ladder up the back, and the lines beside it.
    for side in (-1, 1):
        rod(p.frame, polar(math.pi, 1.24, 0.14) + Vector((0, side * 0.13, 0)), polar(math.pi, 1.24, 1.66) + Vector((0, side * 0.13, 0)), 0.02)
    for i in range(8):
        z = 0.30 + i * 0.18
        rod(p.frame, polar(math.pi, 1.24, z) + Vector((0, -0.13, 0)), polar(math.pi, 1.24, z) + Vector((0, 0.13, 0)), 0.014)
    for a in (2.2, -2.2):
        rod(p.frame, polar(a, 1.25, 0.14), polar(a, 1.25, 1.46), 0.05, 8)
        box(p.fixing, 0.10, 0.14, 0.05, at(a, 1.22, 0.6))
        box(p.fixing, 0.10, 0.14, 0.05, at(a, 1.22, 1.1))
        box(p.black, 0.24, 0.30, 0.30, at(a, 1.33, 0.29))
        box(p.light, 0.012, 0.16, 0.04, at(a, 1.453, 0.34))


# ---------- dome: plates of dark glass over a ring wall, some of them lit ----------
def dome(p):
    hex_plinth(p, 1.54, 0.18)
    prism(p.black, 12, 1.20, 1.20, 0.30, 0.56)
    prism(p.steel, 12, 1.24, 1.24, 0.50, 0.58)
    prism(p.light, 12, 1.222, 1.222, 0.455, 0.49)

    shell = bmesh.new()
    bmesh.ops.create_icosphere(shell, subdivisions=2, radius=1.14)
    bmesh.ops.delete(shell, geom=[v for v in shell.verts if v.co.z < -0.02], context="VERTS")
    lift = Matrix.Translation((0, 0, 0.58))
    bmesh.ops.transform(shell, matrix=lift, verts=shell.verts)
    pick = random.Random(7)
    for face in shell.faces:
        centre = face.calc_center_median()
        lit = centre.z < 1.25 and pick.random() < 0.34
        target = p.light if lit else p.recess
        target.faces.new([target.verts.new(v.co) for v in face.verts])
    for edge in shell.edges:
        a, b = (v.co * 1.0 for v in edge.verts)
        # Stand the frame a little proud of the glass it holds.
        out = lambda v: Vector((v.x, v.y, v.z - 0.58)) * 1.012 + Vector((0, 0, 0.58))
        rod(p.frame, out(a), out(b), 0.022, 5)
    shell.free()

    prism(p.steel, 8, 0.26, 0.22, 1.70, 1.78)
    prism(p.light, 8, 0.19, 0.19, 1.78, 1.81)
    prism(p.steel, 8, 0.22, 0.10, 1.81, 1.88)
    rod(p.frame, (0, 0, 1.88), (0, 0, 2.20), 0.016)
    # The airlock.
    box(p.black, 0.50, 0.66, 0.66, at(0, 1.22, 0.63))
    box(p.steel, 0.54, 0.72, 0.06, at(0, 1.22, 0.33))
    box(p.steel, 0.54, 0.72, 0.05, at(0, 1.22, 0.985))
    box(p.recess, 0.02, 0.44, 0.52, at(0, 1.474, 0.60))
    box(p.light, 0.02, 0.44, 0.03, at(0, 1.478, 0.89))
    for side in (-1, 1):
        box(p.paint, 0.006, 0.06, 0.52, at(0, 1.473, 0.60) @ Matrix.Translation((0, side * 0.28, 0)))
    # Fins that carry the ring wall, and the plant between them.
    for a in (TAU / 6, TAU / 2, -TAU / 6):
        plate(p.steel, [(1.42, 0.30), (1.42, 0.40), (1.24, 0.78), (1.16, 0.78), (1.16, 0.30)], 0.10, at(a))
        box(p.paint, 0.008, 0.05, 0.30, at(a, 1.337, 0.59, tilt=-math.atan2(0.18, 0.38)))
    for a in (TAU / 3, -TAU / 3):
        prism(p.steel, 14, 0.17, 0.17, 0.30, 0.36, at(a, 1.30))
        prism(p.black, 14, 0.15, 0.15, 0.36, 0.84, at(a, 1.30))
        prism(p.paint, 14, 0.153, 0.153, 0.62, 0.70, at(a, 1.30))
        prism(p.steel, 14, 0.17, 0.10, 0.84, 0.92, at(a, 1.30))
        rod(p.frame, polar(a, 1.30, 0.92), polar(a, 1.16, 1.0), 0.03)


# ---------- spire: three stepped tiers, banded with light ----------
def spire(p):
    hex_plinth(p, 1.14, 0.18)
    faces = [i * TAU / 6 + TAU / 12 for i in range(6)]
    tiers = [(0.30, 1.30, 0.62, 0.56), (1.46, 2.40, 0.50, 0.44), (2.56, 3.30, 0.38, 0.31)]
    for z0, z1, r0, r1 in tiers:
        prism(p.black, 6, r0, r1, z0, z1)
        prism(p.steel, 6, r1 + 0.07, r1 + 0.07, z1, z1 + 0.10)
        prism(p.light, 6, r1 + 0.045, r1 + 0.045, z1 + 0.10, z1 + 0.135)
        prism(p.steel, 6, r0 + 0.05, r0 + 0.05, z0 - 0.04, z0 + 0.06)
        middle = (z0 + z1) / 2
        apothem = (r0 + r1) / 2 * math.cos(math.pi / 6)
        lean = -math.atan2((r0 - r1) * math.cos(math.pi / 6), z1 - z0)
        tall = (z1 - z0) * 0.62
        for a in faces:
            box(p.recess, 0.016, apothem * 0.62, tall, at(a, apothem + 0.004, middle, tilt=lean))
            box(p.light, 0.016, 0.045, tall * 0.86, at(a, apothem + 0.01, middle, tilt=lean))
            for side in (-1, 1):
                box(p.steel, 0.03, 0.03, tall, at(a, apothem + 0.012, middle, tilt=lean) @ Matrix.Translation((0, side * apothem * 0.34, 0)))
    # The crown.
    prism(p.black, 6, 0.36, 0.14, 3.435, 3.80)
    prism(p.steel, 8, 0.15, 0.15, 3.80, 3.86)
    prism(p.light, 8, 0.10, 0.10, 3.86, 3.98)
    prism(p.steel, 8, 0.12, 0.05, 3.98, 4.04)
    rod(p.frame, (0, 0, 4.04), (0, 0, 4.60), 0.016)
    prism(p.frame, 8, 0.07, 0.07, 4.26, 4.28)
    # Fins at the foot, a gallery at the first step, and the links.
    for a in (0, TAU / 3, -TAU / 3):
        plate(p.steel, [(1.00, 0.30), (1.00, 0.44), (0.60, 1.24), (0.52, 1.24), (0.52, 0.30)], 0.09, at(a))
        box(p.paint, 0.008, 0.05, 0.5, at(a, 0.812, 0.83, tilt=-math.atan2(0.40, 0.80)))
        box(p.steel, 0.24, 0.22, 0.10, at(a, 0.92, 0.35))
        bolts(p, at(a, 0.92, 0.40), [(-0.08, -0.07), (0.08, 0.07), (-0.08, 0.07), (0.08, -0.07)], 0.018, 0.02)
    prism(p.steel, 6, 0.80, 0.80, 1.36, 1.40)
    for i in range(6):
        a = i * TAU / 6
        rod(p.frame, polar(a, 0.76, 1.40), polar(a, 0.76, 1.62), 0.014)
        rod(p.frame, polar(a, 0.76, 1.62), polar(a + TAU / 6, 0.76, 1.62), 0.014)
    dish(p, TAU / 6, 0.52, 2.10, 0.24)
    dish(p, -TAU / 2.2, 0.42, 3.0, 0.20)
    # The way in.
    box(p.steel, 0.10, 0.44, 0.66, at(faces[5], 0.56, 0.63))
    box(p.recess, 0.02, 0.32, 0.54, at(faces[5], 0.612, 0.60))
    box(p.light, 0.02, 0.32, 0.03, at(faces[5], 0.616, 0.90))


# ---------- forge: a workshop with its door open on the fire ----------
def forge(p):
    box(p.steel, 2.50, 1.80, 0.14, xyz(z=0.07))
    box(p.light, 1.66, 1.66, 0.03, xyz(-0.40, 0, 0.158))
    box(p.black, 1.50, 1.50, 1.20, xyz(-0.40, 0, 0.74))
    box(p.steel, 1.62, 1.62, 0.08, xyz(-0.40, 0, 1.38))
    # A sawtooth roof, each tooth glazed on its upright.
    for i in range(3):
        x = -1.10 + i * 0.47
        plate(p.black, [(0, 1.42), (0.44, 1.42), (0.44, 1.66)], 1.44, xyz(x))
        box(p.light, 0.016, 1.20, 0.13, xyz(x + 0.446, 0, 1.545))
        box(p.steel, 0.03, 1.44, 0.03, xyz(x + 0.44, 0, 1.665))
    # The door: shutter half up, the work glowing under it.
    box(p.steel, 0.08, 1.16, 1.00, xyz(0.37, 0, 0.64))
    box(p.recess, 0.02, 1.00, 0.88, xyz(0.405, 0, 0.60))
    box(p.light, 0.016, 0.96, 0.44, xyz(0.412, 0, 0.40))
    for i in range(5):
        box(p.steel, 0.04, 1.00, 0.074, xyz(0.425, 0, 0.68 + i * 0.08))
    box(p.paint, 0.01, 1.00, 0.05, xyz(0.447, 0, 0.655))
    for sy in (-0.62, 0.62):
        box(p.steel, 0.06, 0.10, 0.20, xyz(0.38, sy, 1.16))
        box(p.light, 0.02, 0.07, 0.05, xyz(0.415, sy, 1.10))
    # The apron, marked out.
    box(p.recess, 0.82, 1.30, 0.012, xyz(0.82, 0, 0.146))
    for sy in (-0.68, 0.68):
        box(p.paint, 0.82, 0.07, 0.006, xyz(0.82, sy, 0.153))
    box(p.paint, 0.07, 1.43, 0.006, xyz(1.20, 0, 0.153))
    # A gantry over it, with the hoist run out.
    for sy in (-0.80, 0.80):
        box(p.steel, 0.10, 0.10, 1.52, xyz(1.12, sy, 0.90))
        box(p.steel, 0.20, 0.20, 0.05, xyz(1.12, sy, 0.165))
        bolts(p, xyz(1.12, sy, 0.19), [(-0.07, -0.07), (0.07, 0.07), (-0.07, 0.07), (0.07, -0.07)], 0.016, 0.018)
        rod(p.frame, (1.12, sy, 1.20), (1.12, sy * 0.6, 1.62), 0.02)
    box(p.steel, 0.12, 1.72, 0.14, xyz(1.12, 0, 1.69))
    box(p.steel, 0.82, 0.10, 0.10, xyz(0.74, 0.30, 1.69))
    box(p.black, 0.18, 0.24, 0.16, xyz(1.12, 0.30, 1.56))
    box(p.light, 0.10, 0.012, 0.04, xyz(1.12, 0.426, 1.56))
    rod(p.frame, (1.12, 0.30, 1.48), (1.12, 0.30, 0.98), 0.012)
    box(p.fixing, 0.09, 0.09, 0.10, xyz(1.12, 0.30, 0.94))
    # What it is lifting.
    box(p.black, 0.34, 0.34, 0.30, xyz(1.12, 0.30, 0.72))
    box(p.steel, 0.36, 0.05, 0.32, xyz(1.12, 0.30, 0.72))
    box(p.steel, 0.05, 0.36, 0.32, xyz(1.12, 0.30, 0.72))
    box(p.black, 0.30, 0.30, 0.26, xyz(0.86, -0.42, 0.28))
    box(p.paint, 0.304, 0.304, 0.05, xyz(0.86, -0.42, 0.30))
    box(p.black, 0.26, 0.26, 0.22, xyz(0.90, -0.40, 0.52, rz=0.5))
    # The stack.
    prism(p.steel, 12, 0.21, 0.21, 1.42, 1.50, xyz(-0.85, 0.45))
    prism(p.black, 12, 0.17, 0.15, 1.50, 2.36, xyz(-0.85, 0.45))
    prism(p.steel, 12, 0.19, 0.19, 1.90, 1.96, xyz(-0.85, 0.45))
    prism(p.steel, 12, 0.18, 0.18, 2.30, 2.38, xyz(-0.85, 0.45))
    prism(p.light, 12, 0.13, 0.13, 2.38, 2.395, xyz(-0.85, 0.45))
    # Side walls: ribs, a vent, the lines.
    for side in (-1, 1):
        y = side * 0.75
        for x in (-1.10, -0.63, -0.17, 0.30):
            box(p.steel, 0.07, 0.07, 1.20, xyz(x, y + side * 0.02, 0.74))
        box(p.recess, 0.36, 0.02, 0.36, xyz(-0.40, y + side * 0.006, 0.95))
        for i in range(4):
            box(p.steel, 0.36, 0.04, 0.024, xyz(-0.40, y + side * 0.02, 0.82 + i * 0.09, rx=side * 0.5))
        box(p.light, 0.30, 0.012, 0.03, xyz(-0.86, y + side * 0.012, 1.14))
    rod(p.frame, (-1.17, -0.4, 0.14), (-1.17, -0.4, 1.36), 0.04, 8)
    rod(p.frame, (-1.17, -0.25, 0.14), (-1.17, -0.25, 1.36), 0.03, 8)
    box(p.black, 0.10, 0.5, 0.4, xyz(-1.19, 0.3, 0.7))
    box(p.light, 0.012, 0.3, 0.05, xyz(-1.244, 0.3, 0.8))


# ---------- pad: a marked deck with a cargo drone standing on it ----------
def pad(p):
    prism(p.steel, 8, 1.54, 1.54, 0.0, 0.12)
    prism(p.black, 8, 1.44, 1.44, 0.12, 0.20)
    prism(p.light, 8, 1.455, 1.455, 0.135, 0.165)
    prism(p.recess, 8, 1.32, 1.32, 0.20, 0.208)
    # The landing circle and the mark in the middle of it.
    prism(p.light, 32, 1.00, 1.00, 0.208, 0.213)
    prism(p.recess, 32, 0.93, 0.93, 0.213, 0.218)
    prism(p.paint, 6, 0.44, 0.44, 0.218, 0.223)
    prism(p.recess, 6, 0.34, 0.34, 0.223, 0.228)
    for i in range(8):
        corner = i * TAU / 8
        face = corner + TAU / 16
        prism(p.steel, 6, 0.055, 0.055, 0.20, 0.34, at(corner, 1.33))
        prism(p.light, 6, 0.042, 0.042, 0.34, 0.385, at(corner, 1.33))
        box(p.paint, 0.10, 0.44, 0.006, at(face, 1.20, 0.211))
        bolts(p, at(face, 1.36, 0.20), [(0, -0.3), (0, 0.3)], 0.022, 0.02)
    # The drone.
    turn = 0.45
    here = Matrix.Rotation(turn, 4, "Z")
    box(p.black, 0.74, 0.50, 0.20, here @ xyz(z=0.66))
    box(p.steel, 0.50, 0.54, 0.05, here @ xyz(z=0.78))
    box(p.recess, 0.20, 0.36, 0.012, here @ xyz(0.25, 0, 0.80, ry=0.0))
    box(p.steel, 0.20, 0.40, 0.12, here @ xyz(0.40, 0, 0.60, ry=0.5))
    box(p.light, 0.012, 0.30, 0.035, here @ xyz(0.468, 0, 0.60, ry=0.5))
    box(p.light, 0.50, 0.012, 0.03, here @ xyz(0, 0.252, 0.64))
    box(p.light, 0.50, 0.012, 0.03, here @ xyz(0, -0.252, 0.64))
    box(p.paint, 0.20, 0.504, 0.06, here @ xyz(-0.2, 0, 0.66))
    for sx in (-1, 1):
        for sy in (-1, 1):
            hub = here @ Vector((sx * 0.58, sy * 0.52, 0.80))
            rod(p.frame, here @ Vector((sx * 0.30, sy * 0.20, 0.74)), hub, 0.03)
            prism(p.steel, 14, 0.24, 0.24, -0.03, 0.03, Matrix.Translation(hub))
            prism(p.recess, 14, 0.20, 0.20, 0.03, 0.036, Matrix.Translation(hub))
            prism(p.fixing, 8, 0.05, 0.05, 0.036, 0.07, Matrix.Translation(hub))
            rod(p.frame, hub + Vector((-0.18, 0, 0.055)), hub + Vector((0.18, 0, 0.055)), 0.012)
            foot = here @ Vector((sx * 0.36, sy * 0.36, 0.228))
            rod(p.frame, here @ Vector((sx * 0.28, sy * 0.20, 0.58)), foot + Vector((0, 0, 0.03)), 0.022)
            prism(p.steel, 8, 0.06, 0.06, 0.0, 0.03, Matrix.Translation(foot))
    # Cargo slung under it.
    box(p.black, 0.34, 0.30, 0.24, here @ xyz(0, 0, 0.40))
    box(p.steel, 0.36, 0.05, 0.26, here @ xyz(0, 0, 0.40))
    # The marshal's post and the step up.
    post = TAU / 16 * 5
    box(p.black, 0.22, 0.28, 0.56, at(post, 1.22, 0.48))
    box(p.steel, 0.26, 0.32, 0.04, at(post, 1.22, 0.78))
    box(p.light, 0.012, 0.18, 0.10, at(post, 1.107, 0.60))
    rod(p.frame, polar(post, 1.28, 0.80) + Vector((0, 0, 0)), polar(post, 1.28, 1.30), 0.014)
    prism(p.light, 6, 0.03, 0.03, 1.30, 1.36, at(post, 1.28))
    step = -TAU / 16
    box(p.steel, 0.20, 0.60, 0.07, at(step, 1.44, 0.155))
    box(p.paint, 0.16, 0.60, 0.006, at(step, 1.44, 0.193))


# ---------- lab: two storeys, a band of lit glass, instruments on the roof ----------
def lab(p):
    box(p.steel, 2.30, 2.00, 0.14, xyz(z=0.07))
    box(p.light, 1.96, 1.56, 0.03, xyz(z=0.158))
    box(p.black, 1.90, 1.50, 0.86, xyz(z=0.57))
    # The glazed band, mullioned.
    box(p.light, 1.916, 1.516, 0.20, xyz(z=0.70))
    for i in range(9):
        x = -0.92 + i * 0.23
        for sy in (-1, 1):
            box(p.steel, 0.045, 0.03, 0.26, xyz(x, sy * 0.762, 0.70))
    for i in range(7):
        y = -0.72 + i * 0.24
        for sx in (-1, 1):
            box(p.steel, 0.03, 0.045, 0.26, xyz(sx * 0.962, y, 0.70))
    for z in (0.575, 0.825):
        box(p.steel, 1.96, 1.56, 0.035, xyz(z=z))
    box(p.steel, 2.00, 1.60, 0.07, xyz(z=1.035))
    # The upper storey, set back to leave a terrace.
    box(p.black, 1.10, 1.14, 0.70, xyz(-0.36, 0, 1.42))
    box(p.steel, 1.20, 1.24, 0.06, xyz(-0.36, 0, 1.80))
    box(p.light, 1.13, 1.17, 0.03, xyz(-0.36, 0, 1.755))
    box(p.recess, 0.02, 0.80, 0.34, xyz(0.196, 0, 1.44))
    box(p.light, 0.02, 0.72, 0.10, xyz(0.20, 0, 1.50))
    box(p.steel, 0.03, 0.03, 0.34, xyz(0.205, 0, 1.44))
    for sy in (-1, 1):
        box(p.recess, 0.5, 0.02, 0.3, xyz(-0.36, sy * 0.574, 1.44))
        for i in range(4):
            box(p.steel, 0.5, 0.04, 0.022, xyz(-0.36, sy * 0.585, 1.33 + i * 0.075, rx=sy * 0.5))
    # The terrace rail and what stands on it.
    rail = [(0.96, -0.76), (0.96, 0.76), (0.24, 0.76)]
    posts = [(0.96, -0.76), (0.96, -0.25), (0.96, 0.25), (0.96, 0.76), (0.6, 0.76), (0.24, 0.76), (0.6, -0.76), (0.24, -0.76)]
    for x, y in posts:
        rod(p.frame, (x, y, 1.07), (x, y, 1.32), 0.016)
    rod(p.frame, (0.24, -0.76, 1.32), (0.96, -0.76, 1.32), 0.016)
    for a, b in zip(rail, rail[1:]):
        rod(p.frame, (*a, 1.32), (*b, 1.32), 0.016)
    rod(p.frame, (0.62, 0.30, 1.07), (0.62, 0.30, 1.34), 0.03, 8)
    prism(p.steel, 14, 0.06, 0.30, 0.0, 0.13, xyz(0.62, 0.30, 1.34, ry=0.35))
    prism(p.recess, 14, 0.26, 0.26, 0.13, 0.136, xyz(0.62, 0.30, 1.34, ry=0.35))
    prism(p.light, 6, 0.03, 0.03, 0.22, 0.27, xyz(0.62, 0.30, 1.34, ry=0.35))
    rod(p.frame, Vector((0.62, 0.30, 1.34)), xyz(0.62, 0.30, 1.34, ry=0.35) @ Vector((0, 0, 0.24)), 0.012)
    box(p.black, 0.26, 0.30, 0.22, xyz(0.66, -0.40, 1.18))
    box(p.light, 0.012, 0.18, 0.05, xyz(0.792, -0.40, 1.20))
    # Instruments on the upper roof.
    prism(p.steel, 12, 0.26, 0.20, 1.83, 1.93, xyz(-0.50, 0.15))
    prism(p.light, 12, 0.18, 0.18, 1.93, 1.955, xyz(-0.50, 0.15))
    prism(p.black, 12, 0.20, 0.06, 1.955, 2.12, xyz(-0.50, 0.15))
    rod(p.frame, (-0.50, 0.15, 2.12), (-0.50, 0.15, 2.62), 0.016)
    box(p.steel, 0.30, 0.24, 0.14, xyz(-0.10, -0.32, 1.90))
    box(p.recess, 0.24, 0.18, 0.01, xyz(-0.10, -0.32, 1.972))
    rod(p.frame, (-0.78, -0.42, 1.83), (-0.78, -0.42, 2.30), 0.012)
    # The door, a duct up the side, and the tanks.
    box(p.steel, 0.56, 0.06, 0.52, xyz(0.30, -0.762, 0.40))
    box(p.recess, 0.44, 0.02, 0.44, xyz(0.30, -0.790, 0.38))
    box(p.light, 0.44, 0.02, 0.03, xyz(0.30, -0.794, 0.585))
    box(p.steel, 0.60, 0.26, 0.08, xyz(0.30, -0.88, 0.18))
    box(p.paint, 0.60, 0.22, 0.006, xyz(0.30, -0.89, 0.223))
    box(p.black, 0.14, 0.26, 1.50, xyz(-1.02, 0.30, 0.89))
    for z in (0.5, 1.0, 1.5):
        box(p.steel, 0.16, 0.28, 0.04, xyz(-1.02, 0.30, z))
    box(p.steel, 0.30, 0.26, 0.10, xyz(-0.94, 0.30, 1.66))
    for y in (-0.45, -0.12):
        prism(p.steel, 14, 0.15, 0.15, 0.14, 0.20, xyz(-1.03, y))
        prism(p.black, 14, 0.13, 0.13, 0.20, 0.80, xyz(-1.03, y))
        prism(p.paint, 14, 0.133, 0.133, 0.52, 0.60, xyz(-1.03, y))
        prism(p.steel, 14, 0.15, 0.08, 0.80, 0.88, xyz(-1.03, y))


# ---------- library: the campus's reading hall, its roof an open book ----------
def library(p):
    """
    A landmark, not a deck building: seven metres across, standing beside the gate with its
    front on -Y. The roof is two leaves rising from a spine, and the front is shelves, lit
    from behind, between steel fins.
    """
    pick = random.Random(11)
    box(p.steel, 7.60, 5.20, 0.20, xyz(z=0.10))
    box(p.steel, 7.30, 4.90, 0.14, xyz(z=0.27))
    box(p.light, 7.34, 4.94, 0.035, xyz(z=0.218))
    box(p.black, 6.80, 4.40, 2.50, xyz(z=1.59))
    front = -2.20

    # The front: nine fins, shelves between them, the way in through the middle two bays.
    fins = [-3.30 + i * 0.825 for i in range(9)]
    for x in fins:
        box(p.steel, 0.14, 0.24, 2.50, xyz(x, front - 0.07, 1.59))
        bolts(p, xyz(x, front - 0.19, 0.50, rx=math.pi / 2), [(0, 0)], 0.03, 0.02)
        bolts(p, xyz(x, front - 0.19, 2.66, rx=math.pi / 2), [(0, 0)], 0.03, 0.02)
    for i, (a, b) in enumerate(zip(fins, fins[1:])):
        if i in (3, 4):
            continue
        x = (a + b) / 2
        box(p.recess, 0.66, 0.02, 2.10, xyz(x, front - 0.012, 1.66))
        for row in range(5):
            z = 0.74 + row * 0.42
            box(p.steel, 0.66, 0.05, 0.03, xyz(x, front - 0.03, z))
            # Spines: no two the same height, and the odd gap where one is out on loan.
            cursor = -0.28
            while cursor < 0.26:
                wide = pick.choice((0.04, 0.05, 0.07))
                tall = pick.uniform(0.20, 0.33)
                if pick.random() > 0.14:
                    box(p.light, wide, 0.012, tall, xyz(x + cursor + wide / 2, front - 0.024, z + 0.02 + tall / 2))
                cursor += wide + 0.022
    # The portal.
    box(p.steel, 1.80, 0.34, 2.40, xyz(0, front - 0.12, 1.54))
    box(p.recess, 1.36, 0.02, 2.00, xyz(0, front - 0.295, 1.34))
    for sx in (-1, 1):
        box(p.light, 0.07, 0.02, 2.00, xyz(sx * 0.715, front - 0.30, 1.34))
        box(p.steel, 0.60, 0.03, 1.90, xyz(sx * 0.32, front - 0.31, 1.31))
        box(p.recess, 0.40, 0.012, 0.9, xyz(sx * 0.32, front - 0.328, 1.55))
        box(p.light, 0.03, 0.014, 0.50, xyz(sx * 0.06, front - 0.329, 1.25))
    box(p.light, 1.50, 0.02, 0.07, xyz(0, front - 0.30, 2.375))
    box(p.paint, 1.10, 0.01, 0.16, xyz(0, front - 0.295, 2.56))
    box(p.steel, 2.60, 0.60, 0.34, xyz(0, -2.55, 0.17))
    box(p.steel, 2.20, 0.50, 0.20, xyz(0, -2.95, 0.10))
    box(p.paint, 2.20, 0.10, 0.006, xyz(0, -3.14, 0.203))
    # Two steles by the steps, and benches along the front.
    for sx in (-1, 1):
        box(p.steel, 0.56, 0.56, 0.10, xyz(sx * 1.80, -3.0, 0.05))
        box(p.black, 0.42, 0.42, 1.60, xyz(sx * 1.80, -3.0, 0.90))
        box(p.steel, 0.48, 0.48, 0.08, xyz(sx * 1.80, -3.0, 1.74))
        box(p.light, 0.30, 0.30, 0.04, xyz(sx * 1.80, -3.0, 1.80))
        for row in range(5):
            wide = pick.choice((0.16, 0.22, 0.28))
            box(p.light, wide, 0.012, 0.05, xyz(sx * 1.80 - (0.28 - wide) / 2, -3.214, 0.70 + row * 0.18))
        box(p.steel, 1.20, 0.40, 0.30, xyz(sx * 2.85, -2.36, 0.49))
        box(p.paint, 1.20, 0.34, 0.008, xyz(sx * 2.85, -2.36, 0.644))

    # The ends: tall slots.
    for sx in (-1, 1):
        x = sx * 3.40
        for i in range(6):
            y = -1.75 + i * 0.70
            box(p.steel, 0.20, 0.12, 2.50, xyz(x + sx * 0.03, y - 0.35, 1.59))
            box(p.recess, 0.02, 0.36, 1.90, xyz(x + sx * 0.012, y, 1.62))
            box(p.light, 0.012, 0.07, 1.70, xyz(x + sx * 0.022, y, 1.62))
    # The back: plant.
    box(p.steel, 3.00, 0.06, 1.30, xyz(0, 2.225, 1.50))
    box(p.recess, 2.80, 0.02, 1.10, xyz(0, 2.256, 1.50))
    for i in range(8):
        box(p.steel, 2.80, 0.05, 0.035, xyz(0, 2.27, 1.02 + i * 0.137, rx=-0.5))
    for x in (-2.6, -2.2, 2.2, 2.6):
        rod(p.frame, (x, 2.27, 0.34), (x, 2.27, 2.84), 0.06, 8)
        box(p.fixing, 0.16, 0.10, 0.06, xyz(x, 2.25, 1.0))
        box(p.fixing, 0.16, 0.10, 0.06, xyz(x, 2.25, 2.2))

    # The roof: an eave, a spine, and two leaves rising away from it.
    box(p.steel, 7.10, 4.70, 0.10, xyz(z=2.89))
    box(p.steel, 0.36, 4.96, 0.22, xyz(z=3.05))
    box(p.light, 0.14, 4.70, 0.03, xyz(z=3.172))
    rise = math.atan2(0.66, 3.63)
    long = math.hypot(3.63, 0.66)
    for sx in (-1, 1):
        leaf = [(0.14, 2.96), (3.77, 3.62), (3.77, 3.86), (0.14, 3.20)]
        plate(p.black, leaf if sx > 0 else [(-x, z) for x, z in reversed(leaf)], 4.96, xyz())
        # The gable under each leaf, glazed.
        for y in (-2.36, 2.36):
            gable = [(0.20, 2.94), (3.70, 2.94), (3.70, 3.58)]
            plate(p.recess, gable if sx > 0 else [(-x, z) for x, z in reversed(gable)], 0.06, xyz(0, y))
        box(p.light, long * 0.86, 0.02, 0.07, xyz(sx * 2.05, -2.40, 3.17, ry=-sx * rise))
        # The page edge, lit, and the lines of the page.
        box(p.light, 0.07, 4.98, 0.25, xyz(sx * 3.785, 0, 3.74))
        box(p.steel, 0.10, 5.04, 0.30, xyz(sx * 3.84, 0, 3.74))
        for k in (0.28, 0.52, 0.76):
            x = 0.14 + 3.63 * k
            box(p.steel, 0.07, 4.80, 0.05, xyz(sx * x, 0, 3.20 + 0.66 * k + 0.02, ry=-sx * rise))
    # A lantern where the spine meets the front.
    prism(p.steel, 6, 0.30, 0.30, 3.16, 3.26, xyz(0, -2.0))
    prism(p.light, 6, 0.22, 0.22, 3.26, 3.70, xyz(0, -2.0))
    for i in range(6):
        rod(p.frame, polar(i * TAU / 6, 0.25, 3.26) + Vector((0, -2.0, 0)), polar(i * TAU / 6, 0.25, 3.70) + Vector((0, -2.0, 0)), 0.02)
    prism(p.steel, 6, 0.32, 0.12, 3.70, 3.90, xyz(0, -2.0))
    rod(p.frame, (0, -2.0, 3.90), (0, -2.0, 4.60), 0.02)


# ---------- what stands on the foundry floor round the campus ----------
# The floor's own furniture: where another world has trees and boulders, this one has plant.
# Each is drawn at its real size, standing on z = 0, and small enough to be scattered by the
# hundred.
def stack(p):
    """A vent stack: the tallest thing out on the floor, with a ring of light at its mouth."""
    box(p.steel, 1.30, 1.30, 0.14, xyz(z=0.07))
    prism(p.steel, 8, 0.52, 0.46, 0.14, 0.40)
    prism(p.black, 12, 0.36, 0.30, 0.40, 3.40)
    for z in (1.10, 2.10, 3.05):
        prism(p.steel, 12, 0.39 - z * 0.017, 0.39 - z * 0.017, z, z + 0.07)
    prism(p.steel, 12, 0.34, 0.36, 3.40, 3.52)
    prism(p.light, 12, 0.27, 0.27, 3.52, 3.54)
    prism(p.paint, 12, 0.335, 0.33, 2.55, 2.72)
    for side in (-1, 1):
        rod(p.frame, (0.41, side * 0.11, 0.40), (0.36, side * 0.11, 3.0), 0.016)
    for i in range(9):
        z = 0.6 + i * 0.28
        rod(p.frame, (0.405 - z * 0.017, -0.11, z), (0.405 - z * 0.017, 0.11, z), 0.012)
    box(p.black, 0.34, 0.44, 0.54, xyz(-0.42, 0.30, 0.41))
    box(p.light, 0.012, 0.22, 0.08, xyz(-0.596, 0.30, 0.50))
    rod(p.frame, (-0.30, -0.36, 0.14), (-0.30, -0.36, 0.90), 0.045, 8)
    rod(p.frame, (-0.30, -0.36, 0.90), (-0.20, -0.20, 1.20), 0.045, 8)
    bolts(p, xyz(z=0.14), [(sx * 0.55, sy * 0.55) for sx in (-1, 1) for sy in (-1, 1)], 0.03, 0.025)


def pylon(p):
    """A lattice pylon carrying the floor's lines, lamps at the ends of its arms."""
    box(p.steel, 1.00, 1.00, 0.12, xyz(z=0.06))
    legs = [i * TAU / 4 + TAU / 8 for i in range(4)]
    z0, z1, r0, r1 = 0.12, 4.40, 0.52, 0.14

    def leg(a, z):
        return polar(a, r0 + (r1 - r0) * (z - z0) / (z1 - z0), z)

    levels = [z0 + (z1 - z0) * i / 5 for i in range(6)]
    for a in legs:
        rod(p.frame, leg(a, z0), leg(a, z1), 0.035, 6)
        box(p.steel, 0.18, 0.18, 0.06, at(a, r0, 0.15))
    for i, z in enumerate(levels):
        for j in range(4):
            a, b = legs[j], legs[(j + 1) % 4]
            rod(p.frame, leg(a, z), leg(b, z), 0.018, 5)
            if i < len(levels) - 1:
                rod(p.frame, leg(a, z), leg(b, levels[i + 1]), 0.014, 5)
    box(p.steel, 2.20, 0.10, 0.10, xyz(z=3.70))
    box(p.steel, 1.50, 0.08, 0.08, xyz(z=4.25))
    for x, z in ((-1.05, 3.70), (1.05, 3.70), (-0.70, 4.25), (0.70, 4.25)):
        prism(p.fixing, 8, 0.05, 0.05, z - 0.22, z - 0.05, xyz(x))
        prism(p.light, 8, 0.07, 0.07, z - 0.30, z - 0.22, xyz(x))
    prism(p.steel, 6, 0.17, 0.17, 4.40, 4.48)
    prism(p.light, 8, 0.08, 0.08, 4.48, 4.60)
    rod(p.frame, (0, 0, 4.60), (0, 0, 5.10), 0.014)
    box(p.paint, 0.9, 0.9, 0.006, xyz(z=0.123))
    box(p.recess, 0.7, 0.7, 0.006, xyz(z=0.126))


def tanks(p):
    """Three coolant tanks on a skid, piped together."""
    box(p.steel, 2.40, 1.30, 0.12, xyz(z=0.06))
    for i, x in enumerate((-0.78, 0.0, 0.78)):
        tall = (1.50, 1.90, 1.30)[i]
        prism(p.steel, 14, 0.36, 0.36, 0.12, 0.20, xyz(x))
        prism(p.black, 14, 0.33, 0.33, 0.20, tall, xyz(x))
        prism(p.steel, 14, 0.345, 0.345, tall * 0.5, tall * 0.5 + 0.06, xyz(x))
        prism(p.paint, 14, 0.334, 0.334, tall - 0.34, tall - 0.20, xyz(x))
        prism(p.steel, 14, 0.35, 0.18, tall, tall + 0.14, xyz(x))
        prism(p.fixing, 8, 0.09, 0.09, tall + 0.14, tall + 0.20, xyz(x))
        box(p.light, 0.05, 0.012, 0.36, xyz(x, -0.336, 0.62))
    rod(p.frame, (-0.78, 0, 1.70), (-0.78, 0, 2.06), 0.04, 8)
    rod(p.frame, (-0.78, 0, 2.06), (0.78, 0, 2.06), 0.04, 8)
    rod(p.frame, (0.78, 0, 2.06), (0.78, 0, 1.50), 0.04, 8)
    rod(p.frame, (0, 0, 2.10), (0, 0, 2.06), 0.05, 8)
    rod(p.frame, (-1.10, 0.48, 0.12), (-1.10, 0.48, 0.80), 0.05, 8)
    rod(p.frame, (-1.10, 0.48, 0.80), (-0.90, 0.25, 0.80), 0.05, 8)
    box(p.black, 0.30, 0.24, 0.50, xyz(1.0, 0.48, 0.37))
    box(p.light, 0.20, 0.012, 0.08, xyz(1.0, 0.602, 0.46))


def manifold(p):
    """A run of pipe on stands, with a valve and its handwheel."""
    for x in (-1.5, 0.0, 1.5):
        box(p.steel, 0.30, 0.90, 0.08, xyz(x, 0, 0.04))
        box(p.steel, 0.12, 0.70, 0.62, xyz(x, 0, 0.39))
        box(p.steel, 0.16, 0.80, 0.06, xyz(x, 0, 0.72))
    for y, r in ((-0.22, 0.14), (0.14, 0.10), (0.34, 0.06)):
        rod(p.black if r > 0.12 else p.frame, (-1.85, y, 0.75 + r), (1.85, y, 0.75 + r), r, 10)
        for x in (-1.85, 1.85):
            prism(p.steel, 10, r + 0.04, r + 0.04, -0.03, 0.03, xyz(x, y, 0.75 + r, ry=math.pi / 2))
    prism(p.steel, 10, 0.19, 0.19, -0.14, 0.14, xyz(0.7, -0.22, 0.89, ry=math.pi / 2))
    prism(p.paint, 10, 0.145, 0.145, -0.25, 0.25, xyz(-0.8, -0.22, 0.89, ry=math.pi / 2))
    rod(p.frame, (0.7, -0.22, 1.08), (0.7, -0.22, 1.34), 0.025)
    prism(p.fixing, 10, 0.15, 0.15, 1.34, 1.37, xyz(0.7, -0.22))
    prism(p.recess, 10, 0.11, 0.11, 1.37, 1.375, xyz(0.7, -0.22))
    box(p.light, 0.40, 0.012, 0.04, xyz(0, -0.356, 0.50))
    box(p.light, 0.40, 0.012, 0.04, xyz(0, 0.356, 0.50))


def beacon(p):
    """A floor light: a short post, lit on top."""
    prism(p.steel, 8, 0.26, 0.22, 0.0, 0.10)
    prism(p.black, 8, 0.11, 0.09, 0.10, 0.95)
    prism(p.steel, 8, 0.13, 0.13, 0.95, 1.01)
    prism(p.light, 8, 0.10, 0.10, 1.01, 1.17)
    for i in range(4):
        rod(p.frame, polar(i * TAU / 4, 0.115, 1.01), polar(i * TAU / 4, 0.115, 1.17), 0.012)
    prism(p.steel, 8, 0.15, 0.06, 1.17, 1.25)
    prism(p.paint, 8, 0.108, 0.104, 0.40, 0.52)


def cabinet(p):
    """A junction cabinet, where a conduit comes up out of the floor."""
    box(p.steel, 1.30, 0.80, 0.10, xyz(z=0.05))
    box(p.black, 1.10, 0.60, 1.10, xyz(z=0.65))
    box(p.steel, 1.18, 0.68, 0.06, xyz(z=1.23))
    for x in (-0.28, 0.28):
        box(p.steel, 0.50, 0.03, 0.92, xyz(x, -0.31, 0.66))
        box(p.recess, 0.38, 0.012, 0.30, xyz(x, -0.328, 0.42))
        box(p.light, 0.30, 0.012, 0.045, xyz(x, -0.33, 0.98))
        for i in range(4):
            box(p.steel, 0.38, 0.03, 0.02, xyz(x, -0.335, 0.66 + i * 0.06, rx=-0.5))
    box(p.light, 0.05, 0.05, 0.05, xyz(0.48, -0.26, 1.285))
    rod(p.frame, (-0.66, 0.1, 0.10), (-0.66, 0.1, 0.80), 0.05, 8)
    rod(p.frame, (-0.66, 0.1, 0.80), (-0.55, 0.1, 0.80), 0.05, 8)
    rod(p.frame, (0.40, 0.2, 1.26), (0.40, 0.2, 1.90), 0.014)
    box(p.paint, 1.30, 0.10, 0.006, xyz(0, -0.45, 0.103))


# ---------- the coolant line ----------
PIPE_HEIGHT = 1.60      # the middle of the line above the floor
PIPE_GLASS = 0.80       # the sleeve's radius


def cradle(p):
    """
    One cradle of the coolant line, the line running along x through the collar at its head.
    The glass and the coolant are not here: the game sweeps those along the line's own curve,
    and stands one of these under it every few metres.
    """
    h = PIPE_HEIGHT
    # The collar the sleeve passes through, banded and bolted.
    prism(p.black, 16, 0.88, 0.88, -0.13, 0.13, xyz(0, 0, h, ry=math.pi / 2))
    prism(p.steel, 16, 0.92, 0.92, -0.04, 0.04, xyz(0, 0, h, ry=math.pi / 2))
    for k in range(8):
        a = k * TAU / 8 + TAU / 16
        for side in (-1, 1):
            prism(p.fixing, 6, 0.035, 0.035, 0.13, 0.16, xyz(0, math.cos(a) * 0.80, h + math.sin(a) * 0.80, ry=side * math.pi / 2))
    # A footing, two legs, a saddle.
    box(p.steel, 0.70, 2.30, 0.12, xyz(0, 0, 0.06))
    box(p.paint, 0.70, 0.16, 0.006, xyz(0, -1.05, 0.123))
    box(p.paint, 0.70, 0.16, 0.006, xyz(0, 1.05, 0.123))
    for side in (-1, 1):
        plate(p.steel, [(0.60, 0.12), (0.95, 0.12), (0.95, 0.30), (0.84, 1.50), (0.60, 1.10)], 0.16,
              Matrix.Rotation(side * math.pi / 2, 4, "Z"))
        bolts(p, xyz(0, side * 0.95, 0.12), [(-0.2, 0), (0.2, 0)], 0.035, 0.03)
    box(p.steel, 0.24, 1.40, 0.14, xyz(0, 0, 0.74))
    box(p.black, 0.20, 0.80, 0.10, xyz(0, 0, 0.84))
    # A gauge, and the line down to it.
    box(p.black, 0.30, 0.20, 0.40, xyz(0, -1.02, 0.55))
    box(p.light, 0.16, 0.012, 0.16, xyz(0, -1.126, 0.58))
    rod(p.frame, (0, -0.95, 0.75), (0, -0.78, 1.30), 0.03)


def pump(p):
    """A pump house, where lines meet: a port on each side, whichever of them are used."""
    h = PIPE_HEIGHT
    box(p.steel, 4.00, 4.00, 0.16, xyz(z=0.08))
    box(p.light, 3.44, 3.44, 0.04, xyz(z=0.18))
    box(p.black, 3.30, 3.30, 2.70, xyz(z=1.55))
    box(p.steel, 3.50, 3.50, 0.14, xyz(z=2.97))
    for i in range(4):
        a = i * TAU / 4
        # The port, ringed in light, and a sight glass over it.
        prism(p.steel, 16, 1.02, 1.02, 0.0, 0.34, at(a, 1.65, h, tilt=math.pi / 2))
        prism(p.light, 16, 0.90, 0.90, 0.34, 0.36, at(a, 1.65, h, tilt=math.pi / 2))
        prism(p.black, 16, 0.84, 0.84, 0.34, 0.40, at(a, 1.65, h, tilt=math.pi / 2))
        box(p.recess, 0.02, 1.30, 0.26, at(a, 1.662, 2.60))
        box(p.light, 0.02, 1.10, 0.10, at(a, 1.668, 2.60))
        for side in (-1, 1):
            box(p.steel, 0.14, 0.20, 2.70, at(a, 1.66, 1.55) @ Matrix.Translation((0, side * 1.45, 0)))
            box(p.paint, 0.008, 0.10, 0.90, at(a, 1.735, 0.75) @ Matrix.Translation((0, side * 1.45, 0)))
    # The plant on the roof.
    prism(p.steel, 12, 0.90, 0.80, 3.04, 3.34)
    prism(p.recess, 12, 0.72, 0.72, 3.34, 3.35)
    for i in range(6):
        rod(p.frame, polar(i * TAU / 6, 0.72, 3.37), polar(i * TAU / 6 + math.pi, 0.72, 3.37), 0.025)
    prism(p.fixing, 8, 0.14, 0.14, 3.35, 3.42)
    for sx, sy in ((1.15, 1.15), (-1.15, -1.15)):
        prism(p.black, 10, 0.24, 0.20, 3.04, 4.30, xyz(sx, sy))
        prism(p.steel, 10, 0.26, 0.26, 3.60, 3.67, xyz(sx, sy))
        prism(p.light, 10, 0.17, 0.17, 4.30, 4.32, xyz(sx, sy))
    box(p.black, 0.9, 0.6, 0.5, xyz(-1.0, 1.1, 3.29))
    box(p.light, 0.5, 0.012, 0.10, xyz(-1.0, 0.794, 3.32))
    rod(p.frame, (1.2, -1.2, 3.04), (1.2, -1.2, 4.9), 0.03)
    prism(p.light, 8, 0.06, 0.06, 4.9, 5.0, xyz(1.2, -1.2))


def sphere(bm, radius, matrix, around=18, up=10):
    verts = bmesh.ops.create_uvsphere(bm, u_segments=around, v_segments=up, radius=radius)["verts"]
    bmesh.ops.transform(bm, matrix=matrix, verts=verts)


def joint(p):
    """
    A coupling, where the line turns: a ball of plate the lengths either side plug into, on a
    pedestal. Round, so a length can meet it from any side, which is what lets the line bend
    by whatever angle the campus it runs round needs.
    """
    h = PIPE_HEIGHT
    prism(p.steel, 8, 1.25, 1.25, 0.0, 0.14)
    prism(p.light, 8, 1.05, 1.05, 0.14, 0.17)
    prism(p.steel, 8, 0.95, 0.70, 0.14, 0.50)
    prism(p.black, 12, 0.55, 0.62, 0.50, h - 0.75)
    sphere(p.black, 1.16, xyz(z=h))
    # A belt round its middle, lit, and a cap with the valve on top.
    prism(p.steel, 20, 1.185, 1.185, h - 0.10, h + 0.10)
    prism(p.light, 20, 1.20, 1.20, h - 0.025, h + 0.025)
    prism(p.steel, 12, 0.62, 0.46, h + 0.98, h + 1.20)
    prism(p.paint, 12, 0.47, 0.47, h + 1.20, h + 1.215)
    rod(p.frame, (0, 0, h + 1.20), (0, 0, h + 1.50), 0.05, 8)
    prism(p.fixing, 12, 0.30, 0.30, h + 1.50, h + 1.54)
    for i in range(3):
        rod(p.frame, polar(i * TAU / 3, 0.0, h + 1.52), polar(i * TAU / 3, 0.30, h + 1.52), 0.025)
    for i in range(8):
        bolts(p, at(i * TAU / 8, 1.10, 0.14), [(0, 0)], 0.04, 0.03)
    for i in range(4):
        box(p.light, 0.02, 0.24, 0.07, at(i * TAU / 4 + TAU / 8, 0.60, 0.95))


PIPELINE = {"cradle": cradle, "pump": pump, "joint": joint}

PROPS = {"stack": stack, "pylon": pylon, "tanks": tanks, "manifold": manifold, "beacon": beacon, "cabinet": cabinet}

BUILDINGS = {
    "core": core, "hall": hall, "array": array, "mast": mast, "vault": vault,
    "dome": dome, "spire": spire, "forge": forge, "pad": pad, "lab": lab,    # Not a deck building: the landmark beside the gate.
    "library": library,
    **PROPS,
    **PIPELINE,
}

built = {}
for name, make in BUILDINGS.items():
    if globals().get("ONLY") and name not in ONLY:
        continue
    parts = Parts()
    make(parts)
    triangles = parts.finish(name)
    reach = 0.0
    top = 0.0
    for made in bpy.data.collections["NX_" + name.capitalize()].objects:
        for v in made.data.vertices:
            reach = max(reach, math.hypot(v.co.x, v.co.y))
            top = max(top, v.co.z)
    built[name] = {"triangles": triangles, "reach": round(reach, 3), "height": round(top, 2)}

result = built
