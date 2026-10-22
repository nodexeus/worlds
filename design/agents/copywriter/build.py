"""Build the Copywriter reference as an editable, independently rigged character."""
import ast
import json
import math
from pathlib import Path
import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
CAMPUS=ROOT/'design/campus'
TAU=math.tau
Q=math.pi/2

def definitions(path,names):
    tree=ast.parse(path.read_text())
    nodes=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name in names]
    exec(compile(ast.Module(body=nodes,type_ignores=[]),str(path),'exec'),globals())

definitions(CAMPUS/'build_buildings.py',{'xyz','prism','rod'})
definitions(CAMPUS/'build_crew.py',{'Figure','preview','for_baking'})
definitions(HERE.parent/'social-media/build.py',{'material','ring','tube','bolt','emblem','disk','emit_parts'})
make_bolt=bolt
bolt_specs=[]
definitions(HERE.parent/'email-marketing/build.py',{'plate','panel','pod','seam','bolt','seat_bolts'})
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for coll in list(bpy.data.collections):
    if not coll.objects:bpy.data.collections.remove(coll)
source=bpy.data.collections.new('Copywriter — editable parts');bpy.context.scene.collection.children.link(source)
props=bpy.data.collections.new('Writing — removable accessories');bpy.context.scene.collection.children.link(props)
LOOKS={
 'cream':material('scribe-worn-ivory',(.68,.60,.46),.52,.46),
 'gold':material('scribe-brass',(.32,.192,.069),.8,.39),
 'steel':material('scribe-machined-steel',(.16,.18,.19),.85,.34),
 'frame':material('scribe-black-iron',(.021,.024,.028),.78,.40),
 'fabric':material('scribe-charcoal-scarf',(.032,.036,.043),0,.94,False),
 'thread':material('scribe-thread',(.27,.265,.235),0,.94,False),
 'leather':material('scribe-brown-leather',(.070,.032,.013),.02,.79),
 'rubber':material('scribe-rubber',(.013,.015,.018),0,.85,False),
 'paper':material('scribe-aged-paper',(.72,.62,.44),0,.86,False),
 'glass':material('scribe-optical-glass',(.004,.007,.009),.4,.08,False),
 'eye':material('scribe-iris',(0,0,0),0,.25,False,(1,.40,.006)),
 'lamp':material('scribe-status',(0,0,0),0,.3,False,(1,.36,.004)),
}
for finish in ('cream','gold','steel','frame','leather'):
    tree=LOOKS[finish].node_tree
    for node in tree.nodes:
        if node.bl_idname=='ShaderNodeTexNoise':node.inputs['Scale'].default_value=42 if finish=='cream' else 65
        if node.bl_idname=='ShaderNodeValToRGB':
            node.color_ramp.elements[0].position=.27
            node.color_ramp.elements[1].position=.33
            node.color_ramp.elements[-2].position=.74
            node.color_ramp.elements[-1].position=.80
            node.color_ramp.elements[-1].color=(.19,.13,.066,1)
            if finish=='cream':
                node.color_ramp.elements[0].position=.31
                node.color_ramp.elements[1].position=.37
                node.color_ramp.elements[-2].position=.70
                node.color_ramp.elements[-1].position=.76
cloth=LOOKS['fabric'].node_tree
noise=cloth.nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=230
bump=cloth.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.40;bump.inputs['Distance'].default_value=.002
cloth.links.new(noise.outputs['Fac'],bump.inputs['Height']);cloth.links.new(bump.outputs['Normal'],cloth.nodes['PBR'].inputs['Normal'])
f=Figure()
HZ,SZ,HIP,KNEE,ANKLE=2.035,1.59,1.035,.565,.145
SHOULDER,EX,WX,LEG=.258,.602,.937,.151

def qmark(bone,transform,size=.04):
    ring(bone,'thread',size,.003,transform,32,6)
    f.bar(bone,'thread',transform @ Vector((size*.30,-size*.34,0)),transform @ Vector((size*.95,-size*.96,0)),.0035,6)

