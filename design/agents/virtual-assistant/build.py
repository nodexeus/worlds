"""Build the purple headset Virtual Assistant from its approved character reference."""
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
make_bolt=bolt;bolt_specs=[]
definitions(HERE.parent/'email-marketing/build.py',{'plate','panel','pod','seam','bolt','seat_bolts'})
definitions(HERE.parent/'copywriter/build.py',{'joint'})
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for coll in list(bpy.data.collections):
    if not coll.objects:bpy.data.collections.remove(coll)
source=bpy.data.collections.new('Virtual Assistant — editable parts');bpy.context.scene.collection.children.link(source)
props=bpy.data.collections.new('Assistant — removable tablet');bpy.context.scene.collection.children.link(props)
LOOKS={
 'purple':material('assistant-weathered-plum',(.105,.034,.135),.57,.47),
 'cream':material('assistant-worn-ivory-metal',(.52,.46,.36),.64,.42),
 'gold':material('assistant-aged-brass',(.32,.195,.072),.84,.36),
 'steel':material('assistant-worn-steel',(.10,.105,.11),.85,.36),
 'frame':material('assistant-charcoal-mechanisms',(.018,.019,.022),.76,.40),
 'leather':material('assistant-utility-pouches',(.026,.022,.020),.02,.79),
 'rubber':material('assistant-rubber',(.009,.010,.012),0,.83,False),
 'glass':material('assistant-display-glass',(.002,.003,.004),.27,.12,False),
 'eye':material('assistant-amber-eyes',(0,0,0),0,.25,False,(1,.36,.004)),
 'lamp':material('assistant-amber-status',(0,0,0),0,.3,False,(1,.36,.004)),
}
for finish in ('purple','cream','gold','steel','frame','leather'):
    for node in LOOKS[finish].node_tree.nodes:
        if node.bl_idname=='ShaderNodeTexNoise':node.inputs['Scale'].default_value=55
        if node.bl_idname=='ShaderNodeValToRGB':
            for el,p in zip(node.color_ramp.elements,[.29,.36,.71,.79]):el.position=p
            node.color_ramp.elements[-1].color=(.24,.17,.085,1)
f=Figure()
HZ,SZ,HIP,KNEE,ANKLE=2.035,1.49,1.005,.555,.145
SHOULDER,EX,WX,LEG=.257,.56,.855,.158

def curved_cable(bone,points,radius,finish='rubber'):
    """Smooth cable bends while retaining the authored mounting endpoints."""
    points=[Vector(p) for p in points];curve=[]
    for i in range(len(points)-1):
        a,b,c,d=points[max(0,i-1)],points[i],points[i+1],points[min(len(points)-1,i+2)]
        for j in range(10):
            t=j/10
            curve.append((2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)*.5)
    curve.append(points[-1]);seam(bone,curve,radius,finish)

# Rounded helmet with an actual open front: no hidden sphere can intersect the visor.
def squircle(a,rx,rz,exponent=2.65):
    c,s=math.cos(a),math.sin(a)
    return math.copysign(abs(c)**(2/exponent),c)*rx,math.copysign(abs(s)**(2/exponent),s)*rz

def helmet_point(t,angle):
    stations=[(-.274,.345,.244),(-.225,.390,.300),(-.065,.414,.334),(.125,.371,.307),(.235,.253,.215),(.280,.035,.035)]
    index=min(int(t),len(stations)-2);u=t-index
    a,b,c,d=[Vector(stations[i]) for i in [max(0,index-1),index,index+1,min(len(stations)-1,index+2)]]
    y,rx,rz=(2*b+(-a+c)*u+(2*a-5*b+4*c-d)*u*u+(-a+3*b-3*c+d)*u*u*u)*.5
    x,z=squircle(angle,rx,rz)
    return Vector((x,y,HZ+z))

bm=f.part('head','purple');rows=[]
for j in range(41):
    rows.append([bm.verts.new(helmet_point(j/8,TAU*i/80)) for i in range(80)])
