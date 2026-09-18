import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPlugin, initPlugin } from '../src/cli.ts'
import { parseZipBundle, isSelfContainedHtml } from '../src/bundle.ts'

test('CLI creates a project and reproducible installable ZIP with inline panel assets', async () => {
  const base = await mkdtemp(join(tmpdir(), 'buckle-sdk-test-'))
  const project = join(base, 'external-plugin')
  try {
    await initPlugin(project)
    await writeFile(join(project, 'src', 'worker.ts'),
      `const ids = ['com.example.external-plugin.open']; self.postMessage({v:1,kind:'plugin.ready',commands:ids});\n`)
    await writeFile(join(project, 'src', 'panel.ts'), `document.body.dataset.loaded = 'yes'\n`)
    await writeFile(join(project, 'panel.css'), `body { color: white; }\n`)
    await writeFile(join(project, 'panel.html'),
      `<link rel="stylesheet" href="./panel.css"><script type="module" src="./src/panel.ts"></script>`)
    const output = await buildPlugin(project)
    const first = await readFile(output)
    const bundle = parseZipBundle(first)
    assert.equal(bundle.manifest.id, 'com.example.external-plugin')
    assert.deepEqual([...bundle.files.keys()].sort(), ['buckle.plugin.json', 'panel.html', 'worker.js'])
    const panel = new TextDecoder().decode(bundle.files.get('panel.html'))
    assert.equal(isSelfContainedHtml(panel), true)
    assert.match(panel, /dataset\.loaded/)
    assert.match(panel, /color: white/)
    const second = await readFile(await buildPlugin(project))
    const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
    assert.equal(hash(first), hash(second))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