def joint(bone,x,z,r=.075,side=False):
    f.ball(bone,'frame',r,xyz(x,0,z),around=20,up=12)
    if side:
        sx=1 if x>0 else -1
        disk(bone,'steel',x+sx*r*.65,0,z,r*.90,r*.85,'side')
        disk(bone,'frame',x+sx*r*1.13,0,z,r*.73,.018,'side')
        ring(bone,'gold',r*.55,.006,xyz(x+sx*r*1.25,0,z,ry=Q),28,6)
        disk(bone,'gold',x+sx*r*1.23,0,z,r*.31,.016,'side')
    else:
        disk(bone,'steel',x,-r*.63,z,r*.91,r*.80)
        disk(bone,'frame',x,-r*1.08,z,r*.73,.017)
        ring(bone,'gold',r*.55,.006,xyz(x,-r*1.20,z,rx=Q),28,6)
        disk(bone,'gold',x,-r*1.22,z,r*.29,.015)

# Single, mechanically layered optical eye in an ivory spherical casing.
f.ball('head','frame',1,xyz(0,.015,HZ),(.272,.213,.248),48,28)
f.ball('head','cream',1,xyz(-.005,.015,HZ+.005),(.285,.222,.239),48,28)
OX=.040
for finish,y,r,depth in [('frame',-.176,.215,.145),('steel',-.247,.201,.026),('frame',-.263,.185,.020),('glass',-.274,.163,.022)]:
    disk('head',finish,OX,y,HZ-.034,r,depth)
ring('head','gold',.177,.007,xyz(OX,-.278,HZ-.034,rx=Q),64,8)
ring('eye','eye',.126,.014,xyz(OX,-.291,HZ-.034,rx=Q),64,8)
ring('head','gold',.104,.004,xyz(OX,-.295,HZ-.034,rx=Q),56,6)
for i in range(48):
    a=TAU*i/48
    f.bar('eye','eye',(OX+math.cos(a)*.110,-.292,HZ-.034+math.sin(a)*.110),
        (OX+math.cos(a)*.146,-.292,HZ-.034+math.sin(a)*.146),.0018,5)
disk('head','frame',OX,-.293,HZ-.034,.088,.018)
f.ball('head','glass',1,xyz(OX,-.304,HZ-.034),(.074,.027,.074),32,20)
for a in [Q/2,3*Q/2,5*Q/2,7*Q/2]:
    bolt('head',xyz(OX+math.cos(a)*.192,-.28,HZ-.034+math.sin(a)*.192,rx=Q),.006)

# Fore-aft carapace. The front is an open transverse arch over the optic,
# not the closed tip of an oval disk; the rear narrows to a raised tail.
def canopy(u,v,inside=False):
    width=.315*math.sqrt(max(.0001,1-max(v,0)**2))*(1-.08*v)
    x=.015+width*u
    y=.035+.40*v
    z=HZ+.32+.045*v-.075*v*v-.20*u*u*(1-max(v,0)**2)
    return Vector((x,y,z-(.013 if inside else 0)))
bm=f.part('head','cream');rows=[];across=40;length=48
for inside in (False,True):
    side=[]
    for j in range(length+1):
        v=-1+1.995*j/length
        side.append([bm.verts.new(canopy(-1+2*i/across,v,inside)) for i in range(across+1)])
    rows.append(side)
    for before,after in zip(side,side[1:]):
        for i in range(across):
            points=(before[i],before[i+1],after[i+1],after[i])
            bm.faces.new(points[::-1] if inside else points)
for j in range(length):
    for i in [0,across]:
        bm.faces.new((rows[0][j][i],rows[1][j][i],rows[1][j+1][i],rows[0][j+1][i]))
for j in [0,length]:
    for i in range(across):
        bm.faces.new((rows[0][j][i],rows[0][j][i+1],rows[1][j][i+1],rows[1][j][i]))