for a,b in zip(rows,rows[1:]):
    for i in range(80):k=(i+1)%80;bm.faces.new((a[i],a[k],b[k],b[i]))
bm.faces.new(rows[-1][::-1])
# Segmented ivory panels follow the same curved shell, with a small physical thickness.
def helmet_patch(t0,t1,a0,a1,finish='cream'):
    bm=f.part('head',finish);grid=[]
    for j in range(13):
        row=[]
        for i in range(9):
            t=t0+(t1-t0)*j/12;a=a0+(a1-a0)*i/8
            p=helmet_point(t,a);normal=Vector((p.x,p.y-.01,p.z-HZ)).normalized()
            row.append(bm.verts.new(p+normal*.004))
        grid.append(row)
    for a,b in zip(grid,grid[1:]):
        for i in range(8):bm.faces.new((a[i],a[i+1],b[i+1],b[i]))
    for edge in [grid[0],grid[-1],[r[0] for r in grid],[r[-1] for r in grid]]:
        for a,b in zip(edge,edge[1:]):
            aa=bm.verts.new(a.co-Vector((a.co.x,a.co.y-.01,a.co.z-HZ)).normalized()*.008)
            bb=bm.verts.new(b.co-Vector((b.co.x,b.co.y-.01,b.co.z-HZ)).normalized()*.008)
            bm.faces.new((a,b,bb,aa))
for a in [.80,2.05,3.80,5.30]:helmet_patch(.6,3.9,a,a+.23)
helmet_patch(1.20,3.0,1.38,1.76,'frame')
for t in [.64,2.85]:
    seam('head',[helmet_point(t,TAU*i/96)*1+Vector((0,0,.0002)) for i in range(97)],.0025,'frame')

# Continuous rounded display bezel and a shallow convex dark screen.
def face_loop(rx,rz,y):
    return [Vector((x,y,HZ+z)) for x,z in (squircle(TAU*i/96,rx,rz) for i in range(96))]
def face_band(finish,stations,close=False):
    bm=f.part('head',finish);rows=[[bm.verts.new(p) for p in face_loop(rx,rz,y)] for rx,rz,y in stations]
    for a,b in zip(rows,rows[1:]):
        for i in range(96):k=(i+1)%96;bm.faces.new((a[i],a[k],b[k],b[i]))
    if close:bm.faces.new(rows[-1])
face_band('frame',[(.351,.251,-.265),(.352,.247,-.286),(.340,.234,-.307),(.320,.214,-.310)])
face_band('gold',[(.322,.216,-.306),(.317,.211,-.313),(.312,.206,-.313)])
face_band('glass',[(.314,.208,-.311),(.28,.185,-.350),(.20,.13,-.350),(.07,.045,-.350)],True)
# Amber ring eyes and fine horizontal scan lines, embedded in the screen surface.
for side,sx in [('l',1),('r',-1)]:
    x=sx*.148;bone=f'eye.{side}'
    ring(bone,'eye',.080,.010,xyz(x,-.352,HZ,rx=Q) @ Matrix.Diagonal((1,1,.12,1)),64,8)
    for j in range(-18,19):
        z=j*.0048
        outer=math.sqrt(max(0,.09**2-z*z));inner=math.sqrt(max(0,.069**2-z*z))
        if outer<.003:continue
        for sign in [-1,1]:
            f.bar(bone,'eye',(x+sign*inner,-.353,HZ+z),(x+sign*outer,-.353,HZ+z),.00075,4)
# Forehead and chin lamps mounted on their curved helmet support.
for sx in [-1,1]:
    panel('head','frame',.115,.036,-.270,.044,sx*.215,HZ+.258,.015)
    panel('head','gold',.100,.027,-.278,.013,sx*.215,HZ+.258,.011)
    panel('head','lamp',.079,.013,-.286,.012,sx*.215,HZ+.258,.006)
    for z in [HZ-.14,HZ+.13]:bolt('head',xyz(sx*.352,-.30,z,rx=Q),.007)
