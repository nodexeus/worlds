"""
Model the Nodexeus crew. Run inside Blender with nodexeus-buildings.blend open:

    exec(open("/path/to/design/campus/build_crew.py").read())

or, for one kind only, set `ONLY_KIND = "unit"` first.

The crew are robots, and they are not all one kind. Two are drawn here, after the owner's own
pictures of them:

    unit   worn cream plate, in pieces, over a black mechanical frame. A wide helmet with
           two real eyes (lenses in housings, ringed in amber) set in a dark faceplate,
           headphone ears, an aerial, the Nodexeus mark on its chest.
    rock   slabs of stone bolted to the same black frame, and one amber eye.

Both keep the skeleton and the animations the crew have always had (KayKit's medium rig, CC0),
so one kind can stand in for another with nothing else changing. There is no armature in this
file, and none is needed. Every part is rigid and belongs to exactly one bone, so it is modelled
where that bone holds it in the rig's rest pose (arms straight out) and named for it:
`<bone>__<finish>`. The game gives each part's vertices that bone, at full weight, when it
loads the file.

    finish: shell  what the robot is clad in: plate on a unit, stone on a rock
            frame  the black machine underneath: joints, struts, hands
            glass  the dark of a visor
            lamp   lit amber

Measured in the rig's own units: feet on z = 0, about 1.9 to the top of the head. Front is -Y.
Writes nodexeus-crew-<kind>.glb next to this file.
"""
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(bpy.data.filepath)
tools = {"ONLY": ["nothing"]}
exec(open(os.path.join(HERE, "build_buildings.py")).read(), tools)
prism, rod, xyz = (tools[k] for k in ("prism", "rod", "xyz"))
TAU = math.pi * 2
QUARTER = math.pi / 2

# Where the rig's joints are in its rest pose, read off crew.glb.
HEAD = 1.241
SHOULDER = (0.212, 1.107)
ELBOW = 0.454
WRIST = 0.713
HIP = (0.171, 0.519)
KNEE = 0.292
ANKLE = 0.145


class Figure:
    """One kind of crew: its parts, by the bone that carries them and what they are made of."""

    def __init__(self):
        self.parts = {}

    def part(self, bone, finish):
        return self.parts.setdefault(f"{bone}__{finish}", bmesh.new())

    def block(self, bone, finish, sx, sy, sz, matrix, round_=0.03, steps=3):
        """A box with its edges rounded over: the shape nearly every plate here starts from."""
        bm = self.part(bone, finish)
        made = bmesh.ops.create_cube(bm, size=1.0)["verts"]
        bmesh.ops.transform(bm, matrix=Matrix.Diagonal((sx, sy, sz, 1.0)), verts=made)
        edges = list({e for v in made for e in v.link_edges})
        width = min(round_, min(sx, sy, sz) * 0.49)
        out = bmesh.ops.bevel(bm, geom=edges, offset=width, segments=steps, profile=0.5, affect="EDGES")
        verts = list({v for f in out["faces"] for v in f.verts} | {v for v in made if v.is_valid})
        bmesh.ops.transform(bm, matrix=matrix, verts=verts)

    def ball(self, bone, finish, radius, matrix, scale=(1.0, 1.0, 1.0), around=14, up=9):
        bm = self.part(bone, finish)
        made = bmesh.ops.create_uvsphere(bm, u_segments=around, v_segments=up, radius=1.0)["verts"]
        bmesh.ops.transform(bm, matrix=matrix @ Matrix.Diagonal((radius * scale[0], radius * scale[1], radius * scale[2], 1.0)), verts=made)

    def drum(self, bone, finish, sides, r0, r1, z0, z1, matrix=Matrix.Identity(4)):
        prism(self.part(bone, finish), sides, r0, r1, z0, z1, matrix)

    def bar(self, bone, finish, start, end, radius, sides=8):
        rod(self.part(bone, finish), start, end, radius, sides)

    def stone(self, bone, sx, sy, sz, matrix, seed):
        """A slab of rock: a ball knocked out of true, every one differently."""
        bm = self.part(bone, "shell")
        rand = random.Random(seed)
        made = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)["verts"]
        for v in made:
            # Squarer than a ball, then chipped: a boulder has faces.
            v.co = Vector([math.copysign(abs(c) ** 0.62, c) for c in v.co]) * (0.86 + rand.random() * 0.22)
        bmesh.ops.transform(bm, matrix=matrix @ Matrix.Diagonal((sx / 2, sy / 2, sz / 2, 1.0)), verts=made)


