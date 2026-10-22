"""Build the Website Builder's yellow wheeled chassis and independent action rig."""
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
definitions(HERE.parent/'social-media/build.py',{'material','ring','tube','bolt','emblem','emit_parts'})
make_bolt=bolt;bolt_specs=[]
definitions(HERE.parent/'email-marketing/build.py',{'plate','panel','pod','seam','bolt','seat_bolts'})
definitions(HERE.parent/'virtual-assistant/build.py',{'curved_cable','squircle'})
definitions(HERE.parent/'copywriter/build.py',{'joint'})
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for coll in list(bpy.data.collections):
    if not coll.objects:bpy.data.collections.remove(coll)
source=bpy.data.collections.new('Website Builder — editable parts');bpy.context.scene.collection.children.link(source)
props=bpy.data.collections.new('Builder — removable tablet and plans');bpy.context.scene.collection.children.link(props)
LOOKS={
 'yellow':material('builder-worn-safety-yellow',(.65,.285,.018),.52,.43),
 'gold':material('builder-dark-bronze',(.23,.14,.064),.84,.39),
 'steel':material('builder-brushed-gunmetal',(.105,.115,.126),.87,.34),
 'frame':material('builder-charcoal',(.015,.018,.022),.76,.40),
 'rubber':material('builder-tires',(.013,.016,.020),0,.84,False),
 'leather':material('builder-tool-pouch',(.031,.023,.018),0,.85),
 'paper':material('builder-drawing-paper',(.67,.68,.65),0,.82,False),
 'ink':material('builder-blueprint-ink',(.055,.075,.10),0,.85,False),
 'glass':material('builder-dark-display',(.002,.003,.005),.25,.13,False),
 'eye':material('builder-amber-eyes',(0,0,0),0,.3,False,(1,.32,.002)),
 'lamp':material('builder-amber-lights',(0,0,0),0,.3,False,(1,.27,.002)),
}
for finish in ('yellow','gold','steel','frame','leather'):
    for node in LOOKS[finish].node_tree.nodes:
        if node.bl_idname=='ShaderNodeTexNoise':node.inputs['Scale'].default_value=55
        if node.bl_idname=='ShaderNodeValToRGB':
            for el,p in zip(node.color_ramp.elements,[.31,.37,.71,.78]):el.position=p
            node.color_ramp.elements[0].color=(.012,.015,.018,1)
            node.color_ramp.elements[-1].color=(.16,.115,.063,1)
f=Figure()
HZ,SZ,HIP=1.865,1.405,.875
SHOULDER,EX,WX=.277,.565,.865
WHEEL_X,WHEEL_Z,WHEEL_R=.286,.355,.350

def disk(bone,finish,x,y,z,r,depth=.025,axis='front'):
    f.drum(bone,finish,64 if r>.2 else 32,r,r,-depth/2,depth/2,
        xyz(x,y,z,rx=Q if axis=='front' else 0,ry=Q if axis=='side' else 0))

def badge(bone,transform,size=.05):
    # Match the angular mark on the supplied builder reference.
    points=[(-.65,-.7),(0,.86),(.65,-.7),(.03,-.24),(-.39,-.47)]
    for a,b in zip(points,points[1:]):
        f.bar(bone,'steel',transform@Vector((a[0]*size,a[1]*size,0)),transform@Vector((b[0]*size,b[1]*size,0)),size*.10,6)