for u in [-1,1]:
    seam('head',[canopy(u,-1+1.995*j/96) for j in range(97)],.0025,'gold')
for v in [-1,.995]:
    seam('head',[canopy(-1+2*i/80,v) for i in range(81)],.0025,'gold')
for u in [-.53,0,.53]:
    seam('head',[canopy(u,-1+1.995*j/96)+Vector((0,0,.0008)) for j in range(97)],.0017,'frame')
for v in [-.42,.43]:
    seam('head',[canopy(-1+2*i/80,v)+Vector((0,0,.0008)) for i in range(81)],.0017,'frame')
for u,v in [(-.67,-.32),(.67,-.32),(.25,.65)]:
    pos=canopy(u,v)
    bolt('head',xyz(pos.x,pos.y,pos.z+.015),.007)
# Left auditory/antenna mechanism, opposite a smaller blank service cover.
for sx,r in [(-1,.117),(1,.09)]:
    disk('head','frame',sx*.264,.045,HZ+.02,r,.075,'side')
    disk('head','steel',sx*.306,.045,HZ+.02,r*.85,.020,'side')
    ring('head','gold',r*.60,.006,xyz(sx*.32,.045,HZ+.02,ry=Q),36,6)
    disk('head','frame',sx*.327,.045,HZ+.02,r*.40,.016,'side')
antenna_base=Vector((-.328,.045,HZ+.02));antenna_tip=Vector((-.43,-.04,HZ+.40))
seam('head',[antenna_base,antenna_tip],.012,'frame')
for t in [.25,.45,.65,.85]:
    pos=antenna_base.lerp(antenna_tip,t)
    f.ball('head','gold',.015,xyz(*pos),around=12,up=8)
for x in [-.12,.12]:
    for y in [-.03,.14]:
        v=(y-.035)/.40
        width=.315*math.sqrt(1-max(v,0)**2)*(1-.08*v)
        roof=canopy((x-.015)/width,v)
        f.bar('head','frame',(x,y,HZ+.18),(x,y,roof.z-.017),.018,12)
# Recessed side vents and body seams.
for z in [HZ-.085,HZ-.04]:
    f.block('head','frame',.022,.023,.063,xyz(-.217,-.136,z,ry=-.25),.009,3)

# Slender torso, open waist mechanism, long ivory limb plates.
f.ball('chest','frame',1,xyz(0,.015,1.452),(.205,.148,.232),36,22)
f.ball('chest','cream',1,xyz(0,.045,1.50),(.196,.135,.204),36,22)
outline=[(-.178,1.672),(.178,1.672),(.215,1.526),(.125,1.31),(.074,1.279),(-.074,1.279),(-.125,1.31),(-.215,1.526)]
plate('chest','gold',outline,-.132,.054,.055,.024)
plate('chest','cream',[(x*.94,1.48+(z-1.48)*.95) for x,z in outline],-.149,.036,.05,.027)
seam('chest',[(0,-.178,1.64),(.008,-.181,1.52),(0,-.179,1.375)],.002,'frame')
seam('chest',[(-.138,-.175,1.482),(-.07,-.179,1.455),(0,-.181,1.45),(.07,-.179,1.455),(.138,-.175,1.482)],.002,'frame')
for sx in [-1,1]:
    seam('chest',[(sx*.08,-.158,1.29),(sx*.16,-.157,1.45),(sx*.178,-.144,1.65)],.003,'frame')
    for z,x in [(1.50,.12),(1.60,.13)]:bolt('chest',xyz(sx*x,-.19,z,rx=Q),.006)
    # Narrow leather harness with inset brass clasps.
    seam('chest',[(sx*.15,-.110,1.68),(sx*.18,-.19,1.53),(sx*.095,-.17,1.31)],.014,'leather')
    f.block('chest','gold',.042,.023,.045,xyz(sx*.17,-.19,1.56,ry=sx*.22),.007,3)
for z in [1.12,1.165,1.21,1.25]:
    f.drum('spine','frame',20,.084,.084,z-.019,z+.019)
    f.drum('spine','steel',20,.074,.074,z+.012,z+.022)
