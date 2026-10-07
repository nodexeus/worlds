"""
Model the Nodexeus crew. Run inside Blender with nodexeus-buildings.blend open:

    exec(open("/path/to/design/campus/build_crew.py").read())

The crew are robots: stocky industrial workers in the same blackened steel and amber as the
campus they keep, and built the way it is built, heavy and plated and six-sided. Each has a
helmet for a head, with a visor across the front that its face shows through.

They keep the skeleton and the animations the crew have always had (KayKit's medium rig, CC0).
There is no armature in this file, and none is needed. Every part is rigid and belongs to
exactly one bone, so it is modelled where that bone holds it in the rig's rest pose (arms
straight out) and named for it: `<bone>__<finish>`. The game gives each part's vertices that
bone, at full weight, when it loads the file.

    finish: dark   blackened plate: the shells
            plate  bare steel: struts, joints, hands and feet
            suit   the few panels that take the thread's own colour
            lamp   lit amber

Measured in the rig's own units: feet on z = 0, about 1.7 to the top of the head. Front is -Y.
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


# Built like the campus is built: heavy, plated, and six-sided wherever it can be. Nothing on
# it is thinner than a hand, and the head is a helmet with a visor, set down into the collar.
HEAD = 1.241
FACE = HEAD + 0.165         # the middle of the visor
HEX = Matrix.Rotation(math.pi / 6, 4, "Z")     # a hexagon turned to put a flat face forward

# ---------- pelvis ----------
prism(part("hips", "dark"), 6, 0.31, 0.27, 0.40, 0.60, squash(1.0, 0.80) @ HEX)
prism(part("hips", "plate"), 6, 0.325, 0.325, 0.555, 0.615, squash(1.0, 0.80) @ HEX)
prism(part("hips", "lamp"), 6, 0.05, 0.05, 0.0, 0.014, xyz(0, -0.228, 0.585, rx=QUARTER))
for sx in (-1, 1):
    box(part("hips", "dark"), 0.09, 0.22, 0.17, xyz(sx * 0.30, 0, 0.49))
    box(part("hips", "plate"), 0.03, 0.16, 0.05, xyz(sx * 0.345, 0, 0.52))

# ---------- waist ----------
prism(part("spine", "plate"), 8, 0.24, 0.26, 0.58, 0.76, squash(1.0, 0.82))
for z in (0.63, 0.70):
    prism(part("spine", "dark"), 8, 0.275, 0.275, z - 0.02, z + 0.02, squash(1.0, 0.82))

# ---------- the body: a hexagonal hull, wider at the shoulder ----------
hull = squash(1.0, 0.82) @ HEX
prism(part("chest", "dark"), 6, 0.34, 0.43, 0.74, 1.14, hull)
prism(part("chest", "plate"), 6, 0.355, 0.355, 0.74, 0.80, hull)
prism(part("chest", "lamp"), 6, 0.448, 0.448, 1.118, 1.14, hull)
prism(part("chest", "plate"), 6, 0.45, 0.40, 1.14, 1.22, hull)
# The core, framed, and louvres either side of it.
prism(part("chest", "plate"), 6, 0.115, 0.115, 0.0, 0.03, xyz(0, -0.292, 0.985, rx=QUARTER))
prism(part("chest", "lamp"), 6, 0.08, 0.08, 0.03, 0.044, xyz(0, -0.292, 0.985, rx=QUARTER))
for sx in (-1, 1):
    for i in range(3):
        box(part("chest", "plate"), 0.10, 0.022, 0.022, xyz(sx * 0.20, -0.272 - i * 0.012, 0.93 + i * 0.05, rx=0.4, rz=-sx * 0.5))
# The collar the head sits down into.
prism(part("chest", "dark"), 8, 0.30, 0.27, 1.20, 1.29)
# The reactor on its back: a pack, a core, two stacks.
box(part("chest", "dark"), 0.46, 0.16, 0.36, xyz(0, 0.36, 0.98))
box(part("chest", "plate"), 0.50, 0.04, 0.06, xyz(0, 0.40, 1.15))
prism(part("chest", "plate"), 6, 0.10, 0.10, 0.0, 0.016, xyz(0, 0.44, 0.97, rx=-QUARTER))
prism(part("chest", "lamp"), 6, 0.07, 0.07, 0.016, 0.03, xyz(0, 0.44, 0.97, rx=-QUARTER))
for sx in (-1, 1):
    prism(part("chest", "plate"), 8, 0.055, 0.05, 0.92, 1.30, xyz(sx * 0.17, 0.40))
    prism(part("chest", "lamp"), 8, 0.036, 0.036, 1.30, 1.312, xyz(sx * 0.17, 0.40))

# ---------- arms, straight out along x in the rest pose ----------
for side, sx in (("l", 1), ("r", -1)):
    along = xyz(0, 0, 1.107, ry=sx * QUARTER)       # a prism drawn up z now runs out along x
    upper, lower, wrist = f"upperarm.{side}", f"lowerarm.{side}", f"wrist.{side}"
    # A pauldron over the shoulder; its top plate is the thread's own colour.
    prism(part(upper, "dark"), 6, 0.185, 0.165, 0.16, 0.36, along @ HEX)
    box(part(upper, "suit"), 0.17, 0.20, 0.03, xyz(sx * 0.265, 0, 1.278))
    box(part(upper, "lamp"), 0.14, 0.014, 0.024, xyz(sx * 0.265, -0.152, 1.14))
    prism(part(upper, "plate"), 8, 0.10, 0.095, 0.34, 0.45, along)
    ball(part(lower, "plate"), 0.105, xyz(sx * 0.454, 0, 1.107))
    # A heavy forearm, cuffed.
    prism(part(lower, "dark"), 6, 0.115, 0.155, 0.49, 0.675, along @ HEX)
    box(part(lower, "lamp"), 0.12, 0.014, 0.024, xyz(sx * 0.585, -0.128, 1.107))
    prism(part(lower, "plate"), 8, 0.158, 0.158, 0.655, 0.705, along)
    # A fist of a hand: a block and three thick fingers.
    box(part(wrist, "plate"), 0.12, 0.17, 0.15, xyz(sx * 0.765, 0, 1.107))
    for dy in (-0.055, 0.0, 0.055):
        box(part(wrist, "dark"), 0.085, 0.045, 0.06, xyz(sx * 0.855, dy, 1.117))
    box(part(wrist, "dark"), 0.07, 0.05, 0.05, xyz(sx * 0.80, -0.10, 1.06))

# ---------- legs ----------
for side, sx in (("l", 1), ("r", -1)):
    x = sx * 0.171
    prism(part(f"upperleg.{side}", "dark"), 6, 0.118, 0.132, 0.33, 0.50, xyz(x) @ HEX)
    ball(part(f"lowerleg.{side}", "plate"), 0.105, xyz(x, 0, 0.292))
    box(part(f"lowerleg.{side}", "dark"), 0.16, 0.05, 0.12, xyz(x, -0.105, 0.30))
    # A greave, flared to the ankle.
    prism(part(f"lowerleg.{side}", "dark"), 6, 0.155, 0.118, 0.12, 0.27, xyz(x) @ HEX)
    box(part(f"lowerleg.{side}", "lamp"), 0.024, 0.014, 0.10, xyz(x, -0.128, 0.19))
    prism(part(f"lowerleg.{side}", "plate"), 8, 0.158, 0.158, 0.105, 0.135, xyz(x))
    # Big feet.
    box(part(f"foot.{side}", "plate"), 0.25, 0.24, 0.115, xyz(x, 0.015, 0.058))
    box(part(f"toes.{side}", "dark"), 0.25, 0.19, 0.10, xyz(x, -0.195, 0.05))
    box(part(f"toes.{side}", "lamp"), 0.15, 0.014, 0.022, xyz(x, -0.292, 0.055))

# ---------- the head: a helmet, with a visor across the front of it ----------
head_dark, head_plate, head_lamp = part("head", "dark"), part("head", "plate"), part("head", "lamp")
helm = squash(1.0, 0.92) @ Matrix.Rotation(math.pi / 8, 4, "Z")
prism(head_dark, 8, 0.31, 0.29, HEAD - 0.02, HEAD + 0.30, helm)
prism(head_plate, 8, 0.29, 0.18, HEAD + 0.30, HEAD + 0.40, helm)
prism(head_dark, 8, 0.18, 0.14, HEAD + 0.40, HEAD + 0.43, helm)
# The visor's frame: a brow, a jaw, and a post at each end.
box(head_plate, 0.50, 0.05, 0.045, xyz(0, -0.262, FACE + 0.105))
box(head_plate, 0.46, 0.06, 0.07, xyz(0, -0.262, FACE - 0.115))
for sx in (-1, 1):
    box(head_plate, 0.045, 0.05, 0.25, xyz(sx * 0.245, -0.25, FACE, rz=-sx * 0.35))
    # A sensor each side, ringed in light.
    prism(head_plate, 8, 0.10, 0.085, 0.0, 0.06, xyz(sx * 0.29, 0.02, FACE, ry=sx * QUARTER))
    prism(head_lamp, 8, 0.055, 0.055, 0.06, 0.07, xyz(sx * 0.29, 0.02, FACE, ry=sx * QUARTER))
    # Vents in the jaw.
    for i in range(2):
        box(head_dark, 0.07, 0.012, 0.014, xyz(sx * 0.12, -0.294, FACE - 0.10 - i * 0.028))
# A crest over the top, and the aerial behind it.
box(head_plate, 0.07, 0.34, 0.05, xyz(0, 0.02, HEAD + 0.425))
rod(head_plate, (-0.17, 0.16, HEAD + 0.34), (-0.19, 0.19, HEAD + 0.74), 0.016)
ball(head_lamp, 0.032, xyz(-0.19, 0.19, HEAD + 0.76))

# ---------- stand-ins: what the game draws itself ----------
stand = {"glass": bmesh.new(), "eyes": bmesh.new()}
box(stand["glass"], 0.47, 0.03, 0.19, xyz(0, -0.255, FACE - 0.005))
for sx in (-1, 1):
    prism(stand["eyes"], 12, 0.042, 0.042, 0.0, 0.006, xyz(sx * 0.105, -0.275, FACE + 0.005, rx=QUARTER) @ squash(1.0, 1.25))


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
            modifier.width = 0.012
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
        # At one, so the colour that reaches the picture is the colour asked for. Any brighter
        # and the red runs out of range first, which turns amber yellow.
        shader.inputs["Emission Strength"].default_value = 1.0
    return material


# Brand amber, #fdc700, in the linear values Blender works in.
AMBER = (0.982, 0.571, 0.0)
SUIT = preview("Crew_Suit", tuple(c * 0.75 for c in AMBER), 0.2, 0.45)
FINISH = {
    "suit": SUIT,
    "dark": bpy.data.materials["NX_Steel_Black"],
    "plate": bpy.data.materials["NX_Steel_Plate"],
    # Its own lamp for the picture: the shared one has a pale surface under its light, for
    # baking, and the two together read yellow.
    "lamp": preview("Crew_Lamp", (0, 0, 0), 0.0, 0.5, AMBER),
}
crew, triangles = into("NX_Crew", parts, lambda key: FINISH[key.split("__")[1]], bevel=True)
STAND = {
    "glass": preview("Crew_Glass", (0.004, 0.005, 0.008), 0.0, 0.06),
    "eyes": preview("Crew_Eyes", (0, 0, 0), 0.0, 0.5, AMBER),
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
