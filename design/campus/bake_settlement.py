"""
Bake and export the settlement kit's parts. Run inside Blender after `build_settlement.py`:

    exec(open("/path/to/design/campus/bake_settlement.py").read())

or, for some of them only, set `ONLY = ["deck-a", "frame"]` first.

For each part this does what `bake_model.py` does for a building, to the same conventions:

  1. joins the part's objects, modifiers applied, into one mesh with one UV atlas;
  2. bakes the procedural finishes to plain maps (colour, roughness, metal, normal, glow);
  3. builds one portable material that only reads those maps;
  4. exports that as nodexeus-set-<name>.glb next to this file, the mesh named set-<name>.

It differs from `bake_model.py` in three ways, all so that it can be run beside the buildings
without disturbing them: it bakes one part at a time with every other part out of the scene
(parts are all modelled at the origin, and would shadow each other), it only ever reads and
rewires materials named `NX_Set_...`, and it does not save the .blend.

The maps are written to `bake/` as set-<name>_<map>.png.
"""
import math
import os

import bmesh
import bpy
import numpy as np

HERE = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.getcwd()
BAKE_DIR = os.path.join(HERE, "bake")
SCENE_NAME = "NX_Settlement"

# Map sizes: decks and modules are looked at closely, the rest are small or thin.
SIZES = {
    "deck-a": 1024, "deck-b": 1024, "deck-c": 1024, "deck-d": 1024,
    "deck-e": 1024, "deck-f": 1024, "deck-g": 1024, "deck-h": 1024, "deck-i": 1024, "deck-j": 1024,
    "mod-cabin": 1024, "mod-drum": 1024, "mod-shed": 1024, "mod-tank": 1024, "stair-2": 1024,
    "legs-1": 1024, "legs-2": 1024, "legs-3": 1024, "legs-4": 1024, "legs-5": 1024,
}
DEFAULT_SIZE = 512
SAMPLES = (32, 16, 8)  # colour, roughness, metal: all three read the occlusion of the part's own shape


def collection_name(name):
    return "NX_Set_" + name.replace("-", "_").title()


def part_names():
    out = []
    for coll in bpy.data.collections:
        if coll.name.startswith("NX_Set_") and not coll.name.endswith("_Export"):
            for ob in coll.objects:
                out.append((coll.name, ob.name.rsplit("_", 1)[0]))
                break
    return dict(out)