for sx in [-1,1]:
    f.bar('spine','steel',(sx*.060,0,1.10),(sx*.070,0,1.29),.018,12)
    seam('spine',[(sx*.063,-.045,1.09),(sx*.092,-.077,1.18),(sx*.073,-.088,1.28)],.008,'frame')
f.ball('hips','frame',1,xyz(0,.010,HIP),(.158,.119,.126),32,20)
plate('hips','cream',[(-.10,1.137),(.10,1.137),(.123,1.012),(.062,.913),(-.062,.913),(-.123,1.012)],-.100,.06,.045,.015)
seam('hips',[(0,-.117,1.105),(.018,-.122,1.005),(0,-.11,.932)],.002,'frame')
# Brown satchel on the opposite side to the scarf, split into strap and bag.
f.block('hips','leather',.255,.158,.375,xyz(-.310,.043,.942),.043,5)
panel('hips','gold',.232,.348,-.049,.024,-.310,.949,.042)
panel('hips','leather',.215,.329,-.063,.022,-.310,.949,.036)
panel('hips','leather',.215,.16,-.084,.022,-.310,1.045,.026)
for x in [-.367,-.251]:
    f.block('hips','leather',.035,.025,.244,xyz(x,-.084,.919),.01,3)
    f.block('hips','gold',.052,.027,.046,xyz(x,-.103,.925),.006,3)
for x in [-.378,-.250]:
    seam('hips',[(x,-.060,1.12),(x,-.064,1.18),(x+.055,-.064,1.22)],.013,'leather')
for i in range(3):f.block('hips','paper',.13,.013,.16,xyz(-.317,.003+i*.025,1.147+i*.008),.003,1)
f.block('hips','gold',.025,.024,.172,xyz(-.450,-.016,.967),.006,2)

