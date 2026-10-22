"""Build the glass-domed Business Strategist from its supplied reference in background Blender."""
import ast
import json
import math
from pathlib import Path
import bmesh
import bpy
from mathutils import Matrix, Vector, Quaternion
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
definitions(HERE.parent/'social-media/build.py',{'material','ring','tube','bolt','disk','emit_parts'})
make_bolt=bolt;bolt_specs=[]
definitions(HERE.parent/'email-marketing/build.py',{'plate','panel','pod','seam','bolt','seat_bolts'})
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for coll in list(bpy.data.collections):
    if not coll.objects:bpy.data.collections.remove(coll)
source=bpy.data.collections.new('Business Strategist — editable parts');bpy.context.scene.collection.children.link(source)
props=bpy.data.collections.new('Strategy — removable tablet and charts');bpy.context.scene.collection.children.link(props)
LOOKS={
 'armor':material('strategist-oil-rubbed-bronze',(.065,.031,.014),.86,.40),
 'gold':material('strategist-aged-bronze',(.24,.135,.047),.88,.34),
 'steel':material('strategist-polished-bronze',(.095,.048,.021),.90,.34),
 'frame':material('strategist-dark-bronze-machinery',(.018,.011,.007),.78,.38),
 'rubber':material('strategist-seals',(.008,.010,.012),0,.78,False),
 'glass':material('strategist-dark-optics',(.002,.004,.006),.35,.08,False),
 'eye':material('strategist-iris',(0,0,0),0,.22,False,(1,.35,.003)),
 'lamp':material('strategist-amber',(0,0,0),0,.25,False,(1,.29,.002)),
}
for finish in ('armor','gold','steel','frame'):
    for node in LOOKS[finish].node_tree.nodes:
        if node.bl_idname=='ShaderNodeTexNoise':node.inputs['Scale'].default_value=70
        if node.bl_idname=='ShaderNodeValToRGB':
            for el,p in zip(node.color_ramp.elements,[.28,.34,.73,.81]):el.position=p
            node.color_ramp.elements[-1].color=(.18,.105,.045,1)
f=Figure()
HZ,SZ,HIP,KNEE=1.94,1.305,1.045,.48
SHOULDER,EX,WX,LEG=.30,.61,.89,.265

def disk(bone,finish,x,y,z,r,depth=.025,axis='front'):
    f.drum(bone,finish,64 if r>.18 else 32,r,r,-depth/2,depth/2,
        xyz(x,y,z,rx=Q if axis=='front' else 0,ry=Q if axis=='side' else 0))

def seat_lamp(bone,x,z,width,height):
    # Place small emitters against their actual armor rather than a guessed Y.
    bm=f.part(bone,'armor');tree=BVHTree.FromBMesh(bm)
    hit,_,_,_=tree.ray_cast(Vector((x,-.4,z)),Vector((0,1,0)),.8)
    assert hit is not None,(bone,x,z)
    f.block(bone,'lamp',width,.014,height,xyz(x,hit.y-.003,z),.004,2)

# Inner optical head, visibly separate from the glass enclosure.
IZ=HZ-.065
f.ball('head','frame',1,xyz(0,-.038,IZ),(.293,.260,.282),48,28)
for a in [-2.45,-.70,.50,2.55]:
    pts=[]
    for j in range(25):
        p=.22+2.58*j/24
        pts.append((.296*math.sin(p)*math.cos(a),-.038+.262*math.sin(p)*math.sin(a),IZ+.284*math.cos(p)))
    seam('head',pts,.003,'steel')
