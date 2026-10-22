/** Validate a character GLB against the portable model contract (not visual fidelity). */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'

const file = process.argv[2]
if (!file) throw new Error('usage: node tools/check-agent-model.mjs <model.glb>')
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file)
const root = doc.getRoot()
assert.equal(root.listSkins().length, 1, 'one dedicated rig')
const skin = root.listSkins()[0]
const manifest = JSON.parse(readFileSync(join(dirname(file),'rig.json'),'utf8'))
const manifestBones = Object.keys(manifest.joints)
assert.ok(skin.listJoints().length >= 20)
const wanted = manifest.actions
assert.equal(wanted.length, 18, 'all production clips must be retargeted')
assert.ok(manifest.motionSource.sha256, 'record source provenance')
for (const name of wanted) assert.ok(root.listAnimations().some(a => a.getName() === name), `missing ${name}`)
for (const a of root.listAnimations()) {
  assert.ok(a.listChannels().length)
  for (const s of a.listSamplers()) {
    assert.ok([...s.getInput().getArray()].every(Number.isFinite), `${a.getName()}: invalid key times`)
    assert.ok([...s.getOutput().getArray()].every(Number.isFinite), `${a.getName()}: invalid transforms`)
  }
}
let triangles = 0
let blendedVertices = 0
for (const mesh of root.listMeshes()) {
  assert.equal(mesh.listPrimitives().length, 1, `${mesh.getName()}: single baked material`)
  for (const p of mesh.listPrimitives()) {
    for (const name of ['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0','_BONE','_LIGHT']) {
      const attr=p.getAttribute(name)
      assert.ok(attr, `${mesh.getName()}: missing ${name}`)
      assert.ok([...attr.getArray()].every(Number.isFinite), `${mesh.getName()}: invalid ${name}`)
    }
    const joints=p.getAttribute('JOINTS_0').getArray(), weights=p.getAttribute('WEIGHTS_0').getArray()
    const rigid=p.getAttribute('_BONE').getArray()
    const deformable=new Set(manifest.deformableBones || [])
    for (let i=0;i<weights.length;i+=4) {
      assert.ok(Math.abs(weights[i]+weights[i+1]+weights[i+2]+weights[i+3]-1)<1e-5)
      const authoredBone=manifestBones[Math.round(rigid[i/4])]
      for (let k=0;k<4;k++) assert.ok(joints[i+k]<skin.listJoints().length)
      if(deformable.has(authoredBone)) {
        if(weights.slice(i,i+4).filter(w=>w>1e-5).length>1)blendedVertices++
        for(let k=0;k<4;k++) if(weights[i+k]>1e-5)
          assert.ok(deformable.has(skin.listJoints()[joints[i+k]].getName()),'cloth must bind only to its declared chain')
        continue
      }
      assert.equal(weights.slice(i,i+4).filter(w=>w>1e-5).length,1, `${mesh.getName()}: mechanical vertex must have one rigid influence`)
      const slot=weights.slice(i,i+4).findIndex(w=>w>.5)
      assert.equal(skin.listJoints()[joints[i+slot]].getName(), manifestBones[Math.round(rigid[i/4])], `${mesh.getName()}: weight bound to wrong bone`)
    }
    const mat=p.getMaterial()
    if(manifest.transmissiveMeshes?.includes(mesh.getName())) {
      assert.ok(mat.getExtension('KHR_materials_transmission')?.getTransmissionFactor()>=.9, `${mesh.getName()}: clear dome must transmit light`)
      assert.ok(mat.getRoughnessFactor()<.2, `${mesh.getName()}: dome must remain clear`)
      assert.ok(mat.getMetallicFactor()<.1, `${mesh.getName()}: dome must be dielectric`)
    } else {
      for (const slot of ['getBaseColorTexture','getNormalTexture','getMetallicRoughnessTexture','getEmissiveTexture'])
        assert.ok(mat[slot]()?.getImage()?.length, `${mesh.getName()}: missing embedded ${slot}`)
    }
    triangles+=p.getIndices().getCount()/3
  }
}
assert.ok(triangles<100_000, `unexpectedly dense: ${triangles}`)
if(manifest.deformableBones?.length)assert.ok(blendedVertices>0,'declared cloth chain must have blended vertices')
console.log(JSON.stringify({file, bytes:readFileSync(file).length, meshes:root.listMeshes().map(m=>m.getName()),
  bones:skin.listJoints().length, triangles, blendedVertices, clips:root.listAnimations().map(a=>a.getName())},null,2))