# Exact shared pivots, rods reaching into joint centers and tapered armor.
for side,sx in [('l',1),('r',-1)]:
    u,l,w=f'upperarm.{side}',f'lowerarm.{side}',f'wrist.{side}'
    joint(u,sx*SHOULDER,SZ,.088);joint(l,sx*EX,SZ,.071);joint(w,sx*WX,SZ,.045)
    f.bar(u,'steel',(sx*SHOULDER,0,SZ),(sx*EX,0,SZ),.037,16)
    pod(u,'frame',.108,.111,.258,xyz(sx*.431,0,SZ,ry=sx*Q))
    pod(u,'cream',.122,.119,.242,xyz(sx*.426,-.027,SZ+.017,ry=sx*Q))
    seam(u,[(sx*.345,-.071,SZ+.028),(sx*.487,-.082,SZ+.025)],.002,'frame')
    f.bar(l,'frame',(sx*EX,0,SZ),(sx*WX,0,SZ),.034,16)
    for y in [-.041,.041]:f.bar(l,'steel',(sx*(EX+.02),y,SZ),(sx*(WX-.015),y,SZ),.009,10)
    pod(l,'cream',.111,.125,.275,xyz(sx*.770,-.009,SZ,ry=sx*Q))
    f.block(l,'frame',.058,.019,.009,xyz(sx*.778,-.071,SZ-.021),.004,3)
    f.block(l,'gold',.084,.013,.018,xyz(sx*.827,-.074,SZ),.006,2)
    for x in [.728,.801]:bolt(l,xyz(sx*x,-.105,SZ+.022,rx=Q),.006)
    f.block(w,'frame',.089,.096,.053,xyz(sx*(WX+.043),0,SZ),.022,4)
    f.block(w,'cream',.079,.083,.020,xyz(sx*(WX+.045),0,SZ+.025),.010,3)
    for j in range(4):
        b=f'finger{j}.{side}';y=(j-1.5)*.025;length=[.071,.085,.079,.059][j]
        f.bar(b,'frame',(sx*(WX+.081),y,SZ),(sx*(WX+.081+length),y,SZ),.011,10)
        for offset in [.09,.12]:
            f.ball(b,'steel',.014,xyz(sx*(WX+offset),y,SZ),around=12,up=8)
        f.block(b,'cream',length*.63,.021,.015,xyz(sx*(WX+.100+length*.29),y,SZ+.012),.006,3)
    f.bar(w,'steel',(sx*(WX+.026),-.056,SZ),(sx*(WX+.083),-.070,SZ-.032),.015,10)
    x=sx*LEG;u,l,foot,toe=f'upperleg.{side}',f'lowerleg.{side}',f'foot.{side}',f'toes.{side}'
    joint(u,x,HIP,.092,True);joint(l,x,KNEE,.073,True);joint(foot,x,ANKLE,.065,True)
    f.bar(u,'frame',(x,0,HIP),(x,0,KNEE),.037,16)
    pod(u,'frame',.125,.126,.345,xyz(x,.005,.807,ry=sx*.025))
    pod(u,'cream',.147,.130,.355,xyz(x,-.023,.817,ry=sx*.035))
    for z in [.76,.87]:bolt(u,xyz(x,-.115,z,rx=Q),.006)
    seam(u,[(x-sx*.026,-.087,.93),(x-sx*.026,-.09,.75),(x,-.080,.68)],.002,'frame')
    f.bar(l,'frame',(x,0,KNEE),(x,0,ANKLE),.032,14)
    for dx in [-.036,.036]:f.bar(l,'steel',(x+dx,0,.49),(x+dx,0,.205),.009,10)
    pod(l,'cream',.120,.110,.287,xyz(x,-.021,.389,ry=-sx*.07))
    f.block(l,'frame',.008,.022,.058,xyz(x-sx*.028,-.073,.42),.003,3)
    seam(l,[(x+.025,-.080,.47),(x+.021,-.079,.32),(x+.008,-.063,.252)],.002,'frame')
    bolt(l,xyz(x,-.10,.41,rx=Q),.006)
    # Exposed ankle actuators and slim long shoes.
    f.drum(foot,'rubber',32,1,1,0,.035,xyz(x,.004) @ Matrix.Diagonal((.099,.094,1,1)))
    f.drum(foot,'steel',32,1,.93,.035,.063,xyz(x,.002) @ Matrix.Diagonal((.102,.096,1,1)))
    f.ball(foot,'frame',1,xyz(x,.002,.109),(.091,.09,.076),28,18)
    pod(foot,'cream',.086,.096,.111,xyz(x,-.003,.163,rx=.20))
    f.drum(toe,'rubber',36,1,1,0,.035,xyz(x,-.162) @ Matrix.Diagonal((.108,.119,1,1)))
    f.drum(toe,'steel',36,1,.94,.035,.064,xyz(x,-.160) @ Matrix.Diagonal((.110,.120,1,1)))
    f.ball(toe,'frame',1,xyz(x,-.154,.095),(.101,.112,.059),32,20)
    f.ball(toe,'cream',1,xyz(x,-.142,.119),(.077,.099,.053),32,20)
    seam(toe,[(x,-.22,.15),(x,-.17,.172),(x,-.085,.153)],.002,'frame')
    for dx in [-.065,.065]:bolt(toe,xyz(x+dx,-.20,.125),.006)
# Cloth collar folds surround the neck, distinct from armor and optical casing.
f.drum('chest','frame',24,.060,.060,1.655,1.837)
for z in [1.68,1.72,1.76,1.80]:f.drum('chest','steel',24,.064,.064,z,z+.014)
f.ball('chest','fabric',1,xyz(0,-.010,1.777),(.232,.157,.098),40,24)
for z,sx,sy,tilt in [(1.731,.236,.164,.10),(1.775,.255,.172,-.05),(1.819,.239,.165,.06)]:
    scarf_mesh=f.part('chest','fabric');before=set(scarf_mesh.verts)
    ring('chest','fabric',1,.145,xyz(0,-.010,z,rx=tilt) @ Matrix.Diagonal((sx,sy,.20,1)),64,10)
    for v in set(scarf_mesh.verts)-before:
        a=math.atan2((v.co.y+.01)/sy,v.co.x/sx)
        v.co.z+=.012*math.sin(a*3+z*21)+.006*math.sin(a*7-z*17)
        v.co.y+=.006*math.cos(a*5+z*11)