for side,x in [('l',.118),('r',-.118)]:
    z=IZ+.016
    for finish,y,r,depth in [('steel',-.255,.112,.063),('frame',-.294,.099,.024),('gold',-.309,.087,.018),('glass',-.320,.076,.016)]:
        disk('head',finish,x,y,z,r,depth)
    ring('eye.'+side,'eye',.074,.014,xyz(x,-.334,z,rx=Q),48,8)
    for i in range(36):
        a=TAU*i/36
        f.bar('eye.'+side,'eye',(x+.042*math.cos(a),-.334,z+.042*math.sin(a)),
            (x+.086*math.cos(a),-.334,z+.086*math.sin(a)),.0013,5)
    disk('head','frame',x,-.335,z,.034,.016)
    f.ball('head','glass',1,xyz(x,-.350,z),(.027,.014,.027),24,16)
    ring('head','gold',.116,.011,xyz(x,-.292,z,rx=Q),26,6,.25,math.pi-.50)
    ring('head','lamp',.113,.004,xyz(x,-.307,z,rx=Q),26,6,.25,math.pi-.50)
# Pedestal and illuminated orbital rings below the floating inner head.
for z,r,finish in [(1.565,.28,'gold'),(1.586,.25,'frame'),(1.611,.22,'steel')]:
    f.drum('head',finish,48,r,r,z,z+.021)
ring('head','lamp',.256,.006,xyz(0,0,1.593),64,6)
ring('head','lamp',.224,.004,xyz(0,0,1.635,ry=.10),56,6)
# Wire globe and orbital halo in the clear space above the inner head.
GZ=2.266
for angle in [0,Q/2,Q,3*Q/2]:ring('head','lamp',.063,.0015,xyz(0,-.005,GZ,rx=Q,rz=angle),36,5)
for z,r in [(-.040,.049),(0,.063),(.040,.049)]:ring('head','lamp',r,.0015,xyz(0,-.005,GZ+z),36,5)
ring('head','lamp',.139,.0035,xyz(0,-.005,GZ-.01,rx=.14),64,6)
# Fine diagram lines inside the side and back of the enclosure.
for sx in [-1,1]:
    for j in range(5):
        x=sx*(.25+j*.018)
        seam('head',[(x,.055,1.73),(x,.055,1.94+j*.018),(x-sx*.04,.055,2.04+j*.016)],.0014,'gold')
    for z in [1.76,1.82,1.88]:seam('head',[(sx*.24,.054,z),(sx*.34,.054,z)],.0014,'lamp')
# Structural outer arch behind the clear sphere and thin equatorial seals.
ring('head','frame',.458,.025,xyz(0,.065,HZ,rx=Q),64,8)
ring('head','armor',.467,.017,xyz(0,.068,HZ,rx=Q),64,8)
ring('head','lamp',.441,.005,xyz(0,.043,HZ,rx=Q),64,6,.02,math.pi-.04)
# Glass seat and segmented armored cradle, fixed to the head joint.
for z,r,finish in [(1.599,.348,'frame'),(1.614,.340,'gold'),(1.625,.332,'lamp')]:
    if finish=='lamp':ring('head',finish,r,.0045,xyz(0,0,z+.006),64,6)
    else:f.drum('head',finish,64,r,r,z,z+.013)
for i in range(10):
    a=TAU*(i+.5)/10
    t=xyz(.343*math.cos(a),.343*math.sin(a),1.584,rz=a-Q)
    f.block('head','armor',.181,.043,.063,t,.014,3)
# Crown cap joins the glass near its top rather than hovering above it.
for z,r,depth,finish in [(2.383,.092,.024,'frame'),(2.402,.101,.018,'gold'),(2.417,.084,.022,'armor')]:
    f.drum('head',finish,48,r,r*.90,z,z+depth)
