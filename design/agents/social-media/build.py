"""Build the social media specialist from the approved reference.

Run: Blender --background --factory-startup --python design/agents/social-media/build.py
The current interactive Blender document is never touched. Coordinates are Z-up,
front -Y. Parts stay editable and rigidly weighted to a dedicated mechanical rig.
"""
import ast
import json
import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
CAMPUS = ROOT / 'design/campus'
TAU = math.tau
Q = math.pi / 2

# Reuse the existing modeler's geometry primitives without executing its scene edits.
def definitions(path, names, scope):
    tree = ast.parse(path.read_text())
    body = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in names]
    exec(compile(ast.Module(body=body, type_ignores=[]), str(path), 'exec'), scope)

definitions(CAMPUS / 'build_buildings.py', {'xyz', 'prism', 'rod'}, globals())
definitions(CAMPUS / 'build_crew.py', {'Figure', 'for_baking', 'preview'}, globals())

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for collection in list(bpy.data.collections):
    if not collection.objects:
        bpy.data.collections.remove(collection)

source = bpy.data.collections.new('Social Media — editable parts')
bpy.context.scene.collection.children.link(source)
props = bpy.data.collections.new('Camera — removable accessory')
bpy.context.scene.collection.children.link(props)

def material(name, color, metal=.65, rough=.4, wear=True, emit=None):
    m = preview('Social_' + name, color, metal, rough, emission=emit)
    tree = m.node_tree
    shader = tree.nodes.get('Principled BSDF')
    socket = None
    if wear:
        tex = tree.nodes.new('ShaderNodeTexNoise')
        tex.inputs['Scale'].default_value = 95
        tex.inputs['Detail'].default_value = 3
        ramp = tree.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = .28
        ramp.color_ramp.elements[0].color = (.025, .02, .017, 1)
        ramp.color_ramp.elements[1].position = .35
        ramp.color_ramp.elements[1].color = (*color, 1)
        clean = ramp.color_ramp.elements.new(.78)
        clean.color = (*color, 1)
        worn = ramp.color_ramp.elements.new(.84)
        worn.color = (.37, .28, .17, 1)
        tree.links.new(tex.outputs['Fac'], ramp.inputs['Fac'])
        tree.links.new(ramp.outputs['Color'], shader.inputs['Base Color'])
        bump = tree.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = .18
        bump.inputs['Distance'].default_value = .004
        tree.links.new(tex.outputs['Fac'], bump.inputs['Height'])
        tree.links.new(bump.outputs['Normal'], shader.inputs['Normal'])
        socket = ramp.outputs['Color']
    if emit:
        shader.inputs['Emission Strength'].default_value = 3
    return for_baking(m, socket, roughness=rough, metallic=metal, emission=emit or (0,0,0))

LOOKS = {
    'purple': material('anodized-violet', (.24,.055,.44)),
    'teal': material('worn-petrol', (.018,.32,.30)),
    'cream': material('ivory-paint', (.70,.63,.49), .25,.52),
    'frame': material('graphite', (.024,.029,.035), .8,.31),
    'gold': material('aged-brass', (.55,.30,.065), .8,.29),
    'steel': material('machined-steel', (.25,.29,.31), .85,.28),
    'fabric': material('cap-and-bag', (.017,.013,.022), .05,.84,False),
    'rubber': material('rubber', (.012,.014,.018), 0,.7,False),
    'glass': material('black-optical-glass', (.003,.007,.014), .32,.085, False),
    'eye': material('amber-display', (0,0,0), 0,.3,False,(1,.40,.008)),
    'lamp': material('amber-light', (0,0,0),0,.3,False,(1,.40,.008)),
    'lamp.violet': material('violet-light',(0,0,0),0,.35,False,(.4,.035,1)),
}

# Fabric has fine woven relief without making the entire cap look rusted.
cloth = LOOKS['fabric'].node_tree
noise = cloth.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value=240
bump = cloth.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.3
bump.inputs['Distance'].default_value=.0015
cloth.links.new(noise.outputs['Fac'],bump.inputs['Height'])
cloth.links.new(bump.outputs['Normal'],cloth.nodes['PBR'].inputs['Normal'])