panel('head','frame',.16,.037,-.270,.045,0,HZ-.268,.016)
panel('head','gold',.14,.027,-.279,.014,0,HZ-.268,.010)
panel('head','lamp',.112,.012,-.287,.014,0,HZ-.268,.005)

# Headset hubs overlap the helmet; ribs, protective cables and microphone attach to them.
for sx in [-1,1]:
    for xx,r,finish,depth in [(sx*.397,.173,'rubber',.09),(sx*.438,.176,'steel',.045),(sx*.467,.158,'gold',.025),(sx*.485,.137,'frame',.025)]:
        disk('head',finish,xx,.018,HZ-.025,r,depth,'side')
    emblem('head',xyz(sx*.500,.018,HZ-.025,ry=sx*Q) @ Matrix.Rotation(sx*Q,4,'Z'),.091)
    for i in range(18):
        a=TAU*i/18
        f.block('head','frame',.060,.015,.023,xyz(sx*.412,.018+math.sin(a)*.166,HZ-.025+math.cos(a)*.166,rx=-a),.005,2)
    for a in [.45,2.4,3.8,5.3]:
        ring('head','lamp',.161,.005,xyz(sx*.452,.018,HZ-.025,ry=Q),8,5,a,.35)
    for a in [.65,2.2,3.8,5.35]:
        bolt('head',xyz(sx*.50,.018+math.sin(a)*.149,HZ-.025+math.cos(a)*.149,ry=sx*Q),.006)
    cable=[(sx*.403,.05,HZ+.095),(sx*.415,.07,HZ+.24),(sx*.31,.10,HZ+.363),(sx*.20,.10,HZ+.377),(sx*.13,.10,HZ+.306)]
    curved_cable('head',cable,.017)
    f.drum('head','gold',24,.028,.024,HZ+.294,HZ+.321,xyz(sx*.13,.10))
    f.block('head','gold',.048,.065,.051,xyz(sx*.379,.065,HZ+.285,ry=sx*.65),.008,3)
    # Attached cable loop remains entirely on the head bone.
    curved_cable('head',[(sx*.397,.08,HZ-.14),(sx*.36,.11,HZ-.32),(sx*.25,.11,HZ-.38),(sx*.18,.13,HZ-.27)],.011)
mic=[(-.475,-.032,HZ-.13),(-.493,-.11,HZ-.22),(-.480,-.245,HZ-.305),(-.398,-.35,HZ-.326),(-.236,-.39,HZ-.326)]
curved_cable('head',mic,.010,'steel')
f.bar('head','rubber',(-.267,-.39,HZ-.326),(-.202,-.39,HZ-.326),.022,16)
f.bar('head','gold',(-.246,-.39,HZ-.326),(-.237,-.39,HZ-.326),.024,16)

# Exposed neck, narrow segmented torso and waist, matching the upright reference.
f.drum('chest','frame',24,.054,.054,1.58,1.80)
for z in [1.63,1.69,1.75]:f.drum('chest','steel',24,.061,.061,z,z+.016)
f.bar('chest','gold',(.041,-.015,1.61),(.041,-.015,1.78),.012,10)
f.ball('chest','frame',1,xyz(0,.022,1.407),(.205,.147,.222),36,24)
# Back service cover sits outside the chassis instead of intersecting its curved surface.
back_outline=[(-.11,1.605),(.11,1.605),(.157,1.51),(.135,1.32),(.075,1.25),(-.075,1.25),(-.135,1.32),(-.157,1.51)]
backward=lambda v:Vector((v.x,-v.y,v.z))
plate('chest','steel',back_outline,-.157,.027,.032,.019,backward)
plate('chest','purple',[(x*.90,1.43+(z-1.43)*.94) for x,z in back_outline],-.174,.022,.030,.014,backward)
for z in [1.39,1.43,1.47,1.51]:
    f.block('chest','frame',.125,.011,.013,xyz(0,.188,z),.005,3)