# Large lateral headset assemblies and narrow tapered antenna fins.
for side,sx,h in [('l',1,.31),('r',-1,.20)]:
    for finish,x,r,depth in [('frame',sx*.414,.181,.093),('gold',sx*.463,.165,.031),('armor',sx*.486,.150,.035),('frame',sx*.508,.127,.022)]:
        disk('head',finish,x,.062,HZ+.033,r,depth,'side')
    ring('head','lamp',.137,.005,xyz(sx*.524,.062,HZ+.033,ry=Q),48,6)
    disk('head','armor',sx*.525,.062,HZ+.033,.115,.012,'side')
    # Three-rib side insignia rather than a flat printed decoration.
    for j in range(3):f.bar('head','gold',(sx*.535,.027+j*.025,HZ+.005),(sx*.535,.044+j*.025,HZ+.067),.004,6)
    for a in [.65,2.5,3.85,5.7]:
        bolt('head',xyz(sx*.51,.062+math.cos(a)*.158,HZ+.033+math.sin(a)*.158,ry=sx*Q),.006)
    bone='antenna.'+side;base=Vector((sx*.425,.085,HZ+.157))
    f.bar(bone,'steel',base,base+Vector((sx*.023,0,.095)),.026,12)
    transform=xyz(sx*.452,.085,HZ+.23+h*.37,ry=-sx*.12)
    outline=[(-.047,-h*.50),(.047,-h*.50),(.039,-h*.25),(.012,h*.50),(-.012,h*.50),(-.040,-h*.25)]
    plate(bone,'frame',outline,-.031,.061,.010,.003,transform.__matmul__)
    plate(bone,'armor',[(x*.88,z*.95) for x,z in outline],-.043,.019,.008,.002,transform.__matmul__)
    f.block(bone,'lamp',.011,.012,h*.22,transform @ xyz(0,-.052,h*.30),.004,2)
    bolt(bone,transform @ xyz(.025,-.052,-h*.30,rx=Q),.005)

# Broad globe cradle tapering to a compact central thruster. No humanoid waist.
f.drum('chest','frame',48,.208,.344,1.235,1.58)
f.drum('chest','gold',48,.213,.346,1.48,1.58)
for i in range(8):
    a=TAU*i/8
    t=xyz(0,0,0,rz=a)
    def cradle_surface(v):
        return t @ Vector((v.x,v.y-.10*(v.z-1.291)/.257,v.z))
    plate('chest','armor',[(-.115,1.548),(.115,1.548),(.074,1.291),(-.074,1.291)],-.240,.060,.018,.015,cradle_surface)
for z,width in [(1.49,.132),(1.453,.115),(1.416,.094)]:
    f.block('chest','frame',width,.021,.014,xyz(0,-.252-.10*(z-1.291)/.257,z),.004,2)
for x in [-.078,.078]:bolt('chest',xyz(x,-.40,1.515,rx=Q),.006)
for z,r,finish in [(1.17,.135,'frame'),(1.205,.146,'steel'),(1.23,.133,'gold')]:
    f.drum('chest',finish,40,r,r,z,z+.030)
ring('chest','lamp',.102,.007,xyz(0,0,1.169),48,6)
f.drum('chest','frame',32,.067,.067,1.164,1.184)
ring('chest','gold',.045,.004,xyz(0,0,1.159),32,6)

# Rounded metal arm shells and large shared-pivot joints.
def hinge(bone,x,z,r):
    f.ball(bone,'frame',r,xyz(x,0,z),around=24,up=16)
    disk(bone,'gold',x,-r*.58,z,r*.96,r*.68)
    disk(bone,'armor',x,-r*.99,z,r*.81,.023)
    ring(bone,'lamp',r*.66,.004,xyz(x,-r*1.12,z,rx=Q),32,6)
    disk(bone,'frame',x,-r*1.13,z,r*.51,.015)
    disk(bone,'steel',x,-r*1.23,z,r*.28,.013)
