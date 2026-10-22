"""Build the turquoise SEO scout from its supplied reference in background Blender."""
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
source=bpy.data.collections.new('SEO Strategist — editable parts');bpy.context.scene.collection.children.link(source)
props=bpy.data.collections.new('Search — removable magnifier');bpy.context.scene.collection.children.link(props)
LOOKS={
 'teal':material('scout-aged-turquoise',(.008,.43,.43),.60,.38),
 'gold':material('scout-worn-bronze',(.22,.135,.067),.85,.37),
 'steel':material('scout-machined-steel',(.095,.12,.13),.85,.31),
 'frame':material('scout-black-iron',(.016,.022,.024),.75,.38),
 'rubber':material('scout-dark-seals',(.008,.012,.013),0,.82,False),
 'glass':material('scout-optical-display',(.003,.008,.010),.42,.10,False),
 'lens':material('scout-magnifier-lens',(.29,.39,.42),.65,.07,False),
 'eye':material('scout-eyes',(0,0,0),0,.24,False,(1,.32,.002)),
 'lamp':material('scout-lamps',(0,0,0),0,.22,False,(1,.26,.001)),
}
for finish in ('teal','gold','steel','frame'):
    for node in LOOKS[finish].node_tree.nodes:
        if node.bl_idname=='ShaderNodeTexNoise':node.inputs['Scale'].default_value=62
        if node.bl_idname=='ShaderNodeValToRGB':
            ramp=node.color_ramp.elements
            for el,p in zip(ramp,[.28,.35,.72,.79]):el.position=p
            ramp[-1].color=(.13,.09,.055,1)
f=Figure()
HZ,SZ,HIP=1.58,1.09,.765
SHOULDER,EX,WX,LEG=.28,.55,.80,.19

def disk(bone,finish,x,y,z,r,depth=.025,axis='front'):
    segments=64 if r>.18 else 32
    f.drum(bone,finish,segments,r,r,-depth/2,depth/2,
        xyz(x,y,z,rx=Q if axis=='front' else 0,ry=Q if axis=='side' else 0))

# The head is a sphere with individually separated curved shell segments.
f.ball('head','frame',1,xyz(0,.025,HZ),(.408,.338,.402),48,28)
def shell_patch(a0,a1,p0,p1,finish='teal',r=.419):
    bm=f.part('head',finish);rows=[]
    # Polar axis points forwards (-Y); longitude is measured around the face.
    for j in range(17):
        p=p0+(p1-p0)*j/16
        rows.append([bm.verts.new((r*math.sin(p)*math.cos(a0+(a1-a0)*i/16),
            .025-r*.83*math.cos(p),HZ+r*math.sin(p)*math.sin(a0+(a1-a0)*i/16))) for i in range(17)])
    for a,b in zip(rows,rows[1:]):
        for i in range(16):bm.faces.new((a[i],a[i+1],b[i+1],b[i]))
for i in range(8):
    a=TAU*i/8
    shell_patch(a+.025,a+TAU/8-.025,.79,1.47)
    shell_patch(a+.025,a+TAU/8-.025,1.51,2.53)
# Rear cap and seam-connected small service panels.
f.ball('head','steel',1,xyz(0,.297,HZ),(.218,.065,.223),32,18)
for finish,y,r,depth in [('steel',-.250,.337,.093),('frame',-.312,.312,.048),('gold',-.342,.286,.023),('frame',-.351,.272,.017)]:
    disk('head',finish,0,y,HZ,r,depth)
ring('head','lamp',.266,.006,xyz(0,-.370,HZ,rx=Q),64,6)
f.ball('head','glass',1,xyz(0,-.362,HZ),(.258,.076,.258),48,28)
# Two unmistakable happy optical arches, supported by the curved dark lens.
for side,x in [('l',.102),('r',-.102)]:
    ring('eye.'+side,'eye',.060,.012,xyz(x,-.435,HZ+.015,rx=Q),24,6,0,math.pi)
    # Seat the luminous strips on the convex display, including their ends.
    for vertex in f.part('eye.'+side,'eye').verts:
        surface=-.362-.076*math.sqrt(max(0,1-(vertex.co.x/.258)**2-((vertex.co.z-HZ)/.258)**2))
        vertex.co.y=surface-.002+(vertex.co.y+.435)