f = Figure()

def ring(bone, finish, radius, tube, transform, segments=36, cross=6, start=0, arc=TAU):
    bm = f.part(bone, finish)
    rows = []
    count = segments if arc == TAU else segments + 1
    for i in range(count):
        a = start + arc*i/segments
        rows.append([bm.verts.new(transform @ Vector(((radius+tube*math.cos(TAU*j/cross))*math.cos(a),
                  (radius+tube*math.cos(TAU*j/cross))*math.sin(a), tube*math.sin(TAU*j/cross)))) for j in range(cross)])
    for i in range(segments):
        k = (i+1)%count
        for j in range(cross):
            n = (j+1)%cross
            bm.faces.new((rows[i][j],rows[k][j],rows[k][n],rows[i][n]))

def tube(bone, finish, points, radius=.009, sides=6):
    for a,b in zip(points,points[1:]): f.bar(bone,finish,a,b,radius,sides)

def bolt(bone, transform, radius=.012):
    f.drum(bone,'gold',6,radius,radius,0,.009,transform)
    f.drum(bone,'frame',6,radius*.4,radius*.4,.009,.010,transform)

def emblem(bone, transform, size=.06):
    points=[Vector((math.sin(i*TAU/6)*size,math.cos(i*TAU/6)*size,0)) for i in range(7)]
    for a,b in zip(points,points[1:]): f.bar(bone,'gold',transform@a,transform@b,size*.055,5)
    points=[(-.37,-.46),(-.37,.46),(.37,-.46),(.37,.46)]
    for a,b in zip(points,points[1:]):
        f.bar(bone,'gold',transform@Vector((a[0]*size,a[1]*size,0)),transform@Vector((b[0]*size,b[1]*size,0)),size*.11,5)

def disk(bone, finish, x,y,z,r,depth=.025, axis='front'):
    f.drum(bone,finish,24,r,r,-depth/2,depth/2,xyz(x,y,z,rx=Q if axis=='front' else 0,ry=Q if axis=='side' else 0))

# Long-legged proportions read from the image, independent of KayKit's short rig.
HZ, SZ, HIP, KNEE, ANKLE = 1.82, 1.38, .88, .49, .17
EX, WX = .54, .86
for z,r in [(1.46,.074),(1.51,.067),(1.56,.073)]:
    f.drum('chest','frame',16,r,r,z-.018,z+.018)
for x in [-.047,.047]: f.bar('chest','gold',(x,-.018,1.44),(x,-.018,1.59),.013,10)

# Circular face casing, segmented bezel, curved optical display.
disk('head','frame',0,.014,HZ,.328,.27)
disk('head','teal',0,-.08,HZ,.317,.10)
disk('head','gold',0,-.146,HZ,.292,.04)
disk('head','frame',0,-.178,HZ,.275,.025)
ring('head','lamp',.268,.007,xyz(0,-.195,HZ,rx=Q),48,5)
ring('head','gold',.246,.009,xyz(0,-.209,HZ,rx=Q),48,6)
f.ball('head','glass',.242,xyz(0,-.203,HZ),(1,.30,1),40,20)
for i in range(12):
    a=TAU*i/12
    bolt('head',xyz(math.sin(a)*.301,-.147,HZ+math.cos(a)*.301,rx=Q),.010)
for a in [3.4,4.35,5.45]:
    ring('head','purple',.322,.016,xyz(0,-.101,HZ,rx=Q),10,5,a,.56)
# Display elements lie in front of the optical dome, each on a controllable eye bone.
ring('eye.l','eye',.063,.011,xyz(-.093,-.280,HZ+.025,rx=Q),30,6)
for i in range(18):
    a=TAU*i/18
    disk('eye.l','eye',-.093+math.sin(a)*.084,-.274,HZ+.025+math.cos(a)*.084,.0035,.002)
ring('eye.r','eye',.063,.011,xyz(.093,-.280,HZ+.025,rx=Q),30,6)

