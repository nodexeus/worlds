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

def ball(bm, radius, matrix, scale=(1.0, 1.0, 1.0), keep=None, around=16, up=10):
    """A sphere, squashed by `scale`. `keep` drops every vertex it answers False for, which
    is how a plate is cut out of one: (x, y, z) on the unit sphere, before any squashing."""
    made = bmesh.ops.create_uvsphere(bm, u_segments=around, v_segments=up, radius=1.0)["verts"]
    if keep:
        gone = [v for v in made if not keep(*v.co)]
        made = [v for v in made if keep(*v.co)]
        bmesh.ops.delete(bm, geom=gone, context="VERTS")
    bmesh.ops.transform(bm, matrix=matrix @ Matrix.Diagonal((radius * scale[0], radius * scale[1], radius * scale[2], 1.0)), verts=made)


def limb(bm, start, end, r0, r1=None, sides=12):
    """A round limb from one point to another, closed with a ball at each end."""
    r1 = r0 if r1 is None else r1
    start, end = Vector(start), Vector(end)
    run = end - start
    made = bmesh.ops.create_cone(bm, cap_ends=False, segments=sides, radius1=r0, radius2=r1, depth=run.length)["verts"]
    turn = Vector((0, 0, 1)).rotation_difference(run.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((start + end) / 2) @ turn, verts=made)
    ball(bm, r0, Matrix.Translation(start), around=sides, up=8)
    ball(bm, r1, Matrix.Translation(end), around=sides, up=8)


# Nothing here is a box. Every part is a ball, a round limb or a plate cut from a ball, so the
# figure reads as a small person in a soft suit with armour over it, not as a toy made of bricks.

# ---------- hips and belt ----------
ball(part("hips", "suit"), 0.30, xyz(z=0.50), (1.0, 0.80, 0.62))
prism(part("hips", "dark"), 20, 0.305, 0.315, 0.565, 0.635, squash(1.0, 0.80))
prism(part("hips", "lamp"), 6, 0.045, 0.045, 0.0, 0.014, xyz(0, -0.248, 0.60, rx=QUARTER))
for sx in (-1, 1):
    ball(part("hips", "dark"), 0.085, xyz(sx * 0.27, -0.09, 0.53), (0.8, 0.8, 1.0))

# ---------- torso ----------
ball(part("spine", "suit"), 0.31, xyz(z=0.76), (1.0, 0.80, 0.80))
ball(part("chest", "suit"), 0.37, xyz(z=1.02), (1.0, 0.80, 0.72))
# The breastplate: a plate cut from the same curve as the chest, standing a little off it.
ball(part("chest", "dark"), 0.385, xyz(z=1.03), (1.0, 0.80, 0.72),
     keep=lambda x, y, z: y < -0.42 and abs(x) < 0.72 and -0.55 < z < 0.62, around=24, up=14)
prism(part("chest", "lamp"), 6, 0.07, 0.07, 0.0, 0.016, xyz(0, -0.304, 1.06, rx=QUARTER))
prism(part("chest", "dark"), 6, 0.095, 0.095, 0.0, 0.008, xyz(0, -0.302, 1.06, rx=QUARTER))
# The collar the helmet seals to.
prism(part("chest", "dark"), 20, 0.25, 0.225, 1.215, 1.295)

# ---------- the pack ----------
ball(part("chest", "dark"), 0.27, xyz(0, 0.27, 1.00), (1.0, 0.62, 1.08))
prism(part("chest", "suit"), 6, 0.15, 0.13, 0.0, 0.03, xyz(0, 0.425, 1.01, rx=-QUARTER))
prism(part("chest", "lamp"), 6, 0.075, 0.075, 0.03, 0.045, xyz(0, 0.425, 1.01, rx=-QUARTER))
for sx in (-1, 1):
    limb(part("chest", "dark"), (sx * 0.20, 0.36, 0.84), (sx * 0.20, 0.36, 1.20), 0.055, sides=10)
    ball(part("chest", "lamp"), 0.03, xyz(sx * 0.20, 0.36, 1.262))