for i in range(8):
    a=TAU*(i+.5)/8
    bolt('head',xyz(math.cos(a)*.322,-.308,HZ+math.sin(a)*.322,rx=Q),.006)
# Lower chin bumper and status window.
panel('head','steel',.174,.063,-.259,.056,0,HZ-.358,.018)
panel('head','frame',.136,.039,-.274,.017,0,HZ-.358,.012)
panel('head','lamp',.110,.017,-.281,.011,0,HZ-.358,.007)
# Large side hubs sit inside spherical casing and carry antenna hinges.
for sx in [-1,1]:
    for finish,x,r,depth in [('frame',sx*.375,.155,.095),('steel',sx*.424,.138,.044),('gold',sx*.449,.113,.019),('frame',sx*.462,.088,.018)]:
        disk('head',finish,x,.035,HZ-.01,r,depth,'side')
    ring('head','lamp',.113,.006,xyz(sx*.466,.035,HZ-.01,ry=Q),40,6)
    disk('head','steel',sx*.477,.035,HZ-.01,.061,.019,'side')
    disk('head','frame',sx*.49,.035,HZ-.01,.033,.008,'side')
# Tall, flat asymmetric scanner antennae; rods remain visibly joined to the hubs.
for side,sx,height,lean in [('l',1,.49,.15),('r',-1,.62,.04)]:
    bone='antenna.'+side;base=Vector((sx*.43,.073,HZ+.045))
    end=base+Vector((sx*lean,.02,height*.46))
    f.bar(bone,'steel',base,end,.024,14)
    for t in [.18,.36,.54,.72,.90]:
        f.ball(bone,'frame',.029,xyz(*base.lerp(end,t)),around=12,up=8)
    center=end+Vector((sx*.028,0,height*.24))
    transform=xyz(*center,ry=sx*.17)
    paddle=[(-.050,-height*.30),(.050,-height*.30),(.066,-height*.21),
        (.032,height*.27),(.020,height*.30),(-.020,height*.30),
        (-.032,height*.27),(-.066,-height*.21)]
    plate(bone,'frame',paddle,-.035,.070,.010,.003,transform.__matmul__)
    plate(bone,'teal',[(x*.87,z*.94) for x,z in paddle],-.051,.019,.009,.002,transform.__matmul__)
    window=[(-.025,-height*.195),(.025,-height*.195),(.014,height*.155),(-.014,height*.155)]
    plate(bone,'gold',window,-.063,.015,.008,0,transform.__matmul__)
    plate(bone,'lamp',[(x*.58,z*.88) for x,z in window],-.071,.010,.006,0,transform.__matmul__)
    for dx,dz in [(.037,-height*.245),(.008,height*.247)]:
        bolt(bone,transform @ xyz(dx,-.060,dz,rx=Q),.005)
# A real handle attached to the top shell, with a clear opening.
for x in [-.069,.069]:f.bar('head','steel',(x,.11,HZ+.37),(x,.11,HZ+.444),.017,10)
f.bar('head','frame',(-.069,.11,HZ+.444),(.069,.11,HZ+.444),.019,12)

# Compact suspended torso with exposed ribbed neck and waist.
for z in [1.075,1.105,1.135,1.165]:f.drum('chest','steel',20,.074,.074,z,z+.017)
f.ball('chest','frame',1,xyz(0,.018,1.033),(.216,.146,.144),28,18)
plate('chest','teal',[(-.19,1.111),(-.15,.984),(0,.92),(.15,.984),(.19,1.111),(.10,1.079),(-.10,1.079)],-.125,.042,.024,.016)
chest_shell=BVHTree.FromBMesh(f.part('chest','teal'))
for sx in [-1,1]:
    f.bar('chest','steel',(sx*.095,-.005,1.13),(sx*.13,-.02,.98),.033,16)
    seat,_,_,_=chest_shell.ray_cast(Vector((sx*.124,-.30,1.047)),Vector((0,1,0)),.30)
    assert seat is not None,'Chest status light requires an armor seat'
    f.block('chest','lamp',.048,.014,.014,xyz(sx*.124,seat.y-.003,1.047),.004,2)
