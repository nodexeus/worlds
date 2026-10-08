import { audience, candidates, complete, headline, mentionAt, postView } from './channel.js'
import { statusLabel } from './compose.js'
import { face, h, icon } from './dom.js'
import { renderMarkdown } from './render.js'

const COLLAPSED_KEY = 'worlds.crew.channel'
const PAGE = 30
const BUSY = ['working', 'waiting']

const remembered = (key) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const remember = (key, value) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private windows refuse. Nothing is lost but the preference.
  }
}

/**
 * The crew channel: one place to say something to the whole crew, docked at the bottom right.
 *
 * Collapsed it is one bar, saying the last thing an agent did and how many posts have news.
 * Open, it lists the posts with each agent's answer under its name, who has taken a post,
 * and the two corrections a person can make: take it back, or hand it to someone.
 *
 * @param {{store: any, channel: any, api: any, onOpen: (agentId: string) => void,
 *   onFront: () => void, toast: (message: string, kind?: string) => void}} options
 */
export function createDock({ store, channel, api, onOpen, onFront, toast }) {
  /** What is being done to each post from here: a menu open, a request on its way, a refusal. */
  const doing = new Map()
  /** Each post's element, with what it was drawn from. */
  const drawn = new Map()
  /** Posts with news since the dock was last open. */
  const unread = new Set()
  let latest = ''
  let sending = false
  let exhausted = false
  /** The name being typed after an `@`, and which of those offered is chosen. */
  let mention = null
  let chosen = 0
  /** A name was just chosen, or the list dismissed: it stays away until something is typed. */
  let quiet = false

  const subEl = h('span.cd-sub')
  const badgeEl = h('span.cd-badge', { hidden: true })
  const toggle = h('button.cd-toggle', { type: 'button', onClick: () => setCollapsed(!el.classList.contains('collapsed')) },
    h('b', null, 'Crew channel'), subEl, badgeEl, icon('chevron'))

  const earlier = h('button.cc-link.cc-earlier', { type: 'button', hidden: true, onClick: () => loadEarlier() }, 'Earlier posts')
  const emptyEl = h('p.cc-empty', null, 'Nothing has been posted yet. Say something to the whole crew, or name an agent with @.')
  const postsEl = h('div.cd-posts', { tabindex: '0', 'aria-label': 'Posts to the crew' }, earlier, emptyEl)

  const menuEl = h('div.cd-menu', { hidden: true, role: 'listbox', 'aria-label': 'Agents' })
  const hintEl = h('p.cc-hint.cd-hint')
  const input = h('textarea.cc-input', { rows: '1', maxlength: '4000', placeholder: 'Post to the crew…', 'aria-label': 'Post to the crew' })
  const send = h('button.cc-send', { type: 'button', 'aria-label': 'Post', onClick: () => post() }, icon('send'))
  const foot = h('div.cc-foot.cd-foot', null, menuEl, hintEl, h('div.cc-box', null, input, send))
  const body = h('div.cd-body', null, postsEl, foot)
  const el = h('section.crew-dock.panel', { 'aria-label': 'Crew channel' }, h('header', null, toggle), body)

  el.addEventListener('keydown', (event) => {
    // As in a card: the world's single-key shortcuts are not for what is typed here.
    event.stopPropagation()
  })
  // And as a card: touching it brings it in front of whatever was over it.
  el.addEventListener('pointerdown', () => onFront(), true)

  function setCollapsed(collapsed) {
    el.classList.toggle('collapsed', collapsed)
    toggle.setAttribute('aria-expanded', String(!collapsed))
    body.hidden = collapsed
    remember(COLLAPSED_KEY, collapsed ? '1' : '0')
    if (!collapsed) {
      unread.clear()
      latest = ''
      // The box could not be measured while it was hidden.
      drawBox()
      postsEl.scrollTop = postsEl.scrollHeight
      // Opened to be read, so not left under a card. Not at the start: nothing is ordered yet.
      if (el.isConnected) onFront()
    }
    drawBar()
  }

  function drawBar() {
    const collapsed = el.classList.contains('collapsed')
    const crew = store.state.agents.length
    subEl.textContent = collapsed ? latest || 'nothing new' : `${crew} in the crew`
    badgeEl.hidden = !collapsed || unread.size === 0
    badgeEl.textContent = String(unread.size)
    toggle.setAttribute('aria-label', collapsed
      ? `Crew channel, ${unread.size ? `${unread.size} with news` : 'nothing new'}. Open`
      : 'Crew channel. Collapse')
  }

  // ── the posts ───────────────────────────────────────────────────────────────────────

  const act = (postId, state) => {
    if (state) doing.set(postId, state)
    else doing.delete(postId)
    drawPosts()
  }

  /** Make a post an agent's task, asking where only if the server cannot tell. */
  async function hand(postId, agentId, workspaceId) {
    act(postId, { busy: true })
    try {
      await api.hand(postId, { agentId, workspaceId })
      act(postId, null)
    } catch (error) {
      if (error.code === 'needs_workspace' && store.state.workspaces.length) act(postId, { place: agentId })
      else act(postId, { problem: error.message })
    }
  }

  async function release(postId) {
    act(postId, { busy: true })
    try {
      await api.release(postId)
      act(postId, null)
    } catch (error) {
      act(postId, { problem: error.message })
    }
  }

  function picker(post, state) {
    if (state.place) {
      const name = store.agent(state.place)?.name ?? 'it'
      return h('div.cd-pick', null,
        h('p.cd-pick-title', null, `Where should ${name} do this?`),
        h('div.cc-chips', null, ...store.state.workspaces.map((workspace) =>
          h('button.cc-chip', { type: 'button', onClick: () => hand(post.id, state.place, workspace.id) }, workspace.name)),
        h('button.cc-link', { type: 'button', onClick: () => act(post.id, null) }, 'Cancel')))
    }
    return h('div.cd-pick', { role: 'listbox', 'aria-label': 'Hand this to' },
      ...store.state.agents.map((agent) => {
        const busy = BUSY.includes(agent.status)
        return h('button.cd-option', {
          type: 'button', role: 'option', disabled: busy, data: { agent: agent.id, act: `to:${agent.id}` },
          title: busy ? `${agent.name} is in the middle of something` : `Make this ${agent.name}'s task`,
          onClick: () => hand(post.id, agent.id),
        }, face(agent.status), agent.name, h('em', null, statusLabel(agent.status)))
      }),
      h('button.cc-link.cd-pick-title', { type: 'button', onClick: () => act(post.id, null) }, 'Cancel'))
  }

  function build(post, view, state) {
    const busy = Boolean(state.busy)
    const out = h('div.cd-post', { data: { post: post.id } },
      h('div.cc-me', null, view.text),
      h('p.cd-sent', null, view.sent))

    for (const reply of view.replies) {
      const agent = store.agent(reply.agentId)
      out.append(h('div.cd-rep', { data: { agent: reply.agentId } },
        face(agent?.status),
        h('div.cd-said', null,
          h('div.cd-who', null, reply.name, agent?.curated && agent.speciality ? h('small', null, agent.speciality) : null, reply.note ? h('small', null, reply.note) : null),
          h('div.cc-ag', null, renderMarkdown(reply.text)),
          // Gone from the crew: there is nobody to give the task to.
          reply.canTask && agent
            ? h('div.cd-acts', null, h('button.cc-link', { type: 'button', disabled: busy, data: { act: `task:${reply.agentId}` }, onClick: () => hand(post.id, reply.agentId) }, `Make this a task for ${reply.name}`))
            : null)))
    }

    if (view.claim) {
      const { claim } = view
      out.append(h('div.cd-claim', { data: { state: claim.state } },
        h('h4', null, claim.title),
        h('p', null, claim.line),
        h('div.cc-opts', null,
          claim.canOpen && store.agent(claim.agentId)
            ? h('button.cc-b.cc-primary', { type: 'button', data: { act: 'open' }, onClick: () => onOpen(claim.agentId) }, 'Open task')
            : null,
          claim.canRelease ? h('button.cc-b', { type: 'button', disabled: busy, data: { act: 'release' }, onClick: () => release(post.id) }, 'Release') : null,
          h('button.cc-b', {
            type: 'button', disabled: busy, data: { act: 'hand' }, 'aria-expanded': String(Boolean(state.pick)), class: claim.canRelease ? '' : 'cc-primary',
            onClick: () => act(post.id, state.pick ? null : { pick: true }),
          }, 'Hand to…'))))
    }
    if (state.pick || state.place) out.append(picker(post, state))
    if (state.problem) out.append(h('p.cc-problem', { role: 'alert' }, state.problem))
    for (const note of view.notes) out.append(h('p.cd-note', { data: { tone: note.tone } }, note.text))
    return out
  }

  function drawPosts() {
    const { posts } = channel
    const stuck = postsEl.scrollHeight - postsEl.scrollTop - postsEl.clientHeight < 40
    const { workspaces, agents } = store.state
    const seen = new Set()
    let before = null
    for (const post of [...posts].reverse()) {
      seen.add(post.id)
      const view = postView(post, { workspaces })
      const state = doing.get(post.id) ?? {}
      // Everything a post's element is made from. If none of it changed, the element stands.
      const from = JSON.stringify([view, state, post.to.map((one) => agents.find((agent) => agent.id === one.agentId)?.status ?? null),
        state.pick ? agents.map((agent) => [agent.id, agent.name, agent.status]) : null, state.place ? workspaces : null])
      let entry = drawn.get(post.id)
      if (!entry || entry.from !== from) {
        const next = build(post, view, state)
        if (entry) {
          // Whoever was on a control in the post is put back on it, or on the first choice of
          // a list they have just opened, and failing both on the post's own way in.
          const held = entry.el.contains(document.activeElement) ? document.activeElement.dataset.act : undefined
          entry.el.replaceWith(next)
          if (held !== undefined) {
            const opened = !entry.picking && (state.pick || state.place)
            const usable = (control) => control && !control.disabled
            const same = held ? next.querySelector(`[data-act="${CSS.escape(held)}"]`) : null
            const target = (opened ? [...next.querySelectorAll('.cd-pick button')].find(usable) : null)
              ?? (usable(same) ? same : null) ?? [...next.querySelectorAll('button')].find(usable) ?? postsEl
            target.focus({ preventScroll: true })
          }
        }
        entry = { el: next, from, picking: Boolean(state.pick || state.place) }
        drawn.set(post.id, entry)
      }
      if (entry.el.nextSibling !== before || entry.el.parentNode !== postsEl) postsEl.insertBefore(entry.el, before)
      before = entry.el
    }
    for (const [id, entry] of drawn) {
      if (seen.has(id)) continue
      entry.el.remove()
      drawn.delete(id)
      doing.delete(id)
    }
    emptyEl.hidden = posts.length > 0
    earlier.hidden = exhausted || posts.length < PAGE
    if (stuck) postsEl.scrollTop = postsEl.scrollHeight
  }

  async function loadEarlier() {
    const [first] = channel.posts
    if (!first) return
    earlier.disabled = true
    try {
      const { posts, seq } = await api.channel({ before: first.id, limit: PAGE })
      exhausted = posts.length < PAGE
      const height = postsEl.scrollHeight
      channel.addEarlier(posts, seq)
      // What the person was reading stays where it was.
      postsEl.scrollTop += postsEl.scrollHeight - height
    } catch (error) {
      toast(error.message, 'err')
    } finally {
      earlier.disabled = false
    }
  }

  // ── the box ─────────────────────────────────────────────────────────────────────────

  function drawBox() {
    const going = audience(input.value, store.state.agents, { limit: store.state.channelLimit })
    hintEl.textContent = going.text
    hintEl.dataset.ok = String(going.ok || !input.value.trim())
    send.disabled = sending || !going.ok
    // Hidden, it has no height to measure, and would be given none.
    if (!body.hidden) {
      input.style.height = 'auto'
      input.style.height = `${Math.min(input.scrollHeight, 160)}px`
    }

    mention = !quiet && document.activeElement === input ? mentionAt(input.value, input.selectionStart) : null
    const offered = mention ? candidates(store.state.agents, mention.query) : []
    if (!offered.length) mention = null
    chosen = Math.min(chosen, Math.max(0, offered.length - 1))
    menuEl.hidden = !mention
    menuEl.replaceChildren(...offered.map((agent, at) =>
      h('button.cd-option', {
        type: 'button', role: 'option', 'aria-selected': String(at === chosen), data: { agent: agent.id },
        // Before the box loses the caret, which is where the name goes.
        onMousedown: (event) => {
          event.preventDefault()
          choose(agent)
        },
      }, face(agent.status), agent.name, h('em', null, statusLabel(agent.status)))))
    return offered
  }

  function choose(agent) {
    const written = complete(input.value, mention, agent.name)
    input.value = written.text
    input.setSelectionRange(written.caret, written.caret)
    chosen = 0
    // The caret is now at the end of a name, which would offer that name again.
    quiet = true
    drawBox()
  }

  async function post() {
    const text = input.value.trim()
    if (sending || !text || !audience(text, store.state.agents).ok) return
    // Emptied now, so what is typed while it is on its way is kept: as in a card.
    sending = true
    input.value = ''
    drawBox()
    try {
      const made = await api.post(text)
      // Shown now, whatever the stream is doing. What the stream says of it is newer.
      if (made?.post) channel.setPosts({ posts: [made.post], seq: 0 })
      postsEl.scrollTop = postsEl.scrollHeight
    } catch (error) {
      input.value = input.value ? `${text}\n${input.value}` : text
      toast(error.message, 'err')
    } finally {
      sending = false
      drawBox()
    }
  }

  input.addEventListener('input', () => {
    chosen = 0
    quiet = false
    drawBox()
  })
  input.addEventListener('click', () => drawBox())
  input.addEventListener('blur', () => drawBox())
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return
    const offered = mention ? candidates(store.state.agents, mention.query) : []
    if (offered.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        chosen = (chosen + (event.key === 'ArrowDown' ? 1 : offered.length - 1)) % offered.length
        return void drawBox()
      }
      if (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) {
        event.preventDefault()
        return choose(offered[chosen])
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        quiet = true
        return void drawBox()
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      post()
    }
  })
  input.addEventListener('keyup', (event) => {
    // The caret moved without anything being typed: the name at it may be another, or none.
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) drawBox()
  })

  const unsubscribe = [
    channel.subscribe(() => drawPosts()),
    store.subscribe((what) => {
      if (what.kind === 'roster' || what.kind === 'workspaces' || what.kind === 'settings') {
        drawPosts()
        drawBox()
        drawBar()
      }
    }),
  ]

  setCollapsed(remembered(COLLAPSED_KEY) !== '0')
  drawPosts()
  drawBox()

  return {
    el,
    /** The stream said something about a post: `was` and `now` are how it stood and stands. */
    noticed({ was, now }) {
      const said = headline(was, now)
      if (!said || !el.classList.contains('collapsed')) return
      unread.add(now.id)
      latest = said
      drawBar()
    },
    /** The record went back: what was counted and read from the old one is not to be trusted. */
    reset() {
      unread.clear()
      latest = ''
      exhausted = false
      drawBar()
    },
    close() {
      for (const off of unsubscribe) off()
    },
  }
}