def bake_part(name):
    scene = bpy.data.scenes[SCENE_NAME]
    window = bpy.context.window
    before = window.scene
    window.scene = scene
    size = SIZES.get(name, DEFAULT_SIZE)
    title = collection_name(name)
    part = bpy.data.collections[title]
    export = bpy.data.collections.get(title + "_Export") or bpy.data.collections.new(title + "_Export")
    if export.name not in [c.name for c in scene.collection.children]:
        scene.collection.children.link(export)
    os.makedirs(BAKE_DIR, exist_ok=True)
    layers = scene.view_layers[0].layer_collection.children
    shown = {child.name: child.exclude for child in layers}
    try:
        # Only this part is in the scene while it bakes.
        for child in layers:
            child.exclude = child.name not in (title, title + "_Export")
        part.hide_render = part.hide_viewport = False
        export.hide_render = export.hide_viewport = False
        for old in list(export.objects):
            bpy.data.objects.remove(old, do_unlink=True)

        # ---------- 1. one mesh, one atlas ----------
        deps = bpy.context.evaluated_depsgraph_get()
        slots = []
        joined = bmesh.new()
        for piece_object in part.objects:
            material = piece_object.data.materials[0]
            if material not in slots:
                slots.append(material)
            evaluated = piece_object.evaluated_get(deps)
            mesh = evaluated.to_mesh()
            piece = bmesh.new()
            piece.from_mesh(mesh)
            evaluated.to_mesh_clear()
            piece.transform(piece_object.matrix_world)
            for face in piece.faces:
                face.material_index = slots.index(material)
            buffer = bpy.data.meshes.new("NX_Set_tmp")
            piece.to_mesh(buffer)
            piece.free()
            joined.from_mesh(buffer)
            bpy.data.meshes.remove(buffer)
        export_name = "set-" + name
        # An earlier bake's meshes would take the names, and the export is asked for by name.
        for stale in (export_name, export_name + "_export"):
            left = bpy.data.meshes.get(stale)
            if left and left.users == 0:
                bpy.data.meshes.remove(left)
        mesh = bpy.data.meshes.new(export_name + "_export")
        joined.to_mesh(mesh)
        joined.free()
        source = bpy.data.objects.new(export_name + "_export", mesh)
        export.objects.link(source)
        for material in slots:
            mesh.materials.append(material)
        atlas = mesh.uv_layers.new(name="atlas")
        mesh.uv_layers.active = atlas
        atlas.active_render = True
        for other in scene.objects:
            other.select_set(False)
        source.select_set(True)
        bpy.context.view_layer.objects.active = source
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, area_weight=0.0)
        bpy.ops.object.mode_set(mode="OBJECT")
        # A finish may ask for more or less of the atlas than its size earns it (`nx_atlas` on the
        # material): what is looked at most gets most, and what is never seen gets next to none.
        shares = [float(material.get("nx_atlas", 1.0)) for material in slots]
        if any(abs(share - 1.0) > 1e-6 for share in shares):
            uv = mesh.uv_layers["atlas"].data
            for polygon in mesh.polygons:
                share = shares[polygon.material_index]
                if share != 1.0:
                    for loop_index in polygon.loop_indices:
                        uv[loop_index].uv = uv[loop_index].uv * share
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.select_all(action="SELECT")
            bpy.ops.uv.pack_islands(rotate=False, margin=0.003)
            bpy.ops.object.mode_set(mode="OBJECT")
        part.hide_render = part.hide_viewport = True

        # ---------- 2. bake ----------
        scene.render.engine = "CYCLES"
        try:
            scene.cycles.device = "GPU"
        except Exception:
            pass
        scene.render.bake.margin = 4
        scene.render.bake.use_clear = True

        def image(suffix, colorspace):
            image_name = f"{export_name}_{suffix}"
            existing = bpy.data.images.get(image_name)
            if existing:
                bpy.data.images.remove(existing)
            made = bpy.data.images.new(image_name, size, size, alpha=False, float_buffer=False)
            made.colorspace_settings.name = colorspace
            made.filepath_raw = os.path.join(BAKE_DIR, image_name + ".png")
            made.file_format = "PNG"
            return made

        def route(node_name, target):
            """Send one named node to every finish's output, and aim the bake at `target`."""
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

        def pixels(suffix):
            data = np.empty(size * size * 4, dtype=np.float32)
            bpy.data.images[f"{export_name}_{suffix}"].pixels.foreach_get(data)
            return data.reshape(-1, 4)

        for suffix, node, colorspace, kind, samples in (
            ("basecolor", "BAKE_COLOR", "sRGB", "EMIT", SAMPLES[0]),
            ("roughness", "BAKE_ROUGH", "Non-Color", "EMIT", SAMPLES[1]),
            ("metallic", "BAKE_METAL", "Non-Color", "EMIT", SAMPLES[2]),
            ("emission", "BAKE_EMIT", "sRGB", "EMIT", 1),
            ("normal", "PBR", "Non-Color", "NORMAL", 4),
        ):
            scene.cycles.samples = samples
            baked_image = image(suffix, colorspace)
            route(node, baked_image)
            bpy.ops.object.bake(type=kind)
            baked_image.save()
        route("PBR", bpy.data.images[export_name + "_normal"])

        # A light is only its glow: where the emission map is lit the surface itself is black.
        base, glow = pixels("basecolor"), pixels("emission")
        base[glow[:, :3].max(axis=1) > 0.05, :3] = 0.0
        bpy.data.images[export_name + "_basecolor"].pixels.foreach_set(base.ravel())
        bpy.data.images[export_name + "_basecolor"].save()

        # glTF reads occlusion, roughness and metalness from one image: R, G and B.
        orm = np.ones((size * size, 4), dtype=np.float32)
        # Where nothing was baked the roughness image is 0, which is a mirror. Smaller copies of the
        # map (what is sampled from far off) blend that into thin parts, and a bright thin part with
        # a mirror's roughness sparkles under the sun. So: empty texels are fully rough, and texels
        # at the rim of an island take the roughest value near them.
        rough = pixels("roughness")[:, 0].reshape(size, size)
        empty = rough < 0.02
        rim = np.zeros_like(empty)
        spread = rough.copy()
        for dy in range(-3, 4):
            for dx in range(-3, 4):
                rim |= np.roll(np.roll(empty, dy, 0), dx, 1)
                spread = np.maximum(spread, np.roll(np.roll(rough, dy, 0), dx, 1))
        rough = np.where(empty, 1.0, np.where(rim, spread, rough))
        orm[:, 1] = rough.ravel()
        orm[:, 2] = pixels("metallic")[:, 0]
        packed = image("orm", "Non-Color")
        packed.pixels.foreach_set(orm.ravel())
        packed.save()

        # ---------- 3. the portable material ----------
        final_name = "NX_Set_%s_Baked" % name
        final = bpy.data.materials.get(final_name) or bpy.data.materials.new(final_name)
        final.use_nodes = True
        tree = final.node_tree
        for node in list(tree.nodes):
            tree.nodes.remove(node)
        principled = tree.nodes.new("ShaderNodeBsdfPrincipled")
        tree.links.new(principled.outputs[0], tree.nodes.new("ShaderNodeOutputMaterial").inputs["Surface"])

        def texture(suffix):
            node = tree.nodes.new("ShaderNodeTexImage")
            node.image = bpy.data.images[f"{export_name}_{suffix}"]
            return node

        tree.links.new(texture("basecolor").outputs["Color"], principled.inputs["Base Color"])
        split = tree.nodes.new("ShaderNodeSeparateColor")
        tree.links.new(texture("orm").outputs["Color"], split.inputs[0])
        tree.links.new(split.outputs[1], principled.inputs["Roughness"])
        tree.links.new(split.outputs[2], principled.inputs["Metallic"])
        normal_map = tree.nodes.new("ShaderNodeNormalMap")
        tree.links.new(texture("normal").outputs["Color"], normal_map.inputs["Color"])
        tree.links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])
        tree.links.new(texture("emission").outputs["Color"], principled.inputs["Emission Color"])
        principled.inputs["Emission Strength"].default_value = 1.0

        baked = source.copy()
        baked.data = source.data.copy()
        baked.name = baked.data.name = export_name
        export.objects.link(baked)
        for extra in [layer for layer in baked.data.uv_layers if layer.name != "atlas"]:
            baked.data.uv_layers.remove(extra)
        baked.data.materials.clear()
        baked.data.materials.append(final)
        for polygon in baked.data.polygons:
            polygon.material_index = 0
        source.hide_render = source.hide_viewport = True

        # ---------- 4. export ----------
        scene.render.engine = "BLENDER_EEVEE"
        for other in scene.objects:
            other.select_set(False)
        baked.select_set(True)
        bpy.context.view_layer.objects.active = baked
        target = os.path.join(HERE, "nodexeus-set-%s.glb" % name)
        bpy.ops.export_scene.gltf(
            filepath=target, use_selection=True, use_active_scene=True, export_format="GLB",
            export_apply=True, export_yup=True,
        )
        baked.data.calc_loop_triangles()
        return {"glb": target, "bytes": os.path.getsize(target), "triangles": len(baked.data.loop_triangles), "size": size}
    finally:
        scene.render.engine = "BLENDER_EEVEE"
        for child in layers:
            if child.name in shown:
                child.exclude = shown[child.name]
        window.scene = before


ONLY = globals().get("ONLY")
result = {}
for _title, _prefix in sorted(part_names().items()):
    # A part's objects are named <part>_<finish>, so the part's name is what comes before.
    _name = _prefix
    if ONLY and _name not in ONLY:
        continue
    result[_name] = bake_part(_name)
