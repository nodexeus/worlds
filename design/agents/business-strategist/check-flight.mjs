/** Verify flight behavior in the exported GLB, independent of the Blender recipe. */
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {Matrix4,Quaternion,Vector3} from 'three'
const here=new URL('./',import.meta.url)
const doc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(fileURLToPath(new URL('business-strategist.glb',here)))
const root=doc.getRoot(),nodes=root.listNodes()
const find=name=>nodes.find(n=>n.getName().replaceAll('.','')===name)
const pods=['upperlegl','upperlegr'].map(find)
const rest=new Map(nodes.map(n=>[n,{translation:n.getTranslation(),rotation:n.getRotation(),scale:n.getScale()}]))
const inverseRest=pods.map(n=>new Matrix4().fromArray(n.getWorldMatrix()).invert())
const reports=[]
for(const clipName of ['walk','run']){
 const clip=root.listAnimations().find(a=>a.getName()===clipName)
 const end=Math.max(...clip.listSamplers().map(s=>s.getInput().getMax([])[0]))
 let minBack=Infinity,maxDirectionDifference=0,maxStagger=0
 for(let sample=0;sample<=60;sample++){
  for(const [n,r] of rest)n.setTranslation(r.translation).setRotation(r.rotation).setScale(r.scale)
  const time=end*sample/60
  for(const channel of clip.listChannels()){
   const sampler=channel.getSampler(),times=sampler.getInput().getArray(),values=sampler.getOutput().getArray()
   const path=channel.getTargetPath(),size=path==='rotation'?4:3
   let a=0;while(a<times.length-1 && times[a+1]<=time)a++
   const b=Math.min(a+1,times.length-1),t=b===a?0:(time-times[a])/(times[b]-times[a])
   const av=Array.from(values.slice(a*size,(a+1)*size)),bv=Array.from(values.slice(b*size,(b+1)*size))
   const v=path==='rotation'?new Quaternion(...av).slerp(new Quaternion(...bv),t).toArray():av.map((v,i)=>v+(bv[i]-v)*t)
   channel.getTargetNode()[{translation:'setTranslation',rotation:'setRotation',scale:'setScale'}[path]](v)
  }
  const directions=pods.map((n,i)=>new Vector3(0,-1,0).transformDirection(new Matrix4().fromArray(n.getWorldMatrix()).multiply(inverseRest[i])))
  // GLB front is +Z: both downward pod axes must sweep toward -Z together.
  minBack=Math.min(minBack,...directions.map(d=>-d.z))
  maxDirectionDifference=Math.max(maxDirectionDifference,directions[0].distanceTo(directions[1]))
  maxStagger=Math.max(maxStagger,Math.abs(pods[0].getWorldTranslation()[2]-pods[1].getWorldTranslation()[2]))
 }
 reports.push({clip:clipName,samples:61,minBackwardDirection:minBack,maxDirectionDifference,maxForeAftHipStagger:maxStagger})
 assert.ok(minBack>.15,`${clipName}: both pods must point backwards throughout the loop (${minBack})`)
 assert.ok(maxDirectionDifference<.001,`${clipName}: pods alternate instead of flying together (${maxDirectionDifference})`)
 assert.ok(maxStagger<.001,`${clipName}: hips retain walking stagger (${maxStagger})`)
}
writeFileSync(new URL('previews/flight-verification.json',here),JSON.stringify(reports,null,2)+'\n')
console.log(JSON.stringify(reports,null,2))
