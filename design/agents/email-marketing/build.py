"""Build the approved burgundy courier, with its own proportions and rigid rig.
Run in a separate Blender background process. The interactive scene is untouched.
"""
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
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for coll in list(bpy.data.collections):
    if not coll.objects:bpy.data.collections.remove(coll)
source=bpy.data.collections.new('Email Marketing — editable parts');bpy.context.scene.collection.children.link(source)
props=bpy.data.collections.new('Mail — removable accessories');bpy.context.scene.collection.children.link(props)
LOOKS={
 'red':material('courier-oxblood',(.115,.012,.009),.48,.47),
 'gold':material('courier-aged-brass',(.30,.185,.079),.75,.46),
 'steel':material('courier-steel',(.057,.051,.043),.75,.43),
 'frame':material('courier-dark-iron',(.016,.014,.012),.68,.44),
 'leather':material('courier-leather',(.038,.021,.012),.05,.84),
 'rubber':material('courier-rubber',(.010,.012,.014),0,.8,False),
 'paper':material('courier-ivory-paper',(.82,.72,.52),0,.86,False),
 'wax':material('courier-sealing-wax',(.27,.012,.009),.05,.37,False),
 'glass':material('courier-display',(.002,.004,.006),.25,.1,False),
 'eye':material('courier-eyes',(0,0,0),0,.3,False,(1,.40,.008)),
 'lamp':material('courier-lamps',(0,0,0),0,.3,False,(1,.40,.008)),
}
# More irregular paint wear; metal highlights stay bronze/graphite rather than silver.
for finish in ('red','gold','steel','frame'):
    tree=LOOKS[finish].node_tree
    for node in tree.nodes:
        if node.bl_idname=='ShaderNodeTexNoise':node.inputs['Scale'].default_value=48
        if node.bl_idname=='ShaderNodeValToRGB':
            colors=node.color_ramp.elements
            colors[0].position=.31
            colors[1].position=.38
            colors[-2].position=.68
            colors[-1].position=.76
            colors[-1].color=(.15,.115,.071,1) if finish=='red' else (.12,.09,.053,1)
f=Figure()
HZ,SZ,HIP,KNEE,ANKLE=1.68,1.27,.77,.42,.13
EX,WX,SHOULDER=.55,.81,.275
make_bolt=bolt
bolt_specs=[]

def bolt(bone,transform,radius=.012):
    # Resolve contact only after the supporting armor has been constructed.
    bolt_specs.append((bone,transform.copy(),radius))

def seat_bolts():
    trees={}
    report=[]
    for bone,transform,radius in bolt_specs:
        if bone not in trees:
            vertices=[];polygons=[]
            for key,bm in f.parts.items():
                if key.split('__')[0]!=bone:continue
                bm.verts.ensure_lookup_table();bm.verts.index_update()
                offset=len(vertices)
                vertices.extend(v.co.copy() for v in bm.verts)
                polygons.extend(tuple(offset+v.index for v in face.verts) for face in bm.faces)
            trees[bone]=BVHTree.FromPolygons(vertices,polygons)
        axis=(transform.to_3x3() @ Vector((0,0,1))).normalized()
        origin=transform.translation+axis*.05
        point,normal,_,distance=trees[bone].ray_cast(origin,-axis,.25)
        if point is None:raise RuntimeError(f'Bolt has no supporting surface: {bone} {tuple(transform.translation)}')
        if normal.dot(axis)<0:normal=-normal
        # Preserve a nominally flat seat's axis across small mesh facets.
        if normal.dot(axis)>.95:normal=axis
        # Sink the head slightly into its seat, including the edge on curved armor.
        seated=Matrix.Translation(point-normal*.004) @ normal.to_track_quat('Z','Y').to_matrix().to_4x4()
        rim_gaps=[]
        for i in range(6):
            a=TAU*i/6
            base=seated @ Vector((radius*math.cos(a),radius*math.sin(a),0))
            support,_,_,_=trees[bone].ray_cast(base+normal*.04,-normal,.15)
            if support is None:raise RuntimeError(f'Bolt rim overhangs its supporting surface: {bone}')
            rim_gaps.append((base-support).dot(normal))
        if max(rim_gaps)>.0002:raise RuntimeError(f'Bolt rim floats above armor: {bone} {tuple(transform.translation)} {max(rim_gaps)}')
        make_bolt(bone,seated,radius)
        report.append({'bone':bone,'original':list(transform.translation),'surface':list(point),
            'base':list(seated.translation),'normal':list(normal),'embed':.004,'rimGaps':rim_gaps})
    (HERE/'previews').mkdir(exist_ok=True)
    (HERE/'previews/fastener-seating.json').write_text(json.dumps(report,indent=2)+'\n')
    print('FASTENERS_SEATED',len(report))