for sx in [-1,1]:
    for z in [1.34,1.55]:bolt('chest',xyz(sx*.085,.22,z,rx=-Q),.006)
outline=[(-.13,1.626),(.13,1.626),(.184,1.52),(.151,1.29),(.09,1.245),(-.09,1.245),(-.151,1.29),(-.184,1.52)]
plate('chest','steel',outline,-.134,.045,.032,.029)
plate('chest','purple',[(x*.91,1.43+(z-1.43)*.95) for x,z in outline],-.153,.025,.031,.030)
emblem('chest',xyz(0,-.190,1.435,rx=Q),.066)
for sx in [-1,1]:
    for z,x in [(1.56,.102),(1.30,.085)]:bolt('chest',xyz(sx*x,-.21,z,rx=Q),.006)
    disk('chest','steel',sx*.168,-.086,1.359,.065,.07)
    disk('chest','gold',sx*.168,-.128,1.359,.047,.018)
    disk('chest','lamp',sx*.168,-.141,1.359,.020,.010)
    seam('chest',[(sx*.162,.045,1.50),(sx*.227,.035,1.35),(sx*.20,.008,1.23),(sx*.13,-.04,1.245)],.012,'rubber')
for z,w in [(1.595,.115),(1.266,.075)]:
    panel('chest','frame',w+.025,.031,-.184,.033,0,z,.013)
    panel('chest','lamp',w,.011,-.196,.012,0,z,.005)
for z in [1.08,1.126,1.17,1.212]:
    f.drum('spine','frame',24,.068,.068,z-.020,z+.020)
    f.drum('spine','steel',24,.071,.071,z+.011,z+.024)
for sx in [-1,1]:f.bar('spine','gold',(sx*.046,-.024,1.05),(sx*.054,-.032,1.25),.014,12)
f.ball('hips','frame',1,xyz(0,.012,HIP),(.187,.136,.134),32,22)
plate('hips','purple',[(-.135,1.126),(.135,1.126),(.157,1.035),(.073,.891),(-.073,.891),(-.157,1.035)],-.120,.05,.036,.024)
panel('hips','gold',.105,.035,-.147,.025,0,1.10,.012)
panel('hips','lamp',.077,.013,-.162,.012,0,1.10,.005)
# Utility pouches attached through visible belt tabs, plus a fixed hanging badge.
for sx in [-1,1]:
    f.block('hips','leather',.135,.170,.232,xyz(sx*.235,.033,.986),.026,4)
    panel('hips','leather',.132,.095,-.062,.029,sx*.235,1.065,.018)
    f.block('hips','leather',.035,.027,.20,xyz(sx*.235,-.072,1.005),.008,3)
    panel('hips','gold',.054,.039,-.092,.017,sx*.235,1.015,.007)
    f.bar('hips','steel',(sx*.15,.028,1.075),(sx*.235,.028,1.11),.022,12)
for j in range(3):ring('hips','gold',.021,.005,xyz(.307,-.047,1.08-j*.030,rx=Q if j%2==0 else 0),20,6)
panel('hips','gold',.082,.115,-.086,.022,.307,.947,.012)
panel('hips','frame',.066,.096,-.099,.014,.307,.947,.008)
emblem('hips',xyz(.307,-.108,.947,rx=Q),.027)

