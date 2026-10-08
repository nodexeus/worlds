import { h } from './dom.js'
import { parseMarkdown } from './markdown.js'
import { answerLabel } from './transcript.js'

/** What an agent wrote, as elements. Every piece of it is set as text. */
export function renderMarkdown(text) {
  const out = document.createDocumentFragment()
  const inline = (spans) =>
    spans.map((span) => {
      if (span.type === 'code') return h('code', null, span.text)
      if (span.type === 'b') return h('strong', null, span.text)
      if (span.type === 'i') return h('em', null, span.text)
      if (span.type === 'link') return h('a', { href: span.href, target: '_blank', rel: 'noopener noreferrer' }, span.text)
      return span.text
    })
  for (const block of parseMarkdown(text)) {
    if (block.type === 'code') out.append(h('pre.cc-code', null, block.text))
    else if (block.type === 'h') out.append(h('p.cc-h', null, ...inline(block.spans)))
    else if (block.type === 'li') {
      out.append(h('p.cc-li', { style: `--depth:${block.depth}` }, h('span.cc-marker', null, block.marker), h('span', null, ...inline(block.spans))))
    } else out.append(h('p', null, ...inline(block.spans)))
  }
  return out
}

const TOOL_MARK = { running: '●', done: '✓', failed: '✕', stopped: '■' }

function tool(item) {
  const line = h('button.cc-tool-line', { type: 'button', 'aria-expanded': 'false', disabled: !item.output },
    h('span.cc-tool-mark', null, TOOL_MARK[item.state]),
    h('span.cc-tool-what', null, item.summary || item.name || 'Tool'),
    item.output ? h('span.cc-tool-caret', { 'aria-hidden': 'true' }, '▸') : null)
  const el = h('div.cc-tool', { data: { state: item.state } }, line)
  if (item.output) {
    const output = h('pre.cc-tool-out', { hidden: true }, item.output)
    line.addEventListener('click', () => {
      output.hidden = !output.hidden
      line.setAttribute('aria-expanded', String(!output.hidden))
    })
    el.append(output)
  }
  return el
}

function message(item, agentName) {
  const note = item.state === 'queued' ? `queued · sent when ${agentName} finishes` : item.state === 'cancelled' ? 'not sent' : null
  return h('div.cc-me', { data: { state: item.state } }, item.text, note ? h('small', null, note) : null)
}

/**
 * An open approval or question, with the controls that answer it. `answer(choice)` is the
 * card's: it sends the answer and resolves to an error message, or to nothing if it went.
 */
function request(item, { agentName, answer }) {
  const problem = h('p.cc-ask-problem', { hidden: true })
  const el = h('div.cc-ask', { data: { type: item.type } })
  const controls = []
  const submit = async (choice) => {
    for (const control of controls) control.disabled = true
    problem.hidden = true
    const failed = await answer(item, choice)
    if (!failed) return
    for (const control of controls) control.disabled = false
    problem.textContent = failed
    problem.hidden = false
  }
  const button = (label, primary, onClick) => {
    const b = h(primary ? 'button.cc-b.cc-primary' : 'button.cc-b', { type: 'button', onClick }, label)
    controls.push(b)
    return b
  }

  if (item.type === 'approval') {
    el.append(
      h('h4', null, 'Approval'),
      h('p', null, `${agentName} wants to use ${item.tool || 'a tool'}.`),
      item.summary ? h('pre.cc-ask-what', null, item.summary) : null,
      h('div.cc-opts', null,
        button('Allow', true, () => submit({ allow: true })),
        button('Refuse', false, () => submit({ allow: false }))),
      problem)
    return el
  }

  const questions = item.questions ?? []
  /** One answer per question: the options ticked, or what was typed. */
  const picked = questions.map(() => [])
  const typed = questions.map(() => '')
  const answers = () => questions.map((_, n) => (typed[n].trim() ? typed[n] : picked[n]))
  const quick = questions.length === 1 && !questions[0].multiple
  const send = button('Send answer', true, () => submit({ answers: answers() }))

  el.append(h('h4', null, questions.length > 1 ? 'Questions' : 'Question'))
  questions.forEach((q, n) => {
    const chips = (q.options ?? []).map((option) => {
      const chip = button(option, false, () => {
        if (quick) return submit({ answers: [option] })
        if (q.multiple) picked[n] = picked[n].includes(option) ? picked[n].filter((o) => o !== option) : [...picked[n], option]
        else picked[n] = picked[n][0] === option ? [] : [option]
        for (const [at, other] of chips.entries()) other.setAttribute('aria-pressed', String(picked[n].includes(q.options[at])))
      })
      if (!quick) chip.setAttribute('aria-pressed', 'false')
      return chip
    })
    const other = h('input.cc-ask-other', {
      type: 'text', placeholder: chips.length ? 'Something else…' : 'Your answer…', 'aria-label': `Answer: ${q.question}`,
      onInput: (event) => { typed[n] = event.target.value },
      onKeydown: (event) => {
        if (event.key === 'Enter' && typed[n].trim()) submit({ answers: answers() })
      },
    })
    controls.push(other)
    el.append(h('p', null, q.question), chips.length ? h('div.cc-opts', null, ...chips) : null, other)
  })
  if (!quick) el.append(h('div.cc-opts', null, send))
  el.append(problem)
  return el
}

function settled(item) {
  if (item.state === 'lapsed') return h('p.cc-note', null, item.type === 'approval' ? `not answered: ${item.summary || item.tool}` : 'not answered')
  if (item.type === 'approval') return h('p.cc-note', null, `answered: ${answerLabel(item)}`)
  const asked = item.questions?.length === 1 ? `${item.questions[0].question} ` : ''
  return h('p.cc-note', null, `${asked}answered: ${answerLabel(item)}`)
}

function ending(item, { retry }) {
  const el = h('p.cc-note', { data: { type: item.type } }, item.note)
  if (item.retry) el.append(' ', h('button.cc-link', { type: 'button', onClick: () => retry(item.retry) }, 'Try again'))
  return el
}

/**
 * One item of a transcript as an element.
 *
 * @param {object} item from `transcript()`
 * @param {{agentName: string, answer: (item: object, choice: object) => Promise<string | void>,
 *   retry: (text: string) => void}} card
 */
export function renderItem(item, card) {
  if (item.kind === 'message') return message(item, card.agentName)
  if (item.kind === 'text') return h('div.cc-ag', null, renderMarkdown(item.text))
  if (item.kind === 'tool') return tool(item)
  if (item.kind === 'request') return item.state === 'open' ? request(item, card) : settled(item)
  if (item.kind === 'ending') return ending(item, card)
  return h('div.cc-ag.cc-draft', null, item.text)
}

/** What an item is, across redraws, and whether it has changed since it was last drawn. */
export const keyOf = (item) => (item.kind === 'draft' ? 'draft' : item.kind === 'tool' ? `tool:${item.seq}` : `${item.kind}:${item.seq}`)
export const signatureOf = (item) => JSON.stringify(item)