# Earphones, ribbed cushions and articulated band.
for sx in [-1,1]:
    x=sx*.338
    for xx,r,mat,d in [(x,.183,'rubber',.07),(sx*.38,.171,'gold',.03),(sx*.407,.15,'purple',.04),(sx*.433,.122,'frame',.01)]:
        disk('head',mat,xx,.028,HZ+.035,r,d,'side')
    for i in range(22):
        a=TAU*i/22
        f.block('head','frame',.055,.013,.026,xyz(sx*.35,.028+math.sin(a)*.17,HZ+.035+math.cos(a)*.17,rx=-a),.004,1)
    ring('head','lamp',.145,.006,xyz(sx*.43,.028,HZ+.035,ry=Q),20,5,.2,2.45)
    emblem('head',xyz(sx*.442,.028,HZ+.035,ry=sx*Q),.087)
    f.block('head','steel',.032,.08,.16,xyz(sx*.335,.03,HZ+.22,ry=sx*.22),.01,2)

# Backward soft cap: open-bottom dome, stitches, back strap and broad brim.
bm=f.part('head','fabric'); rows=[]
for j in range(11):
    theta=.05+(Q-.05)*j/10
    rows.append([bm.verts.new((.343*math.sin(theta)*math.cos(TAU*i/40),
                 .055+.305*math.sin(theta)*math.sin(TAU*i/40),2.024+.20*math.cos(theta))) for i in range(40)])
for j in range(10):
    for i in range(40): bm.faces.new((rows[j][i],rows[j][(i+1)%40],rows[j+1][(i+1)%40],rows[j+1][i]))
f.ball('head','purple',1,xyz(-.085,.333,2.033,rz=-.22),(.36,.25,.027),32,10)
f.block('head','fabric',.27,.025,.057,xyz(.05,-.235,2.047,ry=-.04),.015,3)
for i in range(7): disk('head','frame',-.04+i*.026,-.25,2.047,.007,.004)
for a in [0,Q,math.pi,3*Q]:
    pts=[]
    for j in range(14):
        t=.12+1.40*j/13
        pts.append((.345*math.sin(t)*math.cos(a),.055+.307*math.sin(t)*math.sin(a),2.024+.202*math.cos(t)))
    tube('head','frame',pts,.003,5)
emblem('head',xyz(-.13,-.238,2.132,rx=Q),.055)

# Torso: tapered armor, inset panel, straps and small cross-body pouch.
f.block('chest','frame',.38,.25,.36,xyz(0,0,1.252),.07,3)
f.block('chest','purple',.33,.045,.29,xyz(0,-.139,1.275,ry=-.06),.048,3)
f.block('chest','teal',.085,.052,.29,xyz(-.16,-.106,1.265,ry=-.15),.026,2)
f.block('chest','gold',.20,.035,.045,xyz(0,-.151,1.423),.008,2)
f.block('chest','lamp',.115,.008,.018,xyz(0,-.172,1.423),.004,1)
for sx in [-1,1]:
    f.block('chest','fabric',.049,.028,.43,xyz(sx*.164,-.13,1.26,ry=sx*.12),.012,2)
    for z in [1.11,1.37]:
        f.block('chest','gold',.06,.016,.044,xyz(sx*.155,-.154,z),.009,2)
    for z in [1.18,1.32]: bolt('chest',xyz(sx*.105,-.168,z,rx=Q),.008)
f.block('chest','fabric',.17,.095,.21,xyz(.09,-.202,1.17,ry=-.08),.027,3)
f.block('chest','frame',.146,.012,.18,xyz(.09,-.254,1.17),.025,3)
emblem('chest',xyz(.09,-.263,1.18,rx=Q),.047)
for z in [.96,1.01,1.06]:
    f.drum('spine','frame',16,.105,.105,z-.015,z+.015)
    f.drum('spine','gold',16,.087,.087,z+.015,z+.023)
f.block('hips','teal',.32,.22,.115,xyz(0,0,HIP+.028),.035,3)