# Overlapping axles and shells maintain shared pivots throughout the rigid motion chain.
for side,sx in [('l',1),('r',-1)]:
    u,l,w=f'upperarm.{side}',f'lowerarm.{side}',f'wrist.{side}'
    joint(u,sx*SHOULDER,SZ,.105);joint(l,sx*EX,SZ,.077);joint(w,sx*WX,SZ,.052)
    disk(u,'cream',sx*SHOULDER,0,SZ,.109,.105,'side')
    f.bar(u,'steel',(sx*SHOULDER,0,SZ),(sx*EX,0,SZ),.045,18)
    pod(u,'cream',.150,.155,.242,xyz(sx*.410,.005,SZ,ry=sx*Q))
    pod(u,'purple',.123,.158,.222,xyz(sx*.410,-.026,SZ+.011,ry=sx*Q))
    for x in [.36,.46]:bolt(u,xyz(sx*x,-.12,SZ+.01,rx=Q),.006)
    f.bar(l,'frame',(sx*EX,0,SZ),(sx*WX,0,SZ),.045,16)
    for y in [-.047,.047]:f.bar(l,'steel',(sx*(EX+.025),y,SZ),(sx*(WX-.02),y,SZ),.012,12)
    pod(l,'cream',.176,.183,.255,xyz(sx*.710,.009,SZ,ry=sx*Q))
    pod(l,'purple',.173,.170,.246,xyz(sx*.715,-.023,SZ+.017,ry=sx*Q))
    f.block(l,'gold',.075,.023,.026,xyz(sx*.735,-.106,SZ+.006),.009,3)
    f.block(l,'lamp',.058,.015,.012,xyz(sx*.735,-.119,SZ+.006),.005,3)
    for x in [.66,.78]:bolt(l,xyz(sx*x,-.14,SZ+.026,rx=Q),.006)
    f.block(w,'frame',.099,.120,.066,xyz(sx*(WX+.048),0,SZ),.022,4)
    f.block(w,'steel',.088,.105,.023,xyz(sx*(WX+.048),0,SZ+.032),.016,3)
    disk(w,'gold',sx*(WX+.048),0,SZ-.036,.026,.012,'top')
    disk(w,'lamp',sx*(WX+.048),0,SZ-.044,.017,.009,'top')
    for j in range(4):
        bone=f'finger{j}.{side}';y=(j-1.5)*.029;length=[.072,.090,.083,.064][j]
        f.bar(bone,'frame',(sx*(WX+.089),y,SZ),(sx*(WX+.089+length),y,SZ),.012,12)
        for off in [.096,.126]:f.ball(bone,'steel',.016,xyz(sx*(WX+off),y,SZ),around=12,up=8)
        f.block(bone,'frame',length*.65,.025,.026,xyz(sx*(WX+.113+length*.22),y,SZ+.009),.010,3)
        f.block(bone,'gold',.022,.022,.011,xyz(sx*(WX+.108),y,SZ+.026),.004,2)
        f.block(bone,'lamp',.010,.010,.006,xyz(sx*(WX+.108),y,SZ+.033),.002,2)
    f.bar(w,'steel',(sx*(WX+.027),-.062,SZ),(sx*(WX+.084),-.085,SZ-.036),.018,12)
    f.ball(w,'frame',.023,xyz(sx*(WX+.084),-.085,SZ-.036),around=16,up=10)
    x=sx*LEG;u,l,foot,toe=f'upperleg.{side}',f'lowerleg.{side}',f'foot.{side}',f'toes.{side}'
    joint(u,x,HIP,.101,True);joint(l,x,KNEE,.080,True);joint(foot,x,ANKLE,.069,True)
    f.bar(u,'frame',(x,0,HIP),(x,0,KNEE),.043,16)
    pod(u,'cream',.178,.171,.334,xyz(x,.002,.799,ry=sx*.02))
    pod(u,'purple',.124,.164,.322,xyz(x+sx*.022,-.025,.791,ry=sx*.06))
    f.block(u,'gold',.022,.019,.081,xyz(x-sx*.039,-.087,.755),.008,3)
    f.block(u,'lamp',.010,.013,.062,xyz(x-sx*.039,-.100,.755),.004,3)
    for z in [.71,.89]:bolt(u,xyz(x+sx*.025,-.13,z,rx=Q),.006)
    f.bar(l,'frame',(x,0,KNEE),(x,0,ANKLE),.038,16)
    for dx in [-.046,.046]:f.bar(l,'steel',(x+dx,0,.49),(x+dx,0,.19),.010,12)
    pod(l,'cream',.153,.144,.302,xyz(x,-.012,.349,ry=-sx*.07))
    pod(l,'purple',.116,.153,.282,xyz(x+sx*.016,-.037,.344,ry=-sx*.07))
    f.block(l,'gold',.026,.022,.088,xyz(x-sx*.047,-.077,.405),.009,3)
    f.block(l,'lamp',.011,.013,.067,xyz(x-sx*.047,-.091,.405),.004,3)
    bolt(l,xyz(x+sx*.014,-.13,.30,rx=Q),.006)
    # Heel and articulated toe meet around the toe pivot, with chunky rounded soles.
    f.drum(foot,'rubber',32,1,1,0,.042,xyz(x,.008) @ Matrix.Diagonal((.111,.112,1,1)))
    f.drum(foot,'cream',32,1,.93,.042,.070,xyz(x,.008) @ Matrix.Diagonal((.113,.112,1,1)))
    f.ball(foot,'frame',1,xyz(x,.004,.107),(.103,.102,.080),28,18)
    pod(foot,'purple',.105,.117,.128,xyz(x,-.010,.157,rx=.28))
    f.drum(toe,'rubber',36,1,1,0,.042,xyz(x,-.172) @ Matrix.Diagonal((.126,.133,1,1)))
    f.drum(toe,'gold',36,1,.96,.042,.060,xyz(x,-.172) @ Matrix.Diagonal((.127,.132,1,1)))
    f.ball(toe,'purple',1,xyz(x,-.162,.106),(.122,.126,.063),32,20)
    panel(toe,'cream',.102,.064,-.180,.11,x,.143,.015)
    panel(toe,'frame',.09,.027,-.284,.026,x,.081,.010)
    panel(toe,'lamp',.066,.011,-.299,.012,x,.081,.005)
    for dx in [-.084,.084]:bolt(toe,xyz(x+dx,-.20,.142),.006)