# Two real wheel meshes around horizontal axles. Fixed mudguards belong to the chassis.
for side,sx in [('l',1),('r',-1)]:
    bone=f'wheel.{side}';cx=sx*WHEEL_X
    bm=f.part(bone,'rubber');rows=[]
    for offset,r in [(-.087,.248),(-.091,.306),(-.070,.337),(0,.343),(.070,.337),(.091,.306),(.087,.248)]:
        rows.append([bm.verts.new((cx+offset,math.sin(TAU*i/72)*r,WHEEL_Z+math.cos(TAU*i/72)*r)) for i in range(72)])
    for a,b in zip(rows,rows[1:]):
        for i in range(72):k=(i+1)%72;bm.faces.new((a[i],a[k],b[k],b[i]))
    for i in range(40):
        a=TAU*i/40
        for band in [-1,1]:
            f.block(bone,'rubber',.078,.046,.013,xyz(cx+band*.039,math.sin(a)*.341,WHEEL_Z+math.cos(a)*.341,rx=-a) @ Matrix.Rotation(band*.24,4,'Z'),.004,2)
    for dx in [-.092,.092]:
        disk(bone,'steel',cx+dx,0,WHEEL_Z,.252,.019,'side')
        disk(bone,'frame',cx+dx*1.12,0,WHEEL_Z,.211,.019,'side')
        ring(bone,'lamp',.231,.008,xyz(cx+dx*1.15,0,WHEEL_Z,ry=Q),64,6)
        ring(bone,'gold',.249,.006,xyz(cx+dx*1.12,0,WHEEL_Z,ry=Q),64,6)
        disk(bone,'steel',cx+dx*1.23,0,WHEEL_Z,.145,.020,'side')
        disk(bone,'frame',cx+dx*1.36,0,WHEEL_Z,.068,.020,'side')
        disk(bone,'gold',cx+dx*1.48,0,WHEEL_Z,.032,.018,'side')
        for a in [0,Q,2*Q,3*Q]:
            bolt(bone,xyz(cx+dx*1.25,math.sin(a)*.182,WHEEL_Z+math.cos(a)*.182,ry=(Q if dx>0 else -Q)),.008)
    # Continuous arched mudguard with thickness, not a flat floating plate.
    bm=f.part('root','yellow');rows=[]
    for radius in [.367,.382]:
        grid=[]
        for j in range(33):
            a=-1.00+2.0*j/32
            grid.append([bm.verts.new((cx+x,math.sin(a)*radius,WHEEL_Z+math.cos(a)*radius)) for x in [-.105,.105]])
        rows.append(grid)
        for a,b in zip(grid,grid[1:]):bm.faces.new((a[0],a[1],b[1],b[0]))
    for j in range(32):
        for i in [0,1]:bm.faces.new((rows[0][j][i],rows[0][j+1][i],rows[1][j+1][i],rows[1][j][i]))
    for j in [0,32]:bm.faces.new((rows[0][j][0],rows[0][j][1],rows[1][j][1],rows[1][j][0]))
    f.bar('root','steel',(sx*.09,0,.60),(cx,0,.717),.027,16)
    f.bar('root','steel',(0,0,WHEEL_Z),(cx,0,WHEEL_Z),.061,20)
# Fixed lower drive housing and telescoping central column.
f.block('root','frame',.310,.255,.330,xyz(0,.012,.491),.063,5)
plate('root','yellow',[(-.14,.60),(.14,.60),(.15,.47),(.10,.375),(-.10,.375),(-.15,.47)],-.128,.043,.030,.012)
panel('root','frame',.176,.052,-.154,.027,0,.438,.018)
panel('root','lamp',.134,.017,-.172,.015,0,.438,.007)
for x in [-.11,.11]:bolt('root',xyz(x,-.19,.536,rx=Q),.009)
f.drum('root','steel',32,.075,.075,.58,.92)
for z in [.65,.71,.77,.83]:f.drum('root','frame',32,.087,.087,z,z+.022)
f.block('root','frame',.17,.11,.23,xyz(0,.022,.724),.022,4)
panel('root','lamp',.068,.023,-.044,.013,0,.76,.008)

# Broad rectangular display, armored rear and a swept yellow protective brow.
f.block('head','frame',.680,.372,.441,xyz(0,.018,HZ),.105,7)
f.block('head','steel',.628,.155,.382,xyz(0,.180,HZ),.071,5)
panel('head','frame',.652,.417,-.196,.066,0,HZ,.11)
panel('head','gold',.604,.375,-.225,.022,0,HZ,.099)
panel('head','glass',.569,.339,-.242,.022,0,HZ,.090)
for side,sx in [('l',1),('r',-1)]:
    # Pixelated arch eyes are flat luminous elements on the display.
    for row in range(25):
        z=-.025+row*.006
        for column in range(29):
            x=(column-14)*.006
            rr=(x/.085)**2+(z/.105)**2
            if z>=0 and .43<rr<1.0:
                # Shallow closed pixels pack reliably into the emissive atlas; no bevels needed.
                f.block(f'eye.{side}','eye',.0048,.0015,.0048,xyz(sx*.130+x,-.244,HZ-.040+z),0,1)