def plate(bone,finish,outline,front,depth,radius=.022,crown=0,transform=None):
    """Rounded profile independent of sheet thickness, optionally bowed outward."""
    bm=f.part(bone,finish)
    points=[]
    for i,corner in enumerate(outline):
        p=Vector(corner);before=Vector(outline[i-1]);after=Vector(outline[(i+1)%len(outline)])
        r=min(radius,(before-p).length*.32,(after-p).length*.32)
        a=p+(before-p).normalized()*r;b=p+(after-p).normalized()*r
        for step in range(7):
            t=step/6;points.append(a*(1-t)**2+p*(2*t*(1-t))+b*t*t)
    center=sum(points,Vector((0,0)))/len(points)
    rows=[]
    for factor,y in [(1,front+depth),(1,front),(.68,front-crown)]:
        coordinates=[Vector((center.x+(v.x-center.x)*factor,y,center.y+(v.y-center.y)*factor)) for v in points]
        rows.append([bm.verts.new(transform(v) if transform else v) for v in coordinates])
    bm.faces.new(rows[0][::-1]);bm.faces.new(rows[-1])
    for a,b in zip(rows,rows[1:]):
        for i in range(len(points)):
            j=(i+1)%len(points);bm.faces.new((a[i],a[j],b[j],b[i]))

def panel(bone,finish,width,height,front,depth,cx,cz,radius=.04):
    plate(bone,finish,[(cx-width/2,cz-height/2),(cx+width/2,cz-height/2),
        (cx+width/2,cz+height/2),(cx-width/2,cz+height/2)],front,depth,radius)

def pod(bone,finish,sx,sy,sz,transform):
    """Tapered, domed armor shell, constructed around its long local Z axis."""
    bm=f.part(bone,finish);rows=[];segments=28
    for t,r in [(0,.32),(.06,.63),(.18,.94),(.36,1),(.66,.92),(.87,.72),(.97,.44),(1,.25)]:
        rows.append([bm.verts.new(transform @ Vector((math.cos(TAU*i/segments)*sx*r/2,
            math.sin(TAU*i/segments)*sy*r/2,(t-.5)*sz))) for i in range(segments)])
    bm.faces.new(rows[0][::-1]);bm.faces.new(rows[-1])
    for a,b in zip(rows,rows[1:]):
        for i in range(segments):j=(i+1)%segments;bm.faces.new((a[i],a[j],b[j],b[i]))

def seam(bone,points,r=.005,finish='gold'):
    tube(bone,finish,points,r,6)

def hinge(bone,x,z,r=.075,axis='front'):
    # Each hinge is centered on the actual pivot, with overlapping steel axles.
    f.ball(bone,'frame',r,xyz(x,0,z),around=16,up=10)
    disk(bone,'steel',x,0,z,r,.135,axis)
    if axis=='front':
        disk(bone,'gold',x,-.076,z,r*.83,.017)
        disk(bone,'frame',x,-.089,z,r*.56,.018)
        bolt(bone,xyz(x,-.102,z,rx=Q),r*.27)
    else:
        sx=1 if x>0 else -1
        disk(bone,'gold',x+sx*.076,0,z,r*.84,.02,'side')
        disk(bone,'frame',x+sx*.091,0,z,r*.55,.018,'side')
        ring(bone,'lamp',r*.52,.004,xyz(x+sx*.103,0,z,ry=Q),24,5)

# Broad inset display and tapered visor housing, following the reference silhouette.
f.ball('head','frame',1,xyz(0,.025,HZ),(.335,.195,.185),40,24)
# Clip the display/bezel shoulders to the curved hood opening. A rectangular
# top edge used to poke through the brow at both upper corners.
visor=[(-.30,HZ+.095),(-.20,HZ+.155),(.20,HZ+.155),(.30,HZ+.095),
       (.322,HZ-.065),(.285,HZ-.16),(-.285,HZ-.16),(-.322,HZ-.065)]