seat_bolts();body=emit_parts(f,source)
body_seats=json.loads((HERE/'previews/fastener-seating.json').read_text())

# Separate handheld tablet, shown only when requested in the review controls.
f=Figure();bolt_specs=[];TX=-(WX+.115)
panel('tablet','steel',.295,.390,-.051,.052,TX,SZ+.125,.036)
panel('tablet','frame',.269,.365,-.082,.022,TX,SZ+.125,.028)
panel('tablet','glass',.235,.305,-.097,.013,TX,SZ+.132,.018)
for sx in [-1,1]:
    for z in [SZ-.031,SZ+.282]:bolt('tablet',xyz(TX+sx*.115,-.12,z,rx=Q),.006)
for j,width in enumerate([.12,.15,.09,.14]):
    panel('tablet','lamp',width,.009,-.108,.009,TX-.018,SZ+.21-j*.045,.004)
emblem('tablet',xyz(TX,.006,SZ+.125,rx=-Q),.069)
seat_bolts();prop_seats=json.loads((HERE/'previews/fastener-seating.json').read_text())
(HERE/'previews/fastener-seating.json').write_text(json.dumps(body_seats+prop_seats,indent=2)+'\n')
accessories=emit_parts(f,props)

joints={'root':((0,0,0),None),'hips':((0,0,HIP),'root'),'spine':((0,0,1.14),'hips'),
 'chest':((0,0,1.43),'spine'),'head':((0,0,1.79),'chest'),
 'eye.l':((.148,-.348,HZ),'head'),'eye.r':((-.148,-.348,HZ),'head')}
