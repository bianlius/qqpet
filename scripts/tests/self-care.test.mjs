import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { careUseful, chooseCare, pickCare } from '../../src/renderer/pet/care.ts'

const towel = { name: '浴巾', clean: 720 }
const soap = { name: '香皂', clean: 300 }
const gel = { name: '沐浴露', clean: 400 }
const bath = { name: '浴缸', clean: 900 }

test('auto-care uses the biggest good that still fits the deficit (#40)', () => {
  // cleanMax 1100, clean 659: the towel would waste 279.
  assert.equal(pickCare([towel, soap, gel], 'clean', 441), gel)
})

test('when every good overflows, the one that overflows least is used', () => {
  assert.equal(pickCare([bath, towel], 'clean', 200), towel)
})

test('goods that do nothing for the stat are skipped; none left means nothing is used', () => {
  assert.equal(pickCare([{ name: '饼干', hunger: 100 }], 'clean', 300), undefined)
  assert.equal(pickCare([], 'mood', 300), undefined)
})

test('token hunger/clean (=1) trophies and 属性丹 are not auto-care food', () => {
  const pill = { id: '100010448', name: '大衍飞升丹', hunger: 1, charm: 50, intel: 50, strong: 50 }
  const badge = { id: '100010439', name: '黄金奖杯', hunger: 1 }
  const mud = { id: '100020083', name: '泥浆沐浴露', clean: 1 }
  const rice = { id: 'food', name: '小笼包', hunger: 500 }
  assert.equal(careUseful(pill, 'hunger'), false)
  assert.equal(pickCare([pill, badge], 'hunger', 900), undefined)
  assert.equal(pickCare([pill, rice], 'hunger', 900), rice)
  assert.equal(pickCare([mud, soap], 'clean', 400), soap)
  // Explicitly chosen 大衍飞升丹 must fall back — otherwise it is eaten every minute forever.
  assert.equal(chooseCare([pill, rice], 'hunger', 900, pill.id), rice)
  assert.equal(chooseCare([pill], 'hunger', 900, pill.id), undefined)
})

test('a missing food does not end the round: clean and mood are still checked', () => {
  const src = readFileSync(new URL('../../src/renderer/pet/pet.ts', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('function selfCare'), src.indexOf('\n}\n', src.indexOf('function selfCare')))
  assert.match(body, /for \(const need of NEEDS\)/)
  assert.match(body, /if \(!g\) continue/)
})