plate('head','gold',visor,-.190,.055,.068)
plate('head','frame',[(x*.96,HZ+(z-HZ)*.94) for x,z in visor],-.209,.025,.06)
plate('head','glass',[(x*.91,HZ+(z-HZ)*.84) for x,z in visor],-.220,.016,.054)
# Continuous rounded visor: the bowed brow rolls into tapered side returns,
# with a swept leading edge and a curved crown through its depth.
def visor_housing():
    profile=[Vector((-.383*math.cos(a),.222*math.sin(a)))
        for a in [-.80+(math.pi+1.60)*i/80 for i in range(81)]]
    rows=[];depth_steps=12
    for step in range(depth_steps+1):
        t=step/depth_steps
        for inner in (False,True):
            row=[]
            for x,z in profile:
                # The lower side returns recede to meet the existing face bezel.
                front=-.325+.125*((.227-z)/.377)**1.4
                y=front*(1-t)+.112*t
                shrink=.965 if inner else 1
                row.append((x*(1-.09*t)*shrink,y,
                    HZ+(z*(1-.12*t)-.007*t+.018*math.sin(math.pi*t))*shrink))
            rows.append(row)
    vertices={}
    def face(finish,points):
        bm=f.part('head',finish)
        cache=vertices.setdefault(finish,{})
        for p in points:
            if p not in cache:cache[p]=bm.verts.new(p)
        bm.faces.new([cache[p] for p in points])
    for i in range(len(profile)-1):
        j=i+1
        face('gold',[rows[0][i],rows[0][j],rows[1][j],rows[1][i]])
        finish='red' if (profile[i].y+profile[j].y)/2>.085 else 'frame'
        for step in range(depth_steps):
            a=step*2;b=a+2
            face(finish,[rows[b][i],rows[b][j],rows[a][j],rows[a][i]])
            face('frame',[rows[a+1][i],rows[a+1][j],rows[b+1][j],rows[b+1][i]])
        face('frame',[rows[-1][i],rows[-1][j],rows[-2][j],rows[-2][i]])
    for i in (0,len(profile)-1):
        for step in range(depth_steps):
            a=step*2;b=a+2
            face('gold',[rows[a][i],rows[b][i],rows[b+1][i],rows[a+1][i]])
visor_housing()
# Compact brass hinge blocks lock the visor into the upper ear housings.
for sx in [-1,1]:
    def temple_sweep(v):
        t=(v.y+.213)/.16
        return Vector((sx*v.x*(1-.035*t),v.y,v.z))
    temple=[(.335,HZ+.156),(.386,HZ+.133),(.381,HZ+.012),(.332,HZ+.024)]
    plate('head','gold',temple,-.213,.16,.014,transform=temple_sweep)
    bolt('head',xyz(sx*.357,-.226,HZ+.064,rx=Q),.010)
# Panel seams follow the rounded crown; fasteners are projected onto its surface.
for x in [-.21,.21]:
    z=.222*math.sqrt(1-(x/.383)**2)
    front=-.325+.125*((.227-z)/.377)**1.4
    seam('head',[(x*(1-.09*t),front*(1-t)+.112*t,
        HZ+z*(1-.12*t)-.007*t+.018*math.sin(math.pi*t)+.001)
        for t in [i/12 for i in range(13)]],.002,'frame')
    bolt('head',xyz(x,-.302,HZ+z),.008)
f.block('head','gold',.22,.068,.040,xyz(0,-.231,HZ+.15),.012,3)
f.block('head','lamp',.18,.009,.018,xyz(0,-.268,HZ+.15),.008,3)
for x,eye in [(-.125,'eye.r'),(.125,'eye.l')]:
    ring(eye,'eye',.066,.013,xyz(x,-.227,HZ-.037,rx=Q),24,8,0,math.pi)
