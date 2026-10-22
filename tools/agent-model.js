/** Isolated asset review. Does not load or change the user's world or roster. */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { loadCrew, frameFor, decorateSkinned } from '../src/agents/crew.js'
import { loadCampusBuildings, campusBuilding } from '../src/world/campus-buildings.js'
import { robotGeometry, robotLights, decorateLights } from '../src/agents/robots.js'

try {
  const assets={'social-media':'Social Media Specialist','email-marketing':'Email Marketing Specialist','copywriter':'Copywriter','seo-strategist':'SEO Strategist','business-strategist':'Business Strategist','virtual-assistant':'Virtual Assistant','website-builder':'Website Builder'}
  const requested=new URLSearchParams(location.search).get('asset') || 'social-media'
  const asset=Object.hasOwn(assets,requested)?requested:'social-media'
  const assetSelect=document.querySelector('#asset')
  for(const [id,label] of Object.entries(assets))assetSelect.add(new Option(label,id))
  assetSelect.value=asset
  assetSelect.onchange=()=>{const url=new URL(location.href);url.searchParams.set('asset',assetSelect.value);location.href=url}
  document.title=assets[asset]+' · Model review'
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.2
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  document.querySelector('#scene').append(renderer.domElement)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#171c27')
  const pmrem = new THREE.PMREMGenerator(renderer)
  const environment = new RoomEnvironment()
  scene.environment = pmrem.fromScene(environment).texture
  scene.environmentIntensity = .65
  environment.dispose(); pmrem.dispose()
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, .01, 100)
  camera.position.set(3, 2.4, 5.5)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 1.1, 0)
  controls.update()
  scene.add(new THREE.HemisphereLight(0xc4d8ff, 0x504338, .9))
  const key = new THREE.DirectionalLight(0xffe5c2, 3)
  key.position.set(3, 5, 4); key.castShadow = true
  key.shadow.mapSize.setScalar(2048)
  Object.assign(key.shadow.camera, { left:-3,right:3,top:3,bottom:-3,near:.1,far:15 })
  key.shadow.normalBias = .01; scene.add(key)
  const rim = new THREE.DirectionalLight(0xaf8aff, 2)
  rim.position.set(-3, 2, -2); scene.add(rim)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200),new THREE.MeshStandardMaterial({color:0x242a37,roughness:.8}))
  floor.rotation.x=-Math.PI/2;floor.position.y=-.014;floor.receiveShadow=true;scene.add(floor)
  const gltf = await new GLTFLoader().loadAsync(`/design/agents/${asset}/${asset}.glb`)
  scene.add(gltf.scene)
  let tris = 0
  const skinMeshes=[]
  gltf.scene.traverse(o => {
    if (o.isMesh) { o.castShadow=!(o.material.transmission>0); tris += (o.geometry.index?.count || o.geometry.attributes.position.count)/3 }
    if (o.isSkinnedMesh) skinMeshes.push(o)
  })
  const prop = skinMeshes.find(o=>o.name.startsWith(asset+'-'))
  const mixer = new THREE.AnimationMixer(gltf.scene)
  const clips = new Map(gltf.animations.map(c=>[c.name,c]))
  const manifest=await fetch(`/design/agents/${asset}/rig.json`).then(r=>r.json())
  document.querySelector('#prop-label').textContent=manifest.propLabel || 'Camera'
  const [rig]=await Promise.all([loadCrew(),loadCampusBuildings()])
  const lightUniform={value:new THREE.Vector4(1,1,1,0)}
  for(const mesh of skinMeshes) {
    const marks=mesh.geometry.getAttribute('_light')
    mesh.geometry.setAttribute('aMark',marks.clone())
    let sum=0,count=0
    for(let i=0;i<marks.count;i++) if(Math.round(marks.getX(i))===1){sum+=mesh.geometry.attributes.position.getY(i);count++}
    decorateLights(mesh.material,count?sum/count:0)
    const hook=mesh.material.onBeforeCompile
    mesh.material.onBeforeCompile=(shader,renderer)=>{
      hook(shader,renderer)
      shader.vertexShader=shader.vertexShader.replace('attribute vec4 aLight;','uniform vec4 aLight;')
      shader.uniforms.aLight=lightUniform
    }
  }
  const baselines=['crew-unit','crew-rock'].map((name,index)=>{
    const model=campusBuilding(name),geo=robotGeometry(model.geometry,rig.bones)
    const frames=new THREE.InstancedBufferAttribute(new Float32Array(1),1)
    const lights=new THREE.InstancedBufferAttribute(new Float32Array(4),4)
    geo.setAttribute('aFrame',frames);geo.setAttribute('aLight',lights)
    const mat=model.material.clone();mat.metalness=.75;mat.emissiveIntensity=1.7
    decorateLights(decorateSkinned(mat,{uBones:{value:rig.boneTexture},uFrameMax:{value:rig.frameCount-1}}),geo.userData.eyeY)
    const mesh=new THREE.InstancedMesh(geo,mat,1)
    mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(index===0?-1.6:1.6,0,0))
    mesh.frustumCulled=false;scene.add(mesh)
    return {mesh,frames,lights}
  })
  if(prop) prop.visible=false
  let active, paused=false, elapsed=0, selected='idle'
  const stateFor=name=>name==='sleep'?'sleeping':name==='wave'?'waiting':name.startsWith('work')?'working':name==='hit'?'blocked':name==='cheer'?'celebrating':'idle'
  function update(time) {
    let name=selected, local=time
    if(name==='sleep') {
      const down=manifest.clipMetadata.sitDown.duration
      name=time<down?'sitDown':'sit';local=time<down?time:time-down
    }
    if(active?.getClip().name!==name) {
      mixer.stopAllAction();active=mixer.clipAction(clips.get(name));active.play()
    }
    const meta=manifest.clipMetadata[name]
    active.setLoop(meta.loop?THREE.LoopRepeat:THREE.LoopOnce,meta.loop?Infinity:1)
    active.clampWhenFinished=true;active.paused=false
    mixer.setTime(meta.loop?local%active.getClip().duration:Math.min(local,active.getClip().duration))
    const light=robotLights(stateFor(selected),time,.4)
    lightUniform.value.set(light.eye,light.open,light.lamp,light.fault)
    for(const baseline of baselines) {
      baseline.frames.setX(0,frameFor(rig.clips[name],local));baseline.frames.needsUpdate=true
      baseline.lights.setXYZW(0,light.eye,light.open,light.lamp,light.fault);baseline.lights.needsUpdate=true
    }
    gltf.scene.updateMatrixWorld(true)
    for(const mesh of skinMeshes){mesh.skeleton.update();mesh.computeBoundingBox()}
  }
  const select=document.querySelector('#action')
  for (const name of clips.keys()) select.add(new Option(name,name))
  select.add(new Option('Sleep (sit down + dim eyes)','sleep'))
  function pose(name,time=0,draw=true) {
    selected=name;elapsed=time;update(time)
    select.value=name
    if(draw)renderer.render(scene,camera)
    const bounds=new THREE.Box3()
    for(const mesh of skinMeshes) if(mesh.visible) bounds.union(mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld))
    return bounds.min.toArray().concat(bounds.max.toArray())
  }
  select.onchange=()=>pose(select.value)
  document.querySelector('#pause').onclick=()=>{paused=!paused;document.querySelector('#pause').textContent=paused?'Play':'Pause'}
  document.querySelector('#camera').onchange=e=>{if(prop) prop.visible=e.target.checked}
  const view=(angle=0,distance=10,height=2.5,targetHeight=1.08)=>{
    camera.position.set(Math.sin(angle)*distance,height,Math.cos(angle)*distance)
    controls.target.set(0,targetHeight,0);controls.update();renderer.render(scene,camera)
  }
  document.querySelector('#front').onclick=()=>view(0)
  document.querySelector('#back').onclick=()=>view(Math.PI)
  pose('idle');view(0)
  document.querySelector('#status').textContent=`${skinMeshes[0].skeleton.bones.length} bones · ${Math.round(tris).toLocaleString()} triangles · ${clips.size} clips · Left: existing unit · Center: ${assets[asset]} · Right: existing rock`
  window.agentModelReview = {
    ready:true, clips:[...clips.keys(),'sleep'],
    sample(name,time,angle=.45,solo=false,inspection={}){
      paused=true;for(const baseline of baselines)baseline.mesh.visible=!solo
      const bounds=pose(name,time);view(angle,inspection.distance??(solo?5.8:10),inspection.height??2.5,inspection.targetHeight??1.08)
      return {bounds,png:renderer.domElement.toDataURL('image/png')}
    },
    measure(name,time){ paused=true;return pose(name,time,false) },
    jointGaps(name,time){
      paused=true
      if(selected!==name || elapsed!==time)pose(name,time,false)
      const skeleton=skinMeshes[0].skeleton
      return skeleton.bones.flatMap((bone,index)=>{
        if(['root','hips'].includes(bone.name))return []
        const parent=skeleton.bones.indexOf(bone.parent)
        if(parent<0)return []
        const pivot=new THREE.Vector3().setFromMatrixPosition(skeleton.boneInverses[index].clone().invert())
        const parentPoint=pivot.clone().applyMatrix4(new THREE.Matrix4().fromArray(skeleton.boneMatrices,parent*16))
        const childPoint=pivot.clone().applyMatrix4(new THREE.Matrix4().fromArray(skeleton.boneMatrices,index*16))
        return [{bone:bone.name,gap:parentPoint.distanceTo(childPoint)}]
      })
    },
    durations:{...Object.fromEntries([...clips].map(([name,clip])=>[name,clip.duration])),sleep:5},
    lights(name,time){return robotLights(stateFor(name),time,.4)},
    info(){ return {triangles:tris,bones:skinMeshes[0].skeleton.bones.length,drawCalls:renderer.info.render.calls} },
  }
  const clock=new THREE.Clock()
  renderer.setAnimationLoop(()=>{
    const dt=Math.min(clock.getDelta(),.05)
    if(!paused){elapsed+=dt;update(elapsed)}
    controls.update();renderer.render(scene,camera)
  })
  addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()})
} catch(error) {
  document.querySelector('#error').textContent=error.stack
  window.agentModelReview={error:error.message}
  console.error(error)
}
