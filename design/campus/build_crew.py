"""
Model the Nodexeus crew. Run inside Blender with nodexeus-buildings.blend open:

    exec(open("/path/to/design/campus/build_crew.py").read())

The crew keep the skeleton and the animations they have always had (KayKit's medium rig, CC0),
and the lit screen for a face that makes each one somebody. Everything else is drawn here: a
plated suit, a helmet frame with ear pods and a crest, and a pack with a core in it.

There is no armature in this file, and none is needed. Every part is rigid and belongs to
exactly one bone, so it is modelled where that bone holds it in the rig's rest pose (arms
straight out) and named for it: `<bone>__<finish>`. The game gives each part's vertices that
bone, at full weight, when it loads the file.

    finish: suit   takes the wearer's own suit colour
            dark   plate, the same on everyone
            lamp   lit amber

Measured in the rig's own units: feet on z = 0, a shade over two units to the crown of the
helmet. Front is -Y. Writes nodexeus-crew.glb next to this file.

`STAND_INS` are the parts the game already draws for itself (the helmet shell and the screen)
and are here only so a render shows the whole figure. They are not exported.
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


# Where the helmet sits: the game centres it this far above the head bone.
HEAD = 1.241
CROWN = HEAD + 0.40
R = 0.48

# ---------- hips and belt ----------
prism(part("hips", "suit"), 10, 0.27, 0.29, 0.40, 0.58, squash(1.0, 0.72))
prism(part("hips", "dark"), 10, 0.31, 0.31, 0.555, 0.635, squash(1.0, 0.74))
box(part("hips", "lamp"), 0.10, 0.02, 0.05, xyz(0, -0.232, 0.595))
for sx in (-1, 1):
    box(part("hips", "dark"), 0.11, 0.10, 0.13, xyz(sx * 0.27, -0.10, 0.53))
    box(part("hips", "dark"), 0.08, 0.14, 0.10, xyz(sx * 0.30, 0.06, 0.52))

# ---------- torso ----------
prism(part("spine", "suit"), 10, 0.27, 0.31, 0.60, 0.92, squash(1.0, 0.74))
prism(part("chest", "suit"), 10, 0.33, 0.36, 0.90, 1.19, squash(1.0, 0.76))
prism(part("chest", "suit"), 10, 0.36, 0.24, 1.19, 1.25, squash(1.0, 0.76))
# The breastplate, with the core set in it.
box(part("chest", "dark"), 0.44, 0.07, 0.25, xyz(0, -0.262, 1.055))
box(part("chest", "dark"), 0.30, 0.06, 0.07, xyz(0, -0.258, 0.90))
prism(part("chest", "lamp"), 6, 0.075, 0.075, 0.0, 0.02, xyz(0, -0.298, 1.075, rx=QUARTER))
prism(part("chest", "dark"), 6, 0.10, 0.10, 0.0, 0.012, xyz(0, -0.296, 1.075, rx=QUARTER))
for sx in (-1, 1):
    box(part("chest", "lamp"), 0.07, 0.012, 0.022, xyz(sx * 0.15, -0.299, 0.975))
    box(part("chest", "dark"), 0.05, 0.30, 0.20, xyz(sx * 0.335, 0.0, 1.03))
# The collar the helmet seals to.
prism(part("chest", "dark"), 12, 0.25, 0.23, 1.235, 1.30)

# ---------- the pack ----------
prism(part("chest", "dark"), 6, 0.27, 0.25, 0.0, 0.17, xyz(0, 0.27, 1.00, rx=-QUARTER))
prism(part("chest", "suit"), 6, 0.21, 0.19, 0.17, 0.21, xyz(0, 0.27, 1.00, rx=-QUARTER))
prism(part("chest", "lamp"), 6, 0.085, 0.085, 0.21, 0.225, xyz(0, 0.27, 1.00, rx=-QUARTER))
for sx in (-1, 1):
    rod(part("chest", "dark"), (sx * 0.20, 0.36, 0.76), (sx * 0.20, 0.36, 1.26), 0.045, 8)
    prism(part("chest", "lamp"), 8, 0.03, 0.03, 1.26, 1.275, xyz(sx * 0.20, 0.36))
    box(part("chest", "dark"), 0.06, 0.34, 0.05, xyz(sx * 0.19, 0.10, 1.20))

# ---------- arms, straight out along x in the rest pose ----------
for side, sx in (("l", 1), ("r", -1)):
    along = xyz(ry=sx * QUARTER)              # a prism drawn up z now runs out along x
    upper, lower, wrist = f"upperarm.{side}", f"lowerarm.{side}", f"wrist.{side}"
    # Pauldron over the shoulder.
    prism(part(upper, "dark"), 8, 0.155, 0.125, 0.15, 0.36, xyz(0, 0, 1.115) @ along @ squash(1.0, 1.0))
    box(part(upper, "lamp"), 0.10, 0.012, 0.025, xyz(sx * 0.25, -0.143, 1.115))
    prism(part(upper, "suit"), 8, 0.095, 0.09, 0.34, 0.455, xyz(0, 0, 1.107) @ along)
    prism(part(lower, "dark"), 8, 0.105, 0.105, 0.43, 0.48, xyz(0, 0, 1.107) @ along)
    prism(part(lower, "suit"), 8, 0.09, 0.115, 0.48, 0.63, xyz(0, 0, 1.107) @ along)
    # The gauntlet cuff.
    prism(part(lower, "dark"), 8, 0.135, 0.135, 0.62, 0.705, xyz(0, 0, 1.107) @ along)
    box(part(lower, "lamp"), 0.05, 0.03, 0.012, xyz(sx * 0.662, 0, 1.243))
    # A mitt, thumb forward.
    box(part(wrist, "dark"), 0.17, 0.15, 0.13, xyz(sx * 0.795, 0, 1.107))
    box(part(wrist, "dark"), 0.07, 0.06, 0.06, xyz(sx * 0.77, -0.095, 1.107))

# ---------- legs ----------
for side, sx in (("l", 1), ("r", -1)):
    x = sx * 0.171
    prism(part(f"upperleg.{side}", "suit"), 8, 0.10, 0.12, 0.30, 0.52, xyz(x))
    prism(part(f"lowerleg.{side}", "suit"), 8, 0.115, 0.10, 0.13, 0.29, xyz(x))
    box(part(f"lowerleg.{side}", "dark"), 0.15, 0.06, 0.13, xyz(x, -0.105, 0.295))
    prism(part(f"lowerleg.{side}", "dark"), 8, 0.13, 0.13, 0.12, 0.17, xyz(x))
    # A boot with some weight to it.
    box(part(f"foot.{side}", "dark"), 0.22, 0.24, 0.13, xyz(x, -0.01, 0.065))
    box(part(f"toes.{side}", "dark"), 0.22, 0.15, 0.10, xyz(x, -0.20, 0.05))
    box(part(f"foot.{side}", "suit"), 0.224, 0.10, 0.03, xyz(x, 0.06, 0.125))
    box(part(f"toes.{side}", "lamp"), 0.12, 0.012, 0.02, xyz(x, -0.276, 0.06))

# ---------- the helmet's frame ----------
head_dark, head_lamp = part("head", "dark"), part("head", "lamp")
for sx in (-1, 1):
    # Ear pods, ringed.
    prism(head_dark, 10, 0.15, 0.13, 0.0, 0.09, xyz(sx * (R - 0.03), 0, CROWN, ry=sx * QUARTER))
    prism(head_lamp, 10, 0.085, 0.085, 0.09, 0.10, xyz(sx * (R - 0.03), 0, CROWN, ry=sx * QUARTER))
    prism(head_dark, 10, 0.05, 0.05, 0.10, 0.115, xyz(sx * (R - 0.03), 0, CROWN, ry=sx * QUARTER))
# A crest from brow to nape.
for i in range(9):
    a = math.radians(-58 + i * 22)
    y, z = math.sin(a) * (R + 0.012), math.cos(a) * (R + 0.012)
    box(head_dark, 0.10, 0.19, 0.035, xyz(0, y, CROWN + z, rx=-a))
# The bezel round the screen.
RING = 0.76 * R + 0.012
FRONT = -math.sqrt(R * R - (0.76 * R) ** 2) - 0.01
for k in range(16):
    a, b = k * TAU / 16, (k + 1) * TAU / 16
    rod(head_dark, (math.cos(a) * RING, FRONT, CROWN + math.sin(a) * RING), (math.cos(b) * RING, FRONT, CROWN + math.sin(b) * RING), 0.03, 6)
# A chin vent, and the aerial on the right pod.
box(head_dark, 0.18, 0.07, 0.07, xyz(0, FRONT - 0.005, CROWN - RING - 0.02))
for sx in (-0.045, 0.045):
    box(head_lamp, 0.03, 0.012, 0.035, xyz(sx, FRONT - 0.043, CROWN - RING - 0.02))
rod(head_dark, (-R - 0.02, 0.03, CROWN + 0.08), (-R - 0.05, 0.05, CROWN + 0.62), 0.016)
prism(head_lamp, 8, 0.03, 0.03, 0.0, 0.05, xyz(-R - 0.05, 0.05, CROWN + 0.62))

# ---------- stand-ins: what the game draws itself ----------
stand = {"shell": bmesh.new(), "glass": bmesh.new(), "eyes": bmesh.new()}
bmesh.ops.create_uvsphere(stand["shell"], u_segments=32, v_segments=18, radius=R)
bmesh.ops.translate(stand["shell"], vec=(0, 0, CROWN), verts=stand["shell"].verts)
# The screen: the cap of the helmet inside the bezel, dark, with a face on it.
bmesh.ops.create_uvsphere(stand["glass"], u_segments=32, v_segments=24, radius=R * 1.004)
bmesh.ops.delete(stand["glass"], geom=[v for v in stand["glass"].verts if v.co.y > FRONT + 0.012], context="VERTS")
bmesh.ops.translate(stand["glass"], vec=(0, 0, CROWN), verts=stand["glass"].verts)
for sx in (-1, 1):
    prism(stand["eyes"], 12, 0.05, 0.05, 0.0, 0.006, xyz(sx * 0.13, -R - 0.004, CROWN + 0.04, rx=QUARTER, rz=sx * 0.27) @ squash(1.0, 1.5))
prism(stand["eyes"], 12, 0.045, 0.045, 0.0, 0.006, xyz(0, -R - 0.006, CROWN - 0.10, rx=QUARTER + 0.2) @ squash(1.6, 0.35))


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
        mesh.set_sharp_from_angle(angle=math.radians(42))
        made = bpy.data.objects.new(key, mesh)
        made.data.name = key
        collection.objects.link(made)
        if bevel and not key.endswith("__lamp"):
            # Chamfered, so plate catches a line of light along every edge and stops reading
            # as blocks. Applied on export.
            modifier = made.modifiers.new("Bevel", "BEVEL")
            modifier.width = 0.014
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


SUIT = preview("Crew_Suit", (0.78, 0.78, 0.76), 0.0, 0.45)
FINISH = {"suit": SUIT, "dark": bpy.data.materials["NX_Steel_Black"], "lamp": bpy.data.materials["NX_Amber_Light"]}
crew, triangles = into("NX_Crew", parts, lambda key: FINISH[key.split("__")[1]], bevel=True)
STAND = {
    "shell": SUIT,
    "glass": preview("Crew_Glass", (0.01, 0.012, 0.02), 0.0, 0.08),
    "eyes": preview("Crew_Eyes", (0, 0, 0), 0.0, 0.5, (0.35, 0.9, 1.0)),
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