# Lower grille and angular chin armor.
plate('head','gold',[(-.302,HZ-.152),(.302,HZ-.152),(.224,HZ-.263),(-.224,HZ-.263)],-.174,.20)
plate('head','frame',[(-.19,HZ-.19),(.19,HZ-.19),(.145,HZ-.239),(-.145,HZ-.239)],-.180,.014)
for z in [HZ-.199,HZ-.215,HZ-.231]:f.block('head','steel',.285,.012,.006,xyz(0,-.190,z),.002,1)
for sx in [-1,1]:
    disk('head','frame',sx*.374,.018,HZ,.194,.065,'side')
    disk('head','gold',sx*.410,.018,HZ,.169,.016,'side')
    disk('head','frame',sx*.421,.018,HZ,.148,.019,'side')
    emblem('head',xyz(sx*.434,.018,HZ) @ Matrix.Rotation(Q,4,'X') @ Matrix.Rotation(sx*Q,4,'Y'),.112)
    for i in range(8):
        a=TAU*i/8
        f.ball('head','steel',.009,xyz(sx*.423,.018+math.sin(a)*.156,HZ+math.cos(a)*.156),around=8,up=5)
# Handle and single glowing antenna.
seam('head',[(-.13,.08,HZ+.20),(-.13,.08,HZ+.29),(.13,.08,HZ+.29),(.13,.08,HZ+.20)],.017)
f.bar('head','frame',(.32,.085,HZ+.12),(.38,.085,HZ+.48),.022,12)
f.block('head','gold',.065,.05,.21,xyz(.365,.085,HZ+.405,ry=.17),.025,4)
f.block('head','frame',.050,.018,.191,xyz(.365,.052,HZ+.405,ry=.17),.023,4)
f.block('head','lamp',.017,.008,.15,xyz(.365,.039,HZ+.405,ry=.17),.008,3)
# Neck ring, hoses and compact tapered torso with a real recessed mail opening.
for z,r in [(1.385,.085),(1.425,.072),(1.463,.073)]:
    f.drum('chest','frame',20,r,r,z-.015,z+.015)
    f.drum('chest','gold',20,r*.98,r*.98,z+.012,z+.018)
for sx in [-1,1]:seam('chest',[(sx*.06,.04,1.37),(sx*.1,.08,1.42),(sx*.12,.09,1.48)],.014,'frame')
f.ball('chest','frame',1,xyz(0,.015,1.145),(.253,.181,.230),36,20)
f.ball('chest','red',1,xyz(0,.065,1.188),(.248,.160,.201),36,20)
outline=[(-.19,1.345),(.19,1.345),(.274,1.243),(.248,1.118),(.14,.933),(-.14,.933),(-.248,1.118),(-.274,1.243)]
plate('chest','gold',outline,-.166,.045,.05,.018)
plate('chest','red',[(x*.94,1.15+(z-1.15)*.94) for x,z in outline],-.185,.026,.048,.017)
plate('chest','frame',[(-.115,1.087),(.115,1.087),(.100,.955),(-.100,.955)],-.209,.014,.025)
# Black inset pocket flanked by a heavy brass lip; inset papers stop inside the slot.
panel('chest','gold',.368,.160,-.220,.026,0,1.178,.04)
panel('chest','frame',.337,.128,-.238,.019,0,1.178,.035)
f.block('chest','gold',.332,.085,.022,xyz(0,-.242,1.113),.008,2)
f.block('chest','lamp',.19,.007,.012,xyz(0,-.235,1.228),.005,2)
for i in range(4):f.block('chest','paper',.245-i*.013,.058,.007,xyz(-.005,-.255,1.134+i*.010,rx=-.05*i),.002,1)
emblem('chest',xyz(0,-.228,1.018,rx=Q),.064)
for sx in [-1,1]:
    seam('chest',[(sx*.11,-.184,.946),(sx*.21,-.197,1.108)],.011)
    for z,x in [(1.279,.226 if sx>0 else .206),((1.02 if sx>0 else 1.22),(.226 if sx>0 else .214)),(.971,.085)]:
        bolt('chest',xyz(sx*x,-.215,z,rx=Q),.009)
    pod('chest','red',.174,.29,.195,xyz(sx*.207,.012,1.287,ry=sx*.24))
    seam('chest',[(sx*.17,-.155,1.355),(sx*.235,-.155,1.245)],.008)
