import { agentLine, composer, answerFor, payload } from './compose.js'
import { ago, face, h, icon } from './dom.js'
import { keyOf, renderItem, signatureOf } from './render.js'
import { transcript } from './transcript.js'

/** How many events a card asks for at a time. */
const PAGE = 200

/**
 * One agent's card: its conversation, and the box that continues it.
 *
 * The card draws what the store holds and asks the server for what the person does. It
 * never decides anything itself: what the conversation looks like is `transcript()`, and
 * what the message box is for is `composer()`.
 *
 * It redraws when the store says something it shows has changed, and only the items that
 * changed, so a tool line somebody opened stays open and an answer half typed stays typed.
 *
 * @param {{agentId: string, store: any, api: any, place: {x: number, y: number, w?: number, h?: number},
 *   pinned?: boolean, onClose: () => void, onFront: () => void, onChange: () => void,
 *   onNeedWorkspace: () => void}} options
 */
export function createCard({ agentId, store, api, place, pinned = false, onClose, onFront, onChange, onNeedWorkspace, onGone = () => {} }) {
  /** The conversation on show: the agent's own, or an earlier one picked from its history. */
  let shown = null
  /** An earlier conversation being read, or null for the agent's current one. */
  let reading = null
  /** Whether each conversation has events before the first one loaded. */
  const earlier = new Map()
  let picked = null
  let sending = false
  let problem = ''
  let historyOpen = false
  let closed = false
  /** Item elements by key, with the signature each was drawn from. */
  let drawn = new Map()

  // ── elements ──────────────────────────────────────────────────────────────────────────

  const faceEl = face('idle')
  const nameEl = h('b')
  const lineEl = h('span.cc-line')
  const stopBtn = h('button.cc-ib.cc-stop', { type: 'button', hidden: true, onClick: () => stop() }, 'Stop')
  const historyBtn = h('button.cc-ib', { type: 'button', title: 'Earlier conversations', 'aria-label': 'Earlier conversations', 'aria-pressed': 'false', onClick: () => toggleHistory() }, icon('history'))
  const pinBtn = h('button.cc-ib', { type: 'button', onClick: () => setPinned(!pinned) }, icon('pin'))
  const closeBtn = h('button.cc-ib', { type: 'button', title: 'Close (Esc)', 'aria-label': 'Close', onClick: () => close(false) }, icon('close'))
  const head = h('header.cc-head', null, faceEl, h('div.cc-who', null, nameEl, lineEl), stopBtn, historyBtn, pinBtn, closeBtn)

  const bannerText = h('span')
  const banner = h('div.cc-banner', { hidden: true }, bannerText,
    h('button.cc-link', { type: 'button', onClick: () => read(null) }, 'Back to current'))

  const earlierBtn = h('button.cc-link.cc-earlier', { type: 'button', hidden: true, onClick: () => loadEarlier() }, 'Earlier')
  const itemsEl = h('div.cc-items')
  const emptyEl = h('p.cc-empty', { hidden: true })
  const body = h('div.cc-body', { tabindex: '0' }, earlierBtn, itemsEl, emptyEl)
  const historyEl = h('div.cc-history', { hidden: true })

  const hintEl = h('p.cc-hint')
  const problemEl = h('p.cc-problem', { hidden: true, role: 'alert' })
  const chipsEl = h('div.cc-chips', { hidden: true })
  const input = h('textarea.cc-input', {
    rows: '1',
    'aria-label': 'Message',
    onInput: () => { grow(); syncFoot() },
    onKeydown: (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault()
        send()
      }
    },
  })
  const sendBtn = h('button.cc-send', { type: 'button', title: 'Send (Enter)', 'aria-label': 'Send', onClick: () => send() }, icon('send'))
  const foot = h('footer.cc-foot', null, problemEl, chipsEl, hintEl, h('div.cc-box', null, input, sendBtn))

  const el = h('section.crew-card.panel', { data: { agent: agentId }, 'aria-label': 'Agent' }, head, banner, body, historyEl, foot)
  el.style.left = `${place.x}px`
  el.style.top = `${place.y}px`
  if (place.w) el.style.width = `${place.w}px`
  if (place.h) el.style.height = `${place.h}px`

  // ── moving, sizing, keys ──────────────────────────────────────────────────────────────

  const clamp = (x, y) => {
    const parent = el.offsetParent ?? document.documentElement
    return {
      x: Math.round(Math.min(Math.max(8 - el.offsetWidth + 80, x), parent.clientWidth - 80)),
      y: Math.round(Math.min(Math.max(8, y), parent.clientHeight - 48)),
    }
  }

  let drag = null
  head.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button')) return
    drag = { id: event.pointerId, dx: event.clientX - el.offsetLeft, dy: event.clientY - el.offsetTop }
    head.setPointerCapture(event.pointerId)
    el.classList.add('dragging')
  })
  head.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return
    const at = clamp(event.clientX - drag.dx, event.clientY - drag.dy)
    el.style.left = `${at.x}px`
    el.style.top = `${at.y}px`
  })
  const drop = (event) => {
    if (!drag || event.pointerId !== drag.id) return
    drag = null
    el.classList.remove('dragging')
    onChange()
  }
  head.addEventListener('pointerup', drop)
  head.addEventListener('pointercancel', drop)

  el.addEventListener('pointerdown', () => onFront(), true)
  el.addEventListener('keydown', (event) => {
    // The world has single-key shortcuts. Nothing typed in a card is meant for it.
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      if (historyOpen) toggleHistory(false)
      else close()
    }
  })

  // A card is resized by its corner, which the browser does. Remember what it was left at.
  let sized = false
  const sizes = new ResizeObserver(() => {
    if (sized) onChange()
    sized = true
  })
  sizes.observe(el)

  // ── the conversation ──────────────────────────────────────────────────────────────────

  const agent = () => store.agent(agentId)
  const atBottom = () => body.scrollTop + body.clientHeight >= body.scrollHeight - 24
  const toBottom = () => { body.scrollTop = body.scrollHeight }

  /** Point the card at a conversation: let go of the one it showed and load this one. */
  function show(conversationId) {
    if (conversationId === shown) return
    if (shown) store.unwatch(shown)
    shown = conversationId
    drawn = new Map()
    itemsEl.replaceChildren()
    if (!shown) return draw(true)
    store.watch(shown)
    draw(true)
    load(shown)
  }

  async function load(conversationId) {
    try {
      const { events } = await api.events(conversationId, { limit: PAGE })
      if (closed || shown !== conversationId) return
      earlier.set(conversationId, events.length >= PAGE)
      store.addEvents(conversationId, events)
      draw(true)
    } catch (error) {
      if (closed || shown !== conversationId) return
      say(error.message)
    }
  }

  async function loadEarlier() {
    const conversationId = shown
    const first = store.eventsOf(conversationId)[0]
    if (!first || earlierBtn.disabled) return
    earlierBtn.disabled = true
    try {
      const { events } = await api.events(conversationId, { before: first.seq, limit: PAGE })
      if (closed || shown !== conversationId) return
      earlier.set(conversationId, events.length >= PAGE)
      // What is in view stays in view: the page grows above it.
      const height = body.scrollHeight
      store.addEvents(conversationId, events)
      draw(false)
      body.scrollTop += body.scrollHeight - height
    } catch (error) {
      if (!closed) say(error.message)
    } finally {
      earlierBtn.disabled = false
    }
  }

  /** Bring the items on screen up to date, touching only the ones that changed. */
  function draw(stick = atBottom()) {
    if (closed) return
    const one = agent()
    const items = shown ? transcript(store.eventsOf(shown), { draft: reading ? '' : store.draftOf(shown) }) : []
    // An earlier conversation is only read: trying again would speak into the current one.
    const card = { agentName: one?.name ?? 'the agent', answer, retry: reading ? null : retry }
    const next = new Map()
    let before = null
    for (const item of items) {
      const key = keyOf(item)
      const signature = signatureOf(item)
      const was = drawn.get(key)
      let node = was?.node
      if (!was || was.signature !== signature) {
        if (item.kind === 'draft' && node) node.textContent = item.text
        else {
          node = renderItem(item, card)
          if (was) was.node.replaceWith(node)
        }
      }
      // Keep the order the transcript gives: a delivered message moves below its turn.
      const after = before ? before.nextSibling : itemsEl.firstChild
      if (node !== after) itemsEl.insertBefore(node, after)
      before = node
      next.set(key, { node, signature })
    }
    for (const [key, was] of drawn) if (!next.has(key)) was.node.remove()
    drawn = next

    earlierBtn.hidden = !(shown && earlier.get(shown))
    emptyEl.hidden = items.length > 0
    if (!items.length) {
      emptyEl.textContent = reading ? 'Nothing was said in this conversation.' : `Nothing yet. Say something to ${card.agentName}.`
    }
    if (stick) toBottom()
  }

  // ── the header and the message box ────────────────────────────────────────────────────

  function syncHead() {
    const one = agent()
    if (!one) return
    const { workspaces } = store.state
    faceEl.dataset.status = one.status
    nameEl.textContent = one.name
    lineEl.textContent = one.curated && one.speciality ? `${agentLine(one, workspaces)} · ${one.speciality}` : agentLine(one, workspaces)
    lineEl.dataset.status = one.status
    el.setAttribute('aria-label', `${one.name}, ${agentLine(one, workspaces)}`)
    stopBtn.hidden = !['working', 'waiting'].includes(one.status)
    pinBtn.setAttribute('aria-pressed', String(pinned))
    pinBtn.title = pinned ? 'Pinned: this card comes back after a reload' : 'Pin: keep this card after a reload'
    pinBtn.setAttribute('aria-label', pinBtn.title)
  }

  function syncFoot() {
    const one = agent()
    if (!one) return
    foot.hidden = Boolean(reading) || historyOpen
    const view = composer({ agent: one, workspaces: store.state.workspaces, picked, runtimes: store.state.runtimes })
    chipsEl.hidden = view.chips.length === 0
    const wanted = view.chips.map((chip) => `${chip.id}:${chip.name}:${chip.on}:${chip.current}`).join('|')
    if (chipsEl.dataset.drawn !== wanted) {
      chipsEl.dataset.drawn = wanted
      chipsEl.replaceChildren(h('span.cc-in', null, 'in'), ...view.chips.map((chip) =>
        h('button.cc-chip', {
          type: 'button', 'aria-pressed': String(chip.on), data: { current: String(chip.current) },
          title: chip.on ? 'Starting a new task here. Click to go back.' : `Start a new task in ${chip.name}`,
          onClick: () => {
            picked = picked === chip.id || (chip.on && !picked) ? null : chip.id
            problem = ''
            syncFoot()
            input.focus()
          },
        }, chip.name)))
    }
    hintEl.textContent = view.hint
    hintEl.hidden = !view.hint
    if (view.mode === 'no-workspace' && !hintEl.querySelector('button')) {
      hintEl.append(' ', h('button.cc-link', { type: 'button', onClick: () => onNeedWorkspace() }, 'New workspace'))
    }
    input.placeholder = view.placeholder
    input.disabled = view.mode === 'unavailable'
    sendBtn.disabled = sending || !view.canSend || !input.value.trim()
    problemEl.textContent = problem
    problemEl.hidden = !problem
    return view
  }

  const grow = () => {
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`
  }

  function say(message) {
    problem = message
    syncFoot()
  }

  // ── what the person does ──────────────────────────────────────────────────────────────

  async function deliver(body) {
    const one = agent()
    if (!one || sending) return false
    sending = true
    problem = ''
    syncFoot()
    try {
      const reply = await api.send(one.id, body)
      store.setPlace(one.id, reply.conversation)
      store.applyEvent(reply.event)
      return true
    } catch (error) {
      problem = error.message
      return false
    } finally {
      sending = false
      if (!closed) syncFoot()
    }
  }

  async function send() {
    const view = syncFoot()
    if (!view?.canSend || sending || !input.value.trim()) return
    // The box is emptied as the message goes, not when the server answers: whatever is
    // typed in the meantime is the next message, and must not be wiped by the reply.
    const text = input.value
    const chosen = picked
    input.value = ''
    picked = null
    grow()
    const sent = await deliver(payload(view, text))
    if (closed) return
    if (sent) return toBottom()
    // It did not go. Give back what was typed, ahead of anything typed since.
    input.value = input.value ? `${text}\n${input.value}` : text
    picked = chosen
    grow()
    syncFoot()
  }

  /** Say again what was said in a turn that did not finish. */
  const retry = (text) => deliver({ text })

  async function stop() {
    if (stopBtn.disabled) return
    stopBtn.disabled = true
    try {
      await api.stop(agentId)
    } catch (error) {
      if (!closed) say(error.message)
    } finally {
      stopBtn.disabled = false
    }
  }

  /** Answer a request. Resolves to what went wrong, in words, or to nothing. */
  async function answer(item, choice) {
    const reply = answerFor(item, choice)
    if (!reply) return 'Answer each question first.'
    try {
      const { event } = await api.answer(shown, reply)
      store.applyEvent(event)
    } catch (error) {
      return error.code === 'unknown_request' ? 'That is no longer waiting for an answer.' : error.message
    }
  }

  // ── history ───────────────────────────────────────────────────────────────────────────

  async function toggleHistory(open = !historyOpen) {
    historyOpen = open
    historyBtn.setAttribute('aria-pressed', String(open))
    historyEl.hidden = !open
    body.hidden = open
    banner.hidden = open || !reading
    syncFoot()
    if (!open) return
    historyEl.replaceChildren(h('p.cc-empty', null, 'Loading…'))
    try {
      const { conversations } = await api.conversations(agentId)
      if (closed || !historyOpen) return
      const current = agent()?.conversationId
      historyEl.replaceChildren(...(conversations.length
        ? conversations.map((talk) =>
          h('button.cc-talk', {
            type: 'button', 'aria-current': String(talk.id === shown),
            onClick: () => read(talk.id === current ? null : talk),
          },
          h('span.cc-talk-title', null, talk.title || 'Untitled'),
          h('span.cc-talk-meta', null, [
            store.workspace(talk.workspaceId)?.name, talk.id === current ? 'current' : null, ago(talk.createdAt),
          ].filter(Boolean).join(' · '))))
        : [h('p.cc-empty', null, 'No conversations yet.')]))
    } catch (error) {
      if (!closed && historyOpen) historyEl.replaceChildren(h('p.cc-problem', null, error.message))
    }
  }

  /** Read an earlier conversation, or with null go back to the one the agent is in. */
  function read(talk) {
    reading = talk
    bannerText.textContent = talk ? `Earlier: ${talk.title || 'Untitled'}` : ''
    toggleHistory(false)
    show(talk ? talk.id : agent()?.conversationId ?? null)
    syncFoot()
  }

  // ── life ──────────────────────────────────────────────────────────────────────────────

  function setPinned(value) {
    pinned = value
    syncHead()
    onChange()
  }

  const unsubscribe = store.subscribe((what) => {
    if (closed) return
    if (what.kind === 'roster') {
      const one = agent()
      // Retired, from here or from somewhere else. There is nobody left to talk to.
      if (!one) return close(true)
      syncHead()
      syncFoot()
      if (!reading && one.conversationId !== shown) show(one.conversationId)
    } else if (what.kind === 'workspaces' || what.kind === 'settings') {
      syncHead()
      syncFoot()
    } else if (what.kind === 'conversation' && what.conversationId === shown) {
      draw()
    } else if (what.kind === 'draft' && what.conversationId === shown && !reading) {
      // A fragment changes one thing, and arrives many times a second: only that is touched.
      const draft = drawn.get('draft')
      if (!draft) return draw()
      const stick = atBottom()
      draft.node.textContent = store.draftOf(shown)
      draft.signature = ''
      if (stick) toBottom()
    }
  })

  function close(gone = false) {
    if (closed) return
    closed = true
    if (gone) onGone(nameEl.textContent)
    unsubscribe()
    sizes.disconnect()
    if (shown) store.unwatch(shown)
    el.remove()
    onClose()
  }

  syncHead()
  syncFoot()
  draw(true)
  show(agent()?.conversationId ?? null)

  return {
    el,
    agentId,
    close,
    focus: () => input.focus({ preventScroll: true }),
    /** Ask again for what is on show: the record it came from was replaced. */
    reload: () => {
      if (shown) load(shown)
    },
    get pinned() {
      return pinned
    },
    /** Where the card is and how large, for remembering it. */
    place: () => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }),
    /** Pull it back on screen after the window has shrunk. */
    reclamp() {
      const at = clamp(el.offsetLeft, el.offsetTop)
      el.style.left = `${at.x}px`
      el.style.top = `${at.y}px`
    },
  }
}
