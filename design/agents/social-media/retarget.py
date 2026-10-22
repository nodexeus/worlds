"""Retarget the actual sampled production motions, retaining this model's proportions.

Executed by build.py. Refresh bake/crew-motion.json with tools/export-crew-motion.cjs.
Bone rotations come from the production skin matrices; joint offsets come from
this character. Ground contact is corrected for its longer legs and larger shoes.
"""
motion=json.loads((HERE/'bake/crew-motion.json').read_text())
assert motion.get('restSource')=='inverse bind matrices in authored vertex coordinates', 'Refresh crew-motion.json: bind-pose metadata required'
motion_source={k:motion[k] for k in ('source','sha256','restSource')}
# Three's animation loader strips dots from bone names.
canonical={name.replace('.',''):name for name in joints}
for bone in motion['bones']:
    bone['name']=canonical.get(bone['name'],bone['name'])
    bone['parent']=canonical.get(bone['parent'],bone['parent'])
conversion=Matrix.Rotation(math.pi/2,4,'X')
def matrix(values):
    return conversion @ Matrix([values[i:i+4] for i in range(0,16,4)]).transposed() @ conversion.inverted()

source={b['name']:b for b in motion['bones']}
source_rest={name:matrix(b['rest']) for name,b in source.items()}
target_rest={b.name:b.matrix_local.copy() for b in rig.data.bones}
scale=HIP/source_rest['hips'].translation.z
contact=[]
points={}
for obj in body:
    if obj['bone'] in globals().get('SOFT_BONES',()):continue
    points.setdefault(obj['bone'],set()).update(tuple(v.co) for v in obj.data.vertices)
# A rigid part's convex hull has the same lowest point as its complete mesh.
# Include hands and leg armor too: sitting can put those below the shoe soles.
for key,vertices in points.items():
    bm=bmesh.new()
    for point in vertices: bm.verts.new(point)
    hull=bmesh.ops.convex_hull(bm,input=list(bm.verts))
    surface={v for face in hull['geom'] if isinstance(face,bmesh.types.BMFace) for v in face.verts}
    contact.extend((key,v.co.copy()) for v in surface)
    bm.free()
clips={}
rig.animation_data_create()
for name,clip in motion['clips'].items():
    action=bpy.data.actions.new(name);action.use_fake_user=True
    rig.animation_data.action=action
    for frame in range(clip['frames']):
        posed={}
        delta={}
        for i,b in enumerate(motion['bones']):
            offset=((clip['start']+frame)*motion['boneCount']+i)*16
            delta[b['name']]=matrix(motion['matrices'][offset:offset+16])
            posed[b['name']]=delta[b['name']] @ source_rest[b['name']]
        target={}
        for bone in rig.data.bones:
            key=bone.name;parent=bone.parent.name if bone.parent else None
            rest=target_rest[key]
            inherited=target[parent] @ target_rest[parent].inverted() @ rest if parent else rest
            if key in source:
                rotation=delta[key].to_quaternion().to_matrix().to_4x4() @ rest.to_quaternion().to_matrix().to_4x4()
                translation_delta=Vector((0,0,0))
                # Rigid limbs rotate about shared pivots; they never slide apart.
                # Only root/hips carry body translation from the source animation.
                if key in ('root','hips'):
                    source_parent=source[key]['parent']
                    if source_parent in source_rest:
                        expected=posed[source_parent] @ source_rest[source_parent].inverted() @ source_rest[key].translation
                        translation_delta=posed[key].translation-expected
                    else:
                        translation_delta=posed[key].translation-source_rest[key].translation
                rotation.translation=inherited.translation+translation_delta*scale
                target[key]=rotation
            else:
                target[key]=inherited
        if callable(globals().get('pose_extras')):
            pose_extras(target,target_rest,name,frame,clip)
        # Keep planted feet on the ground. Jump/spawn retain their authored lift.
        if name != 'spawn':
            low=min((target[key] @ target_rest[key].inverted() @ point).z for key,point in contact)
            correction=min(0,low) if name=='jump' else low
            for transform in target.values(): transform.translation.z-=correction
        # Hovering anatomies can keep clearance without adding artificial feet.
        clearance=globals().get('ground_clearance')
        if callable(clearance):
            lift=clearance(name,frame,clip)
            for transform in target.values():transform.translation.z+=lift
        for bone in rig.data.bones:
            key=bone.name;parent=bone.parent.name if bone.parent else None
            base=target[parent] @ target_rest[parent].inverted() @ target_rest[key] if parent else target_rest[key]
            pb=rig.pose.bones[key];pb.rotation_mode='QUATERNION'
            pb.matrix_basis=base.inverted() @ target[key]
            for channel in ('location','rotation_quaternion','scale'):
                pb.keyframe_insert(channel,frame=frame+1)
        scene.frame_set(frame+1)
    track=rig.animation_data.nla_tracks.new();track.name=name;track.mute=True
    track.strips.new(name,1,action)
    clips[name]=action
print('RETARGET_COMPLETE',len(clips),'clips from',motion_source)