# Long scarf tail: one continuous mesh, smoothly weighted to four cloth bones.
bm=f.part('scarf.0','fabric');cloth_rows=[]
for back in (False,True):
    rows=[]
    for i in range(51):
        t=i/50;z=1.80-.955*t;cx=.218+.045*t+.011*math.sin(t*math.pi*2)
        width=.146-.018*t
        rows.append([bm.verts.new((cx+width*(j/10-.5),-.203-.018*math.sin(t*math.pi)-.009*math.cos(j/10*math.pi*4)+(.011 if back else 0),z+.008*math.sin(j/10*math.pi*2))) for j in range(11)])
    cloth_rows.append(rows)
    for i in range(50):
        for j in range(10):
            quad=(rows[i][j],rows[i+1][j],rows[i+1][j+1],rows[i][j+1])
            bm.faces.new(quad[::-1] if back else quad)
for i in range(50):
    for j in [0,10]:bm.faces.new((cloth_rows[0][i][j],cloth_rows[1][i][j],cloth_rows[1][i+1][j],cloth_rows[0][i+1][j]))
for i in [0,50]:
    for j in range(10):bm.faces.new((cloth_rows[0][i][j],cloth_rows[0][i][j+1],cloth_rows[1][i][j+1],cloth_rows[1][i][j]))
for j in range(17):
    x=.198+j*.0077
    seam('scarf.0',[(x,-.207,.85),(x+.004*math.sin(j),-.210,.79+.01*math.sin(j*2))],.0025,'fabric')
qmark('scarf.0',xyz(.263,-.224,.965,rx=Q),.027)
seat_bolts()
body=emit_parts(f,source)

# An open leather-bound notebook and fountain pen, removable for work/phone clips.
f=Figure();BX=-(WX+.095)
for sx in [-1,1]:
    transform=xyz(BX+sx*.095,-.035,SZ+.165,rz=sx*.23)
    f.block('book','leather',.195,.022,.275,transform,.012,3)
    f.block('book','paper',.173,.033,.245,transform @ Matrix.Translation((0,-.024,.008)),.008,3)
    for i in range(6):
        seam('book',[(BX+sx*.018,-.063-i*.001,SZ+.06+i*.034),(BX+sx*.175,-.066-i*.001,SZ+.06+i*.034)],.0008,'gold')
f.bar('book','gold',(BX,-.02,SZ+.035),(BX,-.02,SZ+.297),.018,16)
qmark('book',xyz(BX-.105,.0,SZ+.16,rx=-Q),.037)
PX=WX+.062
f.bar('pen','frame',(PX,-.04,SZ-.055),(PX+.19,-.04,SZ+.30),.013,16)
f.bar('pen','gold',(PX+.10,-.04,SZ+.134),(PX+.19,-.04,SZ+.30),.016,16)
f.bar('pen','steel',(PX+.19,-.04,SZ+.30),(PX+.23,-.04,SZ+.37),.006,12)
accessories=emit_parts(f,props)

joints={'root':((0,0,0),None),'hips':((0,0,HIP),'root'),'spine':((0,0,1.17),'hips'),
 'chest':((0,0,1.46),'spine'),'head':((0,0,1.82),'chest'),'eye':((OX,-.29,HZ-.034),'head')}