# Waist and pelvis have exposed ribbed steel, compact hip armor.
for z in [.807,.841,.875,.909]:
    f.drum('spine','frame',20,.115,.115,z-.014,z+.014)
    f.drum('spine','gold',20,.103,.103,z+.012,z+.019)
f.ball('hips','frame',1,xyz(0,0,HIP),(.186,.129,.09),32,16)
plate('hips','gold',[(-.16,.826),(.16,.826),(.115,.699),(-.115,.699)],-.137,.025)
plate('hips','frame',[(-.125,.806),(.125,.806),(.08,.715),(-.08,.715)],-.164,.015)
# Fixed satchel sits aft of the hip swing; all of it follows the pelvis.
f.block('hips','leather',.25,.23,.39,xyz(.335,.115,.72),.042,4)
f.block('hips','gold',.224,.015,.35,xyz(.335,-.010,.72),.032,4)
f.block('hips','leather',.207,.020,.334,xyz(.335,-.023,.72),.027,4)
f.block('hips','leather',.220,.030,.22,xyz(.335,-.045,.795),.032,4)
emblem('hips',xyz(.335,-.064,.80,rx=Q),.066)
for x in [.26,.408]:
    f.block('hips','gold',.031,.027,.074,xyz(x,-.051,.606),.005,2)
    f.block('hips','leather',.016,.012,.046,xyz(x,-.069,.606),.004,2)
for i in range(4):f.block('hips','paper',.145,.012,.14,xyz(.335,.055+i*.024,.964+i*.014,ry=.05),.003,1)
# Shoulder strap ends at the waist; does not span two animated joints with rigid geometry.
seam('chest',[(.22,.1,1.35),(.24,-.02,1.34),(.25,-.18,1.27),(.23,-.19,1.10),(.19,-.16,.95)],.024,'leather')
for z in [1.28,1.02]:f.block('chest','gold',.063,.018,.069,xyz(.226,-.205,z),.008,2)