def frame(f):
    """The black machine both kinds are built on: a joint at every bend, and what joins them."""
    for sx in (-1, 1):
        f.ball("hips", "frame", 0.085, xyz(sx * HIP[0], 0, HIP[1]))
    f.drum("hips", "frame", 10, 0.15, 0.13, 0.44, 0.60, Matrix.Diagonal((1.0, 0.8, 1.0, 1.0)))
    # A ribbed waist.
    f.drum("spine", "frame", 12, 0.12, 0.13, 0.58, 0.80)
    for z in (0.63, 0.69, 0.75):
        f.drum("spine", "frame", 12, 0.15, 0.15, z - 0.016, z + 0.016)
    f.drum("chest", "frame", 12, 0.10, 0.10, 1.16, 1.34)
    for z in (1.21, 1.27):
        f.drum("chest", "frame", 12, 0.125, 0.125, z - 0.014, z + 0.014)
    for side, sx in (("l", 1), ("r", -1)):
        z = SHOULDER[1]
        f.ball(f"upperarm.{side}", "frame", 0.10, xyz(sx * SHOULDER[0], 0, z))
        f.bar(f"upperarm.{side}", "frame", (sx * SHOULDER[0], 0, z), (sx * ELBOW, 0, z), 0.05)
        f.ball(f"lowerarm.{side}", "frame", 0.082, xyz(sx * ELBOW, 0, z))
        f.bar(f"lowerarm.{side}", "frame", (sx * ELBOW, 0, z), (sx * WRIST, 0, z), 0.045)
        f.drum(f"lowerarm.{side}", "frame", 10, 0.075, 0.075, -0.02, 0.02, xyz(sx * (WRIST - 0.02), 0, z, ry=QUARTER))
        # A hand: a palm, three fingers and a thumb.
        f.block(f"wrist.{side}", "frame", 0.10, 0.13, 0.11, xyz(sx * (WRIST + 0.055), 0, z), 0.025)
        for dy in (-0.042, 0.0, 0.042):
            f.block(f"wrist.{side}", "frame", 0.085, 0.034, 0.04, xyz(sx * (WRIST + 0.135), dy, z + 0.02), 0.012)
        f.block(f"wrist.{side}", "frame", 0.06, 0.04, 0.04, xyz(sx * (WRIST + 0.08), -0.078, z - 0.02), 0.012)
        x = sx * HIP[0]
        f.bar(f"upperleg.{side}", "frame", (x, 0, HIP[1]), (x, 0, KNEE), 0.055)
        f.ball(f"lowerleg.{side}", "frame", 0.085, xyz(x, 0, KNEE))
        f.bar(f"lowerleg.{side}", "frame", (x, 0, KNEE), (x, 0, ANKLE), 0.05)
        f.ball(f"foot.{side}", "frame", 0.07, xyz(x, 0, ANKLE))


