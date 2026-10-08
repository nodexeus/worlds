import { agentLine, runtimeLabel } from './compose.js'
import { face, h, icon } from './dom.js'

const AUTONOMY = [
  ['ask', 'Ask before every action'],
  ['workspace', 'Free inside the workspace'],
  ['autonomous', 'Fully autonomous'],
]

const COLLAPSED_KEY = 'worlds.crew.collapsed'

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

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The crew list: who is in this world, how each is doing, and where a card is opened.
 *
 * Standard agents first, then the specialists in a section of their own, then the
 * workspaces. Agents and workspaces are made here. The world's autonomy level is here too,
 * because it is what decides whether an agent stops to ask.
 *
 * @param {{store: any, api: any, onOpen: (agentId: string) => void, isOpen: (agentId: string) => boolean,
 *   refresh: () => Promise<void>, toast: (message: string, kind?: string) => void}} options
 */
export function createPanel({ store, api, onOpen, isOpen, refresh, toast }) {
  let form = null
  let submitting = false

  const countEl = h('span.cp-count')
  const demoEl = h('span.cp-tag', { hidden: true, title: 'Agents play a script. No model is called and nothing is changed.' }, 'Demo')
  const toggle = h('button.cp-toggle', { type: 'button', 'aria-expanded': 'true', onClick: () => setCollapsed(!el.classList.contains('collapsed')) },
    h('span.cp-heading', null, h('span.cp-title', null, 'Crew'), demoEl, icon('chevron')), countEl)

  const linkEl = h('p.cp-link', { hidden: true, role: 'status' }, 'Reconnecting. What you see may be behind.')
  const agentsEl = h('div.cp-list', { role: 'list' })
  const specialistsHead = h('h3.cp-sec', { hidden: true }, 'Specialists')
  const specialistsEl = h('div.cp-list', { role: 'list' })
  const workspacesHead = h('h3.cp-sec', null, 'Workspaces')
  const workspacesEl = h('div.cp-places')
  const addAgent = h('button.cc-b', { type: 'button', onClick: () => openForm('agent') }, '+ Agent')
  const addWorkspace = h('button.cc-b', { type: 'button', onClick: () => openForm('workspace') }, '+ Workspace')
  const addRow = h('div.cp-add', null, addAgent, addWorkspace)
  const formEl = h('div.cp-form', { hidden: true })
  const autonomy = h('select.cp-select', {
    'aria-label': 'How much agents may do without asking',
    onChange: async () => {
      const wanted = autonomy.value
      try {
        store.setAutonomy((await api.setAutonomy(wanted)).settings.autonomy)
      } catch (error) {
        autonomy.value = store.state.autonomy
        toast(error.message, 'err')
      }
    },
  }, ...AUTONOMY.map(([value, label]) => h('option', { value }, label)))
  const limitOf = (value) => (value === '' ? null : Number(value))
  const limit = h('select.cp-select', {
    'aria-label': 'How many agents answer a post to the crew channel that names nobody',
    onChange: async () => {
      try {
        store.setChannelLimit((await api.setChannelLimit(limitOf(limit.value))).settings.channelLimit)
      } catch (error) {
        drawSettings()
        toast(error.message, 'err')
      }
    },
  })
  const body = h('div.cp-body', null, linkEl, agentsEl, specialistsHead, specialistsEl, workspacesHead, workspacesEl, addRow, formEl,
    h('label.cp-autonomy', null, h('span', null, 'Agents are'), autonomy),
    h('label.cp-autonomy.cp-limit', null, h('span', null, 'A post reaches'), limit))

  const el = h('section.crew-panel.panel', { 'aria-label': 'Crew' }, h('header', null, toggle), body)
  el.addEventListener('keydown', (event) => {
    // As in a card: the world's single-key shortcuts are not for what is typed here.
    event.stopPropagation()
    // Not while a form is being sent: its answer would have nowhere to go.
    if (event.key === 'Escape' && form && !submitting) closeForm()
  })

  function setCollapsed(collapsed) {
    el.classList.toggle('collapsed', collapsed)
    toggle.setAttribute('aria-expanded', String(!collapsed))
    body.hidden = collapsed
    remember(COLLAPSED_KEY, collapsed ? '1' : '0')
  }

  // ── the lists ─────────────────────────────────────────────────────────────────────────

  const row = (agent) =>
    h('button.cp-row', {
      type: 'button', role: 'listitem', data: { agent: agent.id, status: agent.status }, 'aria-pressed': String(isOpen(agent.id)),
      onClick: () => onOpen(agent.id),
    },
    face(agent.status),
    h('span.cp-name', null, agent.name, agent.curated && agent.speciality ? h('small', null, agent.speciality) : null),
    h('em', null, agentLine(agent, store.state.workspaces)))

  function drawAgents() {
    const { agents, counts, specialists, runtimes, workspaces } = store.state
    const standard = agents.filter((agent) => !agent.curated)
    const curated = agents.filter((agent) => agent.curated)
    agentsEl.replaceChildren(...(standard.length
      ? standard.map(row)
      : [h('p.cp-empty', null, 'No agents yet. Add one to begin.')]))

    // A specialist the world may have and has not added is offered here, not hidden in a form.
    const offered = specialists.filter((specialist) => specialist.entitled && !specialist.agentId)
    specialistsHead.hidden = curated.length + offered.length === 0
    specialistsEl.replaceChildren(...curated.map(row), ...offered.map((specialist) => {
      const runs = runtimes.includes(specialist.runtime)
      const add = h('button.cc-b', {
        type: 'button', disabled: !runs,
        title: runs ? `Add ${specialist.name} to this world` : `${specialist.name} runs on ${runtimeLabel(specialist.runtime)}, which this server cannot run yet`,
        onClick: async () => {
          add.disabled = true
          try {
            const { agent } = await api.addSpecialist(specialist.id)
            await refresh()
            onOpen(agent.id)
          } catch (error) {
            add.disabled = false
            toast(error.message, 'err')
          }
        },
      }, 'Add')
      return h('div.cp-row.cp-offer', { role: 'listitem', data: { template: specialist.id } },
        face('idle'),
        h('span.cp-name', null, specialist.name, h('small', null, runs ? specialist.speciality : `Needs ${runtimeLabel(specialist.runtime)}`)),
        add)
    }))

    const { used, limit } = counts.standard
    countEl.textContent = `${used} of ${plural(limit, 'agent')}${counts.curated.used ? `, ${plural(counts.curated.used, 'specialist')}` : ''}`
    addAgent.disabled = used >= limit
    addAgent.title = used >= limit ? `This world has ${used} of ${plural(limit, 'agent')}` : 'Add an agent'

    workspacesEl.replaceChildren(...(workspaces.length
      ? workspaces.map((workspace) => h('span.cp-place', { title: workspace.description || workspace.name }, workspace.name))
      : [h('p.cp-empty', null, 'None yet. An agent works in one.')]))
  }

  function drawSettings() {
    demoEl.hidden = !store.state.demo
    autonomy.value = store.state.autonomy
    // The usual choices, and whatever the world has if it is none of them.
    const { channelLimit } = store.state
    const choices = [...new Set([1, 2, 3, 5, ...(channelLimit ? [channelLimit] : [])])].sort((a, b) => a - b)
    limit.replaceChildren(
      h('option', { value: '' }, 'every free agent'),
      ...choices.map((n) => h('option', { value: String(n) }, `at most ${n} free ${n === 1 ? 'agent' : 'agents'}`)))
    limit.value = channelLimit ? String(channelLimit) : ''
    linkEl.hidden = store.state.link === 'live'
  }

  // ── the two forms ─────────────────────────────────────────────────────────────────────

  const field = (label, control) => h('label.cp-field', null, h('span', null, label), control)

  function openForm(kind) {
    form = kind
    addRow.hidden = true
    formEl.hidden = false
    const problem = h('p.cc-problem', { hidden: true, role: 'alert' })
    const note = h('p.cp-note', { hidden: true })
    const cancel = h('button.cc-b', { type: 'button', onClick: () => closeForm() }, 'Cancel')
    let fields
    let submit
    let make

    if (kind === 'agent') {
      const name = h('input', { type: 'text', placeholder: 'Leave blank for a random name', autocomplete: 'off' })
      const role = h('textarea', { rows: '3', maxlength: '8000', placeholder: 'What is this agent for? (optional)' })
      const runtime = h('select.cp-select', null, ...store.state.runtimes.map((id) => h('option', { value: id }, runtimeLabel(id))))
      fields = [field('Name', name), field('Role', role), store.state.runtimes.length > 1 ? field('Runs on', runtime) : null]
      submit = h('button.cc-b.cc-primary', { type: 'submit' }, 'Add agent')
      make = async () => {
        const { agent } = await api.createAgent({ name: name.value, role: role.value, runtime: runtime.value || store.state.runtimes[0] })
        await refresh()
        onOpen(agent.id)
      }
    } else {
      const name = h('input', { type: 'text', maxlength: '48', required: true, placeholder: 'Site', autocomplete: 'off' })
      const description = h('input', { type: 'text', maxlength: '200', placeholder: 'One line on what it is (optional)' })
      const gitUrl = h('input', { type: 'text', placeholder: 'https://… to start from a repository (optional)', autocomplete: 'off', spellcheck: 'false' })
      fields = [field('Name', name), field('About', description), field('Git source', gitUrl)]
      submit = h('button.cc-b.cc-primary', { type: 'submit' }, 'Add workspace')
      make = async () => {
        if (gitUrl.value.trim()) {
          note.textContent = 'Cloning. This can take a minute or two.'
          note.hidden = false
        }
        await api.createWorkspace({ name: name.value, description: description.value, gitUrl: gitUrl.value })
        await refresh()
      }
    }

    const formNode = h('form', {
      novalidate: true,
      onSubmit: async (event) => {
        event.preventDefault()
        if (submit.disabled) return
        submit.disabled = true
        cancel.disabled = true
        problem.hidden = true
        submitting = true
        try {
          await make()
          submitting = false
          closeForm()
        } catch (error) {
          submitting = false
          // What was typed stays, with the server's own reason under it.
          problem.textContent = error.message
          problem.hidden = false
          note.hidden = true
          submit.disabled = false
          cancel.disabled = false
        }
      },
    }, h('h3.cp-sec', null, kind === 'agent' ? 'New agent' : 'New workspace'), ...fields.filter(Boolean), note, problem, h('div.cp-add', null, cancel, submit))
    formEl.replaceChildren(formNode)
    formNode.querySelector('input')?.focus({ preventScroll: true })
  }

  function closeForm() {
    form = null
    formEl.hidden = true
    formEl.replaceChildren()
    addRow.hidden = false
  }

  const unsubscribe = store.subscribe((what) => {
    if (['roster', 'workspaces', 'specialists'].includes(what.kind)) drawAgents()
    if (['settings', 'link'].includes(what.kind)) {
      drawSettings()
      drawAgents()
    }
  })

  drawAgents()
  drawSettings()
  setCollapsed(remembered(COLLAPSED_KEY) === '1')

  return {
    el,
    /** Redraw the rows: which cards are open is the cards' to know, not the store's. */
    sync: drawAgents,
    openWorkspaceForm() {
      setCollapsed(false)
      openForm('workspace')
    },
    close: unsubscribe,
  }
}