# Stocky armored limbs, exact pivot-to-pivot rods and layered joint collars.
for side,sx in [('l',1),('r',-1)]:
    u,l,w=f'upperarm.{side}',f'lowerarm.{side}',f'wrist.{side}'
    for bone,x,r in [(u,SHOULDER,.10),(l,EX,.074),(w,WX,.052)]:hinge(bone,sx*x,SZ,r)
    f.bar(u,'steel',(sx*SHOULDER,0,SZ),(sx*EX,0,SZ),.047,16)
    pod(u,'red',.161,.158,.219,xyz(sx*.415,0,SZ,ry=sx*Q))
    f.block(u,'gold',.15,.017,.035,xyz(sx*.415,-.082,SZ),.011,3)
    f.bar(l,'steel',(sx*EX,0,SZ),(sx*WX,0,SZ),.042,16)
    pod(l,'gold',.158,.147,.227,xyz(sx*.686,0,SZ,ry=sx*Q))
    pod(l,'red',.144,.142,.210,xyz(sx*.686,-.019,SZ+.012,ry=sx*Q))
    f.block(l,'frame',.151,.018,.035,xyz(sx*.683,-.083,SZ),.010,3)
    f.block(l,'lamp',.112,.008,.013,xyz(sx*.683,-.097,SZ),.006,3)
    for x in [.625,.748]:bolt(l,xyz(sx*x,-.087,SZ+.048,rx=Q),.007)
    f.block(w,'frame',.089,.117,.066,xyz(sx*(WX+.043),0,SZ),.027,4)
    disk(w,'gold',sx*(WX+.046),-.065,SZ,.030,.014)
    disk(w,'lamp',sx*(WX+.046),-.076,SZ,.017,.005)
    for j in range(4):
        b=f'finger{j}.{side}';y=(j-1.5)*.028;length=[.072,.087,.081,.063][j]
        f.bar(b,'frame',(sx*(WX+.086),y,SZ),(sx*(WX+.086+length),y,SZ),.013,10)
        for offset in [.10,.131]:
            f.ball(b,'gold',.016,xyz(sx*(WX+offset),y,SZ),around=10,up=6)
        f.block(b,'steel',length*.7,.023,.018,xyz(sx*(WX+.105+length*.3),y,SZ+.014),.008,3)
    f.bar(w,'frame',(sx*(WX+.025),-.072,SZ),(sx*(WX+.088),-.078,SZ-.035),.018,10)
    x=sx*.17;u,l,foot,toe=f'upperleg.{side}',f'lowerleg.{side}',f'foot.{side}',f'toes.{side}'
    hinge(u,x,HIP,.098,'side');hinge(l,x,KNEE,.079,'side');hinge(foot,x,ANKLE,.067,'side')
    f.bar(u,'steel',(x,0,HIP),(x,0,KNEE),.057,16)
    pod(u,'gold',.183,.167,.270,xyz(x,-.015,.612,ry=sx*.07))
    pod(u,'red',.167,.162,.254,xyz(x,-.029,.615,ry=sx*.07))
    f.block(u,'lamp',.012,.009,.070,xyz(x,-.111,.588,ry=sx*.15),.005,3)
    for z in [.55,.68]:bolt(u,xyz(x-sx*.047,-.114,z,rx=Q),.008)
    f.bar(l,'steel',(x,0,KNEE),(x,0,ANKLE),.043,16)
    pod(l,'gold',.166,.155,.226,xyz(x,-.016,.292,ry=-sx*.10))
    pod(l,'red',.149,.158,.211,xyz(x,-.028,.295,ry=-sx*.10))
    f.block(l,'frame',.04,.019,.112,xyz(x,-.11,.294,ry=-sx*.1),.016,3)
    f.block(l,'lamp',.014,.009,.083,xyz(x,-.123,.294,ry=-sx*.1),.006,3)
    # Boots split at a shared toe pivot; chunky soles and brass toe bumper.
    f.drum(foot,'rubber',32,1,1,0,.043,xyz(x,.016) @ Matrix.Diagonal((.12,.105,1,1)))
    f.drum(foot,'gold',32,1,.94,.043,.077,xyz(x,.014) @ Matrix.Diagonal((.123,.106,1,1)))
    f.ball(foot,'frame',1,xyz(x,.008,.122),(.109,.109,.075),32,16)
    f.block(foot,'red',.127,.142,.04,xyz(x,-.015,.181,rx=.22),.017,3)
    f.drum(toe,'rubber',32,1,1,0,.043,xyz(x,-.162) @ Matrix.Diagonal((.123,.105,1,1)))
    f.drum(toe,'gold',32,1,.94,.043,.077,xyz(x,-.162) @ Matrix.Diagonal((.126,.108,1,1)))
    f.ball(toe,'frame',1,xyz(x,-.159,.108),(.115,.101,.066),32,16)
    f.block(toe,'red',.135,.136,.025,xyz(x,-.158,.158,rx=.15),.018,3)
    f.block(toe,'lamp',.069,.008,.013,xyz(x,-.245,.117),.006,3)
    for dx in [-.09,.09]:bolt(toe,xyz(x+dx,-.237,.068,rx=Q),.009)
seat_bolts()
body=emit_parts(f,source)

# A removable sealed envelope in the right hand; props stay off for motion inspection.
f=Figure();CX=-(WX+.12)
f.block('mail','paper',.28,.014,.175,xyz(CX,-.052,SZ+.10),.004,2)
seam('mail',[(CX-.133,-.063,SZ+.18),(CX,-.065,SZ+.095),(CX+.133,-.063,SZ+.18)],.002,'gold')
seam('mail',[(CX-.133,-.063,SZ+.025),(CX-.030,-.063,SZ+.090)],.0015,'gold')
seam('mail',[(CX+.133,-.063,SZ+.025),(CX+.030,-.063,SZ+.090)],.0015,'gold')
disk('mail','wax',CX,-.069,SZ+.101,.034,.009)
emblem('mail',xyz(CX,-.076,SZ+.101,rx=Q),.022)
# Folded paper aircraft in the opposite hand, with a brass crease and wax seal.
PX=WX+.11
bm=f.part('airmail','paper')
coords=[(PX+.34,-.058,SZ+.31),(PX-.12,-.058,SZ+.16),(PX-.02,-.12,SZ+.104),(PX-.05,-.058,SZ-.015),(PX-.025,-.058,SZ+.10)]
v=[bm.verts.new(c) for c in coords]
for triangle in [(0,1,2),(0,2,3),(2,4,3),(2,1,4)]:bm.faces.new([v[i] for i in triangle])
seam('airmail',[coords[1],coords[0],coords[3]],.003,'gold')
seam('airmail',[coords[0],coords[2],coords[4]],.003,'gold')
# Seat the seal on the folded wing plane, with its normal following the paper.
a,b,c=[Vector(coords[i]) for i in (0,1,2)]
normal=(b-a).cross(c-a).normalized()
if normal.y>0:normal.negate()
seal=(a*.23+b*.36+c*.41)+normal*.006
seal_matrix=normal.to_track_quat('Z','Y').to_matrix().to_4x4()
seal_matrix.translation=seal
f.drum('airmail','wax',24,.027,.027,-.003,.003,seal_matrix)
emblem('airmail',seal_matrix @ Matrix.Translation((0,0,.004)),.017)
accessories=emit_parts(f,props)

