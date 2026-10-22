/** Run with Electron while Vite is serving the isolated agent-model review page. */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const asset=process.argv[2] || 'social-media'
if(!/^[a-z0-9-]+$/.test(asset))throw new Error('Invalid asset name')
const out = path.join(root, `design/agents/${asset}/previews`)
const manifest=JSON.parse(fs.readFileSync(path.join(root,`design/agents/${asset}/rig.json`),'utf8'))
const errors = []
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-agent-review-'))
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1500, height: 900, show: false, webPreferences: { backgroundThrottling: false } })
  win.webContents.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message)
  })
  await win.loadURL(process.env.AGENT_REVIEW_URL || `http://127.0.0.1:5277/tools/agent-model.html?asset=${asset}`)
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript('!!window.agentModelReview')) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const state = await win.webContents.executeJavaScript('({ready:window.agentModelReview?.ready,error:window.agentModelReview?.error,info:window.agentModelReview?.info?.()})')
  assert.ok(state.ready, JSON.stringify(state))
  const sampled = await win.webContents.executeJavaScript(`(() => {
    const review=window.agentModelReview, result=[];
    for(const [clip,duration] of Object.entries(review.durations)) {
      let minY=Infinity, maxY=-Infinity, jointGap=0, joint=null;
      const samples=Math.ceil(duration*60)+1;
      for(let i=0;i<samples;i++) {
        const bounds=review.measure(clip,duration*i/(samples-1));
        if(!bounds.every(Number.isFinite)) throw new Error('Nonfinite bounds: '+clip);
        minY=Math.min(minY,bounds[1]);maxY=Math.max(maxY,bounds[4]);
        for(const entry of review.jointGaps(clip,duration*i/(samples-1))) {
          if(entry.gap>jointGap){jointGap=entry.gap;joint=entry.bone}
        }
      }
      result.push({clip,samples,minY,maxY,jointGap,joint});
    }
    return result;
  })()`)
  fs.mkdirSync(out, { recursive: true })
  const reports=[]
  const durations=await win.webContents.executeJavaScript('window.agentModelReview.durations')
  const shots=[['front','idle',.5,0],['back','idle',.5,Math.PI],['sit','sit',.5,0],['sleep','sleep',3,0]]
  for(const [name,angle] of [['under-front',0],['under-left',-.65],['under-right',.65]])
    shots.push([name,'idle',.5,angle,true,{distance:2.7,height:.15,targetHeight:1.4}])
  for(const clip of ['wave','work','walk','interact','phone','phoneUp','phoneDown','run','sit','sitDown','standUp']) for(let i=0;i<12;i++) shots.push([`${clip}-${i}`,clip,i*durations[clip]/12,0])
  for(const clip of ['interact','phone','phoneUp','phoneDown','run','sit','sitDown']) for(const [label,angle] of [['side',Math.PI/2],['three-quarter',.65]]) shots.push([`${clip}-${label}`,clip,durations[clip]*.6,angle,true])
  for(const [name,clip,time,angle,solo=false,inspection={}] of shots) {
    const result=await win.webContents.executeJavaScript(`window.agentModelReview.sample(${JSON.stringify(clip)},${time},${angle},${solo},${JSON.stringify(inspection)})`)
    fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(result.png.split(',')[1],'base64'))
    reports.push({name,clip,time,bounds:result.bounds})
  }
  // Inspect removable accessories and the actual review controls as well as bare-body motion.
  const propShot=await win.webContents.executeJavaScript(`(() => {
    document.querySelector('#camera').click();
    return window.agentModelReview.sample('idle',.5,.35,true);
  })()`)
  fs.writeFileSync(path.join(out,'with-props.png'),Buffer.from(propShot.png.split(',')[1],'base64'))
  fs.writeFileSync(path.join(out,'review-page.png'),(await win.webContents.capturePage()).toPNG())
  const result={state,sampled,reports,errors}
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify({state,sampled,errors},null,2))
  assert.deepEqual(errors,[], 'renderer errors')
  for(const {clip,minY,maxY,jointGap,joint} of sampled) {
    assert.ok(jointGap < .001, `${clip}: ${joint} separates by ${jointGap.toFixed(4)}m`)
    assert.ok(clip==='spawn' || minY >= -.025, `${clip}: penetrates floor by ${-minY.toFixed(3)}m`)
    if(manifest.locomotion==='hover' && clip!=='spawn')
      assert.ok(minY>=manifest.minimumClearance-.002, `${clip}: loses hover clearance (${minY.toFixed(3)}m)`)
    assert.ok(clip==='spawn' || maxY < 3.6, `${clip}: unexpected posed height ${maxY}`)
  }
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