# Upper brow: curved across its width and length, anchored into both temples.
def brow(u,v,inside=False):
    x=.369*u
    y=-.035+.287*v+.038*u*u
    z=HZ+.259-.090*abs(u)**5-.022*v*v+.021*v
    return Vector((x,y,z-(.023 if inside else 0)))
bm=f.part('head','yellow');surfaces=[]
for inside in [False,True]:
    rows=[]
    for j in range(19):
        v=-1+2*j/18
        rows.append([bm.verts.new(brow(-1+2*i/40,v,inside)) for i in range(41)])
    surfaces.append(rows)
    for a,b in zip(rows,rows[1:]):
        for i in range(40):bm.faces.new((a[i],a[i+1],b[i+1],b[i]))
for j in range(18):
    for i in [0,40]:bm.faces.new((surfaces[0][j][i],surfaces[0][j+1][i],surfaces[1][j+1][i],surfaces[1][j][i]))
for j in [0,18]:
    for i in range(40):bm.faces.new((surfaces[0][j][i],surfaces[0][j][i+1],surfaces[1][j][i+1],surfaces[1][j][i]))
seam('head',[brow(-1+2*i/60,-1) for i in range(61)],.0035,'gold')
for sx in [-1,1]:
    f.block('head','yellow',.065,.300,.119,xyz(sx*.331,-.012,HZ+.172),.027,4)
    bolt('head',xyz(sx*.33,-.16,HZ+.216),.008)
    # Lower cheek corners sweep into the ear mount.
    plate('head','yellow',[(sx*.23,HZ-.23),(sx*.35,HZ-.17),(sx*.36,HZ-.09),(sx*.30,HZ-.10),(sx*.26,HZ-.18)],-.226,.135,.025,.014)
    bolt('head',xyz(sx*.31,-.26,HZ-.16,rx=Q),.008)
    for finish,x,r,dep in [('frame',sx*.350,.182,.088),('steel',sx*.392,.170,.040),('yellow',sx*.418,.155,.029),('frame',sx*.438,.126,.025)]:
        disk('head',finish,x,.019,HZ-.006,r,dep,'side')
    ring('head','lamp',.148,.007,xyz(sx*.439,.019,HZ-.006,ry=Q),48,6)
    disk('head','steel',sx*.454,.019,HZ-.006,.078,.020,'side')
    disk('head','frame',sx*.467,.019,HZ-.006,.036,.013,'side')
    for a in [.65,2.3,3.9,5.4]:bolt('head',xyz(sx*.44,.019+math.sin(a)*.134,HZ-.006+math.cos(a)*.134,ry=sx*Q),.005)
# Lower chin rail overlaps both cheek returns.
panel('head','yellow',.535,.058,-.228,.078,0,HZ-.222,.021)
panel('head','frame',.215,.043,-.246,.025,0,HZ-.235,.015)
panel('head','lamp',.161,.015,-.262,.015,0,HZ-.235,.006)
# Crown service plate and rear cooling details, seated on their shells.
f.block('head','frame',.185,.205,.028,xyz(0,.04,HZ+.252,rx=.03),.014,3)
for x in [-.052,.052]:f.block('head','steel',.016,.090,.011,xyz(x,.034,HZ+.270),.004,2)
for z in [HZ-.09,HZ-.045,HZ,HZ+.045,HZ+.09]:
    f.block('head','frame',.27,.015,.012,xyz(0,.264,z),.004,2)
# Single antenna paddle attached through a hinge on the left ear assembly.
f.bar('head','steel',(.395,.07,HZ+.09),(.415,.07,HZ+.267),.024,16)
disk('head','steel',.416,.070,HZ+.244,.039,.050,'side')
panel('antenna','frame',.069,.235,.042,.055,.416,HZ+.390,.028)
panel('antenna','yellow',.049,.198,.032,.019,.416,HZ+.390,.020)
panel('antenna','lamp',.020,.159,.022,.014,.416,HZ+.390,.009)

