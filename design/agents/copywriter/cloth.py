"""Continuous scarf weights and secondary motion, confined to the cloth chain."""
import math
from mathutils import Matrix

SCARF=['scarf.0','scarf.1','scarf.2','scarf.3']
SCARF_Z=[1.73,1.43,1.13,.86]

def weight_scarf(obj,bones,all_vertices=False):
    marks=obj.data.attributes.get('_bone')
    selected=[v for v in obj.data.vertices if all_vertices or bones[round(marks.data[v.index].value)]=='scarf.0']
    if not selected:return
    for name in SCARF:
        if obj.vertex_groups.get(name) is None:obj.vertex_groups.new(name=name)
    for v in selected:
        for group in obj.vertex_groups:group.remove([v.index])
        z=v.co.z
        if z>=SCARF_Z[0]:weights={SCARF[0]:1}
        elif z<=SCARF_Z[-1]:weights={SCARF[-1]:1}
        else:
            for i in range(len(SCARF)-1):
                if SCARF_Z[i]>=z>=SCARF_Z[i+1]:
                    t=(SCARF_Z[i]-z)/(SCARF_Z[i]-SCARF_Z[i+1])
                    weights={SCARF[i]:1-t,SCARF[i+1]:t};break
        for name,w in weights.items():
            if w>1e-8:obj.vertex_groups[name].add([v.index],w,'REPLACE')

def pose_extras(target,rest,name,frame,clip):
    # Follow the adjacent thigh as it moves forward into the hanging scarf.
    local=target['hips'].inverted() @ target['upperleg.l']
    bind=rest['hips'].inverted() @ rest['upperleg.l']
    leg=(local @ bind.inverted()).to_euler().x
    bend=max(-1.6,min(0,leg))
    for i,key in enumerate(SCARF):
        parent='chest' if i==0 else SCARF[i-1]
        sway=math.sin(frame/30*2.3+i*.55)*(.006 if i else 0)
        target[key]=target[parent] @ rest[parent].inverted() @ rest[key] @ Matrix.Rotation(bend*[.10,.45,.30,.15][i]+sway,4,'X')