for side,sx in [('l',1),('r',-1)]:
    upper,lower,wrist=f'upperarm.{side}',f'lowerarm.{side}',f'wrist.{side}'
    hinge(upper,sx*SHOULDER,SZ,.105);hinge(lower,sx*EX,SZ,.086);hinge(wrist,sx*WX,SZ,.073)
    f.bar(upper,'steel',(sx*SHOULDER,0,SZ),(sx*EX,0,SZ),.062,20)
    pod(upper,'armor',.164,.166,.257,xyz(sx*.456,0,SZ,ry=sx*Q))
    for x in [.365,.54]:
        disk(upper,'gold',sx*x,0,SZ,.079,.016,'side')
    f.bar(lower,'frame',(sx*EX,0,SZ),(sx*WX,0,SZ),.069,20)
    pod(lower,'armor',.208,.193,.252,xyz(sx*.754,0,SZ,ry=sx*Q))
    for x in [.668,.840]:disk(lower,'gold',sx*x,0,SZ,.094,.016,'side')
    f.block(lower,'frame',.130,.018,.036,xyz(sx*.751,-.098,SZ),.009,3)
    for dx in [-.07,.07]:bolt(lower,xyz(sx*.753+dx,-.10,SZ+.025,rx=Q),.006)
    f.block(wrist,'frame',.128,.115,.085,xyz(sx*(WX+.048),0,SZ),.023,4)
    f.block(wrist,'armor',.109,.103,.025,xyz(sx*(WX+.047),0,SZ+.044),.019,3)
    ring(wrist,'gold',.035,.005,xyz(sx*(WX+.050),0,SZ+.060),32,6)
    ring(wrist,'lamp',.025,.004,xyz(sx*(WX+.050),0,SZ+.062),28,6)
    for j in range(4):
        bone=f'finger{j}.{side}';y=(j-1.5)*.030;length=[.073,.089,.083,.065][j]
        f.bar(bone,'frame',(sx*(WX+.092),y,SZ),(sx*(WX+.092+length),y,SZ),.014,10)
        for offset in [.101,.136]:
            f.ball(bone,'gold',.019,xyz(sx*(WX+offset),y,SZ),around=12,up=8)
            f.ball(bone,'steel',1,xyz(sx*(WX+offset+.010),y,SZ),(.021,.015,.015),12,8)
    f.bar(wrist,'gold',(sx*(WX+.015),-.067,SZ),(sx*(WX+.083),-.090,SZ-.034),.020,12)

# Suspended blade pods with visible upper and lower rotary assemblies.
# Empty space between torso and pods is intentional magnetic suspension.
for side,sx in [('l',1),('r',-1)]:
    x=sx*LEG;upper,lower=f'upperleg.{side}',f'lowerleg.{side}'
    hinge(upper,x,.91,.091);hinge(lower,x,KNEE,.069)
    # Lateral magnetic hub faces toward the central thruster.
    for finish,dx,r,depth in [('frame',-.055,.111,.085),('gold',-.095,.096,.025),('steel',-.12,.077,.021)]:
        disk(upper,finish,x+sx*dx,.025,.89,r,depth,'side')
    ring(upper,'lamp',.080,.004,xyz(x-sx*.133,.025,.89,ry=Q),36,6)
    f.bar(upper,'steel',(x,0,.91),(x,0,KNEE),.033,14)
    outline=[(x-sx*.03,1.005),(x+sx*.115,.871),(x+sx*.104,.678),(x+sx*.037,.514),(x-sx*.075,.545),(x-sx*.10,.747)]
    if sx<0:outline=outline[::-1]
    plate(upper,'frame',outline,-.059,.115,.024,.012)
    plate(upper,'armor',[(x+(a-x)*.92,.75+(z-.75)*.96) for a,z in outline],-.074,.032,.021,.011)
    seam(upper,[(x+sx*.030,-.090,.956),(x+sx*.081,-.092,.826),(x+sx*.045,-.090,.647)],.003,'steel')
    for dx,z in [(sx*.063,.818),(-sx*.048,.647)]:bolt(upper,xyz(x+dx,-.11,z,rx=Q),.005)
    f.bar(lower,'frame',(x,0,KNEE),(x-sx*.035,0,.08),.028,12)
    outline=[(x-sx*.073,.481),(x+sx*.076,.462),(x+sx*.064,.286),(x-sx*.047,.031),(x-sx*.077,.175),(x-sx*.087,.372)]
    if sx<0:outline=outline[::-1]
    plate(lower,'frame',outline,-.050,.10,.019,.009)
    plate(lower,'armor',[(x+(a-x)*.92,.26+(z-.26)*.97) for a,z in outline],-.065,.027,.017,.009)
    seam(lower,[(x+sx*.037,-.078,.415),(x+sx*.025,-.078,.286),(x-sx*.035,-.078,.095)],.005,'gold')
    seam(lower,[(x-sx*.025,-.081,.394),(x-sx*.044,-.081,.206)],.004,'lamp')
    for dx,z in [(-sx*.05,.386),(sx*.038,.322)]:bolt(lower,xyz(x+dx,-.095,z,rx=Q),.005)
