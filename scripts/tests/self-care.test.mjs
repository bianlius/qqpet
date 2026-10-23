import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { careAttrBonus, careUseful, chooseCare, pickCare } from '../../src/renderer/pet/care.ts'

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
  const badge = { id: '100010439', name: '黄金奖杯', hunger: 1, charm: 5, intel: 5, strong: 5 }
  const mud = { id: '100020083', name: '泥浆沐浴露', clean: 1 }
  const junk = { id: '100010102', name: '愚人怪怪饼', hunger: 1 } // attrs=0, still a token fill
  const rice = { id: 'food', name: '小笼包', hunger: 500 }
  assert.equal(careAttrBonus(pill), 150)
  assert.equal(careUseful(pill, 'hunger'), false)
  assert.equal(careUseful(junk, 'hunger'), false)
  assert.equal(pickCare([pill, badge, junk], 'hunger', 900), undefined)
  assert.equal(pickCare([pill, rice], 'hunger', 900), rice)
  assert.equal(pickCare([mud, soap], 'clean', 400), soap)
  // Explicitly chosen 大衍飞升丹 must fall back — otherwise it is eaten every minute forever.
  assert.equal(chooseCare([pill, rice], 'hunger', 900, pill.id), rice)
  assert.equal(chooseCare([pill], 'hunger', 900, pill.id), undefined)
})

test('attr trinkets (圣战令牌) excluded; tiny snacks without attrs and real attr-foods kept', () => {
  const token = { id: '100010399', name: '圣战令牌', hunger: 10, charm: 10, intel: 10, strong: 10 }
  const ice = { id: '100010056', name: '清爽冰花', hunger: 10 } // attrs=0, real snack
  const coffee = { id: '100010055', name: '浓郁咖啡', hunger: 15, price: 8 }
  const elixir = { id: '100010296', name: '大灵丹', hunger: 2500, charm: 15, intel: 15, strong: 15 }
  const pure = { id: '100010123', name: '千年蜂浆', hunger: 0, intel: 100, strong: 100 }
  const study = { id: '100020207', name: '学霸牌学习机', clean: 1, intel: 20 }
  assert.equal(careUseful(token, 'hunger'), false)
  assert.equal(careUseful(ice, 'hunger'), true)
  assert.equal(careUseful(coffee, 'hunger'), true)
  assert.equal(careUseful(elixir, 'hunger'), true)
  assert.equal(careUseful(pure, 'hunger'), false)
  assert.equal(careUseful(study, 'clean'), false)
  assert.equal(pickCare([token, ice, coffee], 'hunger', 900), coffee) // bigger fit among useful
  assert.equal(chooseCare([token, ice], 'hunger', 900, token.id), ice)
})

test('a missing food does not end the round: clean and mood are still checked', () => {
  const src = readFileSync(new URL('../../src/renderer/pet/pet.ts', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('function selfCare'), src.indexOf('\n}\n', src.indexOf('function selfCare')))
  assert.match(body, /for \(const need of NEEDS\)/)
  assert.match(body, /if \(!g\) continue/)
})