# Backpack with a side-mounted board, canisters, seams and buckles.
f.block('chest','fabric',.37,.22,.46,xyz(0,.213,1.22),.055,3)
f.block('chest','frame',.31,.035,.35,xyz(0,.337,1.22),.035,3)
for sx in [-1,1]:
    f.block('chest','gold',.017,.017,.37,xyz(sx*.159,.36,1.22),.005,2)
    f.block('chest','fabric',.055,.035,.49,xyz(sx*.105,.34,1.22),.01,2)
    f.block('chest','gold',.058,.012,.065,xyz(sx*.105,.363,1.03),.01,2)
for x,z,mat in [(-.13,1.51,'purple'),(0,1.57,'gold'),(.13,1.53,'teal')]:
    f.drum('chest',mat,16,.043,.043,1.3,z,xyz(x,.24))
    f.drum('chest','gold',16,.045,.045,z-.012,z,xyz(x,.24))
f.block('chest','frame',.17,.05,.60,xyz(-.27,.20,1.14,ry=-.10),.08,5)
f.block('chest','gold',.145,.009,.56,xyz(-.27,.168,1.14,ry=-.10),.068,5)
f.block('chest','fabric',.13,.009,.535,xyz(-.27,.159,1.14,ry=-.10),.060,5)
emblem('chest',xyz(-.27,.151,1.17,rx=Q),.046)
tube('chest','purple',[(-.24,-.005,1.38),(-.25,-.12,1.24),(-.20,-.22,1.08),(-.13,-.21,1.01)],.013,8)
ring('hips','gold',.028,.006,xyz(-.18,-.15,.935,rx=Q),16,6)
disk('hips','gold',-.18,-.154,.867,.044,.014)
disk('hips','frame',-.18,-.164,.867,.037,.012)
for x in [-.192,-.168]: disk('hips','lamp',x,-.173,.876,.004,.004)
ring('hips','lamp',.022,.003,xyz(-.18,-.174,.865,rx=Q),10,5,math.pi,math.pi)