# Rectangular chest with flanking yellow armor and exposed waist mechanics.
f.drum('chest','steel',24,.055,.055,1.525,1.675)
for z in [1.55,1.60,1.65]:f.drum('chest','frame',24,.065,.065,z,z+.018)
f.block('chest','frame',.431,.272,.341,xyz(0,.025,1.346),.065,5)
chest_outline=[(-.218,1.51),(.218,1.51),(.218,1.27),(.159,1.17),(-.159,1.17),(-.218,1.27)]
plate('chest','yellow',chest_outline,-.122,.061,.035,.012)
panel('chest','steel',.254,.277,-.150,.026,0,1.337,.028)
panel('chest','frame',.223,.249,-.169,.018,0,1.337,.021)
badge('chest',xyz(0,-.184,1.36,rx=Q),.060)
panel('chest','yellow',.158,.041,-.186,.025,0,1.241,.013)
panel('chest','lamp',.115,.016,-.201,.014,0,1.241,.006)
for sx in [-1,1]:
    for z in [1.27,1.43]:bolt('chest',xyz(sx*.090,-.20,z,rx=Q),.006)
    for z in [1.28,1.40]:bolt('chest',xyz(sx*.189,-.17,z,rx=Q),.007)
    f.block('chest','yellow',.080,.255,.082,xyz(sx*.157,.01,1.506),.020,3)
    f.block('chest','frame',.033,.12,.028,xyz(sx*.158,-.033,1.55),.009,3)
    curved_cable('chest',[(sx*.19,.044,1.32),(sx*.21,.05,1.18),(sx*.135,-.007,1.125)],.011)
for z in [1.27,1.31,1.35,1.39,1.43]:f.block('chest','steel',.202,.022,.014,xyz(0,.166,z),.005,2)
for z in [1.00,1.045,1.09,1.135]:
    f.drum('spine','frame',24,.070,.070,z-.016,z+.016)
    f.drum('spine','steel',24,.077,.077,z+.012,z+.023)
for sx in [-1,1]:f.bar('spine','steel',(sx*.054,0,.97),(sx*.070,0,1.18),.016,12)
# The belt stays on the fixed chassis; only the upper torso telescopes for rest.
# This keeps its pouches clear of the fixed wheel fenders.
f.block('root','frame',.355,.265,.247,xyz(0,.012,HIP),.044,4)
plate('root','yellow',[(-.175,.99),(.175,.99),(.175,.82),(.13,.758),(-.13,.758),(-.175,.82)],-.128,.041,.025,.010)
panel('root','steel',.125,.209,-.151,.028,0,.882,.020)
panel('root','frame',.084,.177,-.170,.022,0,.882,.015)
panel('root','lamp',.037,.026,-.187,.012,0,.825,.007)
for sx in [-1,1]:
    for z in [.812,.954]:bolt('root',xyz(sx*.133,-.19,z,rx=Q),.007)
    f.block('root','leather',.135,.182,.193,xyz(sx*.235,.008,.855),.025,4)
    f.bar('root','steel',(sx*.14,.03,.955),(sx*.235,.03,.955),.023,14)
    f.block('root','leather',.145,.026,.034,xyz(sx*.235,-.085,.93),.008,2)
# Tape measure with a visible belt attachment, and two handled tools.
disk('root','frame',.229,-.010,.981,.066,.052)
disk('root','yellow',.229,-.043,.981,.054,.025)
disk('root','steel',.229,-.060,.981,.023,.013)
for x,z,finish in [(.286,1.043,'yellow'),(.184,1.066,'frame')]:
    f.bar('root','steel',(x,.012,.88),(x,.012,z),.011,10)
    pod('root',finish,.033,.035,.109,xyz(x,.012,z+.012))
badge('root',xyz(.235,-.087,.865,rx=Q),.034)

