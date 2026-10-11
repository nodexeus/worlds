"""
Far twins of the settlement kit's heavy parts: the same part with most of its faces left out,
for drawing a long way from the camera (NODEX-348).

Run inside nodexeus-buildings.blend AFTER build_settlement.py and bake_settlement.py, since a twin
is cut from the baked part:

    exec(compile(open("design/campus/make_far_twins.py").read(), "make_far_twins.py", "exec"))

or, for some parts only, set `ONLY = ["deck-m6", "post-3"]` first.

A twin is not a new model. It is a choice of the full part's own faces, the biggest and the ones
that are lit or painted, kept exactly as they are: the same places, the same atlas coordinates. So
it wears the full part's baked material with nothing new baked, and matches it in colour, wear,
stripes and light. Bolts, rails, bars, braces and bevels are what is left out.

Each is exported as `nodexeus-set-<part>-far.glb` with NO images in it. `tools/build-settlement.mjs`
gives every `<part>-far` the material of `<part>` when it packs the kit, so the textures are in the
packed file once.

It does not save the .blend and it does not touch a full part.
"""
import os

import bmesh
import bpy
import numpy as np

HERE = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.getcwd()
BAKE_DIR = os.path.join(HERE, "bake")
SCENE_NAME = "NX_Settlement"
FAR_COLLECTION = "NX_Far_Twins"         # not NX_Set_: the bake reads every such collection as a part

# How many triangles a twin may have.
BUDGET = {"deck-join": 250, "deck-fill": 250, "frame": 60, "stair-1": 80, "stair-2": 80, "stair-ground": 80,
          "gangway": 40, "port-gate": 24}
BUDGET.update({"deck-%s" % d: 250 for d in "abcd"})
BUDGET.update({"deck-s%d" % i: 250 for i in range(1, 7)})
BUDGET.update({"deck-m%d" % i: 250 for i in range(1, 12)})
# A large deck has twice the plates, and each plate is its own patch of the atlas, so it cannot be had in 250.
BUDGET.update({"deck-l%d" % i: 400 for i in range(1, 4)})
BUDGET.update({"post-%d" % i: 24 for i in range(1, 6)})
BUDGET.update({"legs-%d" % i: 120 for i in range(1, 6)})
BUDGET.update({"mod-%s" % m: 150 for m in ("cabin", "drum", "shed", "tank")})


def _pixels(part, suffix):
    """A baked map of the full part as rows of RGB, from the session if it is there, else from the file."""
    name = "set-%s_%s" % (part, suffix)
    image = bpy.data.images.get(name)
    loaded = False
    if image is None or not image.has_data:
        image = bpy.data.images.load(os.path.join(BAKE_DIR, name + ".png"))
        loaded = True
    width, height = image.size
    data = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(data)
    if loaded:
        bpy.data.images.remove(image)
    return data.reshape(height, width, 4)[..., :3]


def twin(part):
    """Make `set-<part>-far` from `set-<part>` and export it. Returns the two triangle counts."""
    full = bpy.data.objects["set-" + part]
    mesh = full.data
    budget = BUDGET[part]
    glow, colour = _pixels(part, "emission"), _pixels(part, "basecolor")
    uv = mesh.uv_layers["atlas"].data
    deck = part.startswith("deck-")

    def sample(image, u, v):
        height, width = image.shape[:2]
        return image[min(height - 1, max(0, int(v * height))), min(width - 1, max(0, int(u * width)))]

    ranked = []
    for polygon in mesh.polygons:
        if polygon.area < 0.01:
            continue
        u = sum(uv[i].uv[0] for i in polygon.loop_indices) / polygon.loop_total
        v = sum(uv[i].uv[1] for i in polygon.loop_indices) / polygon.loop_total
        up = polygon.normal.z
        # What is seen from the app's camera, which looks down from above: tops and sides. An underside
        # counts for little, but a big one (a deck's) is kept so nothing is seen through from below.
        weight = polygon.area * (0.8 if up > 0.5 else 0.12 if up < -0.5 else 1.0)
        if sample(glow, u, v).max() > 0.3:
            weight *= 4.0                       # a lamp, a lit window, a lit strip: these must still light
        elif deck and up > 0.5:
            r, g, b = sample(colour, u, v)
            if r > 0.35 and r > 1.6 * b:
                weight *= 5.0                   # painted chevrons, bands and lines: the deck's own marks
        ranked.append((weight, polygon.index, polygon.loop_total - 2))
    ranked.sort(reverse=True)
    keep, spent = set(), 0
    for weight, index, triangles in ranked:
        if spent + triangles <= budget:
            keep.add(index)
            spent += triangles

    work = bmesh.new()
    work.from_mesh(mesh)
    work.faces.ensure_lookup_table()
    bmesh.ops.delete(work, geom=[face for face in work.faces if face.index not in keep], context="FACES")
    name = "set-%s-far" % part
    old = bpy.data.objects.get(name)
    if old:
        old_mesh = old.data
        bpy.data.objects.remove(old, do_unlink=True)
        if old_mesh.users == 0:
            bpy.data.meshes.remove(old_mesh)
    far_mesh = bpy.data.meshes.new(name)
    work.to_mesh(far_mesh)
    work.free()
    for material in mesh.materials:
        far_mesh.materials.append(material)
    far = bpy.data.objects.new(name, far_mesh)
    far.matrix_world = full.matrix_world
    scene = bpy.data.scenes[SCENE_NAME]
    collection = bpy.data.collections.get(FAR_COLLECTION)
    if collection is None:
        collection = bpy.data.collections.new(FAR_COLLECTION)
        scene.collection.children.link(collection)
    collection.objects.link(far)

    # Exported with no images: the packer gives it the full part's material.
    window = bpy.context.window
    before = window.scene
    window.scene = scene
    layers = scene.view_layers[0].layer_collection.children
    shown = {child.name: child.exclude for child in layers}
    try:
        for child in layers:
            child.exclude = child.name != FAR_COLLECTION
        for other in scene.objects:
            other.select_set(False)
        far.select_set(True)
        bpy.context.view_layer.objects.active = far
        target = os.path.join(HERE, "nodexeus-set-%s-far.glb" % part)
        bpy.ops.export_scene.gltf(
            filepath=target, use_selection=True, use_active_scene=True, export_format="GLB",
            export_apply=True, export_yup=True, export_image_format="NONE",
        )
    finally:
        for child in layers:
            if child.name in shown:
                child.exclude = shown[child.name]
            elif child.name == FAR_COLLECTION:
                child.exclude = True
        window.scene = before
    mesh.calc_loop_triangles()
    far_mesh.calc_loop_triangles()
    lo = [min(vertex.co[i] for vertex in far_mesh.vertices) for i in range(3)]
    hi = [max(vertex.co[i] for vertex in far_mesh.vertices) for i in range(3)]
    flo = [min(vertex.co[i] for vertex in mesh.vertices) for i in range(3)]
    fhi = [max(vertex.co[i] for vertex in mesh.vertices) for i in range(3)]
    return {"full": len(mesh.loop_triangles), "far": len(far_mesh.loop_triangles), "bytes": os.path.getsize(target),
            "short_by": [round(max(lo[i] - flo[i], fhi[i] - hi[i]), 2) for i in range(3)]}


ONLY = globals().get("ONLY")
result = {}
for _part in BUDGET:
    if ONLY and _part not in ONLY:
        continue
    if bpy.data.objects.get("set-" + _part) is None:
        result[_part] = "no baked part in this file"
        continue
    result[_part] = twin(_part)