# Arms and legs are independent mechanical assemblies; no mesh bends across joints.
for side,sx in [('l',1),('r',-1)]:
    u,l,w=f'upperarm.{side}',f'lowerarm.{side}',f'wrist.{side}'
    for b,x,r in [(u,.24,.11),(l,EX,.080),(w,WX,.053)]:
        disk(b,'frame',sx*x,0,SZ,r,.15)
        disk(b,'gold',sx*x,-.085,SZ,r*.72,.018)
        disk(b,'frame',sx*x,-.101,SZ,r*.47,.018)
        bolt(b,xyz(sx*x,-.115,SZ,rx=Q),r*.20)
        disk(b,'steel',sx*x,.084,SZ,r*.76,.012)
        disk(b,'frame',sx*x,.093,SZ,r*.53,.012)
        bolt(b,xyz(sx*x,.104,SZ,rx=-Q),r*.19)
    f.bar(u,'steel',(sx*.27,.018,SZ),(sx*(EX-.07),.018,SZ),.036,12)
    f.block(u,'purple',.22,.12,.115,xyz(sx*.393,-.015,SZ+.025),.025,3)
    f.block(u,'teal',.10,.15,.12,xyz(sx*.267,0,SZ+.065),.035,3)
    f.block(u,'lamp',.135,.008,.012,xyz(sx*.397,-.08,SZ+.034),.004,1)
    f.bar(l,'steel',(sx*(EX+.04),.035,SZ),(sx*(WX-.04),.035,SZ),.037,12)
    for dy in [-.045,.065]:
        f.bar(l,'gold',(sx*(EX+.055),dy,SZ-.027),(sx*(WX-.04),dy,SZ-.027),.009,8)
    f.block(l,'purple',.205,.108,.117,xyz(sx*.694,-.022,SZ+.014),.028,3)
    f.block(l,'teal',.104,.105,.105,xyz(sx*.782,-.012,SZ),.027,3)
    f.block(l,'cream',.18,.02,.042,xyz(sx*.69,-.081,SZ-.015),.01,2)
    for x in [.62,.75]: bolt(l,xyz(sx*x,-.096,SZ-.015,rx=Q),.008)
    for x in [.82,.84]: disk(l,'gold',sx*x,0,SZ,.055,.009,'side')
    f.block(w,'frame',.096,.107,.058,xyz(sx*(WX+.059),0,SZ),.018,3)
    f.block(w,'gold',.065,.09,.012,xyz(sx*(WX+.052),0,SZ+.034),.012,2)
    # Four separate knuckled fingers, with a dedicated bone apiece.
    for j in range(4):
        b=f'finger{j}.{side}'; y=(j-1.5)*.026
        length=[.083,.10,.091,.068][j]
        f.bar(b,'frame',(sx*(WX+.102),y,SZ),(sx*(WX+.10+length),y,SZ),.012,8)
        f.block(b,'steel',length*.70,.021,.026,xyz(sx*(WX+.112+length*.42),y,SZ+.009),.009,2)
        f.ball(b,'gold',.014,xyz(sx*(WX+.113),y,SZ),around=8,up=5)
    f.bar(w,'frame',(sx*(WX+.025),-.067,SZ),(sx*(WX+.102),-.069,SZ-.038),.016,8)
    x=sx*.17
    u,l,foot,toe=f'upperleg.{side}',f'lowerleg.{side}',f'foot.{side}',f'toes.{side}'
    disk(u,'frame',x,0,HIP,.093,.19,'side')
    disk(u,'gold',x+sx*.106,0,HIP,.065,.017,'side')
    f.bar(u,'steel',(x,0,HIP-.02),(x,0,KNEE+.03),.043,12)
    for dx in [-.045,.045]:
        f.bar(u,'gold',(x+dx,.045,HIP-.075),(x+dx,.045,KNEE+.08),.011,8)
    f.block(u,'cream' if side=='r' else 'purple',.132,.11,.264,xyz(x,-.035,.70,ry=sx*.05),.03,3)
    f.block(u,'frame',.04,.02,.20,xyz(x+sx*.071,-.075,.70),.009,2)
    f.block(u,'lamp.violet',.013,.008,.15,xyz(x+sx*.071,-.089,.70),.004,1)
    for z in [.60,.78]: bolt(u,xyz(x-sx*.029,-.095,z,rx=Q),.009)
    disk(l,'frame',x,0,KNEE,.083,.17,'side')
    disk(l,'gold',x+sx*.095,0,KNEE,.056,.022,'side')
    disk(l,'frame',x+sx*.110,0,KNEE,.035,.014,'side')
    f.bar(l,'steel',(x,0,KNEE-.035),(x,0,ANKLE),.035,12)
    for z in [.235,.26,.285,.31,.335]:
        f.drum(l,'gold',12,.047,.047,z,z+.009,xyz(x))
    f.block(l,'teal' if side=='r' else 'purple',.113,.061,.205,xyz(x,-.058,.367,ry=-sx*.09),.022,3)
    f.block(l,'cream',.035,.065,.183,xyz(x-sx*.057,-.050,.36),.016,2)
    for z in [.328,.355,.382]:
        f.block(l,'frame',.075,.008,.008,xyz(x,-.093,z),.002,1)
    bolt(l,xyz(x,-.096,.422,rx=Q),.011)
    # High-top sneakers with layered sole, toe cap, tongue, laces and brass eyelets.
    f.block(foot,'rubber',.215,.22,.03,xyz(x,.012,.02),.022,3)
    f.block(foot,'cream',.221,.23,.057,xyz(x,.005,.057),.025,3)
    f.block(foot,'purple',.19,.19,.15,xyz(x,.018,.137),.036,3)
    f.block(foot,'fabric',.12,.055,.14,xyz(x,-.09,.165,rx=-.15),.019,3)
    disk(foot,'gold',x+sx*.101,0,.172,.044,.012,'side')
    disk(foot,'frame',x+sx*.109,0,.172,.035,.009,'side')
    f.block(toe,'rubber',.215,.20,.03,xyz(x,-.178,.02),.033,3)
    f.block(toe,'cream',.221,.20,.057,xyz(x,-.178,.057),.038,3)
    f.block(toe,'purple',.193,.194,.088,xyz(x,-.174,.111),.04,3)
    f.block(toe,'frame',.18,.063,.061,xyz(x,-.25,.107),.026,3)
    for z,y in [(.13,-.147),(.16,-.105),(.188,-.079)]:
        for a in [-1,1]: bolt(foot,xyz(x+a*.065,y-.007,z,rx=Q),.009)
        f.bar(foot,'cream',(x-.06,y-.014,z),(x+.06,y-.014,z-.017),.007,6)
    for i in range(5): f.block(toe,'frame',.17,.008,.006,xyz(x,-.25+i*.022,.003),.001,1)