for side,sx in [('l',1),('r',-1)]:
    joints.update({f'upperarm.{side}':((sx*SHOULDER,0,SZ),'chest'),f'lowerarm.{side}':((sx*EX,0,SZ),f'upperarm.{side}'),
        f'wrist.{side}':((sx*WX,0,SZ),f'lowerarm.{side}'),f'upperleg.{side}':((sx*LEG,0,HIP),'hips'),
        f'lowerleg.{side}':((sx*LEG,0,KNEE),f'upperleg.{side}'),f'foot.{side}':((sx*LEG,0,ANKLE),f'lowerleg.{side}'),
        f'toes.{side}':((sx*LEG,-.079,.060),f'foot.{side}')})
    for j in range(4):joints[f'finger{j}.{side}']=((sx*(WX+.081),(j-1.5)*.025,SZ),f'wrist.{side}')
joints['book']=((BX,-.035,SZ),'wrist.r');joints['pen']=((PX,-.04,SZ),'wrist.l')
SCARF=['scarf.0','scarf.1','scarf.2','scarf.3']
for i,z in enumerate([1.73,1.43,1.13,.86]):joints[SCARF[i]]=((.245,-.211,z),'chest' if i==0 else SCARF[i-1])
SOFT_BONES=set(SCARF)
arm=bpy.data.armatures.new('CopywriterRig');rig=bpy.data.objects.new('CopywriterRig',arm)
bpy.context.scene.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name,(pos,parent) in joints.items():
    bone=arm.edit_bones.new(name);bone.head=pos;bone.tail=Vector(pos)+Vector((0,0,.08))
    if parent:bone.parent=arm.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True
exec(compile((HERE/'cloth.py').read_text(),str(HERE/'cloth.py'),'exec'),globals())
for obj in body+accessories:
    bone=obj['bone'];group=obj.vertex_groups.new(name=bone);group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    if bone=='scarf.0':weight_scarf(obj,list(joints),all_vertices=True)
    mod=obj.modifiers.new('Character skin','ARMATURE');mod.object=rig;obj.parent=rig
    for name,val in [('_bone',list(joints).index(bone)),('_light',1 if obj['finish']=='eye' else 2 if obj['finish']=='lamp' else 0)]:
        attr=obj.data.attributes.new(name,'FLOAT','POINT');attr.data.foreach_set('value',[float(val)]*len(obj.data.vertices))
scene=bpy.context.scene;scene.render.fps=30
rig['reference']='agents/Finals/Copywriter.png';rig['rig_family']='scribe-humanoid-v1';rig['front']='-Y'
exec(compile((HERE.parent/'social-media/retarget.py').read_text(),str(HERE.parent/'social-media/retarget.py'),'exec'),globals())
rig.animation_data.action=clips['idle'];scene.frame_set(1)

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
area('Neutral fill',(-3,-2,2),200,(.72,.76,.82),3)
area('Top reflection',(0,0,5),250,(1,1,1),3)
world=bpy.data.worlds.new('Studio world');world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.10,.12,.17,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.35;scene.world=world
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.012));ground=bpy.context.object;ground.name='Studio floor';move_to_studio(ground)
ground.data.materials.append(material('studio-floor',(.025,.029,.043),0,.6,False))
data=bpy.data.cameras.new('Portrait');camera=bpy.data.objects.new('Portrait',data);studio.objects.link(camera)
camera.location=(3,-6,2.8);camera.rotation_euler=(Vector((0,0,1.24))-camera.location).to_track_quat('-Z','Y').to_euler()
data.type='ORTHO';data.ortho_scale=3.0;scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=True
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
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'copywriter.blend'))
(HERE/'rig.json').write_text(json.dumps({'id':'scribe-humanoid-v1','units':'metres','front':'-Y',
    'joints':{k:{'position':p,'parent':q} for k,(p,q) in joints.items()},
    'name':'Copywriter','asset':'copywriter','propLabel':'Book and pen','deformableBones':SCARF,'actions':list(clips),'motionSource':motion_source,'clipMetadata':motion['clips'],'reference':str(rig['reference'])},indent=2)+'\n')
scene.render.filepath=str(HERE/'preview.png');bpy.ops.render.render(write_still=True)
print('COPYWRITER_BUILD_COMPLETE',len(body),'body parts',len(joints),'bones')