# Heavy industrial arms use their own dimensions, with rods crossing every joint center.
for side,sx in [('l',1),('r',-1)]:
    u,l,w=f'upperarm.{side}',f'lowerarm.{side}',f'wrist.{side}'
    joint(u,sx*SHOULDER,SZ,.103);joint(l,sx*EX,SZ,.080);joint(w,sx*WX,SZ,.053)
    f.bar(u,'steel',(sx*SHOULDER,0,SZ),(sx*EX,0,SZ),.052,18)
    f.block(u,'frame',.214,.143,.145,xyz(sx*.421,.012,SZ),.031,4)
    plate(u,'yellow',[(sx*.324,SZ+.075),(sx*.507,SZ+.065),(sx*.517,SZ-.054),(sx*.343,SZ-.069)],-.074,.038,.021,.012)
    for x in [.36,.48]:bolt(u,xyz(sx*x,-.12,SZ+.015,rx=Q),.007)
    disk(u,'yellow',sx*.292,0,SZ,.104,.076,'side')
    f.bar(l,'steel',(sx*EX,0,SZ),(sx*WX,0,SZ),.045,18)
    f.block(l,'frame',.234,.163,.164,xyz(sx*.718,.004,SZ),.039,4)
    f.block(l,'yellow',.228,.179,.183,xyz(sx*.718,.004,SZ),.034,4)
    plate(l,'steel',[(sx*.634,SZ+.052),(sx*.805,SZ+.045),(sx*.809,SZ-.045),(sx*.626,SZ-.052)],-.099,.025,.014,.006)
    for x in [.655,.783]:bolt(l,xyz(sx*x,-.15,SZ+.028,rx=Q),.007)
    f.block(w,'frame',.105,.126,.072,xyz(sx*(WX+.05),0,SZ),.022,4)
    f.block(w,'yellow',.094,.111,.025,xyz(sx*(WX+.05),0,SZ+.036),.017,3)
    for j in range(4):
        bone=f'finger{j}.{side}';y=(j-1.5)*.030;length=[.081,.096,.089,.070][j]
        f.bar(bone,'frame',(sx*(WX+.093),y,SZ),(sx*(WX+.093+length),y,SZ),.014,12)
        for off in [.100,.139]:f.ball(bone,'steel',.018,xyz(sx*(WX+off),y,SZ),around=12,up=8)
        f.block(bone,'frame',length*.62,.027,.027,xyz(sx*(WX+.121+length*.22),y,SZ+.012),.010,3)
        f.block(bone,'lamp',.022,.010,.007,xyz(sx*(WX+.109),y,SZ+.033),.003,2)
    f.bar(w,'steel',(sx*(WX+.024),-.064,SZ),(sx*(WX+.087),-.087,SZ-.038),.018,12)
    f.ball(w,'frame',.024,xyz(sx*(WX+.087),-.087,SZ-.038),around=16,up=10)
seat_bolts();body=emit_parts(f,source)
body_seats=json.loads((HERE/'previews/fastener-seating.json').read_text())

# Removable work accessories: tablet on the right, three genuinely hollow rolled plans on the left.
f=Figure();bolt_specs=[];TX=-(WX+.122);PX=WX+.125
panel('tablet','steel',.303,.367,-.055,.051,TX,SZ+.136,.032)
panel('tablet','frame',.276,.340,-.082,.024,TX,SZ+.136,.025)
panel('tablet','glass',.235,.276,-.100,.013,TX,SZ+.143,.016)
for sx in [-1,1]:
    for z in [SZ-.014,SZ+.282]:bolt('tablet',xyz(TX+sx*.117,-.12,z,rx=Q),.006)
# Simple page wireframe on the screen.
for a,b in [((-.091,.22),(.091,.22)),((-.091,.04),(.091,.04)),((-.091,.04),(-.091,.22)),((.091,.04),(.091,.22)),((-.091,.16),(.091,.16)),((-.025,.04),(-.025,.16))]:
    f.bar('tablet','lamp',(TX+a[0],-.112,SZ+a[1]),(TX+b[0],-.112,SZ+b[1]),.0018,5)