joints={'root':((0,0,0),None),'hips':((0,0,HIP),'root'),
 'spine':((0,0,.84),'hips'),'chest':((0,0,1.12),'spine'),
 'head':((0,0,1.465),'chest'),
 'eye.l':((.125,-.227,HZ-.01),'head'),'eye.r':((-.125,-.227,HZ-.01),'head')}
for side,sx in [('l',1),('r',-1)]:
    joints.update({f'upperarm.{side}':((sx*SHOULDER,0,SZ),'chest'),
        f'lowerarm.{side}':((sx*EX,0,SZ),f'upperarm.{side}'),f'wrist.{side}':((sx*WX,0,SZ),f'lowerarm.{side}'),
        f'upperleg.{side}':((sx*.17,0,HIP),'hips'),f'lowerleg.{side}':((sx*.17,0,KNEE),f'upperleg.{side}'),
        f'foot.{side}':((sx*.17,0,ANKLE),f'lowerleg.{side}'),f'toes.{side}':((sx*.17,-.08,.06),f'foot.{side}')})
    for j in range(4):joints[f'finger{j}.{side}']=((sx*(WX+.086),(j-1.5)*.028,SZ),f'wrist.{side}')
joints['mail']=((CX,-.052,SZ),'wrist.r')

joints['airmail']=((PX,-.058,SZ),'wrist.l')
arm=bpy.data.armatures.new('EmailMarketingRig')
rig=bpy.data.objects.new('EmailMarketingRig',arm)
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
rig['reference']='agents/Finals/Email Marketing Specialist.png'
rig['rig_family']='courier-humanoid-v1'
rig['front']='-Y'

exec(compile((HERE.parent/'social-media/retarget.py').read_text(),str(HERE.parent/'social-media/retarget.py'),'exec'),globals())
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
area('Neutral fill',(-3,-2,2),200,(.72,.76,.82),3)
area('Top reflection',(0,0,5),250,(1,1,1),3)
world=bpy.data.worlds.new('Studio world');world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.10,.12,.17,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.35;scene.world=world
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.012));ground=bpy.context.object;ground.name='Studio floor';move_to_studio(ground)
ground.data.materials.append(material('studio-floor',(.025,.029,.043),0,.6,False))
data=bpy.data.cameras.new('Portrait');camera=bpy.data.objects.new('Portrait',data);studio.objects.link(camera)
camera.location=(3,-6,2.6);camera.rotation_euler=(Vector((0,0,1.13))-camera.location).to_track_quat('-Z','Y').to_euler()
data.type='ORTHO';data.ortho_scale=2.85;scene.camera=camera
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
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'email-marketing.blend'))
(HERE/'rig.json').write_text(json.dumps({'id':'courier-humanoid-v1','units':'metres','front':'-Y',
    'joints':{k:{'position':p,'parent':q} for k,(p,q) in joints.items()},
    'name':'Email Marketing Specialist','asset':'email-marketing','propLabel':'Mail props','actions':list(clips),'motionSource':motion_source,'clipMetadata':motion['clips'],'reference':str(rig['reference'])},indent=2)+'\n')
scene.render.filepath=str(HERE/'preview.png');bpy.ops.render.render(write_still=True)
print('EMAIL_BUILD_COMPLETE',len(body),'body parts',len(joints),'bones')