# ---------- unit: plate over the frame ----------
def unit(f):
    """
    After the owner's picture of one: worn cream plate, in separate pieces with the black
    machine showing between them, and a face that is not a screen. Its eyes are eyes: a lens
    in a housing, ringed in light.
    """
    frame(f)
    face = HEAD + 0.36           # level with the eyes
    bolt = lambda bone, m: f.drum(bone, "frame", 6, 0.013, 0.013, 0.0, 0.008, m)

    # More of the machine than the bare frame shows: discs at the hinges, pistons in the neck.
    for side, sx in (("l", 1), ("r", -1)):
        z = SHOULDER[1]
        f.drum(f"upperarm.{side}", "frame", 14, 0.115, 0.115, -0.035, 0.035, xyz(sx * 0.225, 0, z, ry=QUARTER))
        f.drum(f"lowerarm.{side}", "frame", 14, 0.088, 0.088, -0.085, 0.085, xyz(sx * ELBOW, 0, z, rx=QUARTER))
        f.drum(f"lowerarm.{side}", "shell", 14, 0.05, 0.05, -0.095, 0.095, xyz(sx * ELBOW, 0, z, rx=QUARTER))
        f.drum(f"lowerleg.{side}", "frame", 14, 0.09, 0.09, -0.10, 0.10, xyz(sx * HIP[0], 0, KNEE, ry=QUARTER))
        f.drum(f"lowerleg.{side}", "shell", 14, 0.05, 0.05, -0.11, 0.11, xyz(sx * HIP[0], 0, KNEE, ry=QUARTER))
        f.bar("chest", "frame", (sx * 0.085, 0.07, 1.17), (sx * 0.11, 0.09, 1.36), 0.018)
        f.bar("spine", "frame", (sx * 0.16, -0.03, 0.57), (sx * 0.19, -0.05, 0.80), 0.016)

    # ---- the head ----
    f.block("head", "shell", 0.84, 0.60, 0.60, xyz(0, 0.02, face), 0.15, 5)
    # A dark panel let into the crown, the way the helmet in the picture is pieced.
    f.block("head", "frame", 0.30, 0.40, 0.02, xyz(0, 0.06, face + 0.295), 0.008, 2)
    # The faceplate, sunk into a black surround.
    f.block("head", "frame", 0.72, 0.07, 0.44, xyz(0, -0.272, face - 0.01), 0.10, 4)
    f.block("head", "glass", 0.64, 0.05, 0.36, xyz(0, -0.268, face - 0.01), 0.08, 4)
    # A brow over each eye, and a jaw under the plate.
    for sx in (-1, 1):
        f.block("head", "shell", 0.30, 0.07, 0.07, xyz(sx * 0.18, -0.292, face + 0.235, ry=sx * 0.10), 0.02, 3)
    f.block("head", "shell", 0.42, 0.09, 0.075, xyz(0, -0.262, face - 0.262), 0.02, 3)
    for sx in (-0.09, 0.0, 0.09):
        f.block("head", "frame", 0.05, 0.02, 0.016, xyz(sx, -0.31, face - 0.262), 0.004, 1)
    # The eyes: a housing, a ring of light, a lens, and the point of light in it.
    for sx in (-1, 1):
        eye = xyz(sx * 0.17, -0.292, face, rx=QUARTER, rz=-sx * 0.06)
        f.drum("head", "frame", 20, 0.122, 0.112, 0.0, 0.05, eye)
        f.drum("head", "lamp", 20, 0.098, 0.098, 0.05, 0.057, eye)
        f.drum("head", "frame", 20, 0.074, 0.070, 0.05, 0.066, eye)
        f.ball("head", "glass", 0.064, eye @ Matrix.Translation((0, 0, 0.062)), (1.0, 1.0, 0.42), 16, 10)
        f.drum("head", "lamp", 12, 0.021, 0.021, 0.086, 0.091, eye)
    # Ears: a cup in layers, ringed in light.
    for sx in (-1, 1):
        cup = xyz(sx * 0.42, 0.03, face, ry=sx * QUARTER)
        f.drum("head", "frame", 20, 0.195, 0.180, 0.0, 0.06, cup)
        f.drum("head", "shell", 20, 0.158, 0.150, 0.06, 0.085, cup)
        f.drum("head", "frame", 20, 0.128, 0.128, 0.085, 0.10, cup)
        f.drum("head", "lamp", 20, 0.108, 0.108, 0.10, 0.107, cup)
        f.drum("head", "frame", 12, 0.072, 0.062, 0.10, 0.128, cup)
        for k in range(4):
            a = k * TAU / 4 + TAU / 8
            bolt("head", cup @ Matrix.Translation((math.cos(a) * 0.142, math.sin(a) * 0.142, 0.085)))
    # A grab bar on top, and the aerial.
    for sx in (-1, 1):
        f.bar("head", "frame", (sx * 0.10, 0.04, face + 0.29), (sx * 0.10, 0.04, face + 0.345), 0.016)
    f.bar("head", "frame", (-0.115, 0.04, face + 0.345), (0.115, 0.04, face + 0.345), 0.018)
    f.bar("head", "frame", (0.47, 0.07, face + 0.12), (0.52, 0.13, face + 0.56), 0.026)
    f.bar("head", "lamp", (0.513, 0.122, face + 0.50), (0.518, 0.128, face + 0.545), 0.029)
    f.bar("head", "frame", (0.47, 0.07, face + 0.10), (0.474, 0.075, face + 0.15), 0.04)

    # ---- the body: a black core, plated in pieces ----
    f.block("chest", "frame", 0.50, 0.36, 0.40, xyz(0, 0, 0.985), 0.07, 3)
    f.block("chest", "frame", 0.64, 0.17, 0.07, xyz(0, 0, 1.165), 0.02, 2)
    f.block("chest", "shell", 0.36, 0.10, 0.36, xyz(0, -0.165, 0.995), 0.04, 3)
    for sx in (-1, 1):
        f.block("chest", "shell", 0.11, 0.30, 0.33, xyz(sx * 0.255, -0.02, 0.99, rz=sx * 0.30), 0.035, 3)
        f.block("chest", "lamp", 0.012, 0.022, 0.11, xyz(sx * 0.213, -0.196, 1.0, rz=sx * 0.30), 0.004, 1)
        for sz in (0.865, 1.125):
            bolt("chest", xyz(sx * 0.14, -0.216, sz, rx=QUARTER))
    f.block("chest", "shell", 0.42, 0.09, 0.32, xyz(0, 0.175, 0.995), 0.035, 3)
    f.drum("chest", "frame", 12, 0.21, 0.18, 1.17, 1.215)
    # The mark.
    mark = xyz(0, -0.216, 1.0, rx=QUARTER)
    f.drum("chest", "lamp", 6, 0.10, 0.10, 0.0, 0.008, mark)
    f.drum("chest", "frame", 6, 0.078, 0.078, 0.008, 0.012, mark)
    for sx in (-1, 1):
        f.block("chest", "lamp", 0.017, 0.008, 0.07, xyz(sx * 0.028, -0.23, 1.0), 0.002, 1)
    # Top left to bottom right as you face it: the other way round it reads as a Cyrillic I.
    f.block("chest", "lamp", 0.017, 0.008, 0.088, xyz(0, -0.23, 1.0, ry=-0.68), 0.002, 1)
    # A belly plate, and the pelvis in three.
    f.block("spine", "shell", 0.20, 0.05, 0.13, xyz(0, -0.135, 0.69), 0.02, 2)
    f.block("hips", "shell", 0.26, 0.30, 0.15, xyz(0, 0, 0.50), 0.035, 3)
    for sx in (-1, 1):
        f.block("hips", "shell", 0.07, 0.22, 0.15, xyz(sx * 0.215, 0, 0.505, ry=-sx * 0.2), 0.02, 2)
    # The pack: vented, with a canister each side.
    f.block("chest", "shell", 0.30, 0.12, 0.28, xyz(0, 0.275, 1.0), 0.03, 3)
    for i in range(3):
        f.block("chest", "frame", 0.20, 0.012, 0.022, xyz(0, 0.338, 0.93 + i * 0.045), 0.004, 1)
    f.block("chest", "lamp", 0.14, 0.012, 0.026, xyz(0, 0.338, 1.09), 0.004, 1)
    for sx in (-1, 1):
        f.drum("chest", "frame", 10, 0.045, 0.045, 0.87, 1.15, xyz(sx * 0.19, 0.27))

    for side, sx in (("l", 1), ("r", -1)):
        z = SHOULDER[1]
        upper, lower, wrist = f"upperarm.{side}", f"lowerarm.{side}", f"wrist.{side}"
        # A pauldron, angled down over the joint, bolted at the corners.
        cap = xyz(sx * 0.285, 0, z + 0.075, ry=sx * 0.30)
        f.block(upper, "shell", 0.25, 0.28, 0.10, cap, 0.035, 3)
        f.block(upper, "shell", 0.07, 0.26, 0.20, xyz(sx * 0.385, 0, z + 0.005, ry=sx * 0.12), 0.025, 2)
        for dx in (-0.085, 0.085):
            for dy in (-0.10, 0.10):
                bolt(upper, cap @ Matrix.Translation((dx, dy, 0.05)))
        f.block(lower, "shell", 0.20, 0.17, 0.17, xyz(sx * 0.59, 0, z), 0.035, 3)
        f.block(lower, "shell", 0.13, 0.11, 0.025, xyz(sx * 0.59, 0, z + 0.092), 0.008, 2)
        f.block(lower, "lamp", 0.085, 0.012, 0.02, xyz(sx * 0.59, -0.088, z), 0.004, 1)
        f.block(wrist, "shell", 0.085, 0.12, 0.028, xyz(sx * (WRIST + 0.06), 0, z + 0.062), 0.008, 2)
        x = sx * HIP[0]
        f.block(f"upperleg.{side}", "shell", 0.17, 0.19, 0.15, xyz(x, 0, 0.405), 0.035, 3)
        f.block(f"lowerleg.{side}", "shell", 0.11, 0.045, 0.10, xyz(x, -0.105, KNEE + 0.01), 0.015, 2)
        f.block(f"lowerleg.{side}", "shell", 0.18, 0.20, 0.115, xyz(x, 0, 0.21), 0.035, 3)
        f.block(f"lowerleg.{side}", "lamp", 0.02, 0.012, 0.07, xyz(x, -0.103, 0.21), 0.004, 1)
        # A boot: plate over a black sole, with a toe cap.
        f.block(f"foot.{side}", "shell", 0.20, 0.22, 0.095, xyz(x, 0.0, 0.085), 0.03, 3)
        f.block(f"foot.{side}", "frame", 0.21, 0.23, 0.04, xyz(x, 0.0, 0.02), 0.01, 2)
        f.block(f"toes.{side}", "shell", 0.20, 0.16, 0.08, xyz(x, -0.17, 0.075), 0.03, 3)
        f.block(f"toes.{side}", "frame", 0.21, 0.17, 0.04, xyz(x, -0.17, 0.02), 0.01, 2)


