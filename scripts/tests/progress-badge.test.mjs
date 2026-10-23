import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { progressMark } from '../../src/renderer/ui/progress-mark.ts'

test('progressMark formats completed/total and skips empty totals', () => {
  assert.equal(progressMark(4, 9), '4/9')
  assert.equal(progressMark(0, 20), '0/20')
  assert.equal(progressMark(20, 20), '20/20')
  assert.equal(progressMark(25, 20), '20/20')
  assert.equal(progressMark(-3, 9), '0/9')
  assert.equal(progressMark(1.9, 9.7), '1/9')
  assert.equal(progressMark(3, 0), null)
  assert.equal(progressMark(3, -1), null)
  assert.equal(progressMark(NaN, 9), '0/9')
})

test('control panel wires study fraction + name, and bag counts', () => {
  const src = readFileSync(new URL('../../src/renderer/ui/control.ts', import.meta.url), 'utf8')
  assert.match(src, /mark:\s*\(g\)\s*=>\s*progressMark\(studyLessons\(g\),\s*g\.classNum/)
  assert.match(src, /tag:\s*\(g\)\s*=>\s*g\.name/)
  assert.match(src, /mark:\s*\(g\)\s*=>\s*\(g\.num != null && g\.num > 0 \? String\(g\.num\) : null\)/)
  assert.match(src, /cardBadge\(tag,\s*'tl'\)/)
  assert.match(src, /cardBadge\(mark,\s*'br'\)/)
  // Work has no completed/total — do not force a mark there.
  assert.doesNotMatch(src, /workGoods[\s\S]{0,200}mark:/)
})

test('study lessons helper is exported for the badge', () => {
  const src = readFileSync(new URL('../../src/renderer/pet/jobs.ts', import.meta.url), 'utf8')
  assert.match(src, /export const studyLessons/)
})

test('games picker shows today play minutes as completed/total', () => {
  const src = readFileSync(new URL('../../src/renderer/ui/games.ts', import.meta.url), 'utf8')
  assert.match(src, /今日已玩 \$\{played\}\/\$\{DAY_MINUTES\} 分钟/)
})

test('badge CSS sits on the card corners', () => {
  const css = readFileSync(new URL('../../src/renderer/ui/css/control.css', import.meta.url), 'utf8')
  assert.match(css, /\.ui-control \.cardBadge-br\s*\{[^}]*bottom:\s*0/)
  assert.match(css, /\.ui-control \.cardBadge-tl\s*\{[^}]*top:\s*0/)
})