def emit_parts(figure, collection):
    objects=[]
    for key,bm in figure.parts.items():
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        mesh=bpy.data.meshes.new(key); bm.to_mesh(mesh); bm.free()
        finish=key.split('__')[1]
        mesh.materials.append(LOOKS[finish])
        for p in mesh.polygons: p.use_smooth=True
        mesh.set_sharp_from_angle(angle=math.radians(40))
        obj=bpy.data.objects.new(key,mesh); collection.objects.link(obj)
        obj['bone']=key.split('__')[0]
        obj['finish']=finish
        objects.append(obj)
    return objects

body=emit_parts(f,source)

# Camera is authored at a hand socket, exported independently and can be hidden.
f=Figure()
CX=WX+.05
f.bar('camera','frame',(CX,0,SZ-.13),(CX,0,SZ+.15),.028,12)
for z in [SZ-.09,SZ-.04,SZ+.01]: disk('camera','gold',CX,0,z,.030,.012,'vertical')
f.block('camera','frame',.20,.105,.132,xyz(CX,-.012,SZ+.20),.025,3)
f.block('camera','teal',.032,.112,.102,xyz(CX-.078,-.012,SZ+.20),.014,2)
disk('camera','gold',CX+.025,-.085,SZ+.20,.065,.032)
disk('camera','frame',CX+.025,-.11,SZ+.20,.061,.028)
disk('camera','glass',CX+.025,-.128,SZ+.20,.049,.012)
ring('camera','steel',.046,.004,xyz(CX+.025,-.136,SZ+.20,rx=Q),24,5)
f.bar('camera','steel',(CX,0,SZ+.265),(CX,0,SZ+.30),.013)
f.block('camera','gold',.216,.028,.132,xyz(CX,0,SZ+.361),.014,2)
f.block('camera','frame',.20,.03,.116,xyz(CX,-.01,SZ+.361),.011,2)
emblem('camera',xyz(CX,-.029,SZ+.361,rx=Q),.037)
accessories=emit_parts(f,props)

# An explicit rig manifest makes a different anatomy possible without changing action names.
joints={
    'root':((0,0,0),None), 'hips':((0,0,HIP),'root'),
    'spine':((0,0,.98),'hips'), 'chest':((0,0,1.24),'spine'),
    'head':((0,0,1.56),'chest'),
    'eye.l':((-.093,-.28,HZ+.025),'head'), 'eye.r':((.093,-.28,HZ+.025),'head'),
}
for side,sx in [('l',1),('r',-1)]:
    joints.update({f'upperarm.{side}':((sx*.24,0,SZ),'chest'),
                   f'lowerarm.{side}':((sx*EX,0,SZ),f'upperarm.{side}'),
                   f'wrist.{side}':((sx*WX,0,SZ),f'lowerarm.{side}'),
                   f'upperleg.{side}':((sx*.17,0,HIP),'hips'),
                   f'lowerleg.{side}':((sx*.17,0,KNEE),f'upperleg.{side}'),
                   f'foot.{side}':((sx*.17,0,ANKLE),f'lowerleg.{side}'),
                   f'toes.{side}':((sx*.17,-.1,.06),f'foot.{side}')})
    for j in range(4): joints[f'finger{j}.{side}']=((sx*(WX+.102),(j-1.5)*.026,SZ),f'wrist.{side}')
