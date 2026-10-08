import './crew.css'
import { createCrewApi } from './api.js'
import { createCard } from './card.js'
import { createChannelState } from './channel.js'
import { createDock } from './dock.js'
import { h } from './dom.js'
import { createPanel } from './panel.js'
import { createRefresher } from './refresher.js'
import { createCrewStore } from './store.js'
import { connectStream } from './stream.js'

const CARDS_KEY = 'worlds.crew.cards'
/** The roster is not on the stream, so it is asked for now and then. */
const REFRESH_MS = 20_000

/**
 * The crew in the page: the list, the cards, and what keeps them current.
 *
 * It asks the server whether it has a crew at all. A monitor-only server, which is what the
 * desktop app runs when nobody is signed in, has none, and then nothing here is drawn.
 *
 * @param {HTMLElement} hud the HUD layer the crew is drawn into
 * @param {{toast: (message: string, kind?: string) => void}} options
 * @returns {Promise<{store: any, open: (agentId: string) => void, close: () => void} | null>}
 */
export async function installCrew(hud, { toast }) {
  const api = createCrewApi()
  let status
  try {
    status = await api.status()
  } catch {
    return null
  }
  if (!status.enabled) return null

  const store = createCrewStore()
  store.setStatus(status)
  const channel = createChannelState()

  const layer = h('div.crew-layer')
  // Under the toasts and the help sheet, which are for the whole page.
  hud.insertBefore(layer, hud.querySelector('.toasts'))

  // ── keeping current ───────────────────────────────────────────────────────────────────

  let rosterSeq = 0
  /** Everything a snapshot can say, read one at a time however many things ask for it. */
  const refresh = createRefresher(async () => {
    const [roster, workspaces, specialists, settings, posts] = await Promise.all([
      api.agents(), api.workspaces(), api.specialists(), api.settings(), api.channel(),
    ])
    rosterSeq = roster.seq ?? 0
    store.setWorkspaces(workspaces.workspaces)
    store.setSpecialists(specialists.specialists)
    store.setAutonomy(settings.settings.autonomy)
    store.setChannelLimit(settings.settings.channelLimit)
    store.setRoster(roster)
    channel.setPosts(posts)
  })
  const quietly = () => refresh().catch(() => {})

  let soon = null
  const refreshSoon = () => {
    soon ??= setTimeout(() => {
      soon = null
      quietly()
    }, 250)
  }

  // ── the cards ─────────────────────────────────────────────────────────────────────────

  /** @type {Map<string, ReturnType<typeof createCard>>} */
  const cards = new Map()
  let top = 10

  /** Until the crew has been read once there is nothing to compare the saved pins with. */
  let loaded = false
  const savePins = () => {
    if (!loaded) return
    const pins = [...cards.values()].filter((card) => card.pinned).map((card) => ({ agentId: card.agentId, ...card.place() }))
    try {
      localStorage.setItem(CARDS_KEY, JSON.stringify(pins))
    } catch {
      // A private window: the cards are simply not remembered.
    }
  }

  const front = (card) => {
    card.el.style.zIndex = String(++top)
  }

  /**
   * Where a new card goes: beside the list, then beside the cards already there, for as
   * long as there is room between the list and the sidebar. After that they overlap, each
   * a little down and right of the last.
   */
  function nextPlace() {
    const WIDTH = 380
    const GAP = 12
    const left = panel.el.offsetLeft + panel.el.offsetWidth + GAP
    const right = layer.clientWidth - (parseFloat(getComputedStyle(hud).getPropertyValue('--side')) || 0) - GAP
    const columns = Math.max(1, Math.floor((right - left + GAP) / (WIDTH + GAP)))
    const n = cards.size
    const step = Math.floor(n / columns) % 6
    return {
      x: Math.max(8, Math.min(left + (n % columns) * (WIDTH + GAP) + step * 28, layer.clientWidth - WIDTH - 8)),
      y: Math.min(panel.el.offsetTop + step * 28, Math.max(8, layer.clientHeight - 200)),
    }
  }

  function open(agentId, { place, pinned = false, focus = true } = {}) {
    const already = cards.get(agentId)
    if (already) {
      front(already)
      if (focus) already.focus()
      return
    }
    if (!store.agent(agentId)) return
    const at = place ?? nextPlace()
    const card = createCard({
      agentId, store, api, place: at, pinned,
      onClose: () => {
        cards.delete(agentId)
        savePins()
        panel.sync()
      },
      onFront: () => front(card),
      onChange: savePins,
      onNeedWorkspace: () => panel.openWorkspaceForm(),
      onGone: (name) => toast(`${name} is no longer in this world`),
    })
    cards.set(agentId, card)
    layer.append(card.el)
    front(card)
    card.reclamp()
    panel.sync()
    if (focus) card.focus()
  }

  const panel = createPanel({ store, api, onOpen: (agentId) => open(agentId), isOpen: (agentId) => cards.has(agentId), refresh, toast })
  // The channel is ordered among the cards: whichever was last touched is on top.
  const dock = createDock({ store, channel, api, onOpen: (agentId) => open(agentId), onFront: () => front(dock), toast })
  layer.append(panel.el, dock.el)

  try {
    await refresh()
    loaded = true
  } catch (error) {
    toast(error.message || 'Could not load the crew', 'err')
  }

  // Pinned cards come back where they were left.
  try {
    for (const pin of JSON.parse(localStorage.getItem(CARDS_KEY) || '[]')) {
      if (pin && typeof pin.agentId === 'string') open(pin.agentId, { place: pin, pinned: true, focus: false })
    }
  } catch {
    // Not there, or not what was saved: start with none.
  }

  // ── the stream ────────────────────────────────────────────────────────────────────────

  let greeted = false
  const stream = connectStream({
    // From where the snapshot stood, so nothing that happened since is missed.
    after: rosterSeq || undefined,
    onHello({ reset }) {
      if (reset) {
        store.reset()
        channel.reset()
        for (const card of cards.values()) card.reload()
      }
      // A reconnect may have skipped what the stream does not carry: who is in the crew.
      if (greeted || reset) quietly()
      greeted = true
    },
    onEvent(event) {
      const changed = channel.apply(event)
      if (changed) dock.noticed(changed)
      store.applyEvent(event)
      if (store.needsRoster()) refreshSoon()
    },
    onDelta: (delta) => store.applyDelta(delta),
    onState: (state) => store.setLink(state),
  })

  const timer = setInterval(() => {
    if (!document.hidden) quietly()
  }, REFRESH_MS)
  const onFocus = () => quietly()
  const onResize = () => {
    for (const card of cards.values()) card.reclamp()
  }
  window.addEventListener('focus', onFocus)
  window.addEventListener('resize', onResize)

  return {
    store,
    channel,
    open,
    close() {
      stream.close()
      clearInterval(timer)
      clearTimeout(soon)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('resize', onResize)
      for (const card of [...cards.values()]) card.close()
      panel.close()
      dock.close()
      layer.remove()
    },
  }
}
