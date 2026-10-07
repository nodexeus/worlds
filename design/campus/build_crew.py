"""
Model the Nodexeus crew. Run inside Blender with nodexeus-buildings.blend open:

    exec(open("/path/to/design/campus/build_crew.py").read())

The crew are robots: small mechanical workers in the same blackened steel and amber as the
campus they keep. They are built the way a machine is, a chassis and a head unit carried on
struts with a joint showing at every bend, and each has a screen for a face.

They keep the skeleton and the animations the crew have always had (KayKit's medium rig, CC0).
There is no armature in this file, and none is needed. Every part is rigid and belongs to
exactly one bone, so it is modelled where that bone holds it in the rig's rest pose (arms
straight out) and named for it: `<bone>__<finish>`. The game gives each part's vertices that
bone, at full weight, when it loads the file.

    finish: dark   blackened plate: the shells
            plate  bare steel: struts, joints, hands and feet
            suit   the few panels that take the thread's own colour
            lamp   lit amber

Measured in the rig's own units: feet on z = 0, about 1.8 to the top of the head. Front is -Y.
Writes nodexeus-crew.glb next to this file.

`STAND_INS` are what the game draws for itself (the face on the screen) and are here only so
a render shows the whole figure. They are not exported.
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(bpy.data.filepath)
tools = {"ONLY": ["nothing"]}
exec(open(os.path.join(HERE, "build_buildings.py")).read(), tools)
box, prism, rod, xyz, polar = (tools[k] for k in ("box", "prism", "rod", "xyz", "polar"))
TAU = math.pi * 2
QUARTER = math.pi / 2

parts = {}


def part(bone, finish):
    return parts.setdefault(f"{bone}__{finish}", bmesh.new())


def squash(sx, sy, sz=1.0):
    return Matrix.Diagonal((sx, sy, sz, 1.0))


def ball(bm, radius, matrix, around=12, up=8):
    made = bmesh.ops.create_uvsphere(bm, u_segments=around, v_segments=up, radius=radius)["verts"]
    bmesh.ops.transform(bm, matrix=matrix, verts=made)


# Where the head unit sits: on a neck above the head bone.
HEAD = 1.241
FACE = HEAD + 0.30          # the middle of the screen

# ---------- pelvis ----------
prism(part("hips", "dark"), 8, 0.20, 0.17, 0.42, 0.57, squash(1.0, 0.74))
box(part("hips", "plate"), 0.44, 0.10, 0.07, xyz(z=0.52))
prism(part("hips", "lamp"), 6, 0.035, 0.035, 0.0, 0.012, xyz(0, -0.142, 0.50, rx=QUARTER))
for sx in (-1, 1):
    ball(part("hips", "plate"), 0.078, xyz(sx * 0.171, 0, 0.519))

# ---------- spine: a column, ringed, between pelvis and chassis ----------
prism(part("spine", "plate"), 10, 0.065, 0.065, 0.56, 0.82)
for z in (0.61, 0.68, 0.75):
    prism(part("spine", "dark"), 10, 0.095, 0.095, z - 0.018, z + 0.018)
for sx in (-1, 1):
    rod(part("spine", "plate"), (sx * 0.11, 0.03, 0.57), (sx * 0.16, 0.03, 0.82), 0.018)

# ---------- chassis ----------
chest = part("chest", "dark")
prism(chest, 6, 0.24, 0.33, 0.80, 1.13, squash(1.0, 0.70) @ Matrix.Rotation(math.pi / 6, 4, "Z"))
box(part("chest", "plate"), 0.56, 0.22, 0.07, xyz(z=1.145))
# The core, and the grille under it.
prism(part("chest", "plate"), 6, 0.085, 0.085, 0.0, 0.016, xyz(0, -0.212, 1.03, rx=QUARTER))
prism(part("chest", "lamp"), 6, 0.062, 0.062, 0.016, 0.028, xyz(0, -0.212, 1.03, rx=QUARTER))
for i in range(3):
    box(part("chest", "plate"), 0.16, 0.02, 0.016, xyz(0, -0.19 + i * 0.012, 0.905 - i * 0.03, rx=0.4))
# Identity: a shoulder plate each side takes the thread's colour.
for sx in (-1, 1):
    box(part("chest", "suit"), 0.13, 0.20, 0.035, xyz(sx * 0.215, 0, 1.196, ry=sx * 0.32))
# The neck.
prism(part("chest", "plate"), 10, 0.055, 0.055, 1.17, 1.30)
prism(part("chest", "dark"), 10, 0.085, 0.085, 1.18, 1.215)
# The power pack on its back, with two fins.
box(chest, 0.30, 0.12, 0.30, xyz(0, 0.235, 0.99))
prism(part("chest", "plate"), 6, 0.085, 0.085, 0.0, 0.012, xyz(0, 0.295, 1.0, rx=-QUARTER))
prism(part("chest", "lamp"), 6, 0.058, 0.058, 0.012, 0.022, xyz(0, 0.295, 1.0, rx=-QUARTER))
for sx in (-1, 1):
    box(part("chest", "plate"), 0.02, 0.10, 0.26, xyz(sx * 0.17, 0.26, 0.99))

# ---------- arms, straight out along x in the rest pose ----------
for side, sx in (("l", 1), ("r", -1)):
    along = xyz(0, 0, 1.107, ry=sx * QUARTER)       # a prism drawn up z now runs out along x
    upper, lower, wrist = f"upperarm.{side}", f"lowerarm.{side}", f"wrist.{side}"
    ball(part(upper, "plate"), 0.082, xyz(sx * 0.225, 0, 1.107))
    prism(part(upper, "plate"), 8, 0.036, 0.036, 0.24, 0.45, along)
    prism(part(upper, "dark"), 8, 0.070, 0.062, 0.29, 0.40, along)
    ball(part(lower, "plate"), 0.062, xyz(sx * 0.454, 0, 1.107))
    prism(part(lower, "plate"), 8, 0.032, 0.032, 0.46, 0.70, along)
    prism(part(lower, "dark"), 8, 0.058, 0.086, 0.50, 0.675, along)
    box(part(lower, "lamp"), 0.10, 0.012, 0.022, xyz(sx * 0.60, 0, 1.107 + 0.084))
    prism(part(lower, "plate"), 8, 0.070, 0.070, 0.675, 0.70, along)
    # A gripper: a palm and three fingers.
    box(part(wrist, "plate"), 0.07, 0.10, 0.09, xyz(sx * 0.745, 0, 1.107))
    for dy, dz in ((0.035, 0.03), (-0.035, 0.03), (0.0, -0.035)):
        box(part(wrist, "dark"), 0.085, 0.026, 0.028, xyz(sx * 0.82, dy, 1.107 + dz))

# ---------- legs ----------
for side, sx in (("l", 1), ("r", -1)):
    x = sx * 0.171
    prism(part(f"upperleg.{side}", "plate"), 8, 0.040, 0.040, 0.30, 0.52, xyz(x))
    prism(part(f"upperleg.{side}", "dark"), 8, 0.062, 0.082, 0.33, 0.47, xyz(x))
    ball(part(f"lowerleg.{side}", "plate"), 0.066, xyz(x, 0, 0.292))
    box(part(f"lowerleg.{side}", "dark"), 0.10, 0.03, 0.09, xyz(x, -0.068, 0.295))
    prism(part(f"lowerleg.{side}", "plate"), 8, 0.034, 0.034, 0.12, 0.29, xyz(x))
    prism(part(f"lowerleg.{side}", "dark"), 8, 0.090, 0.060, 0.135, 0.255, xyz(x))
    ball(part(f"foot.{side}", "plate"), 0.052, xyz(x, 0, 0.125))
    # A flat foot in two plates, heel and toe.
    box(part(f"foot.{side}", "dark"), 0.15, 0.17, 0.06, xyz(x, 0.0, 0.03))
    box(part(f"foot.{side}", "plate"), 0.13, 0.10, 0.03, xyz(x, 0.02, 0.075))
    box(part(f"toes.{side}", "dark"), 0.15, 0.13, 0.05, xyz(x, -0.15, 0.025))
    box(part(f"toes.{side}", "lamp"), 0.09, 0.012, 0.016, xyz(x, -0.217, 0.03))

# ---------- the head unit: a housing round the screen ----------
head_dark, head_plate, head_lamp = part("head", "dark"), part("head", "plate"), part("head", "lamp")
box(head_dark, 0.62, 0.40, 0.46, xyz(0, 0.02, FACE))
# The bezel: four bars round the screen, proud of the housing.
box(head_plate, 0.58, 0.03, 0.04, xyz(0, -0.19, FACE + 0.20))
box(head_plate, 0.58, 0.03, 0.04, xyz(0, -0.19, FACE - 0.20))
for sx in (-1, 1):
    box(head_plate, 0.04, 0.03, 0.44, xyz(sx * 0.29, -0.19, FACE))
    # A sensor each side, ringed in light.
    prism(head_plate, 10, 0.085, 0.075, 0.0, 0.05, xyz(sx * 0.31, 0.03, FACE, ry=sx * QUARTER))
    prism(head_lamp, 10, 0.05, 0.05, 0.05, 0.058, xyz(sx * 0.31, 0.03, FACE, ry=sx * QUARTER))
# Cooling fins on top, and the aerial.
for i in range(4):
    box(head_plate, 0.34, 0.02, 0.035, xyz(0, -0.04 + i * 0.06, FACE + 0.245))
rod(head_plate, (0.22, 0.12, FACE + 0.23), (0.24, 0.14, FACE + 0.60), 0.012)
ball(head_lamp, 0.026, xyz(0.24, 0.14, FACE + 0.615))
box(head_dark, 0.10, 0.08, 0.05, xyz(0.22, 0.12, FACE + 0.245))

# ---------- stand-ins: what the game draws itself ----------
stand = {"glass": bmesh.new(), "eyes": bmesh.new()}
box(stand["glass"], 0.52, 0.012, 0.36, xyz(0, -0.186, FACE))
for sx in (-1, 1):
    prism(stand["eyes"], 12, 0.045, 0.045, 0.0, 0.006, xyz(sx * 0.12, -0.194, FACE + 0.03, rx=QUARTER) @ squash(1.0, 1.45))
prism(stand["eyes"], 12, 0.04, 0.04, 0.0, 0.006, xyz(0, -0.194, FACE - 0.10, rx=QUARTER) @ squash(1.7, 0.32))


def into(name, groups, materials, bevel=False):
    collection = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if collection.name not in [c.name for c in bpy.context.scene.collection.children]:
        bpy.context.scene.collection.children.link(collection)
    collection.hide_render = collection.hide_viewport = False
    for old in list(collection.objects):
        bpy.data.objects.remove(old, do_unlink=True)
    count = 0
    for key, bm in groups.items():
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new(key)
        bm.to_mesh(mesh)
        bm.free()
        mesh.calc_loop_triangles()
        count += len(mesh.loop_triangles)
        material = materials(key)
        if material:
            mesh.materials.append(material)
        for polygon in mesh.polygons:
            polygon.use_smooth = True
        mesh.set_sharp_from_angle(angle=math.radians(40))
        made = bpy.data.objects.new(key, mesh)
        made.data.name = key
        collection.objects.link(made)
        if bevel and not key.endswith("__lamp"):
            # Chamfered, so plate catches a line of light along every edge and stops reading
            # as blocks. Applied on export.
            modifier = made.modifiers.new("Bevel", "BEVEL")
            modifier.width = 0.009
            modifier.segments = 1
            modifier.limit_method = "ANGLE"
            modifier.angle_limit = math.radians(42)
            modifier.harden_normals = True
    return collection, count


def preview(name, color, metallic=0.0, roughness=0.5, emission=None):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission:
        shader.inputs["Emission Color"].default_value = (*emission, 1)
        shader.inputs["Emission Strength"].default_value = 3.0
    return material


SUIT = preview("Crew_Suit", (0.86, 0.50, 0.04), 0.2, 0.45)
FINISH = {
    "suit": SUIT,
    "dark": bpy.data.materials["NX_Steel_Black"],
    "plate": bpy.data.materials["NX_Steel_Plate"],
    "lamp": bpy.data.materials["NX_Amber_Light"],
}
crew, triangles = into("NX_Crew", parts, lambda key: FINISH[key.split("__")[1]], bevel=True)
STAND = {
    "glass": preview("Crew_Glass", (0.004, 0.005, 0.008), 0.0, 0.06),
    "eyes": preview("Crew_Eyes", (0, 0, 0), 0.0, 0.5, (0.98, 0.57, 0.0)),
}
stand_ins, _ = into("NX_Crew_StandIns", stand, lambda key: STAND[key])

bpy.ops.object.select_all(action="DESELECT")
for made in crew.objects:
    made.select_set(True)
bpy.context.view_layer.objects.active = crew.objects[0]
target = os.path.join(HERE, "nodexeus-crew.glb")
bpy.ops.export_scene.gltf(
    filepath=target, use_selection=True, export_format="GLB", export_apply=True, export_yup=True,
    export_materials="NONE", export_texcoords=False,
)
result = {"glb": target, "bytes": os.path.getsize(target), "triangles": triangles, "parts": len(crew.objects)}
