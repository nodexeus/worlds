// test/crew-names.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NAMES, KINDS, RUNTIMES, checkName, nameKey, pickName } from '../server/crew/names.mjs'
import { loadCatalog } from '../server/crew/catalog.mjs'
import { CrewError } from '../server/crew/errors.mjs'

const refused = (code) => (error) => error instanceof CrewError && error.code === code

test('the name list is long enough, valid, and has no two alike', () => {
  assert.ok(NAMES.length >= 60)
  assert.equal(new Set(NAMES.map(nameKey)).size, NAMES.length)
  for (const name of NAMES) assert.equal(checkName(name), name)
})

test('a name is one word that can follow an @', () => {
  for (const good of ['Ada', 'ronnie', 'R2', 'Mary-Anne', 'big_al', 'Zoë']) assert.equal(checkName(good), good)
  for (const bad of ['', ' ', 'a', 'two words', '@ada', 'ada!', '9lives', '-ada', 'x'.repeat(25), null, 42, {}]) {
    assert.throws(() => checkName(bad), refused('bad_name'), `accepted ${JSON.stringify(bad)}`)
  }
})

test('padding is trimmed and case does not make a different name', () => {
  assert.equal(checkName('  Ada  '), 'Ada')
  assert.equal(nameKey(' ADA '), 'ada')
  assert.equal(nameKey('Zoë'), nameKey('ZOË'))
})

test('picking skips what is taken and never repeats itself into a corner', () => {
  const taken = new Set(NAMES.slice(1).map(nameKey))
  assert.equal(pickName(taken, () => 0.99), NAMES[0])
  assert.throws(() => pickName(new Set(NAMES.map(nameKey))), refused('no_names_left'))
})

test('the same roll gives the same name, so a test can know what it will get', () => {
  assert.equal(pickName(new Set(), () => 0), pickName(new Set(), () => 0))
  assert.notEqual(pickName(new Set(), () => 0), pickName(new Set(), () => 0.5))
})

test('the shipped catalog loads, and its names are reserved and not in the name list', async () => {
  const catalog = await loadCatalog()
  assert.ok(catalog.templates.length >= 1)
  const quill = catalog.byId.get('quill')
  assert.equal(quill.name, 'Quill')
  assert.ok(KINDS.includes(quill.kind) && RUNTIMES.includes(quill.runtime))
  assert.ok(quill.role.length > 20 && quill.speciality.length > 0)
  assert.ok(catalog.reserved.has('quill'))
  for (const name of NAMES) assert.ok(!catalog.reserved.has(nameKey(name)), `${name} is a specialist's name`)
})

async function catalogOf(...templates) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-catalog-'))
  await Promise.all(templates.map((t, i) => fs.writeFile(path.join(dir, `${i}.json`), JSON.stringify(t))))
  return dir
}
const sample = { id: 'sophie', name: 'Sophie', speciality: 'Social media', kind: 'rock', runtime: 'hermes', role: 'Runs social media campaigns end to end.', skills: [] }

test('a template that is missing something says which file and what', async () => {
  for (const [field, value] of [['name', 'two words'], ['kind', 'dragon'], ['runtime', 'gpt'], ['role', ''], ['id', 'Has Caps'], ['skills', 'none']]) {
    const dir = await catalogOf({ ...sample, [field]: value })
    await assert.rejects(loadCatalog(dir), new RegExp(`0\\.json.*${field}`))
  }
})

test('two templates cannot share an id or a name', async () => {
  await assert.rejects(loadCatalog(await catalogOf(sample, { ...sample, name: 'Other' })), /sophie/)
  await assert.rejects(loadCatalog(await catalogOf(sample, { ...sample, id: 'other', name: 'SOPHIE' })), /Sophie|SOPHIE/)
})

test('an empty catalog is allowed', async () => {
  const catalog = await loadCatalog(await catalogOf())
  assert.deepEqual(catalog.templates, [])
  assert.equal(catalog.reserved.size, 0)
})

test('two names are the same name however they are accented, cased or composed', () => {
  // Postgres lowers a dotted capital I to a plain i. If this side did not, "QUİLL" would get
  // past the reserved check and then hold the specialist's name in the database.
  assert.equal(nameKey('QUİLL'), 'quill')
  assert.equal(nameKey('Zoë'), nameKey('Zoë'))
  assert.equal(nameKey('Zoë'), nameKey('zoe'))
})

test('a name typed in decomposed form is accepted and stored composed', () => {
  assert.equal(checkName('Zoë'), 'Zoë')
})
