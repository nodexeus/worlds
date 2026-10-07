"""
Bake and export one of the campus's own models. Run inside Blender with the model's .blend
open, after setting which one:

    BAKE = {"collection": "NX_Core", "name": "core", "size": 1024}
    exec(open("/path/to/design/campus/bake_model.py").read())

The model is separate parts in its collection, each with one of the procedural `NX_*`
materials (worn, brushed steel; chipped amber paint; amber light). None of that survives
export as it stands, so this:

  1. joins every part, modifiers applied, into one mesh with one UV atlas;
  2. bakes the procedural materials to plain maps (colour, roughness, metal, normal, glow);
  3. builds one portable material that only reads those maps;
  4. exports that as nodexeus-<name>.glb next to this file, the mesh named <name>.

A packer in `tools/` then shrinks the maps for shipping.

Every material is expected to carry the nodes its recipe gave it: a Principled BSDF named
`PBR`, emitters named `BAKE_COLOR`, `BAKE_ROUGH`, `BAKE_METAL` and `BAKE_EMIT`, an image
node named `BAKE_TARGET`, and an output named `OUT`.
"""
import math
import os

import bmesh
import bpy
import numpy as np

HERE = os.path.dirname(bpy.data.filepath)
BAKE_DIR = os.path.join(HERE, "bake")
SPEC = globals().get("BAKE") or {}
NAME = SPEC.get("name", "gate")
SIZE = SPEC.get("size", 2048)
GLOW = 1.0

scene = bpy.context.scene
gate = bpy.data.collections[SPEC.get("collection", "NX_Gate")]
export = bpy.data.collections.get(gate.name + "_Export") or bpy.data.collections.new(gate.name + "_Export")
if export.name not in [c.name for c in scene.collection.children]:
    scene.collection.children.link(export)
os.makedirs(BAKE_DIR, exist_ok=True)

# ---------- 1. one mesh, one atlas ----------
gate.hide_render = gate.hide_viewport = False
export.hide_render = export.hide_viewport = False
for old in list(export.objects):
    bpy.data.objects.remove(old, do_unlink=True)

deps = bpy.context.evaluated_depsgraph_get()
slots = []
BONE_OF = {name: index for index, name in enumerate(SPEC["bones"])} if SPEC.get("bones") else None
joined = bmesh.new()
for part in gate.objects:
    material = part.data.materials[0]
    if material not in slots:
        slots.append(material)
    evaluated = part.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    piece = bmesh.new()
    piece.from_mesh(mesh)
    evaluated.to_mesh_clear()
    piece.transform(part.matrix_world)
    for face in piece.faces:
        face.material_index = slots.index(material)
    buffer = bpy.data.meshes.new("tmp")
    piece.to_mesh(buffer)
    piece.free()
    before = len(joined.verts)
    joined.from_mesh(buffer)
    if BONE_OF is not None:
        # A figure for the crew: each part is named `<bone>__<finish>`, and its vertices carry
        # that bone's number so the game can hang them on it. See build_crew.py.
        layer = joined.verts.layers.float.get("_bone") or joined.verts.layers.float.new("_bone")
        joined.verts.ensure_lookup_table()
        number = BONE_OF[part.name.split("__")[0]]
        for index in range(before, len(joined.verts)):
            joined.verts[index][layer] = number
    bpy.data.meshes.remove(buffer)

mesh = bpy.data.meshes.new(NAME + "_export")
joined.to_mesh(mesh)
joined.free()
source = bpy.data.objects.new(NAME + "_export", mesh)
export.objects.link(source)
for material in slots:
    mesh.materials.append(material)

bpy.ops.object.select_all(action="DESELECT")
source.select_set(True)
bpy.context.view_layer.objects.active = source
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003, area_weight=0.0)
bpy.ops.object.mode_set(mode="OBJECT")
gate.hide_render = gate.hide_viewport = True

# ---------- 2. bake ----------
scene.render.engine = "CYCLES"
try:
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "METAL"
    preferences.get_devices()
    for device in preferences.devices:
        device.use = True
    scene.cycles.device = "GPU"
except Exception:
    scene.cycles.device = "CPU"
scene.render.bake.margin = 6
scene.render.bake.use_clear = True


def image(name, colorspace):
    existing = bpy.data.images.get(name)
    if existing:
        bpy.data.images.remove(existing)
    made = bpy.data.images.new(name, SIZE, SIZE, alpha=False, float_buffer=False)
    made.colorspace_settings.name = colorspace
    made.filepath_raw = os.path.join(BAKE_DIR, name + ".png")
    made.file_format = "PNG"
    return made