badge('tablet',xyz(TX,.001,SZ+.136,rx=-Q),.060)
for j,(dx,dy,height,tilt) in enumerate([(-.047,0,.40,-.08),(.020,.016,.47,.03),(.076,.004,.36,.13)]):
    transform=xyz(PX+dx,dy,SZ+.09,ry=tilt)
    bm=f.part('plans','paper');rows=[]
    for radius,z in [(.038,-.16),(.038,height),(.033,height),(.033,-.16)]:
        rows.append([bm.verts.new(transform @ Vector((radius*math.cos(TAU*i/40),radius*math.sin(TAU*i/40),z))) for i in range(40)])
    for a,b in zip(rows,rows[1:]+rows[:1]):
        for i in range(40):k=(i+1)%40;bm.faces.new((a[i],a[k],b[k],b[i]))
    for r in [.034,.036]:ring('plans','paper',r,.0007,transform @ Matrix.Translation((0,0,height)),40,5)
    # Ink follows each cylindrical sheet rather than floating across its silhouette.
    for k in range(9):
        z=-.12+k*(height+.06)/9
        curve=[transform @ Vector((.0385*math.cos(a),.0385*math.sin(a),z)) for a in [math.pi+q*math.pi/18 for q in range(19)]]
        seam('plans',curve,.00055,'ink')
    for a in [3.6,4.2,4.9,5.5]:
        f.bar('plans','ink',transform @ Vector((.0385*math.cos(a),.0385*math.sin(a),-.11)),transform @ Vector((.0385*math.cos(a),.0385*math.sin(a),height-.06)),.0005,5)
# Retaining strap passes through the hand grip and around the roll bundle.
ring('plans','leather',1,.08,xyz(PX+.01,.01,SZ+.055) @ Matrix.Diagonal((.112,.052,.12,1)),40,6)
seat_bolts();prop_seats=json.loads((HERE/'previews/fastener-seating.json').read_text())
(HERE/'previews/fastener-seating.json').write_text(json.dumps(body_seats+prop_seats,indent=2)+'\n')
accessories=emit_parts(f,props)

joints={'root':((0,0,0),None),'hips':((0,0,HIP),'root'),'spine':((0,0,1.037),'hips'),
 'chest':((0,0,1.345),'spine'),'head':((0,0,1.661),'chest'),
 'eye.l':((.130,-.244,HZ),'head'),'eye.r':((-.130,-.244,HZ),'head'),
 'antenna':((.416,.07,HZ+.244),'head')}
for side,sx in [('l',1),('r',-1)]:
    joints.update({f'upperarm.{side}':((sx*SHOULDER,0,SZ),'chest'),f'lowerarm.{side}':((sx*EX,0,SZ),f'upperarm.{side}'),f'wrist.{side}':((sx*WX,0,SZ),f'lowerarm.{side}'),f'wheel.{side}':((sx*WHEEL_X,0,WHEEL_Z),'root')})
    for j in range(4):joints[f'finger{j}.{side}']=((sx*(WX+.093),(j-1.5)*.030,SZ),f'wrist.{side}')
joints['tablet']=((TX,-.055,SZ),'wrist.r');joints['plans']=((PX,0,SZ),'wrist.l')
arm=bpy.data.armatures.new('WebsiteBuilderRig');rig=bpy.data.objects.new('WebsiteBuilderRig',arm)
bpy.context.scene.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name,(pos,parent) in joints.items():
    bone=arm.edit_bones.new(name);bone.head=pos;bone.tail=Vector(pos)+Vector((0,0,.08))
    if parent:bone.parent=arm.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True
for obj in body+accessories:
    bone=obj['bone'];obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))),1,'REPLACE')
    obj.modifiers.new('Rigid mechanical skin','ARMATURE').object=rig;obj.parent=rig
    for name,val in [('_bone',list(joints).index(bone)),('_light',1 if obj['finish']=='eye' else 2 if obj['finish']=='lamp' else 0)]:
        obj.data.attributes.new(name,'FLOAT','POINT').data.foreach_set('value',[float(val)]*len(obj.data.vertices))
scene=bpy.context.scene;scene.render.fps=30
rig['reference']='agents/Finals/Website Builder.png';rig['rig_family']='builder-wheeled-v1';rig['front']='-Y'

