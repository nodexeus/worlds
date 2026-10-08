// Run with Electron, not node:test: drives the real page against a real server whose agents
// play a script. `npm run test:crew:ui` builds the page first.
import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const database = process.env.WORLDS_TEST_DATABASE_URL
const temp = mkdtempSync(path.join(os.tmpdir(), 'crew-ui-'))
const shots = process.env.CREW_UI_SHOTS || path.join(temp, 'shots')
const schema = `ui_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

app.setPath('userData', path.join(temp, 'electron'))
// The window is never shown, and a page that is not shown is not painted unless told to be.
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

let server
let win
const steps = []

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })

/** Start the server as a deployment would: its own process, told everything by its environment. */
function startServer(port) {
  const child = spawn('node', ['server/serve.mjs'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      // No sessions of the person running this are read: the campus is empty but for the crew.
      HOME: temp,
      CLAUDE_CONFIG_DIR: path.join(temp, 'claude'),
      CODEX_HOME: path.join(temp, 'codex'),
      BOT_CROSSING_CLAUDE_DESKTOP: path.join(temp, 'no-desktop'),
      PORT: String(port),
      WORLDS_DATABASE_URL: database,
      WORLDS_DATABASE_SCHEMA: schema,
      WORLDS_DATA_DIR: path.join(temp, 'data'),
      WORLDS_DEMO_RUNTIME: '1',
      WORLDS_CURATED_AGENTS: 'quill',
      WORLDS_AGENT_LIMIT: '3',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let said = ''
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      said += chunk
      if (said.includes('Crew backend ready')) resolve()
    })
    child.stderr.on('data', (chunk) => { said += chunk })
    child.once('exit', (code) => reject(new Error(`the server stopped (${code}): ${said}`)))
  })
  return { child, ready, stop: () => new Promise((resolve) => (child.exitCode === null ? (child.once('exit', resolve), child.kill('SIGTERM')) : resolve())) }
}

/** Run an expression in the page and give back what it evaluates to. */
const page = (expression) => win.webContents.executeJavaScript(`(async () => (${expression}))()`, true)

/** Wait until an expression in the page is truthy, and give back its value. */
async function until(expression, what, ms = 20_000) {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await page(expression).catch(() => null)
    if (value) return value
    if (Date.now() > deadline) throw new Error(`never happened: ${what}\n  ${expression}`)
    await delay(40)
  }
}

/**
 * Save what the page looks like now. The window is drawn off screen, at its own pace, so the
 * picture is taken from frames painted after this was asked for and not from the last one
 * there happened to be.
 */
async function shot(name) {
  await delay(400)
  const image = await new Promise((resolve) => {
    let frames = 0
    let latest = null
    const done = () => {
      clearTimeout(timer)
      win.webContents.off('paint', onPaint)
      resolve(latest)
    }
    const onPaint = (_event, _dirty, frame) => {
      latest = frame
      if (++frames >= 5) done()
    }
    const timer = setTimeout(done, 4000)
    win.webContents.on('paint', onPaint)
    win.webContents.invalidate()
  })
  await fs.mkdir(shots, { recursive: true })
  await fs.writeFile(path.join(shots, `${name}.png`), (image ?? await win.webContents.capturePage()).toPNG())
}

const step = (name) => {
  steps.push(name)
  process.stdout.write(`  ${name}\n`)
}

/** Helpers the page is given, so each step reads as what a person does. */
const HELPERS = `
  window.t = {
    q: (sel, root = document) => root.querySelector(sel),
    all: (sel, root = document) => [...root.querySelectorAll(sel)],
    text: (sel, root = document) => root.querySelector(sel)?.textContent ?? '',
    card: (name) => [...document.querySelectorAll('.crew-card')].find((card) => card.querySelector('.cc-who b').textContent === name),
    row: (name) => [...document.querySelectorAll('.cp-row')].find((row) => row.querySelector('.cp-name').firstChild.textContent === name),
    type(el, value) {
      el.focus()
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    /** Type into a card's box and send, once the last message has gone. */
    async say(name, value) {
      const card = this.card(name)
      this.type(card.querySelector('.cc-input'), value)
      const send = card.querySelector('.cc-send')
      for (let n = 0; send.disabled && n < 200; n += 1) await new Promise((resolve) => setTimeout(resolve, 25))
      send.click()
    },
    notes: (name) => [...window.t.card(name).querySelectorAll('.cc-note')].map((note) => note.textContent),
    line: (name) => window.t.card(name).querySelector('.cc-line').textContent,
    chip(name, workspace) {
      [...this.card(name).querySelectorAll('.cc-chip')].find((chip) => chip.textContent === workspace).click()
    },
    /** The crew as the campus has drawn it: its workspaces' plots, its robots, its buildings. */
    world() {
      const colony = window.botCrossing.colony
      const title = (id) => colony.plots.get(id)?.title
      return {
        plots: colony.plotOrder.filter((plot) => plot.crew).map((plot) => [plot.title, plot.cells.length]).sort(),
        crew: colony.astronauts.agents.filter((agent) => agent.thread?.crew && agent.state !== 'gone' && agent.state !== 'leaving')
          .map((agent) => [agent.thread.title, agent.roams ? 'roams' : title(agent.thread.project), agent.status]).sort(),
        buildings: [...colony.buildings.values()].filter((entry) => !entry.retiring).map((entry) => title(entry.plot)).sort(),
      }
    },
    /** Look at one of the crew's workspaces from close by. */
    lookAt(name) {
      const { colony, rig } = window.botCrossing
      const plot = colony.plotOrder.find((one) => one.title === name)
      rig.focus(plot.middle || plot.center, { distance: 15 })
    },
    dock: () => document.querySelector('.crew-dock'),
    box: () => document.querySelector('.crew-dock .cc-input'),
    /** The newest post in the channel, and parts of it. */
    last: () => [...document.querySelectorAll('.cd-post')].at(-1),
    replies: () => [...window.t.last().querySelectorAll('.cd-rep')].map((rep) => rep.querySelector('.cd-who').firstChild.textContent),
    dnotes: () => [...window.t.last().querySelectorAll('.cd-note')].map((note) => note.textContent),
    claim: () => window.t.last().querySelector('.cd-claim h4')?.textContent ?? '',
    button(label, root = window.t.last()) {
      return [...root.querySelectorAll('button')].find((button) => button.textContent === label)
    },
    /** Type a post and send it, once the last has gone. */
    async post(value) {
      const count = document.querySelectorAll('.cd-post').length
      this.type(this.box(), value)
      const send = document.querySelector('.crew-dock .cc-send')
      for (let n = 0; send.disabled && n < 200; n += 1) await new Promise((resolve) => setTimeout(resolve, 25))
      send.click()
      for (let n = 0; document.querySelectorAll('.cd-post').length === count && n < 400; n += 1) await new Promise((resolve) => setTimeout(resolve, 25))
    },
  }, true`

async function load(url) {
  await win.loadURL(url)
  await page(HELPERS)
  await until(`window.botCrossing?.crew && t.q('.crew-panel')`, 'the crew is installed and its list drawn', 60_000)
}

async function run() {
  if (!database) throw new Error('set WORLDS_TEST_DATABASE_URL: the interface is checked against a real crew backend')
  const port = await freePort()
  const url = `http://127.0.0.1:${port}/`
  server = startServer(port)
  await server.ready

  win = new BrowserWindow({ show: false, width: 1600, height: 1000, webPreferences: { backgroundThrottling: false, offscreen: true } })
  const errors = []
  win.webContents.on('console-message', ({ level, message }) => {
    if (level === 'error' && !/favicon|megakit|Failed to load resource/.test(message)) errors.push(message)
  })
  await load(url)
  // The first visit opens the help sheet over everything. This is not a first visit.
  await page(`(localStorage.setItem('botcrossing.seen-help', '1'), document.querySelector('#btn-help-close').click())`)

  step('a new world: nobody in the crew, a specialist on offer, and it says it is a demonstration')
  assert.equal(await page(`t.text('.cp-count')`), '0 of 3 agents')
  assert.match(await page(`t.text('.cp-empty')`), /No agents yet/)
  assert.equal(await page(`t.q('.cp-tag').hidden`), false)
  assert.equal(await page(`t.text('.cp-offer .cp-name')`), 'QuillResearch and briefings')
  await shot('01-empty-world')

  step('a workspace is made from the list, and a mistake is explained in the form')
  await page(`t.all('.cp-add .cc-b')[1].click()`)
  await page(`t.q('.cp-form form').requestSubmit()`)
  assert.match(await until(`t.text('.cp-form .cc-problem')`, 'the refusal is shown'), /workspace name/i)
  await page(`t.type(t.q('.cp-form input'), 'Site'), t.q('.cp-form form').requestSubmit()`)
  await until(`t.text('.cp-places') === 'Site'`, 'the workspace is listed')
  await page(`t.all('.cp-add .cc-b')[1].click(), t.type(t.q('.cp-form input'), 'Api'), t.q('.cp-form form').requestSubmit()`)
  await until(`t.text('.cp-places') === 'SiteApi'`, 'the second workspace is listed')

  step('each workspace is a plot on the campus, under its name, with one building and nobody on it')
  await until(`t.world().plots.length === 2`, 'both plots are up')
  assert.deepEqual(await page(`t.world()`), { plots: [['Api', 1], ['Site', 1]], crew: [], buildings: ['Api', 'Site'] })

  step('an agent is added, and its card opens')
  await page(`t.all('.cp-add .cc-b')[0].click()`)
  // A new agent is a name and a role. What it runs on is the server's business, never asked.
  assert.deepEqual(await page(`[t.all('.cp-form select').length, t.all('.cp-form input, .cp-form textarea').length]`), [0, 2])
  assert.doesNotMatch(await page(`document.body.innerText`), /runs on|claude|hermes|openclaw/i)
  await shot('01-new-agent')
  await page(`t.type(t.q('.cp-form input'), 'Ada'), t.q('.cp-form form').requestSubmit()`)
  await until(`t.card('Ada')`, 'the card is open')
  assert.equal(await page(`t.text('.cp-count')`), '1 of 3 agents')
  assert.equal(await page(`t.line('Ada')`), 'idle')
  assert.equal(await page(`t.row('Ada').getAttribute('aria-pressed')`), 'true')

  step('the new agent is a robot on the campus, with no workspace and so going where it likes')
  await until(`t.world().crew.length === 1`, 'the robot is drawn')
  assert.deepEqual(await page(`t.world().crew`), [['Ada', 'roams', 'idle']])
  assert.deepEqual(await page(`t.world().buildings`), ['Api', 'Site'], 'an agent with no workspace raises nothing')

  step('with two workspaces and nothing to continue, it must be told where')
  await page(`t.type(t.card('Ada').querySelector('.cc-input'), 'Tidy the README')`)
  assert.equal(await page(`t.card('Ada').querySelector('.cc-send').disabled`), true)
  assert.match(await page(`t.text('.cc-hint', t.card('Ada'))`), /Choose a workspace/)
  await page(`t.chip('Ada', 'Site')`)
  assert.match(await page(`t.text('.cc-hint', t.card('Ada'))`), /New task in Site/)

  step('a task is given: the agent works, its words arrive as it writes them, and it finishes')
  await page(`t.card('Ada').querySelector('.cc-send').click()`)
  await until(`t.line('Ada') === 'working · Site'`, 'the card says it is working')
  assert.equal(await page(`t.row('Ada').dataset.status`), 'working')
  await until(`JSON.stringify(t.world().crew) === '[["Ada","Site","working"]]'`, 'the robot is working on its workspace')
  await until(`t.card('Ada').querySelector('.cc-draft')?.textContent.length > 20`, 'text is streaming')
  await shot('02-working')
  await until(`t.notes('Ada').some((note) => note.startsWith('finished'))`, 'the turn finished')
  assert.equal(await page(`t.card('Ada').querySelector('.cc-draft')`), null, 'the draft gave way to the stored text')
  assert.deepEqual(await page(`t.all('.cc-tool', t.card('Ada')).map((tool) => [tool.dataset.state, tool.querySelector('.cc-tool-line').textContent])`), [['done', '✓Read: README.md▸'], ['done', '✓Edit: README.md']])
  assert.equal(await page(`t.text('.cc-ag strong', t.card('Ada'))`), 'Install')
  assert.equal(await page(`t.text('.cc-me', t.card('Ada'))`), 'Tidy the README')
  assert.equal(await page(`t.line('Ada')`), 'idle · last in Site')
  assert.equal(await page(`t.card('Ada').querySelector('.cc-input').value`), '')

  step('a tool line opens to show what it gave back')
  await page(`t.q('.cc-tool-line', t.card('Ada')).click()`)
  assert.equal(await page(`t.q('.cc-tool-out', t.card('Ada')).hidden`), false)
  assert.match(await page(`t.text('.cc-tool-out', t.card('Ada'))`), /A short description/)

  step('markup an agent writes is shown, never run')
  await page(`t.say('Ada', '<img src=x onerror="window.pwned=1"> [x](javascript:window.pwned=2) <script>window.pwned=3</script>')`)
  await until(`t.notes('Ada').filter((note) => note.startsWith('finished')).length === 2`, 'the second turn finished')
  assert.equal(await page(`window.pwned`), undefined)
  assert.equal(await page(`t.all('.crew-card img, .crew-card script, .crew-card a[href^="javascript"]').length`), 0)
  assert.match(await page(`t.all('.cc-ag', t.card('Ada')).at(-1).textContent`), /<img src=x onerror=/)

  step('a message to a busy agent waits, and stopping the agent cancels it')
  await page(`t.say('Ada', 'a long one please')`)
  await until(`t.line('Ada') === 'working · Site'`, 'it is working again')
  assert.equal(await page(`t.card('Ada').querySelector('.cc-chips').hidden`), true, 'a busy agent is not offered a workspace')
  await page(`t.say('Ada', 'and also this')`)
  await until(`t.q('.cc-me[data-state="queued"]', t.card('Ada'))`, 'the message is shown as queued')
  await shot('03-queued')
  await page(`t.card('Ada').querySelector('.cc-stop').click(), t.card('Ada').querySelector('.cc-stop').click()`)
  await until(`t.notes('Ada').includes('stopped')`, 'the turn was stopped')
  await until(`t.q('.cc-me[data-state="cancelled"]', t.card('Ada'))`, 'the queued message was cancelled')
  assert.equal(await page(`t.card('Ada').querySelector('.cc-stop').hidden`), true)
  assert.equal(await page(`t.all('.cc-tool[data-state="stopped"]', t.card('Ada')).length`), 1)

  step('a question is answered in place')
  await page(`t.say('Ada', 'I have a question for you')`)
  await until(`t.q('.cc-ask', t.card('Ada'))`, 'the question is on the card')
  assert.equal(await page(`t.line('Ada')`), 'needs you · Site')
  assert.equal(await page(`t.row('Ada').dataset.status`), 'waiting')
  await until(`JSON.stringify(t.world().crew) === '[["Ada","Site","waiting"]]'`, 'the robot is waiting on the person')
  await shot('04-question')

  step('clicking the robot opens its card, at the question')
  await page(`t.q('.cc-ib[aria-label="Close"]', t.card('Ada')).click()`)
  await until(`!t.card('Ada')`, 'the card is closed')
  await page(`window.botCrossing.hud.actions.select(window.botCrossing.colony.astronauts.agents.find((agent) => agent.thread?.title === 'Ada').id)`)
  await until(`t.q('.cc-ask', t.card('Ada'))`, 'the card is open at the question')
  assert.equal(await page(`document.querySelector('.thread-pop')?.classList.contains('on') ?? false`), false, 'the card for a local session stays shut')
  assert.doesNotMatch(await page(`document.body.innerText`), /crew:/, 'nothing on the page shows an id of the crew\'s')
  await page(`t.all('.cc-ask .cc-b', t.card('Ada'))[0].click()`)
  await until(`t.notes('Ada').some((note) => note === 'Which should I begin with? answered: The README')`, 'the answer is shown')
  await until(`t.all('.cc-ag', t.card('Ada')).at(-1).textContent.includes('begin with: The README')`, 'the agent went on with it')
  assert.equal(await page(`t.q('.cc-ask', t.card('Ada'))`), null)

  step('an answer of the person\'s own can be typed and sent')
  await page(`t.say('Ada', 'one more question')`)
  await until(`t.q('.cc-ask', t.card('Ada'))`, 'the second question is on the card')
  assert.equal(await page(`getComputedStyle(t.q('.cc-send-typed', t.card('Ada'))).display`), 'none', 'nothing to send until something is typed')
  await page(`t.type(t.q('.cc-ask-other', t.card('Ada')), 'The changelog')`)
  assert.equal(await page(`getComputedStyle(t.q('.cc-send-typed', t.card('Ada'))).display`), 'flex')
  await page(`t.q('.cc-send-typed .cc-b', t.card('Ada')).click()`)
  await until(`t.notes('Ada').includes('Which should I begin with? answered: The changelog')`, 'the typed answer is shown')
  await until(`t.all('.cc-ag', t.card('Ada')).at(-1).textContent.includes('begin with: The changelog')`, 'the agent went on with it')

  step('told to ask first, the agent asks, and two clicks are one answer')
  await page(`(t.q('.cp-autonomy select').value = 'ask', t.q('.cp-autonomy select').dispatchEvent(new Event('change')))`)
  await until(`botCrossing.crew.store.state.autonomy === 'ask'`, 'the world is set to ask')
  await page(`t.say('Ada', 'approve the cleanup')`)
  await until(`t.q('.cc-ask[data-type="approval"]', t.card('Ada'))`, 'the approval is on the card')
  assert.match(await page(`t.text('.cc-ask-what', t.card('Ada'))`), /rm -rf build/)
  await shot('05-approval')
  await page(`(t.all('.cc-ask .cc-b', t.card('Ada'))[0].click(), t.all('.cc-ask .cc-b', t.card('Ada'))[0].click())`)
  await until(`t.notes('Ada').includes('answered: allowed')`, 'the approval is shown as answered')
  await until(`t.all('.cc-ag', t.card('Ada')).at(-1).textContent.includes('build output is gone')`, 'the agent went on')
  assert.equal(await page(`t.notes('Ada').filter((note) => note === 'answered: allowed').length`), 1)
  assert.equal(await page(`t.q('.cc-ask-problem:not([hidden])', t.card('Ada'))`), null)
  await page(`(t.q('.cp-autonomy select').value = 'autonomous', t.q('.cp-autonomy select').dispatchEvent(new Event('change')))`)
  await until(`botCrossing.crew.store.state.autonomy === 'autonomous'`, 'the world is autonomous again')

  step('a failure is said plainly, and can be tried again')
  await page(`t.say('Ada', 'please fail')`)
  await until(`t.notes('Ada').some((note) => note.startsWith('failed: The demonstration was asked to fail'))`, 'the failure is shown')
  assert.equal(await page(`t.line('Ada')`), 'failed · last in Site')
  assert.equal(await page(`t.all('.cc-note .cc-link', t.card('Ada')).length`), 1)
  await shot('06-failed')
  await page(`t.q('.cc-note .cc-link', t.card('Ada')).click()`)
  await until(`t.notes('Ada').filter((note) => note.startsWith('failed')).length === 2`, 'it was tried again, and failed again')
  assert.equal(await page(`t.all('.cc-note .cc-link', t.card('Ada')).length`), 1, 'only the last failure offers it')

  step('what is typed while a message is on its way is kept')
  await page(`(t.type(t.card('Ada').querySelector('.cc-input'), 'first thought'), t.card('Ada').querySelector('.cc-send').click(), t.type(t.card('Ada').querySelector('.cc-input'), 'second thought'))`)
  await until(`t.all('.cc-me', t.card('Ada')).some((me) => me.firstChild.textContent === 'first thought')`, 'the first message went')
  await until(`!t.card('Ada').querySelector('.cc-send').disabled`, 'the box is free again')
  assert.equal(await page(`t.card('Ada').querySelector('.cc-input').value`), 'second thought')
  await page(`t.type(t.card('Ada').querySelector('.cc-input'), '')`)
  await until(`t.notes('Ada').filter((note) => note.startsWith('finished')).length === 6`, 'that turn finished')

  step('sending twice in a hurry sends once')
  await page(`(t.type(t.card('Ada').querySelector('.cc-input'), 'just once'), t.card('Ada').querySelector('.cc-send').click(), t.card('Ada').querySelector('.cc-send').click())`)
  await until(`t.notes('Ada').filter((note) => note.startsWith('finished')).length === 7`, 'the turn finished')
  assert.equal(await page(`t.all('.cc-me', t.card('Ada')).filter((me) => me.textContent === 'just once').length`), 1)

  step('choosing a workspace starts a new task, and the old conversation is in the history')
  await page(`t.chip('Ada', 'Api')`)
  await page(`t.say('Ada', 'hello from the other workspace')`)
  await until(`t.line('Ada') === 'working · Api'`, 'it moved to the other workspace')
  await until(`t.world().crew[0][1] === 'Api'`, 'the robot belongs to the other plot now')
  assert.deepEqual(await page(`t.world().buildings`), ['Api', 'Site'], 'a second task raised no second building')
  await until(`t.notes('Ada').some((note) => note.startsWith('finished'))`, 'the new task finished')
  assert.equal(await page(`t.all('.cc-me', t.card('Ada')).length`), 1, 'the card shows the new conversation only')
  await page(`t.q('.cc-ib[aria-label="Earlier conversations"]', t.card('Ada')).click()`)
  await until(`t.all('.cc-talk', t.card('Ada')).length === 2`, 'both conversations are listed')
  assert.deepEqual(await page(`t.all('.cc-talk-title', t.card('Ada')).map((title) => title.textContent)`), ['hello from the other workspace', 'Tidy the README'])
  await shot('07-history')
  await page(`t.all('.cc-talk', t.card('Ada'))[1].click()`)
  await until(`t.all('.cc-me', t.card('Ada')).length > 7`, 'the earlier conversation is shown')
  assert.equal(await page(`t.q('.cc-banner', t.card('Ada')).hidden`), false)
  assert.equal(await page(`t.q('.cc-foot', t.card('Ada')).hidden`), true, 'an earlier conversation is only read')
  await page(`t.q('.cc-banner .cc-link', t.card('Ada')).click()`)
  await until(`t.all('.cc-me', t.card('Ada')).length === 1`, 'back to the current one')
  assert.equal(await page(`t.q('.cc-foot', t.card('Ada')).hidden`), false)

  step('an earlier conversation that failed is read, and does not offer to be tried again')
  await page(`t.say('Ada', 'please fail')`)
  await until(`t.all('.cc-note .cc-link', t.card('Ada')).length === 1`, 'the current one offers it')
  await page(`t.chip('Ada', 'Site')`)
  await page(`t.say('Ada', 'a fresh start')`)
  await until(`t.all('.cc-me', t.card('Ada')).length === 1 && t.notes('Ada').some((note) => note.startsWith('finished'))`, 'the new task finished')
  await page(`t.q('.cc-ib[aria-label="Earlier conversations"]', t.card('Ada')).click()`)
  await until(`t.all('.cc-talk', t.card('Ada')).length === 3`, 'three conversations are listed')
  await page(`t.all('.cc-talk', t.card('Ada'))[1].click()`)
  await until(`t.notes('Ada').some((note) => note.startsWith('failed'))`, 'the failed one is shown')
  assert.equal(await page(`t.all('.cc-note .cc-link', t.card('Ada')).length`), 0)
  await page(`t.q('.cc-banner .cc-link', t.card('Ada')).click()`)
  await until(`t.all('.cc-me', t.card('Ada')).length === 1 && !t.notes('Ada').some((note) => note.startsWith('failed'))`, 'back to the current one')

  step('the help sheet opens over the cards, not under them')
  await page(`document.querySelector('#btn-help').click()`)
  const over = await page(`(() => { const box = t.card('Ada').getBoundingClientRect(); return Boolean(document.elementFromPoint(box.left + 40, box.top + 40).closest('.help')) })()`)
  await page(`document.querySelector('#btn-help-close').click()`)
  assert.equal(over, true)

  step('a specialist is added, in its own section, and counted apart')
  await page(`t.q('.cp-offer .cc-b').click()`)
  await until(`t.card('Quill')`, 'its card opened')
  assert.equal(await page(`t.text('.cp-count')`), '1 of 3 agents, 1 specialist')
  assert.equal(await page(`t.q('.cp-offer')`), null)
  assert.match(await page(`t.line('Quill')`), /Research and briefings/)
  assert.match(await page(`t.text('.cc-empty', t.card('Quill'))`), /Say something to Quill/)
  const [ada, quill] = await page(`[t.card('Ada'), t.card('Quill')].map((card) => card.getBoundingClientRect().toJSON())`)
  assert.ok(quill.left >= ada.right, 'a second card is put beside the first while there is room')
  await shot('08-two-cards')
  await until(`t.world().crew.length === 2`, 'the specialist is drawn too')
  assert.deepEqual(await page(`t.world().crew.find(([name]) => name === 'Quill')`), ['Quill', 'roams', 'idle'])
  assert.deepEqual(await page(`t.world().buildings`), ['Api', 'Site'])
  // The campus on its own, with the cards out of the way.
  await page(`(t.q('.crew-layer').style.visibility = 'hidden', t.lookAt('Site'))`)
  await delay(4000)
  await shot('08b-campus')
  assert.equal(await page(`document.querySelector('.thread-pop').classList.contains('on')`), false, 'the card for a local session stays shut however often the campus is redrawn')
  await page(`t.q('.crew-layer').style.visibility = ''`)

  step('a pinned card comes back after a reload, and an unpinned one does not')
  await page(`t.q('.cc-ib[aria-label^="Pin"]', t.card('Ada')).click()`)
  await load(url)
  await until(`t.card('Ada')`, 'the pinned card is back')
  assert.equal(await page(`Boolean(t.card('Quill'))`), false)
  await until(`t.all('.cc-me', t.card('Ada')).length === 1`, 'with its conversation')

  step('the server going away is said, and coming back is caught up with')
  await server.stop()
  await until(`!t.q('.cp-link').hidden`, 'the list says it is reconnecting', 30_000)
  server = startServer(port)
  await server.ready
  await until(`t.q('.cp-link').hidden`, 'the list is live again', 60_000)
  await page(`t.say('Ada', 'are you still there')`)
  await until(`t.notes('Ada').filter((note) => note.startsWith('finished')).length === 2`, 'a message after the restart is answered', 30_000)
  assert.equal(await page(`t.all('.cc-me', t.card('Ada')).length`), 2, 'and nothing is shown twice')

  step('the crew channel is one bar until it is opened, and says who a post would go to')
  assert.equal(await page(`t.dock().classList.contains('collapsed')`), true)
  assert.equal(await page(`t.text('.cd-sub')`), 'nothing new')
  await page(`t.q('.cd-toggle').click()`)
  assert.equal(await page(`t.text('.cd-sub')`), '2 in the crew')
  assert.equal(
    await page(`t.all('.crew-card').every((card) => Number(card.style.zIndex) < Number(t.dock().style.zIndex))`), true,
    'opened to be read, so it is in front of the cards')
  assert.match(await page(`t.text('.cd-posts .cc-empty')`), /Nothing has been posted yet/)
  assert.ok(await page(`t.box().offsetHeight`) >= 20, 'the box is its full height the first time it is seen')
  await until(`t.line('Ada').startsWith('idle')`, 'Ada has finished')
  await page(`t.type(t.box(), 'Does anyone know where the footer is?')`)
  assert.match(await page(`t.text('.cd-hint')`), /every agent that is free: 2 of 2 now/)
  await page(`t.type(t.box(), '@Zed are you there')`)
  assert.equal(await page(`t.text('.cd-hint')`), 'There is no agent called Zed.')
  assert.equal(await page(`t.q('.crew-dock .cc-send').disabled`), true)

  step('a question to everyone is answered by each agent, under its name')
  await page(`t.post('Does anyone know where the footer is?')`)
  assert.equal(await page(`t.box().value`), '')
  await until(`t.replies().length === 2`, 'both have answered', 30_000)
  assert.deepEqual(await page(`t.replies()`), ['Ada', 'Quill'])
  assert.equal(await page(`t.text('.cd-sent', t.last())`), 'sent to Ada, Quill')
  assert.match(await page(`t.text('.cd-rep .cc-ag', t.last())`), /^Ada here\./)
  assert.equal(await page(`t.text('.cd-rep[data-agent] .cd-who small', t.all('.cd-rep', t.last())[1])`), 'Research and briefings')
  await shot('09-channel-replies')

  step('typing @ offers the crew, and a post that names an agent goes only to it')
  await page(`t.type(t.box(), '@qu')`)
  assert.deepEqual(await page(`t.all('.cd-menu .cd-option').map((option) => option.firstChild.nextSibling.textContent)`), ['Quill'])
  await page(`t.box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
  assert.equal(await page(`t.box().value`), '@Quill ')
  assert.equal(await page(`t.all('.cd-post').length`), 1, 'choosing a name is not sending')
  assert.equal(await page(`t.text('.cd-hint')`), 'Goes only to Quill.')
  // A name written in front of what is already there: chosen once, and then Enter is for sending.
  await page(`(t.type(t.box(), '@ad you there'), t.box().setSelectionRange(3, 3), t.box().dispatchEvent(new Event('input', { bubbles: true })))`)
  assert.equal(await page(`t.q('.cd-menu').hidden`), false)
  await page(`t.box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
  assert.deepEqual(await page(`[t.box().value, t.box().selectionStart, t.q('.cd-menu').hidden]`), ['@Ada you there', 4, true])
  await page(`t.post('@Quill you can pass on this one')`)
  await until(`t.dnotes().includes('Quill passed')`, 'Quill passed', 30_000)
  assert.equal(await page(`t.text('.cd-sent', t.last())`), 'sent to Quill')

  step('a task posted to everyone is taken by one agent, and the other stands down')
  await page(`t.post('Fix the footer')`)
  const taken = await until(`t.claim().startsWith('Taken by') && t.button('Open task') && t.claim()`, 'one agent has it', 30_000)
  const winner = taken.replace('Taken by ', '')
  const other = winner === 'Ada' ? 'Quill' : 'Ada'
  assert.equal(await page(`t.text('.cd-claim p', t.last())`), 'Its task is in Site.')
  await until(`t.dnotes().includes('${other} stood down: it was taken')`, 'the other stood down')
  assert.deepEqual(await page(`t.replies()`), [winner])
  await shot('10-channel-claim')
  await page(`t.button('Open task').click()`)
  await until(`t.card('${winner}')`, 'the winner\'s card is open')
  assert.equal(await until(`t.text('.cc-me small', t.card('${winner}'))`, 'the task says where it came from'), 'from the crew channel')
  assert.equal(await page(`t.text('.cc-me', t.card('${winner}')).startsWith('Fix the footer')`), true)

  step('the post is taken back, and handed to the other agent')
  await page(`t.button('Release').click()`)
  await until(`t.claim() === 'Released'`, 'it is released')
  assert.equal(await page(`t.text('.cd-claim p', t.last())`), `${winner} was taken off it. Nobody has this now.`)
  await until(`t.row('${winner}').dataset.status === 'idle'`, 'the winner was stopped')
  await page(`(t.button('Hand to…').focus(), t.button('Hand to…').click())`)
  assert.deepEqual(await page(`t.all('.cd-pick .cd-option', t.last()).map((option) => option.firstChild.nextSibling.textContent)`), ['Ada', 'Quill'])
  assert.equal(await page(`document.activeElement === t.q('.cd-pick .cd-option', t.last())`), true, 'whoever opened the list is on its first choice')
  await shot('11-channel-hand')
  await page(`t.all('.cd-pick .cd-option', t.last()).find((option) => option.textContent.startsWith('${other}')).click()`)
  await until(`t.claim() === 'Taken by ${other}'`, 'the other agent has it')
  await until(`t.row('${other}').dataset.status === 'working'`, 'and is working on it')
  assert.equal(await page(`t.q('.cd-pick', t.last())`), null)

  step('a world can limit how many agents answer')
  await until(`t.row('${other}').dataset.status === 'idle'`, 'everyone is free again', 30_000)
  await page(`(t.q('.cp-limit select').value = '1', t.q('.cp-limit select').dispatchEvent(new Event('change')))`)
  await until(`fetch('/api/crew/settings').then((res) => res.json()).then((body) => body.settings.channelLimit === 1)`, 'the limit is kept')
  await page(`t.type(t.box(), 'Is anyone there?')`)
  assert.equal(await until(`t.text('.cd-hint').startsWith('Goes to 1') && t.text('.cd-hint')`, 'the box allows for the limit'), 'Goes to 1 of the 2 agents that are free. Type @ to name one.')
  await page(`t.post('Is anyone there?')`)
  await until(`t.replies().length === 1`, 'one has answered', 30_000)
  assert.match(await page(`t.text('.cd-sent', t.last())`), /^sent to (Ada|Quill) · skipped (Ada|Quill) \(over the limit\)$/)
  await page(`(t.q('.cp-limit select').value = '', t.q('.cp-limit select').dispatchEvent(new Event('change')))`)
  await until(`fetch('/api/crew/settings').then((res) => res.json()).then((body) => body.settings.channelLimit === null)`, 'the limit is lifted')

  step('collapsed, the bar says what happened last and how many posts have news')
  await page(`t.q('.cd-toggle').click()`)
  assert.equal(await page(`t.q('.cd-body').hidden`), true)
  await page(`fetch('/api/crew/channel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '@Ada is the build green?' }) })`)
  await until(`t.text('.cd-sub') === 'Ada replied'`, 'the bar says so', 30_000)
  assert.equal(await page(`t.text('.cd-badge')`), '1')
  assert.equal(await page(`t.q('.cd-badge').hidden`), false)
  await shot('12-channel-collapsed')
  await page(`t.q('.cd-toggle').click()`)
  assert.equal(await page(`t.q('.cd-badge').hidden`), true)
  assert.equal(await page(`t.all('.cd-post').length`), 5)

  step('the channel is still there, in order, after a reload')
  await load(url)
  await page(`t.q('.cd-toggle').click()`)
  await until(`t.all('.cd-post').length === 5`, 'the posts came back')
  assert.equal(await page(`t.text('.cc-me', t.all('.cd-post')[2])`), 'Fix the footer')
  assert.equal(await page(`t.text('.cd-claim h4', t.all('.cd-post')[2])`), `Taken by ${other}`)
  if (!(await page(`Boolean(t.card('Ada'))`))) await page(`t.row('Ada').click()`)
  await until(`t.card('Ada')`, 'Ada\'s card is open')

  step('an agent retired from somewhere else closes its card')
  const retired = await page(`fetch('/api/crew/agents/' + t.card('Ada').dataset.agent, { method: 'DELETE' }).then((res) => res.status)`)
  assert.equal(retired, 200)
  await page(`window.dispatchEvent(new Event('focus'))`)
  await until(`!t.card('Ada')`, 'the card closed')
  assert.match(await until(`t.text('.toasts')`, 'it says why'), /Ada is no longer in this world/)
  assert.equal(await page(`t.text('.cp-count')`), '0 of 3 agents, 1 specialist')

  assert.deepEqual(errors, [], 'nothing was logged as an error by the page')
}

app.whenReady().then(async () => {
  let failed = null
  try {
    await run()
    console.log(`Crew interface: ${steps.length} steps PASS. Screenshots in ${shots}`)
  } catch (error) {
    failed = error
    console.error(`\nFAILED at: ${steps.at(-1) ?? 'start'}\n`, error)
    if (win) await shot('failure').catch(() => {})
  }
  await server?.stop().catch(() => {})
  if (database) {
    // The schema this run made is its own: take it away again.
    const { connect } = await import('../server/crew/store/db.mjs')
    const sql = connect(database, { max: 1 })
    await sql.unsafe(`drop schema if exists "${schema}" cascade`).catch(() => {})
    await sql.end({ timeout: 2 })
  }
  if (!process.env.CREW_UI_SHOTS && !failed) await fs.rm(temp, { recursive: true, force: true })
  app.exit(failed ? 1 : 0)
})
