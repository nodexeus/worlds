/** Verify actual wheel motion and axle stability in the exported GLB. */
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {Matrix4,Quaternion,Vector3} from 'three'
const here=new URL('./',import.meta.url)
const doc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(fileURLToPath(new URL('website-builder.glb',here)))
const root=doc.getRoot(),nodes=root.listNodes()
const find=name=>nodes.find(n=>n.getName().replaceAll('.','')===name)
const wheels=['wheell','wheelr'].map(find)
assert.ok(wheels.every(Boolean),'two dedicated wheel bones')
assert.ok(!nodes.some(n=>/upperleg|lowerleg|foot|toes/.test(n.getName())),'wheeled anatomy must not inherit a leg rig')
const rest=new Map(nodes.map(n=>[n,{translation:n.getTranslation(),rotation:n.getRotation(),scale:n.getScale()}]))
const inverseRest=wheels.map(n=>new Matrix4().fromArray(n.getWorldMatrix()).invert())
function pose(clip,time){
 for(const [n,r] of rest)n.setTranslation(r.translation).setRotation(r.rotation).setScale(r.scale)
 for(const channel of clip.listChannels()){
  const sampler=channel.getSampler(),times=sampler.getInput().getArray(),values=sampler.getOutput().getArray()
  const path=channel.getTargetPath(),size=path==='rotation'?4:3
  let a=0;while(a<times.length-1&&times[a+1]<=time)a++
  // glTF holds endpoint values outside a sampler's authored key range.
  const b=Math.min(a+1,times.length-1),t=b===a?0:Math.max(0,Math.min(1,(time-times[a])/(times[b]-times[a])))
  const av=Array.from(values.slice(a*size,(a+1)*size)),bv=Array.from(values.slice(b*size,(b+1)*size))
  const v=path==='rotation'?new Quaternion(...av).slerp(new Quaternion(...bv),t).toArray():av.map((v,i)=>v+(bv[i]-v)*t)
  channel.getTargetNode()[{translation:'setTranslation',rotation:'setRotation',scale:'setScale'}[path]](v)
 }
}
const reports=[]
for(const clipName of ['walk','run','sit']){
 const clip=root.listAnimations().find(a=>a.getName()===clipName)
 const end=Math.max(...clip.listSamplers().map(s=>s.getInput().getMax([])[0]))
 let previous=null,total=0,maxDisagreement=0,maxStagger=0,minHeight=Infinity,maxHeight=-Infinity,maxTrackDrift=0
 for(let i=0;i<=120;i++){
  pose(clip,end*i/120)
  const transforms=wheels.map((n,j)=>new Matrix4().fromArray(n.getWorldMatrix()).multiply(inverseRest[j]))
  const directions=transforms.map(m=>new Vector3(0,1,0).transformDirection(m))
  maxDisagreement=Math.max(maxDisagreement,directions[0].distanceTo(directions[1]))
  const angle=Math.atan2(directions[0].z,directions[0].y)
  if(previous!==null){let step=angle-previous;while(step>Math.PI)step-=2*Math.PI;while(step< -Math.PI)step+=2*Math.PI;total+=step}
  previous=angle
  const centers=wheels.map(n=>n.getWorldTranslation())
  maxStagger=Math.max(maxStagger,Math.abs(centers[0][2]-centers[1][2]))
  maxTrackDrift=Math.max(maxTrackDrift,Math.abs(Math.abs(centers[0][0]-centers[1][0])-.572))
  for(const p of centers){minHeight=Math.min(minHeight,p[1]);maxHeight=Math.max(maxHeight,p[1])}
  for(const m of transforms)assert.ok(new Vector3(1,0,0).transformDirection(m).distanceTo(new Vector3(1,0,0))<.001,'axles must remain horizontal')
 }
 const turns=total/(2*Math.PI)
 assert.ok(Math.abs(turns-(clipName==='walk'?1:clipName==='run'?2:0))<.01,`${clipName}: wrong rolling direction or travel (${turns} turns)`)
 assert.ok(maxDisagreement<.001,`${clipName}: wheel rotations diverge`)
 assert.ok(maxStagger<.001,`${clipName}: wheels step fore and aft`)
 assert.ok(maxTrackDrift<.001,`${clipName}: track width changes`)
 assert.ok(maxHeight-minHeight<.003,`${clipName}: chassis height varies by ${maxHeight-minHeight} m (${minHeight} to ${maxHeight})`)
 reports.push({clip:clipName,samples:121,turns,maxDirectionDifference:maxDisagreement,maxForeAftStagger:maxStagger,maxTrackDrift,heightVariation:maxHeight-minHeight})
}
writeFileSync(new URL('previews/wheel-verification.json',here),JSON.stringify(reports,null,2)+'\n')
console.log(JSON.stringify(reports,null,2))