seat_bolts()
body_fasteners=json.loads((HERE/'previews/fastener-seating.json').read_text())
body=emit_parts(f,source)

# Genuine transmissive glass kept separate from opaque material atlases.
clear_collection=bpy.data.collections.new('Clear globe — transmissive surface');bpy.context.scene.collection.children.link(clear_collection)
bpy.ops.mesh.primitive_uv_sphere_add(segments=64,ring_count=40,radius=1,location=(0,0,0))
dome=bpy.context.object;dome.name='StrategistGlobe';dome.data.name='StrategistGlobe'
bm=bmesh.new();bm.from_mesh(dome.data)
bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.co.z<-.72],context='VERTS')
for v in bm.verts:v.co=Vector((v.co.x*.455,v.co.y*.410,HZ+v.co.z*.455))
bm.to_mesh(dome.data);bm.free()
for polygon in dome.data.polygons:polygon.use_smooth=True
for coll in list(dome.users_collection):coll.objects.unlink(dome)
clear_collection.objects.link(dome)
clear=bpy.data.materials.new('Strategist optical glass');clear.use_nodes=True
bsdf=clear.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Base Color'].default_value=(.96,.99,1,1)
bsdf.inputs['Roughness'].default_value=.055
bsdf.inputs['Metallic'].default_value=0
bsdf.inputs['Transmission Weight'].default_value=1
bsdf.inputs['IOR'].default_value=1.12
bsdf.inputs['Coat Weight'].default_value=.12
clear.use_backface_culling=True
dome.data.materials.append(clear);dome['bone']='head';dome['finish']='clear'

# Removable tablet and wireframe charts above the opposite palm.
f=Figure();bolt_specs=[];TX=WX+.060
f.block('tablet','frame',.30,.035,.416,xyz(TX,-.025,SZ+.205),.027,4)
f.block('tablet','armor',.278,.018,.395,xyz(TX,-.053,SZ+.205),.023,4)
f.block('tablet','glass',.246,.010,.352,xyz(TX,-.066,SZ+.205),.017,3)
for i,h in enumerate([.09,.14,.11,.20]):
    f.block('tablet','lamp',.024,.008,h,xyz(TX-.080+i*.052,-.075,SZ+.09+h/2),.004,2)
seam('tablet',[(TX-.10,-.078,SZ+.08),(TX+.10,-.078,SZ+.08)],.002,'gold')
for dx,dz in [(-.124,.026),(.124,.026),(-.124,.382),(.124,.382)]:
    bolt('tablet',xyz(TX+dx,-.09,SZ+dz,rx=Q),.004)
HX=-(WX+.067)
for n,(dx,dz,w,h) in enumerate([(-.11,.28,.19,.16),(.13,.43,.18,.17),(.11,.16,.19,.13)]):
    x=HX+dx;z=SZ+dz;y=-.03
    border=[(x-w/2,y,z-h/2),(x+w/2,y,z-h/2),(x+w/2,y,z+h/2),(x-w/2,y,z+h/2),(x-w/2,y,z-h/2)]
    seam('charts',border,.0025,'lamp')
    if n==1:
        seam('charts',[(x-.07,y,z-.05),(x-.025,y,z+.015),(x+.015,y,z-.008),(x+.065,y,z+.05)],.003,'lamp')
    else:
        for j,height in enumerate([.035,.065,.045,.085]):
            f.block('charts','lamp',.017,.006,height,xyz(x-.060+j*.039,y,z-h*.36+height/2),.002,1)
