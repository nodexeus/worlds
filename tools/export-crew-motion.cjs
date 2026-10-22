/** Export the actual runtime's sampled clips, including its work/phone adjustments. */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const asset=process.argv[2] || 'social-media'
if(!/^[a-z0-9-]+$/.test(asset))throw new Error('Invalid asset name')
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL((process.env.AGENT_REVIEW_ORIGIN || 'http://127.0.0.1:5277') + '/tools/agent-model.html')
  const data = await win.webContents.executeJavaScript(`(async()=>{
    const {loadCrew}=await import('/src/agents/crew.js');
    const rig=await loadCrew();
    const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const source=await new GLTFLoader().loadAsync('/assets/crew.glb');
    source.scene.updateMatrixWorld(true);
    let mesh;source.scene.traverse(o=>{if(!mesh&&o.isSkinnedMesh)mesh=o});
    const skeleton=mesh.skeleton;
    return {fps:rig.fps,clips:rig.clips,boneCount:rig.boneCount,
      restSource:'inverse bind matrices in authored vertex coordinates',
      bones:rig.bones.map(b=>{
        const index=skeleton.bones.findIndex(original=>original.name===b.name);
        if(index<0)throw new Error('Missing bind matrix: '+b.name);
        return {name:b.name,parent:b.parent?.name,
          rest:mesh.bindMatrix.clone().invert().multiply(skeleton.boneInverses[index].clone().invert()).toArray()};
      }),
      matrices:Array.from(rig.boneTexture.image.data)};
  })()`)
  data.source='public/assets/crew.glb + src/agents/crew.js'
  data.sha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'public/assets/crew.glb'))).update(fs.readFileSync(path.join(root,'src/agents/crew.js'))).digest('hex')
  const out=path.join(root,`design/agents/${asset}/bake/crew-motion.json`)
  fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(data))
  console.log(JSON.stringify({file:out,clips:Object.keys(data.clips),bones:data.bones.length,sha256:data.sha256}))
  app.quit()
}).catch(error=>{console.error(error);app.exit(1)})