joints['camera']=((CX,0,SZ),'wrist.l')
arm=bpy.data.armatures.new('SocialMediaRig')
rig=bpy.data.objects.new('SocialMediaRig',arm)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig; rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name,(pos,parent) in joints.items():
    bone=arm.edit_bones.new(name); bone.head=pos; bone.tail=Vector(pos)+Vector((0,0,.09))
    if parent: bone.parent=arm.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
rig.show_in_front=True
for obj in body+accessories:
    bone=obj['bone']; group=obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    mod=obj.modifiers.new('Rigid mechanical skin','ARMATURE'); mod.object=rig
    obj.parent=rig
    for name,val in [('_bone',list(joints).index(bone)),('_light',1 if obj['finish']=='eye' else 2 if obj['finish'].startswith('lamp') else 0)]:
        attr=obj.data.attributes.new(name,'FLOAT','POINT')
        attr.data.foreach_set('value',[float(val)]*len(obj.data.vertices))

scene=bpy.context.scene
scene.render.fps=30
rig['reference']='agents/Finals/Social Media Specialist.png'
rig['rig_family']='social-humanoid-v1'
rig['front']='-Y'

exec(compile((HERE/'retarget.py').read_text(),str(HERE/'retarget.py'),'exec'),globals())
rig.animation_data.action=clips['idle']
scene.frame_set(1)

# Studio previews are cameras/lights in their own collection, excluded from GLB exports.
studio=bpy.data.collections.new('Studio — preview only'); scene.collection.children.link(studio)
def move_to_studio(obj):
    for coll in list(obj.users_collection): coll.objects.unlink(obj)
    studio.objects.link(obj)
def area(name,position,energy,color,size):
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.color=color;data.shape='DISK';data.size=size
    obj=bpy.data.objects.new(name,data);studio.objects.link(obj);obj.location=position
    obj.rotation_euler=(Vector((0,0,1.2))-obj.location).to_track_quat('-Z','Y').to_euler()
area('Key softbox',(3,-4,5),480,(.80,.87,1),4)
area('Warm rim',(-3,1,3),650,(1,.63,.26),3)
area('Violet fill',(-3,-2,2),200,(.62,.43,1),3)
area('Top reflection',(0,0,5),250,(1,1,1),3)
world=bpy.data.worlds.new('Studio world');world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.10,.12,.17,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.35;scene.world=world
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.012));ground=bpy.context.object;ground.name='Studio floor';move_to_studio(ground)
ground.data.materials.append(material('studio-floor',(.025,.029,.043),0,.6,False))
data=bpy.data.cameras.new('Portrait');camera=bpy.data.objects.new('Portrait',data);studio.objects.link(camera)
camera.location=(3,-6,2.6);camera.rotation_euler=(Vector((0,0,1.13))-camera.location).to_track_quat('-Z','Y').to_euler()
data.type='ORTHO';data.ortho_scale=2.85;scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=1000;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
scene.render.image_settings.file_format='PNG'

for obj in bpy.context.selected_objects: obj.select_set(False)
rig.select_set(True);bpy.context.view_layer.objects.active=rig
for screen in bpy.data.screens:
    for ar in screen.areas:
        if ar.type=='VIEW_3D':
            ar.spaces.active.region_3d.view_distance=3.5
            ar.spaces.active.region_3d.view_location=(0,0,1.1)
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'social-media.blend'))
(HERE/'rig.json').write_text(json.dumps({'id':'social-humanoid-v1','units':'metres','front':'-Y',
    'joints':{k:{'position':p,'parent':q} for k,(p,q) in joints.items()},
    'actions':list(clips),'motionSource':motion_source,'clipMetadata':motion['clips'],'reference':str(rig['reference'])},indent=2)+'\n')
scene.render.filepath=str(HERE/'preview.png');bpy.ops.render.render(write_still=True)
print('SOCIAL_BUILD_COMPLETE',len(body),'body parts',len(joints),'bones')