# ---------- rock: stone over the frame ----------
def rock(f):
    frame(f)
    face = HEAD + 0.30
    n = iter(range(100, 200))

    f.stone("head", 0.74, 0.62, 0.62, xyz(0, 0.02, face), next(n))
    f.stone("head", 0.50, 0.36, 0.22, xyz(0.03, 0.04, face + 0.27, ry=0.12), next(n))
    # One eye, set in a socket, off to one side.
    eye = xyz(0.15, -0.295, face + 0.02, rx=QUARTER)
    f.drum("head", "frame", 12, 0.095, 0.085, 0.0, 0.03, eye)
    f.drum("head", "lamp", 12, 0.05, 0.05, 0.03, 0.036, eye)

    f.stone("chest", 0.66, 0.46, 0.46, xyz(0, 0, 0.99), next(n))
    f.stone("chest", 0.40, 0.20, 0.30, xyz(0.02, 0.24, 1.02), next(n))
    f.stone("hips", 0.48, 0.36, 0.22, xyz(0, 0, 0.49), next(n))
    for side, sx in (("l", 1), ("r", -1)):
        z = SHOULDER[1]
        f.stone(f"upperarm.{side}", 0.30, 0.30, 0.28, xyz(sx * 0.285, 0, z + 0.03), next(n))
        f.stone(f"upperarm.{side}", 0.15, 0.17, 0.17, xyz(sx * 0.38, 0, z), next(n))
        f.stone(f"lowerarm.{side}", 0.24, 0.22, 0.22, xyz(sx * 0.59, 0, z), next(n))
        f.stone(f"wrist.{side}", 0.17, 0.19, 0.17, xyz(sx * (WRIST + 0.07), 0, z + 0.035), next(n))
        x = sx * HIP[0]
        f.stone(f"upperleg.{side}", 0.20, 0.22, 0.18, xyz(x, 0, 0.405), next(n))
        f.stone(f"lowerleg.{side}", 0.22, 0.24, 0.16, xyz(x, 0, 0.21), next(n))
        f.stone(f"foot.{side}", 0.24, 0.26, 0.15, xyz(x, 0.0, 0.075), next(n))
        f.stone(f"toes.{side}", 0.23, 0.19, 0.12, xyz(x, -0.17, 0.06), next(n))