for z in [.84,.87,.90,.93]:f.drum('spine','steel',20,.073,.073,z,z+.015)
f.ball('hips','frame',1,xyz(0,.016,HIP),(.188,.116,.097),24,16)
plate('hips','teal',[(-.135,.823),(.135,.823),(.123,.748),(0,.712),(-.123,.748)],-.097,.03,.018,.012)

# Scanner pack, weathered turquoise frame and dark inset rear panel.
f.block('chest','frame',.448,.242,.474,xyz(.20,.282,1.24),.065,5)
f.block('chest','teal',.467,.092,.458,xyz(.20,.402,1.24),.065,5)
f.block('chest','steel',.375,.028,.361,xyz(.20,.457,1.24),.040,4)
for sx in [-1,1]:
    f.block('chest','frame',.068,.21,.345,xyz(.20+sx*.219,.304,1.258),.025,4)
    f.block('chest','lamp',.021,.015,.18,xyz(.20+sx*.195,.473,1.24),.008,3)
    for z in [1.097,1.38]:bolt('chest',xyz(.20+sx*.154,.484,z,rx=-Q),.006)
for i in range(5):f.block('chest','frame',.190,.018,.013,xyz(.20,.482,1.18+i*.033),.004,2)
# Two side-mounted scanner blocks extend beyond the small torso.
for sx in [-1,1]:
    t=xyz(sx*.28,.19,1.29,ry=sx*.15)
    f.block('chest','frame',.104,.21,.245,t,.025,4)
    f.block('chest','teal',.084,.026,.221,t @ Matrix.Translation((0,-.112,0)),.018,3)
    for z in [-.065,0,.065]:f.block('chest','lamp',.043,.013,.025,t @ Matrix.Translation((0,-.132,z)),.006,3)

def hinge(bone,x,z,r):
    f.ball(bone,'frame',r,xyz(x,0,z),around=20,up=12)
    disk(bone,'steel',x,-r*.55,z,r*.96,r*.64)
    disk(bone,'frame',x,-r*.96,z,r*.76,.019)
    ring(bone,'gold',r*.61,.005,xyz(x,-r*1.07,z,rx=Q),28,6)
    disk(bone,'steel',x,-r*1.09,z,r*.33,.014)

# Connected mechanical arms with turquoise caps and fully modeled fingers.
for side,sx in [('l',1),('r',-1)]:
    upper,lower,wrist=f'upperarm.{side}',f'lowerarm.{side}',f'wrist.{side}'
    hinge(upper,sx*SHOULDER,SZ,.082);hinge(lower,sx*EX,SZ,.075);hinge(wrist,sx*WX,SZ,.056)
    f.bar(upper,'frame',(sx*SHOULDER,0,SZ),(sx*EX,0,SZ),.041,16)
    pod(upper,'teal',.141,.150,.223,xyz(sx*.404,-.012,SZ,ry=sx*Q))
    f.block(upper,'steel',.138,.038,.064,xyz(sx*.404,-.086,SZ),.018,3)
    f.block(upper,'lamp',.095,.012,.020,xyz(sx*.404,-.11,SZ),.008,3)
    f.bar(lower,'frame',(sx*EX,0,SZ),(sx*WX,0,SZ),.044,16)
    pod(lower,'teal',.177,.171,.229,xyz(sx*.680,0,SZ,ry=sx*Q))
    f.block(lower,'steel',.150,.043,.092,xyz(sx*.680,-.080,SZ),.02,3)
    for dx in [-.049,.049]:bolt(lower,xyz(sx*.680+dx,-.117,SZ,rx=Q),.006)
    f.block(wrist,'frame',.112,.103,.070,xyz(sx*(WX+.047),0,SZ),.023,4)
    f.block(wrist,'teal',.093,.090,.022,xyz(sx*(WX+.049),0,SZ+.038),.014,3)
    for j in range(4):
        b=f'finger{j}.{side}';y=(j-1.5)*.027;length=[.066,.081,.077,.060][j]
        a=(sx*(WX+.085),y,SZ);end=(sx*(WX+.085+length),y,SZ)
        f.bar(b,'frame',a,end,.013,10)
        for offset in [.091,.122]:f.ball(b,'steel',.017,xyz(sx*(WX+offset),y,SZ),around=12,up=8)
        f.block(b,'teal',length*.65,.021,.013,xyz(sx*(WX+.101+length*.28),y,SZ+.014),.005,3)
    f.bar(wrist,'steel',(sx*(WX+.02),-.061,SZ),(sx*(WX+.087),-.081,SZ-.036),.016,10)