seat_bolts()
prop_fasteners=json.loads((HERE/'previews/fastener-seating.json').read_text())
(HERE/'previews/fastener-seating.json').write_text(json.dumps(body_fasteners+prop_fasteners,indent=2)+'\n')
accessories=emit_parts(f,props)

joints={'root':((0,0,0),None),'hips':((0,0,HIP),'root'),'spine':((0,0,1.17),'hips'),
 'chest':((0,0,1.28),'spine'),'head':((0,0,1.61),'chest')}
for side,sx in [('l',1),('r',-1)]:
    joints.update({f'eye.{side}':((sx*.118,-.334,IZ+.016),'head'),
        f'antenna.{side}':((sx*.425,.085,HZ+.157),'head'),
        f'upperarm.{side}':((sx*SHOULDER,0,SZ),'chest'),f'lowerarm.{side}':((sx*EX,0,SZ),f'upperarm.{side}'),
        f'wrist.{side}':((sx*WX,0,SZ),f'lowerarm.{side}'),f'upperleg.{side}':((sx*LEG,0,.91),'hips'),
        f'lowerleg.{side}':((sx*LEG,0,KNEE),f'upperleg.{side}')})
    for j in range(4):joints[f'finger{j}.{side}']=((sx*(WX+.092),(j-1.5)*.030,SZ),f'wrist.{side}')
joints['tablet']=((TX,-.025,SZ),'wrist.l');joints['charts']=((HX,-.03,SZ),'wrist.r')
arm=bpy.data.armatures.new('BusinessStrategistRig');rig=bpy.data.objects.new('BusinessStrategistRig',arm)
bpy.context.scene.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name,(pos,parent) in joints.items():
    b=arm.edit_bones.new(name);b.head=pos;b.tail=Vector(pos)+Vector((0,0,.08))
    if parent:b.parent=arm.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True
for obj in body+accessories+[dome]:
    bone=obj['bone'];obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))),1,'REPLACE')
    obj.modifiers.new('Rigid mechanical skin','ARMATURE').object=rig;obj.parent=rig
    for name,val in [('_bone',list(joints).index(bone)),('_light',1 if obj['finish']=='eye' else 2 if obj['finish']=='lamp' else 0)]:
        obj.data.attributes.new(name,'FLOAT','POINT').data.foreach_set('value',[float(val)]*len(obj.data.vertices))
scene=bpy.context.scene;scene.render.fps=30
rig['reference']='agents/Finals/Business Strategist.png';rig['rig_family']='strategist-hover-v1';rig['front']='-Y'

def pose_extras(target,rest,name,frame,clip):
    if name in ('walk','run'):
        # These semantic locomotion slots are flight, with no inherited gait.
        # +X leans the torso toward -Y and sweeps the downward pods toward +Y.
        fast=name=='run';phase=TAU*frame/max(1,clip['frames']-1)
        trim=.012*math.sin(phase)
        for bone in rig.data.bones:
            key=bone.name;parent=bone.parent.name if bone.parent else None
            inherited=target[parent] @ rest[parent].inverted() @ rest[key] if parent else rest[key].copy()
            rotation=Matrix.Identity(4)
            if key=='hips':rotation=Matrix.Rotation((.14 if fast else .08)+trim,4,'X')
            elif key=='head':rotation=Matrix.Rotation(-.04,4,'X')
            elif key.startswith('upperleg.'):
                rotation=Matrix.Rotation((.37 if fast else .23)+trim,4,'X')
            elif key.startswith('upperarm.'):
                sx=1 if key.endswith('.l') else -1
                rotation=Matrix.Rotation(.20 if fast else .12,4,'X') @ Matrix.Rotation(sx*1.16,4,'Y')
            elif key.startswith('lowerarm.'):
                sx=1 if key.endswith('.l') else -1
                rotation=Matrix.Rotation(sx*.16,4,'Y')
            # Edit bones use +Y along the character's +Z. Express the authored
            # rotations in character axes, then return to each bone's basis.
            basis=rest[key].to_quaternion().to_matrix().to_4x4()
            target[key]=inherited @ basis.inverted() @ rotation @ basis
        return
    # Retain production action gestures, adapted to the single-piece pods.
    for key in ('upperleg.l','upperleg.r'):
        inherited=target['hips'] @ rest['hips'].inverted() @ rest[key]
        local=inherited.inverted() @ target[key]
        rotation=Quaternion((1,0,0,0)).slerp(local.to_quaternion(),.65).to_matrix().to_4x4()
        previous=target[key].copy()
        target[key]=inherited @ rotation
        # This anatomy has articulated lower blades. Carry the whole subtree
        # through the hip adjustment, preserving every authored local pivot.
        change=target[key] @ previous.inverted()
        for child in rig.data.bones[key].children_recursive:
            target[child.name]=change @ target[child.name]