KINDS = {"unit": unit, "rock": rock}


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


def worn_paint(name, color, detail):
    """
    The campus's chipped paint (`NX_Amber_Paint`: wear along every edge, grime in every hollow)
    in another colour, and with its wear at the scale of something a metre and a half tall.
    """
    existing = bpy.data.materials.get(name)
    if existing:
        bpy.data.materials.remove(existing)
    material = bpy.data.materials["NX_Amber_Paint"].copy()
    material.name = name
    nodes = material.node_tree.nodes
    nodes["Color"].outputs[0].default_value = (*color, 1)
    nodes["Mix"].inputs["A"].default_value = (*color, 1)
    for node in nodes:
        if node.type == "MAPPING":
            node.inputs["Scale"].default_value = [v * detail for v in node.inputs["Scale"].default_value]
    return material
# What each finish looks like in a render here. The game has its own materials for them.
LOOKS = {
    "unit": {
        "shell": lambda: bpy.data.materials.get("NX_Cream_Paint") or worn_paint("NX_Cream_Paint", (0.62, 0.58, 0.49), 3.5),
        "frame": lambda: bpy.data.materials["NX_Steel_Black"],
        "glass": lambda: preview("Crew_Glass", (0.003, 0.003, 0.005), 0.0, 0.06),
        "lamp": lambda: preview("Crew_Lamp", (0, 0, 0), 0.0, 0.5, AMBER),
    },
    "rock": {
        "shell": lambda: preview("Crew_Stone", (0.115, 0.082, 0.058), 0.0, 0.9),
        "frame": lambda: preview("Crew_Frame", (0.012, 0.012, 0.014), 0.6, 0.35),
        "glass": lambda: preview("Crew_Glass", (0.003, 0.003, 0.005), 0.0, 0.06),
        "lamp": lambda: preview("Crew_Lamp", (0, 0, 0), 0.0, 0.5, AMBER),
    },
}

