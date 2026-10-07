"""
Model the campus's maintenance drone. Run inside Blender with nodexeus-buildings.blend open:

    exec(open("/path/to/design/campus/build_drone.py").read())

The drone is not baked like the buildings. The game draws every drone in one instanced call
with its own shader, which spins the rotors, folds the crate away when a drone flies empty,
and colours each part from a flag. So this exports bare geometry, one object per role, and
the game reads the role off the object's name:

    hull            takes the drone's own colour
    dark, amber     the two fixed colours
    lamp            lit
    rotor0..rotor3  spun about their own middle; `rotor_amber0..3` likewise, in amber
    cable, crate, crate_amber   folded into the hull when there is nothing to carry

About a metre across the rotors, front on -Y, with the hull's middle at the origin.
Writes nodexeus-drone.glb next to this file.
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(bpy.data.filepath)
tools = {"ONLY": ["nothing"]}
exec(open(os.path.join(HERE, "build_buildings.py")).read(), tools)
box, prism, rod, xyz, at, polar = (tools[k] for k in ("box", "prism", "rod", "xyz", "at", "polar"))
TAU = math.pi * 2

roles = {}


def role(name):
    return roles.setdefault(name, bmesh.new())


hull, dark, amber, lamp = role("hull"), role("dark"), role("amber"), role("lamp")

# The body: a flattened hexagon, belted in amber, with a plated back.
prism(hull, 6, 0.27, 0.27, -0.075, 0.075)
prism(hull, 6, 0.27, 0.19, 0.075, 0.115)
prism(hull, 6, 0.27, 0.20, -0.115, -0.075)
prism(amber, 6, 0.276, 0.276, -0.012, 0.012)
prism(dark, 6, 0.17, 0.12, 0.115, 0.150)
prism(dark, 6, 0.18, 0.18, -0.135, -0.115)
# The eye, and the brow over it.
box(lamp, 0.20, 0.02, 0.045, xyz(0, -0.238, 0.0))
box(dark, 0.26, 0.05, 0.02, xyz(0, -0.235, 0.045))
box(dark, 0.26, 0.05, 0.02, xyz(0, -0.235, -0.045))
# Tail light and aerial.
box(lamp, 0.07, 0.02, 0.03, xyz(0, 0.238, 0.02))
rod(dark, (0.06, 0.12, 0.15), (0.06, 0.16, 0.36), 0.008)
prism(lamp, 6, 0.016, 0.016, 0.36, 0.385, xyz(0.06, 0.16))

# Four arms, each to a motor in a guard ring.
for i in range(4):
    sx = 1 if i & 1 else -1
    sy = 1 if i & 2 else -1
    hub = Vector((sx * 0.36, sy * 0.36, 0.06))
    rod(dark, (sx * 0.16, sy * 0.16, 0.02), hub + Vector((0, 0, -0.02)), 0.026)
    prism(dark, 8, 0.05, 0.04, -0.04, 0.06, Matrix.Translation(hub))
    prism(amber, 8, 0.052, 0.052, -0.012, 0.004, Matrix.Translation(hub))
    for k in range(10):
        a, b = k * TAU / 10, (k + 1) * TAU / 10
        rod(dark, hub + polar(a, 0.185, 0.0), hub + polar(b, 0.185, 0.0), 0.012, 5)
    for k in range(3):
        a = k * TAU / 3 + (0.5 if i & 1 else 0)
        rod(dark, hub + polar(a, 0.05, 0.0), hub + polar(a, 0.185, 0.0), 0.008, 4)
    blades = role(f"rotor{i}")
    box(blades, 0.32, 0.04, 0.008, Matrix.Translation(hub + Vector((0, 0, 0.075))))
    box(blades, 0.04, 0.32, 0.008, Matrix.Translation(hub + Vector((0, 0, 0.075))))
    prism(blades, 6, 0.03, 0.02, 0.06, 0.095, Matrix.Translation(hub))
    disc = role(f"rotor_amber{i}")
    for tip in ((0.15, 0), (-0.15, 0), (0, 0.15), (0, -0.15)):
        box(disc, 0.03, 0.03, 0.009, Matrix.Translation(hub + Vector((tip[0], tip[1], 0.075))))

# Skids.
for sx in (-1, 1):
    rod(dark, (sx * 0.15, -0.12, -0.12), (sx * 0.19, -0.14, -0.24), 0.012)
    rod(dark, (sx * 0.15, 0.12, -0.12), (sx * 0.19, 0.14, -0.24), 0.012)
    rod(dark, (sx * 0.19, -0.20, -0.24), (sx * 0.19, 0.20, -0.24), 0.014)

# What it carries: a strapped crate on a line, with the clamp that holds it.
box(dark, 0.10, 0.10, 0.03, xyz(z=-0.15))
rod(role("cable"), (0, 0, -0.15), (0, 0, -0.46), 0.007, 5)
crate = role("crate")
box(crate, 0.30, 0.30, 0.30, xyz(z=-0.61))
box(crate, 0.12, 0.12, 0.03, xyz(z=-0.455))
straps = role("crate_amber")
box(straps, 0.308, 0.05, 0.308, xyz(z=-0.61))
box(straps, 0.05, 0.308, 0.308, xyz(z=-0.61))

name = "NX_Drone"
collection = bpy.data.collections.get(name) or bpy.data.collections.new(name)
if collection.name not in [c.name for c in bpy.context.scene.collection.children]:
    bpy.context.scene.collection.children.link(collection)
collection.hide_render = collection.hide_viewport = False
for old in list(collection.objects):
    bpy.data.objects.remove(old, do_unlink=True)

triangles = 0
bpy.ops.object.select_all(action="DESELECT")
for part, bm in roles.items():
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(part)
    bm.to_mesh(mesh)
    bm.free()
    triangles += len(mesh.polygons)
    made = bpy.data.objects.new(part, mesh)
    made.data.name = part
    collection.objects.link(made)
    made.select_set(True)

target = os.path.join(HERE, "nodexeus-drone.glb")
bpy.context.view_layer.objects.active = collection.objects[0]
bpy.ops.export_scene.gltf(
    filepath=target, use_selection=True, export_format="GLB", export_apply=True, export_yup=True,
    export_materials="NONE", export_texcoords=False,
)
result = {"glb": target, "bytes": os.path.getsize(target), "triangles": triangles, "parts": sorted(o.name for o in collection.objects)}
