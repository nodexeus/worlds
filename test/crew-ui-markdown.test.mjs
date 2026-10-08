// test/crew-ui-markdown.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMarkdown } from '../src/crew/markdown.js'

const t = (text) => ({ type: 'text', text })

test('plain lines are a paragraph, and a blank line starts another', () => {
  assert.deepEqual(parseMarkdown('One line.\nAnd another.\n\nA second paragraph.'), [
    { type: 'p', spans: [t('One line.\nAnd another.')] },
    { type: 'p', spans: [t('A second paragraph.')] },
  ])
  assert.deepEqual(parseMarkdown(''), [])
  assert.deepEqual(parseMarkdown('  \n\n '), [])
})

test('code, bold, italic and links inside a line', () => {
  assert.deepEqual(parseMarkdown('Run `npm test` then **stop**, *really*. See [the docs](https://example.com/a) or https://example.com/b.')[0].spans, [
    t('Run '), { type: 'code', text: 'npm test' }, t(' then '), { type: 'b', text: 'stop' }, t(', '), { type: 'i', text: 'really' },
    t('. See '), { type: 'link', text: 'the docs', href: 'https://example.com/a' }, t(' or '),
    { type: 'link', text: 'https://example.com/b', href: 'https://example.com/b' }, t('.'),
  ])
})

test('a fenced block keeps its lines exactly, and says its language', () => {
  assert.deepEqual(parseMarkdown('Before\n```js\nconst a = `**not bold**`\n\n  indented\n```\nAfter'), [
    { type: 'p', spans: [t('Before')] },
    { type: 'code', lang: 'js', text: 'const a = `**not bold**`\n\n  indented' },
    { type: 'p', spans: [t('After')] },
  ])
})

test('a fence never closed takes the rest', () => {
  assert.deepEqual(parseMarkdown('```\nline one\nline two'), [{ type: 'code', lang: '', text: 'line one\nline two' }])
})

test('headings and list items', () => {
  assert.deepEqual(parseMarkdown('## What I did\n- Read `a.js`\n  * nested\n1. First\n12) Twelfth'), [
    { type: 'h', level: 2, spans: [t('What I did')] },
    { type: 'li', marker: '•', depth: 0, spans: [t('Read '), { type: 'code', text: 'a.js' }] },
    { type: 'li', marker: '•', depth: 1, spans: [t('nested')] },
    { type: 'li', marker: '1.', depth: 0, spans: [t('First')] },
    { type: 'li', marker: '12.', depth: 0, spans: [t('Twelfth')] },
  ])
})

test('only http and https are ever links', () => {
  for (const href of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>', 'vbscript:x', 'file:///etc/passwd', '//evil.example', '/relative', ' javascript:alert(1)']) {
    const spans = parseMarkdown(`Click [here](${href}) now`).flatMap((block) => block.spans)
    assert.equal(spans.some((span) => span.type === 'link'), false, href)
    assert.ok(spans.map((span) => span.text).join('').includes('here'), 'and the words are still shown')
  }
})

test('markup in what an agent wrote is only ever text', () => {
  const nasty = '<img src=x onerror=alert(1)> <script>alert(2)</script> &amp; "quoted"'
  const blocks = parseMarkdown(`${nasty}\n\n- ${nasty}\n\n\`${nasty}\``)
  const all = blocks.flatMap((block) => block.spans ?? [t(block.text)])
  for (const span of all) assert.ok(['text', 'code'].includes(span.type))
  assert.equal(all.filter((span) => span.text.includes('<script>alert(2)</script>')).length, 3)
})

test('stray markers are left as they were written', () => {
  assert.deepEqual(parseMarkdown('2 * 3 * 4 and a_snake_case_name and a lone ` tick')[0].spans, [t('2 * 3 * 4 and a_snake_case_name and a lone ` tick')])
  assert.deepEqual(parseMarkdown('#hashtag and -dash')[0].spans, [t('#hashtag and -dash')])
})

test('a very long input is dealt with promptly', () => {
  const started = Date.now()
  const stars = parseMarkdown('* '.repeat(100_000))
  const line = parseMarkdown('`'.repeat(200_000))
  const many = parseMarkdown('word **bold** `code`\n'.repeat(10_000))
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started}ms`)
  assert.equal(stars.length, 1)
  assert.equal(line.length, 1)
  assert.equal(many.length, 1)
})