built = {}
for kind, make in KINDS.items():
    if globals().get("ONLY_KIND") and kind != ONLY_KIND:
        continue
    figure = Figure()
    make(figure)
    title = "NX_Crew_" + kind.capitalize()
    collection = bpy.data.collections.get(title) or bpy.data.collections.new(title)
    if collection.name not in [c.name for c in bpy.context.scene.collection.children]:
        bpy.context.scene.collection.children.link(collection)
    collection.hide_render = collection.hide_viewport = False
    for old in list(collection.objects):
        bpy.data.objects.remove(old, do_unlink=True)

    triangles = 0
    bpy.ops.object.select_all(action="DESELECT")
    for key, bm in figure.parts.items():
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new(f"{kind}_{key}")
        bm.to_mesh(mesh)
        bm.free()
        finish = key.split("__")[1]
        mesh.materials.append(LOOKS[kind][finish]())
        for polygon in mesh.polygons:
            polygon.use_smooth = True
        # Stone is faceted, so every face of it catches the light on its own.
        mesh.set_sharp_from_angle(angle=math.radians(12 if kind == "rock" and finish == "shell" else 38))
        mesh.calc_loop_triangles()
        triangles += len(mesh.loop_triangles)
        made = bpy.data.objects.new(key, mesh)
        collection.objects.link(made)
        made.select_set(True)
        bpy.context.view_layer.objects.active = made

    target = os.path.join(HERE, f"nodexeus-crew-{kind}.glb")
    bpy.ops.export_scene.gltf(
        filepath=target, use_selection=True, export_format="GLB", export_apply=True, export_yup=True,
        export_materials="NONE", export_texcoords=False,
    )
    built[kind] = {"glb": target, "bytes": os.path.getsize(target), "triangles": triangles, "parts": len(collection.objects)}

result = built
