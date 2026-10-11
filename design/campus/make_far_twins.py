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
stripes and light. Bolts, grating bars and bevels are what is left out; a rail is two faces of its tube.

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
BUDGET = {"deck-join": 250, "deck-fill": 250, "frame": 60, "stair-1": 80, "stair-2": 120, "stair-ground": 80,
          "gangway": 40, "port-gate": 24}
BUDGET.update({"deck-%s" % d: 450 for d in "abcd"})
BUDGET.update({"deck-s%d" % i: 450 for i in range(1, 7)})
BUDGET.update({"deck-m%d" % i: 450 for i in range(1, 12)})
# A large deck has twice the plates and twice the rail, and each plate is its own patch of the atlas.
BUDGET.update({"deck-l%d" % i: 700 for i in range(1, 4)})
BUDGET.update({"post-%d" % i: 40 for i in range(1, 6)})
BUDGET.update({"legs-%d" % i: 120 for i in range(1, 6)})
BUDGET.update({"mod-%s" % m: 150 for m in ("cabin", "drum", "shed", "tank")})
# Of that, how much is held back for everything that is not a rail: the rest goes on rails and their posts first.
FLOOR = {"stair-1": 56, "stair-2": 64, "stair-ground": 56, "gangway": 28}
FLOOR.update({name: (400 if name.startswith("deck-l") else 250) for name in BUDGET if name.startswith("deck-") and name not in ("deck-join", "deck-fill")})


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
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree

    full = bpy.data.objects["set-" + part]
    mesh = full.data
    budget = BUDGET[part]
    glow, colour = _pixels(part, "emission"), _pixels(part, "basecolor")
    uv = mesh.uv_layers["atlas"].data
    deck = part.startswith("deck-")
    post = part.startswith("post-")
    lo = [min(vertex.co[i] for vertex in mesh.vertices) for i in range(3)]
    hi = [max(vertex.co[i] for vertex in mesh.vertices) for i in range(3)]

    def sample(image, u, v):
        height, width = image.shape[:2]
        return image[min(height - 1, max(0, int(v * height))), min(width - 1, max(0, int(u * width)))]

    study = bmesh.new()
    study.from_mesh(mesh)
    study.faces.ensure_lookup_table()
    tree = BVHTree.FromBMesh(study)
    triangles = {polygon.index: polygon.loop_total - 2 for polygon in mesh.polygons}

    # ---------- every face's worth ----------
    weight, lit = {}, []
    for polygon in mesh.polygons:
        if polygon.area < 0.01:
            continue
        u = sum(uv[i].uv[0] for i in polygon.loop_indices) / polygon.loop_total
        v = sum(uv[i].uv[1] for i in polygon.loop_indices) / polygon.loop_total
        up = polygon.normal.z
        # What is seen from the app's camera, which looks down from above: tops and sides. An underside
        # counts for little, but a big one (a deck's) is kept so nothing is seen through from below.
        w = polygon.area * (0.8 if up > 0.5 else 0.12 if up < -0.5 else 1.0)
        if sample(glow, u, v).max() > 0.3:
            w *= 4.0                            # a lamp, a lit window, a lit strip: these must still light
            lit.append(polygon.index)
        elif deck and up > 0.5:
            r, g, b = sample(colour, u, v)
            if r > 0.35 and r > 1.6 * b:
                w *= 5.0                        # painted chevrons, bands and lines: the deck's own marks
        if post:
            zs = [mesh.vertices[i].co.z for i in polygon.vertices]
            if abs(up) > 0.9 and min(zs) > hi[2] - 0.15:
                w = 0.0                         # the head plate lies against the deck: never seen
            elif abs(up) < 0.2 and max(zs) - min(zs) > 0.3 and polygon.area > 0.04:
                xs = [mesh.vertices[i].co.x for i in polygon.vertices]
                ys = [mesh.vertices[i].co.y for i in polygon.vertices]
                if max(max(xs) - min(xs), max(ys) - min(ys)) > 0.5 and max(zs) > hi[2] - 1.2 and min(zs) > hi[2] - 1.3:
                    w *= 6.0                    # a knee brace's side: one flat face stands for the brace
        weight[polygon.index] = w

    # ---------- what covers a light ----------
    # A lit face is often mostly hidden: a lamp's disc under a roof that leaves a ring of it showing, a
    # lit band behind a skirt. Kept without its cover it would shine whole, which from far off is a
    # glowing cap where the part has a thin line. So a lit face that is more than half covered is kept
    # only together with every face that covers it, and left out altogether if that cannot be afforded.
    bundles = []
    for index in lit:
        polygon = mesh.polygons[index]
        normal = polygon.normal
        # points all over the face, not only its middle: a cover may hide the middle and leave the rim
        corners = [mesh.vertices[i].co for i in polygon.vertices]
        points = [polygon.center]
        for k in range(len(corners)):
            p, q = corners[k], corners[(k + 1) % len(corners)]
            for wc, wp, wq in ((0.6, 0.2, 0.2), (0.3, 0.35, 0.35), (0.1, 0.45, 0.45), (0.15, 0.7, 0.15), (0.15, 0.15, 0.7), (0.04, 0.48, 0.48)):
                points.append(polygon.center * wc + p * wp + q * wq)
        covers, hidden = set(), 0
        for point in points:
            origin, left, under = point + normal * 0.003, 1.5, False
            for _ in range(6):
                where, hit_normal, hit, distance = tree.ray_cast(origin, normal, left)
                if hit is None:
                    break
                if hit != index and hit_normal.dot(normal) > 0.3:
                    covers.add(hit)
                    under = True
                origin, left = where + normal * 0.003, left - distance - 0.003
                if left <= 0:
                    break
            hidden += under
        if hidden > len(points) * 0.5:
            bundles.append((weight[index], index, covers))
            weight[index] = 0.0                 # in with its covers, below, or not at all

    # ---------- rails and their posts ----------
    # A rail or a post is a tube. Two of its faces, back to back, stand for it: the two that look out
    # from the deck and in across it.
    rails = []
    if part in FLOOR:
        seen = set()
        centroid = Vector((sum(v.co.x for v in mesh.vertices) / len(mesh.vertices), sum(v.co.y for v in mesh.vertices) / len(mesh.vertices), 0))
        for start in study.faces:
            if start.index in seen:
                continue
            group, stack = [], [start]
            seen.add(start.index)
            while stack:
                face = stack.pop()
                if len(group) <= 12:
                    group.append(face)      # a tube has ten faces at most: past that it is something else
                for vertex in face.verts:
                    for other in vertex.link_faces:
                        if other.index not in seen:
                            seen.add(other.index)
                            stack.append(other)
            caps = [face for face in group if len(face.verts) != 4]
            sides = [face for face in group if len(face.verts) == 4]
            if len(group) > 10 or len(caps) != 2 or len(sides) != len(caps[0].verts) or not 4 < len(sides) <= 8:
                continue
            a, b = caps[0].calc_center_median(), caps[1].calc_center_median()
            length = (b - a).length
            radius = (caps[0].verts[0].co - a).length
            if length < 0.4 or radius > 0.06 or length / radius < 8:
                continue
            axis = (b - a) / length
            mid = (a + b) / 2
            if deck and max(a.z, b.z) < 0.3:
                continue                        # a conduit or a pipe under the deck: not a rail
            if abs(axis.z) > 0.9:
                out = Vector((mid.x - centroid.x, mid.y - centroid.y, 0))
                out = out.normalized() if out.length > 1e-3 else Vector((1, 0, 0))
                first = max(sides, key=lambda face: face.normal.dot(out))
                order = (1, -length)            # posts after rails, the tallest first
            else:
                first = min(sides, key=lambda face: (abs(face.normal.z), face.index))
                order = (0, -max(a.z, b.z) - 0.001 * length)   # the top rail before the mid rail
            second = min(sides, key=lambda face: face.normal.dot(first.normal))
            rails.append((order, [first.index, second.index]))
        rails.sort()

    # ---------- the choice ----------
    keep, spent = set(), 0
    for w, index, covers in sorted(bundles, key=lambda bundle: -bundle[0]):
        new = [i for i in covers | {index} if i not in keep]
        cost = sum(triangles[i] for i in new)
        if spent + cost <= budget * 0.5:
            keep.update(new)
            spent += cost
    for order, pair in rails:
        cost = sum(triangles[i] for i in pair)
        if spent + cost <= budget - FLOOR[part]:
            keep.update(pair)
            spent += cost
    ranked = sorted(((w, index) for index, w in weight.items() if w > 0 and index not in keep), reverse=True)
    taken = []
    # what the outline may yet ask for, below: a pad's four sides for each leg, a face or two for the rest
    room = budget - (32 if part.startswith('legs-') else 8)
    for w, index in ranked:
        if spent + triangles[index] > room:
            continue
        if post and w > 0 and taken:
            # of a brace's two sides, one
            polygon = mesh.polygons[index]
            if any(mesh.polygons[other].normal.dot(polygon.normal) < -0.9 and (mesh.polygons[other].center - polygon.center).length < 0.12
                   and mesh.polygons[other].area < 0.3 for other in taken):
                continue
        keep.add(index)
        taken.append(index)
        spent += triangles[index]

    # ---------- the outline and the height ----------
    # The twin should reach as far as the full part every way. Where it stops short, the biggest face
    # that does reach is added (for the foot, every upright face that stands on the ground).
    def reach(axis, top):
        value = hi[axis] if top else lo[axis]
        return [polygon for polygon in mesh.polygons
                if polygon.area > 0.004 and polygon.normal.z > -0.5
                and any(abs(mesh.vertices[i].co[axis] - value) < 0.03 for i in polygon.vertices)]
    for axis in range(3):
        for top in (False, True):
            value = hi[axis] if top else lo[axis]
            got = [mesh.vertices[i].co[axis] for index in keep for i in mesh.polygons[index].vertices]
            if got and abs((max(got) if top else min(got)) - value) < 0.04:
                continue
            found = reach(axis, top)
            if not found:
                continue
            if axis == 2 and not top and deck:
                continue                        # a deck's beam is under it, out of the camera's sight
            if post and not (axis == 2 and not top):
                continue                        # a post's braces and column reach near enough; only its foot is seated
            if axis == 2 and not top:
                upright = [polygon for polygon in found if abs(polygon.normal.z) < 0.5]
                biggest = max((polygon.area for polygon in upright), default=0)
                # every side of a pad, but of a round foot only four
                upright = sorted((polygon for polygon in upright if polygon.area >= biggest * 0.5), key=lambda polygon: -polygon.area)
                keep.update(polygon.index for polygon in (upright if len(upright) <= 16 else upright[:4]))
            else:
                keep.add(max(found, key=lambda polygon: polygon.area).index)
    study.free()

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
