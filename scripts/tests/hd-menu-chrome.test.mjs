import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createRequire } from 'node:module'

const root = join(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)

/** Walk resource files; skip huge trees we do not ship as UI chrome. */
function* walk(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name)
    if (name.isDirectory()) {
      if (name.name === 'qqfarm' || name.name === 'smallGame' || name.name === 'smallGamec1' || name.name === 'petsoc') continue
      yield* walk(p)
    } else yield p
  }
}

describe('HD menu chrome (#117)', () => {
  it('ships no ~ short-name lookalikes next to @2x (Windows 8.3 clobber)', () => {
    const bad = []
    for (const file of walk(join(root, 'resources/pet'))) {
      if (file.includes('~')) bad.push(relative(root, file))
    }
    assert.deepEqual(bad, [], `remove tilde filenames so installers cannot overwrite @2x twins:\n${bad.join('\n')}`)
  })

  it('protocol skips /pet/Menu/ for X-HD SVG wrapping', () => {
    const src = readFileSync(join(root, 'src/main/protocol.ts'), 'utf8')
    assert.match(src, /menuChrome/)
    assert.match(src, /\/pet\/Menu\//)
    assert.match(src, /!menuChrome/)
  })

  it('Menu @2x twins are exact 2× of the 1× caps used by the frame', async () => {
    let imageSize
    try {
      ;({ imageSize } = await import('../../src/main/hidpi.ts'))
    } catch {
      const esbuild = require('esbuild')
      const outfile = join(root, 'scripts/tests/.hidpi-menu.mjs')
      await esbuild.build({ entryPoints: ['src/main/hidpi.ts'], outfile, format: 'esm', platform: 'node', bundle: true })
      ;({ imageSize } = await import(outfile))
    }
    const menu = join(root, 'resources/pet/Menu')
    for (const n of [1, 2, 3, 7, 8, 9]) {
      const one = join(menu, `ditu0${n}.png`)
      const two = join(menu, `ditu0${n}@2x.png`)
      assert.ok(existsSync(one) && existsSync(two), `ditu0${n}`)
      const oneBuf = readFileSync(one)
      const twoBuf = readFileSync(two)
      // CI checkouts skip Git LFS, so Menu PNGs may be pointer stubs without IHDR.
      const a = imageSize(oneBuf)
      const b = imageSize(twoBuf)
      if (!a || !b) {
        assert.ok(oneBuf.includes('version https://git-lfs.github.com/spec/v1') || twoBuf.includes('version https://git-lfs.github.com/spec/v1'),
          `ditu0${n}: unreadable PNG and not an LFS pointer`)
        continue
      }
      assert.equal(b.w, a.w * 2, `ditu0${n} width`)
      assert.equal(b.h, a.h * 2, `ditu0${n} height`)
    }
  })
})