def ground_clearance(name,frame,clip):
    return .14+(.010*math.sin(TAU*frame/max(1,clip['frames']-1)) if clip['loop'] else 0)

exec(compile((HERE.parent/'social-media/retarget.py').read_text(),str(HERE.parent/'social-media/retarget.py'),'exec'),globals())
rig.animation_data.action=clips['idle'];scene.frame_set(1)
# Independent studio, excluded from export.
studio=bpy.data.collections.new('Studio — preview only');scene.collection.children.link(studio)
def move_to_studio(obj):
    for coll in list(obj.users_collection):coll.objects.unlink(obj)
    studio.objects.link(obj)
def area(name,position,energy,color,size):
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.color=color;data.shape='DISK';data.size=size
    obj=bpy.data.objects.new(name,data);studio.objects.link(obj);obj.location=position
    obj.rotation_euler=(Vector((0,0,1.2))-obj.location).to_track_quat('-Z','Y').to_euler()
area('Key',(3,-4,5),450,(.80,.90,1),4)
area('Warm rim',(-3,1,3),600,(1,.62,.28),3)
area('Fill',(-3,-2,2),180,(.75,.82,.88),3)
world=bpy.data.worlds.new('Strategist studio');world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.10,.12,.17,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.35;scene.world=world
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.012));ground=bpy.context.object;move_to_studio(ground)
ground.data.materials.append(material('studio-floor',(.025,.029,.043),0,.6,False))
data=bpy.data.cameras.new('Portrait');camera=bpy.data.objects.new('Portrait',data);studio.objects.link(camera)
camera.location=(3,-6,2.75);camera.rotation_euler=(Vector((0,0,1.40))-camera.location).to_track_quat('-Z','Y').to_euler()
data.type='ORTHO';data.ortho_scale=3.3;scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=40;scene.cycles.use_denoising=True
scene.render.resolution_x=1000;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
for obj in bpy.context.selected_objects:obj.select_set(False)
rig.select_set(True);bpy.context.view_layer.objects.active=rig
for screen in bpy.data.screens:
    for ar in screen.areas:
        if ar.type=='VIEW_3D':
            ar.spaces.active.region_3d.view_distance=3.5;ar.spaces.active.region_3d.view_location=(0,0,1.2)
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'business-strategist.blend'))
(HERE/'rig.json').write_text(json.dumps({'id':'strategist-hover-v1','units':'metres','front':'-Y',
 'joints':{k:{'position':p,'parent':q} for k,(p,q) in joints.items()},'name':'Business Strategist','asset':'business-strategist',
 'propLabel':'Tablet and charts','transmissiveMeshes':['StrategistGlobe'],'locomotion':'hover','minimumClearance':.13,'actions':list(clips),
 'authoredFlightClips':['walk','run'],
 'motionSource':motion_source,'clipMetadata':motion['clips'],'reference':str(rig['reference'])},indent=2)+'\n')
scene.render.filepath=str(HERE/'preview.png');bpy.ops.render.render(write_still=True)
print('BUSINESS_BUILD_COMPLETE',len(body),'parts',len(joints),'bones')