def pose_extras(target,rest,name,frame,clip):
    """Keep a fixed axle track; adapt torso gestures and roll instead of stepping."""
    original={key:value.copy() for key,value in target.items()}
    t=frame/max(1,clip['frames']-1);phase=TAU*t
    ease=t*t*(3-2*t)
    crouch=.10 if name=='sit' else .10*ease if name=='sitDown' else .10*(1-ease) if name=='standUp' else 0
    for bone in rig.data.bones:
        key=bone.name;parent=bone.parent.name if bone.parent else None
        inherited=target[parent] @ rest[parent].inverted() @ rest[key] if parent else rest[key].copy()
        basis=rest[key].to_quaternion().to_matrix().to_4x4()
        rotation=Matrix.Identity(4)
        if key=='root':
            lift=.12*math.sin(math.pi*t)**2 if name=='jump' else .65*(1-ease) if name=='spawn' else 0
            inherited.translation.z+=lift
        elif key=='hips':
            inherited.translation.z-=crouch
            rotation=Matrix.Rotation(.065 if name=='run' else .025 if name=='walk' else 0,4,'X')
        elif key.startswith('wheel.'):
            # +X rotation rolls forward toward -Y; both wheels share axle direction.
            rotation=Matrix.Rotation(phase*(2 if name=='run' else 1) if name in ('walk','run') else 0,4,'X')
        elif name in ('walk','run'):
            if key.startswith('upperarm.'):
                sx=1 if key.endswith('.l') else -1
                rotation=Matrix.Rotation(sx*1.10,4,'Y')
            elif key.startswith('lowerarm.'):
                sx=1 if key.endswith('.l') else -1
                rotation=Matrix.Rotation(-.16,4,'Z') @ Matrix.Rotation(sx*.13,4,'Y')
        elif parent:
            old_base=original[parent] @ rest[parent].inverted() @ rest[key]
            local=(old_base.inverted() @ original[key]).to_quaternion().to_matrix().to_4x4()
            target[key]=inherited @ local
            continue
        target[key]=inherited @ basis.inverted() @ rotation @ basis

exec(compile((HERE.parent/'social-media/retarget.py').read_text(),str(HERE.parent/'social-media/retarget.py'),'exec'),globals())
rig.animation_data.action=clips['idle'];scene.frame_set(1)

# Independent studio, excluded from runtime exports.
studio=bpy.data.collections.new('Studio — preview only');scene.collection.children.link(studio)
def move_to_studio(obj):
    for coll in list(obj.users_collection):coll.objects.unlink(obj)
    studio.objects.link(obj)
def area(name,position,energy,color,size):
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.color=color;data.shape='DISK';data.size=size
    obj=bpy.data.objects.new(name,data);studio.objects.link(obj);obj.location=position
    obj.rotation_euler=(Vector((0,0,1.2))-obj.location).to_track_quat('-Z','Y').to_euler()
area('Key',(3,-4,5),480,(.80,.90,1),4)
area('Warm rim',(-3,1,3),600,(1,.65,.30),3)
area('Fill',(-3,-2,2),200,(.80,.85,.91),3)
world=bpy.data.worlds.new('Builder studio');world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.10,.12,.17,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.35;scene.world=world
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.012));ground=bpy.context.object;move_to_studio(ground)
ground.data.materials.append(material('studio-floor',(.025,.029,.043),0,.6,False))
data=bpy.data.cameras.new('Portrait');camera=bpy.data.objects.new('Portrait',data);studio.objects.link(camera)
camera.location=(3,-6,2.65);camera.rotation_euler=(Vector((0,0,1.18))-camera.location).to_track_quat('-Z','Y').to_euler()
data.type='ORTHO';data.ortho_scale=2.85;scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=40;scene.cycles.use_denoising=True
scene.render.resolution_x=1000;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
for obj in bpy.context.selected_objects:obj.select_set(False)
rig.select_set(True);bpy.context.view_layer.objects.active=rig
for screen in bpy.data.screens:
    for ar in screen.areas:
        if ar.type=='VIEW_3D':ar.spaces.active.region_3d.view_distance=3.5;ar.spaces.active.region_3d.view_location=(0,0,1.2)
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'website-builder.blend'))
(HERE/'rig.json').write_text(json.dumps({'id':'builder-wheeled-v1','units':'metres','front':'-Y',
 'joints':{k:{'position':p,'parent':q} for k,(p,q) in joints.items()},'name':'Website Builder','asset':'website-builder',
 'propLabel':'Tablet and plans','locomotion':'wheeled','wheelBones':['wheel.l','wheel.r'],'wheelRadius':WHEEL_R,
 'actions':list(clips),'motionSource':motion_source,'clipMetadata':motion['clips'],'reference':str(rig['reference'])},indent=2)+'\n')
scene.render.filepath=str(HERE/'preview.png');bpy.ops.render.render(write_still=True)
print('WEBSITE_BUILDER_BUILD_COMPLETE',len(body),'parts',len(joints),'bones')