# ---------- arms, straight out along x in the rest pose ----------
for side, sx in (("l", 1), ("r", -1)):
    upper, lower, wrist = f"upperarm.{side}", f"lowerarm.{side}", f"wrist.{side}"
    ball(part(upper, "dark"), 0.155, xyz(sx * 0.235, 0, 1.118), (1.05, 1.0, 1.0))
    limb(part(upper, "suit"), (sx * 0.30, 0, 1.107), (sx * 0.43, 0, 1.107), 0.092)
    ball(part(lower, "dark"), 0.10, xyz(sx * 0.454, 0, 1.107))
    limb(part(lower, "suit"), (sx * 0.50, 0, 1.107), (sx * 0.63, 0, 1.107), 0.088, 0.108)
    # The gauntlet cuff, and a round mitt with a thumb.
    limb(part(lower, "dark"), (sx * 0.645, 0, 1.107), (sx * 0.695, 0, 1.107), 0.125, sides=14)
    prism(part(lower, "lamp"), 14, 0.128, 0.128, -0.008, 0.008, xyz(sx * 0.67, 0, 1.107, ry=sx * QUARTER))
    ball(part(wrist, "dark"), 0.105, xyz(sx * 0.80, 0, 1.107), (1.12, 1.0, 0.92))
    ball(part(wrist, "dark"), 0.048, xyz(sx * 0.775, -0.088, 1.107))

# ---------- legs ----------
for side, sx in (("l", 1), ("r", -1)):
    x = sx * 0.171
    limb(part(f"upperleg.{side}", "suit"), (x, 0, 0.50), (x, 0, 0.33), 0.112, 0.106)
    ball(part(f"lowerleg.{side}", "dark"), 0.118, xyz(x, -0.012, 0.292), (1.0, 1.05, 0.88))
    limb(part(f"lowerleg.{side}", "suit"), (x, 0, 0.26), (x, 0, 0.17), 0.10, 0.112)
    prism(part(f"lowerleg.{side}", "dark"), 14, 0.126, 0.13, 0.115, 0.165, xyz(x))
    prism(part(f"lowerleg.{side}", "lamp"), 14, 0.132, 0.132, 0.136, 0.146, xyz(x))
    # A boot with some weight to it: a heel and a rounded toe.
    ball(part(f"foot.{side}", "dark"), 0.135, xyz(x, 0.0, 0.085), (0.90, 1.05, 0.66))
    ball(part(f"toes.{side}", "dark"), 0.125, xyz(x, -0.17, 0.075), (0.92, 1.15, 0.60))

# ---------- the helmet's frame ----------
head_dark, head_lamp = part("head", "dark"), part("head", "lamp")
for sx in (-1, 1):
    # Ear pods, ringed.
    ball(head_dark, 0.15, xyz(sx * (R - 0.01), 0, CROWN), (0.55, 1.0, 1.0))
    prism(head_lamp, 14, 0.085, 0.085, 0.0, 0.012, xyz(sx * (R + 0.068), 0, CROWN, ry=sx * QUARTER))
    prism(head_dark, 14, 0.05, 0.05, 0.012, 0.022, xyz(sx * (R + 0.068), 0, CROWN, ry=sx * QUARTER))
# The bezel round the screen.
RING = 0.76 * R + 0.012
FRONT = -math.sqrt(R * R - (0.76 * R) ** 2) - 0.01
for k in range(24):
    a, b = k * TAU / 24, (k + 1) * TAU / 24
    rod(head_dark, (math.cos(a) * RING, FRONT, CROWN + math.sin(a) * RING), (math.cos(b) * RING, FRONT, CROWN + math.sin(b) * RING), 0.032, 8)
# A band over the crown from the bezel to the nape, cut from the helmet's own curve.
ball(head_dark, R + 0.014, xyz(z=CROWN), keep=lambda x, y, z: abs(x) < 0.13 and y > FRONT / R and z > -0.5, around=32, up=18)
# The aerial, on the right pod.
rod(head_dark, (-R - 0.03, 0.02, CROWN + 0.10), (-R - 0.05, 0.04, CROWN + 0.60), 0.014)
ball(head_lamp, 0.032, xyz(-R - 0.05, 0.04, CROWN + 0.62))

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
        mesh.set_sharp_from_angle(angle=math.radians(55))
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
crew, triangles = into("NX_Crew", parts, lambda key: FINISH[key.split("__")[1]])
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