# Two knee-less tapered thruster pods, attached at real hip pivots.
for side,sx in [('l',1),('r',-1)]:
    bone=f'upperleg.{side}';x=sx*LEG
    hinge(bone,x,HIP,.098)
    existing={key:set(bm.verts) for key,bm in f.parts.items() if key.split('__')[0]==bone}
    first_bolt=len(bolt_specs)
    f.bar(bone,'steel',(x,0,HIP),(x+sx*.016,.012,.575),.046,16)
    outline=[(x-.119,.688),(x-.129,.562),(x-.090,.294),(x+.020,.035),(x+.096,.257),(x+.130,.568),(x+.098,.693)]
    plate(bone,'frame',outline,-.094,.185,.028,.018)
    plate(bone,'teal',[(x+(a-x)*1.045,.35+(z-.35)*.97) for a,z in outline],-.111,.061,.029,.023)
    inner=[(x-.070,.602),(x-.055,.412),(x+.019,.115),(x+.065,.364),(x+.073,.610)]
    plate(bone,'steel',inner,-.143,.029,.023,.009)
    plate(bone,'gold',[(x-.024,.521),(x+.004,.522),(x+.051,.275),(x+.030,.261)],-.160,.015,.009,.002)
    seam(bone,[(x-.010,-.171,.502),(x+.037,-.171,.280)],.009,'lamp')
    for dx,z in [(-.084,.594),(.085,.592),(.017,.189)]:bolt(bone,xyz(x+dx,-.143,z,rx=Q),.005)
    for z in [.35,.40,.45,.50]:f.block(bone,'frame',.049,.027,.009,xyz(x+.061,.100,z),.003,2)
    # Inset outlet: no feet beneath the taper.
    f.drum(bone,'steel',16,.025,.036,.032,.074,xyz(x+.018,0))
    f.drum(bone,'lamp',16,.015,.017,.027,.034,xyz(x+.018,0))
    # Compress the complete pod assembly, including vents/outlet, but retain
    # the spherical hip bearing. Seat bolts on the resulting final surfaces.
    for key,bm in f.parts.items():
        if key.split('__')[0]==bone:
            for vertex in set(bm.verts)-existing.get(key,set()):vertex.co.y*=.60
    for _,transform,_ in bolt_specs[first_bolt:]:transform.translation.y*=.60
seat_bolts()
body=emit_parts(f,source)

# Detachable optical magnifier. Handle remains anchored at the palm pivot.
f=Figure();MX=-(WX+.069)
f.bar('magnifier','frame',(MX,-.016,SZ-.064),(MX,-.016,SZ+.17),.031,18)
for z in [SZ-.04,SZ+.012,SZ+.070]:
    f.drum('magnifier','steel',18,.033,.033,z,z+.014,xyz(MX,-.016))
MZ=SZ+.426
for finish,y,r,depth in [('steel',-.016,.270,.060),('frame',-.053,.254,.022),('gold',-.070,.233,.015)]:
    disk('magnifier',finish,MX,y,MZ,r,depth)
f.ball('magnifier','lens',1,xyz(MX,-.076,MZ),(.225,.039,.225),40,24)
ring('magnifier','lamp',.237,.005,xyz(MX,-.086,MZ,rx=Q),56,6)
accessories=emit_parts(f,props)