def route(node_name, target):
    """Send one named node to every material's output, and aim the bake at `target`."""
    for material in source.data.materials:
        tree = material.node_tree
        out = tree.nodes["OUT"]
        for link in list(out.inputs["Surface"].links):
            tree.links.remove(link)
        tree.links.new(tree.nodes[node_name].outputs[0], out.inputs["Surface"])
        holder = tree.nodes["BAKE_TARGET"]
        holder.image = target
        for node in tree.nodes:
            node.select = False
        holder.select = True
        tree.nodes.active = holder


def pixels(name):
    data = np.empty(SIZE * SIZE * 4, dtype=np.float32)
    bpy.data.images[name].pixels.foreach_get(data)
    return data.reshape(-1, 4)


# Colour and roughness read the ambient-occlusion node, so they want a few samples; the rest
# are flat values and need one.
for name, node, colorspace, kind, samples in (
    (NAME + "_basecolor", "BAKE_COLOR", "sRGB", "EMIT", 16),
    (NAME + "_roughness", "BAKE_ROUGH", "Non-Color", "EMIT", 10),
    (NAME + "_metallic", "BAKE_METAL", "Non-Color", "EMIT", 1),
    (NAME + "_emission", "BAKE_EMIT", "sRGB", "EMIT", 1),
    (NAME + "_normal", "PBR", "Non-Color", "NORMAL", 4),
):
    scene.cycles.samples = samples
    baked_image = image(name, colorspace)
    route(node, baked_image)
    bpy.ops.object.bake(type=kind)
    baked_image.save()
route("PBR", bpy.data.images[NAME + "_normal"])

# A light is only its glow: where the emission map is lit the surface itself is black, so
# scene lighting cannot push the amber toward yellow.
base, glow = pixels(NAME + "_basecolor"), pixels(NAME + "_emission")
base[glow[:, :3].max(axis=1) > 0.05, :3] = 0.0
bpy.data.images[NAME + "_basecolor"].pixels.foreach_set(base.ravel())
bpy.data.images[NAME + "_basecolor"].save()

# glTF reads occlusion, roughness and metalness from one image: R, G and B.
orm = np.ones((SIZE * SIZE, 4), dtype=np.float32)
orm[:, 1] = pixels(NAME + "_roughness")[:, 0]
orm[:, 2] = pixels(NAME + "_metallic")[:, 0]
packed = image(NAME + "_orm", "Non-Color")
packed.pixels.foreach_set(orm.ravel())
packed.save()

# ---------- 3. the portable material ----------
final = bpy.data.materials.get("NX_%s_Baked" % NAME) or bpy.data.materials.new("NX_%s_Baked" % NAME)
final.use_nodes = True
tree = final.node_tree
for node in list(tree.nodes):
    tree.nodes.remove(node)
principled = tree.nodes.new("ShaderNodeBsdfPrincipled")
tree.links.new(principled.outputs[0], tree.nodes.new("ShaderNodeOutputMaterial").inputs["Surface"])


def texture(name):
    node = tree.nodes.new("ShaderNodeTexImage")
    node.image = bpy.data.images[name]
    return node


tree.links.new(texture(NAME + "_basecolor").outputs["Color"], principled.inputs["Base Color"])
split = tree.nodes.new("ShaderNodeSeparateColor")
tree.links.new(texture(NAME + "_orm").outputs["Color"], split.inputs[0])
tree.links.new(split.outputs[1], principled.inputs["Roughness"])
tree.links.new(split.outputs[2], principled.inputs["Metallic"])
normal_map = tree.nodes.new("ShaderNodeNormalMap")
tree.links.new(texture(NAME + "_normal").outputs["Color"], normal_map.inputs["Color"])
tree.links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])
tree.links.new(texture(NAME + "_emission").outputs["Color"], principled.inputs["Emission Color"])
principled.inputs["Emission Strength"].default_value = GLOW

baked = source.copy()
baked.data = source.data.copy()
baked.name = baked.data.name = NAME
export.objects.link(baked)
baked.data.materials.clear()
baked.data.materials.append(final)
for polygon in baked.data.polygons:
    polygon.material_index = 0
source.hide_render = source.hide_viewport = True

# ---------- 4. export ----------
scene.render.engine = "BLENDER_EEVEE"
bpy.ops.object.select_all(action="DESELECT")
baked.select_set(True)
bpy.context.view_layer.objects.active = baked
target = os.path.join(HERE, "nodexeus-%s.glb" % NAME)
bpy.ops.export_scene.gltf(
    filepath=target, use_selection=True, export_format="GLB", export_apply=True, export_yup=True,
    # Custom attributes whose names start with an underscore go out with the mesh: `_bone`.
    export_attributes=BONE_OF is not None,
)
bpy.ops.wm.save_mainfile()

baked.data.calc_loop_triangles()
result = {"glb": target, "bytes": os.path.getsize(target), "triangles": len(baked.data.loop_triangles)}
