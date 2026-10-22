"""Bake the editable model and export a portable, independently rigged GLB.

Run after build.py:
Blender --background design/agents/social-media/social-media.blend --python design/agents/social-media/export.py
"""
from pathlib import Path
import json

import bmesh
import bpy

HERE = Path(globals().get('ASSET_DIR', Path(__file__).resolve().parent))
ASSET_ID = globals().get('ASSET_ID','social-media')
PROP_SUFFIX = globals().get('PROP_SUFFIX','camera')
ROOT = HERE.parents[2]
rig = bpy.data.objects[globals().get('RIG_NAME','SocialMediaRig')]
rig.data.pose_position = 'REST'
bones = list(json.loads((HERE/'rig.json').read_text())['joints'])
studio = bpy.data.collections['Studio — preview only']
studio.hide_render = studio.hide_viewport = True
body_source = bpy.data.collections[globals().get('BODY_COLLECTION','Social Media — editable parts')]
camera_source = bpy.data.collections[globals().get('PROP_COLLECTION','Camera — removable accessory')]
camera_source.hide_render = camera_source.hide_viewport = True
recipe = (ROOT/'design/campus/bake_model.py').read_text()

def bake(collection, name, size):
    # The campus baker creates one UV atlas and a single material, preserving the
    # custom light/bone attributes. Its ordinary static GLB is replaced below by
    # a GLB carrying this character's own skin and animations.
    env = {'BAKE':{'collection':collection.name,'name':name,'size':size,'bones':bones,
                   'light_uv_scale':globals().get('LIGHT_UV_SCALE',{})}}
    exec(compile(recipe,'bake_model.py','exec'),env)
    obj = env['baked']
    # Evaluated source meshes can carry orphaned deform indices through the
    # campus joiner. Remove them before assigning this rig's rigid groups.
    bm=bmesh.new();bm.from_mesh(obj.data)
    for layer in list(bm.verts.layers.deform.values()): bm.verts.layers.deform.remove(layer)
    bm.to_mesh(obj.data);bm.free()
    obj.vertex_groups.clear()
    attr = obj.data.attributes['_bone']
    ids = {}
    for i, entry in enumerate(attr.data):
        index = round(entry.value)
        assert 0 <= index < len(bones), (i,index)
        ids.setdefault(index,[]).append(i)
    for index, vertices in ids.items():
        obj.vertex_groups.new(name=bones[index]).add(vertices,1,'REPLACE')
    mod = obj.modifiers.new('Rigid mechanical skin','ARMATURE'); mod.object=rig
    obj.parent=rig
    return obj

body = bake(body_source,ASSET_ID,1024)
if callable(globals().get('POST_SKIN')):
    POST_SKIN(body,bones)
body.hide_render = body.hide_viewport = True
camera_source.hide_render = camera_source.hide_viewport = False
camera = bake(camera_source,f'{ASSET_ID}-{PROP_SUFFIX}',512)
body.hide_render = body.hide_viewport = False
rig.data.pose_position = 'POSE'
rig.animation_data.action = bpy.data.actions['idle']
bpy.context.scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
extras=[bpy.data.objects[name] for name in globals().get('EXTRA_EXPORT_OBJECTS',())]
for obj in (rig,body,camera,*extras):
    obj.hide_render=obj.hide_viewport=False
    obj.select_set(True)
bpy.context.view_layer.objects.active=rig
path=HERE/f'{ASSET_ID}.glb'
bpy.ops.export_scene.gltf(filepath=str(path),use_selection=True,export_format='GLB',
    export_yup=True,export_apply=False,export_attributes=True,export_skins=True,
    export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,
    export_all_influences=False,export_force_sampling=True,export_frame_range=False,
    export_cameras=False,export_lights=False)
# Reopen to the editable source, with baked runtime meshes available in hidden collections.
body.hide_render=body.hide_viewport=True
camera.hide_render=camera.hide_viewport=True
body_source.hide_render=body_source.hide_viewport=False
camera_source.hide_render=camera_source.hide_viewport=False
studio.hide_render=studio.hide_viewport=False
rig.animation_data.action=bpy.data.actions['idle']
bpy.context.scene.frame_set(1)
bpy.ops.file.pack_all()
bpy.ops.wm.save_mainfile()
for name in [f'nodexeus-{ASSET_ID}.glb',f'nodexeus-{ASSET_ID}-{PROP_SUFFIX}.glb']:
    (HERE/name).unlink(missing_ok=True)
print('AGENT_EXPORT_COMPLETE',path,path.stat().st_size)