for side,sx in [('l',1),('r',-1)]:
    joints.update({f'upperarm.{side}':((sx*SHOULDER,0,SZ),'chest'),f'lowerarm.{side}':((sx*EX,0,SZ),f'upperarm.{side}'),
        f'wrist.{side}':((sx*WX,0,SZ),f'lowerarm.{side}'),f'upperleg.{side}':((sx*LEG,0,HIP),'hips'),
        f'lowerleg.{side}':((sx*LEG,0,KNEE),f'upperleg.{side}'),f'foot.{side}':((sx*LEG,0,ANKLE),f'lowerleg.{side}'),
        f'toes.{side}':((sx*LEG,-.080,.060),f'foot.{side}')})
    for j in range(4):joints[f'finger{j}.{side}']=((sx*(WX+.089),(j-1.5)*.029,SZ),f'wrist.{side}')
joints['tablet']=((TX,-.051,SZ),'wrist.r')
arm=bpy.data.armatures.new('VirtualAssistantRig');rig=bpy.data.objects.new('VirtualAssistantRig',arm)
bpy.context.scene.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name,(pos,parent) in joints.items():
    bone=arm.edit_bones.new(name);bone.head=pos;bone.tail=Vector(pos)+Vector((0,0,.08))
    if parent:bone.parent=arm.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True
for obj in body+accessories:
    bone=obj['bone'];group=obj.vertex_groups.new(name=bone);group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    mod=obj.modifiers.new('Character skin','ARMATURE');mod.object=rig;obj.parent=rig
    for name,val in [('_bone',list(joints).index(bone)),('_light',1 if obj['finish']=='eye' else 2 if obj['finish']=='lamp' else 0)]:
        attr=obj.data.attributes.new(name,'FLOAT','POINT');attr.data.foreach_set('value',[float(val)]*len(obj.data.vertices))
scene=bpy.context.scene;scene.render.fps=30
rig['reference']='agents/Finals/Virtual Assistant.png';rig['rig_family']='assistant-humanoid-v1';rig['front']='-Y'
exec(compile((HERE.parent/'social-media/retarget.py').read_text(),str(HERE.parent/'social-media/retarget.py'),'exec'),globals())
rig.animation_data.action=clips['idle'];scene.frame_set(1)

# Studio scene is excluded from portable exports.
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
world=bpy.data.worlds.new('Assistant studio');world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.10,.12,.17,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.35;scene.world=world
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.012));ground=bpy.context.object;move_to_studio(ground)
ground.data.materials.append(material('studio-floor',(.025,.029,.043),0,.6,False))
data=bpy.data.cameras.new('Portrait');camera=bpy.data.objects.new('Portrait',data);studio.objects.link(camera)
camera.location=(3,-6,2.7);camera.rotation_euler=(Vector((0,0,1.23))-camera.location).to_track_quat('-Z','Y').to_euler()
data.type='ORTHO';data.ortho_scale=2.85;scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=40;scene.cycles.use_denoising=True
scene.render.resolution_x=1000;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
for obj in bpy.context.selected_objects:obj.select_set(False)
rig.select_set(True);bpy.context.view_layer.objects.active=rig
for screen in bpy.data.screens:
    for ar in screen.areas:
        if ar.type=='VIEW_3D':
            ar.spaces.active.region_3d.view_distance=3.5;ar.spaces.active.region_3d.view_location=(0,0,1.2)
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'virtual-assistant.blend'))
(HERE/'rig.json').write_text(json.dumps({'id':'assistant-humanoid-v1','units':'metres','front':'-Y',
 'joints':{k:{'position':p,'parent':q} for k,(p,q) in joints.items()},'name':'Virtual Assistant','asset':'virtual-assistant',
 'propLabel':'Tablet','actions':list(clips),'motionSource':motion_source,'clipMetadata':motion['clips'],'reference':str(rig['reference'])},indent=2)+'\n')
scene.render.filepath=str(HERE/'preview.png');bpy.ops.render.render(write_still=True)
print('VIRTUAL_ASSISTANT_BUILD_COMPLETE',len(body),'parts',len(joints),'bones')