joints={'root':((0,0,0),None),'hips':((0,0,HIP),'root'),'spine':((0,0,.88),'hips'),
 'chest':((0,0,1.015),'spine'),'head':((0,0,1.184),'chest')}
for side,sx in [('l',1),('r',-1)]:
    joints.update({f'eye.{side}':((sx*.102,-.435,HZ+.015),'head'),
        f'antenna.{side}':((sx*.43,.073,HZ+.045),'head'),
        f'upperarm.{side}':((sx*SHOULDER,0,SZ),'chest'),f'lowerarm.{side}':((sx*EX,0,SZ),f'upperarm.{side}'),
        f'wrist.{side}':((sx*WX,0,SZ),f'lowerarm.{side}'),f'upperleg.{side}':((sx*LEG,0,HIP),'hips')})
    for j in range(4):joints[f'finger{j}.{side}']=((sx*(WX+.085),(j-1.5)*.027,SZ),f'wrist.{side}')
joints['magnifier']=((MX,-.016,SZ),'wrist.r')
arm=bpy.data.armatures.new('SEOStrategistRig');rig=bpy.data.objects.new('SEOStrategistRig',arm)
bpy.context.scene.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name,(pos,parent) in joints.items():
    b=arm.edit_bones.new(name);b.head=pos;b.tail=Vector(pos)+Vector((0,0,.08))
    if parent:b.parent=arm.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True
for obj in body+accessories:
    bone=obj['bone'];obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))),1,'REPLACE')
    obj.modifiers.new('Rigid mechanical skin','ARMATURE').object=rig;obj.parent=rig
    for name,val in [('_bone',list(joints).index(bone)),('_light',1 if obj['finish']=='eye' else 2 if obj['finish']=='lamp' else 0)]:
        obj.data.attributes.new(name,'FLOAT','POINT').data.foreach_set('value',[float(val)]*len(obj.data.vertices))
scene=bpy.context.scene;scene.render.fps=30
rig['reference']='agents/Finals/SEO Strategist.png';rig['rig_family']='scout-hover-v1';rig['front']='-Y'

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
        target[key]=inherited @ rotation

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
world=bpy.data.worlds.new('Scout studio');world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.10,.12,.17,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.35;scene.world=world
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.012));ground=bpy.context.object;move_to_studio(ground)
ground.data.materials.append(material('studio-floor',(.025,.029,.043),0,.6,False))
data=bpy.data.cameras.new('Portrait');camera=bpy.data.objects.new('Portrait',data);studio.objects.link(camera)
camera.location=(3,-6,2.75);camera.rotation_euler=(Vector((0,0,1.25))-camera.location).to_track_quat('-Z','Y').to_euler()
data.type='ORTHO';data.ortho_scale=3.0;scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=40;scene.cycles.use_denoising=True
scene.render.resolution_x=1000;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
for obj in bpy.context.selected_objects:obj.select_set(False)
rig.select_set(True);bpy.context.view_layer.objects.active=rig
for screen in bpy.data.screens:
    for ar in screen.areas:
        if ar.type=='VIEW_3D':
            ar.spaces.active.region_3d.view_distance=3.5;ar.spaces.active.region_3d.view_location=(0,0,1.2)
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'seo-strategist.blend'))
(HERE/'rig.json').write_text(json.dumps({'id':'scout-hover-v1','units':'metres','front':'-Y',
 'joints':{k:{'position':p,'parent':q} for k,(p,q) in joints.items()},'name':'SEO Strategist','asset':'seo-strategist',
 'propLabel':'Magnifying glass','locomotion':'hover','minimumClearance':.13,'actions':list(clips),
 'authoredFlightClips':['walk','run'],
 'motionSource':motion_source,'clipMetadata':motion['clips'],'reference':str(rig['reference'])},indent=2)+'\n')
scene.render.filepath=str(HERE/'preview.png');bpy.ops.render.render(write_still=True)
print('SEO_BUILD_COMPLETE',len(body),'parts',len(joints),'bones')
