#!/usr/bin/env node
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as signEd25519 } from 'node:crypto'
import { build as bundleJs } from 'esbuild'
import { zipSync } from 'fflate'
import { parseZipBundle, isSelfContainedHtml, normalizeEntry } from './bundle.ts'
import { validateManifest } from './manifest.ts'
import { BUNDLE_SIGNATURE_FILE, BUNDLE_SIGNATURE_FORMAT, canonicalBundleMessage, encodeBase64, verifyBundleSignature } from './signature.ts'
import type { PluginManifest } from './contract.ts'

const encoder = new TextEncoder()
const fixedMtime = new Date('1980-01-01T00:00:00.000Z')

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}

async function loadManifest(dir: string): Promise<PluginManifest> {
  return validateManifest(JSON.parse(await readFile(join(dir, 'buckle.plugin.json'), 'utf8')))
}

function localPath(dir: string, entry: string): string {
  if (isAbsolute(entry) || /^[a-z][a-z0-9+.-]*:/i.test(entry) || entry.includes('\\')) {
    throw new Error(`Remote or absolute entry is unsupported: ${entry}`)
  }
  const root = resolve(dir)
  const path = resolve(root, normalizeEntry(entry))
  const rel = relative(root, path)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Entry escapes plugin directory: ${entry}`)
  }
  return path
}

async function bundleScript(path: string): Promise<string> {
  const result = await bundleJs({ entryPoints: [path], bundle: true, write: false,
    platform: 'browser', format: 'esm', target: 'es2020', logLevel: 'silent' })
  if (!result.outputFiles?.[0]) throw new Error(`No output for ${path}`)
  return result.outputFiles[0].text
}

async function bundlePanel(dir: string, entry: string): Promise<string> {
  const panelPath = localPath(dir, entry)
  let html = await readFile(panelPath, 'utf8')
  for (const match of [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi)]) {
    const script = await bundleScript(localPath(dirname(panelPath), match[1]))
    html = html.replace(match[0], `<script type="module">\n${script.replace(/<\/script/gi, '<\\/script')}\n</script>`)
  }
  for (const match of [...html.matchAll(/<link\b[^>]*>/gi)]) {
    if (!/\brel=["']stylesheet["']/i.test(match[0])) continue
    const href = match[0].match(/\bhref=["']([^"']+)["']/i)?.[1]
    if (!href) throw new Error('Stylesheet link is missing href')
    const css = await readFile(localPath(dirname(panelPath), href), 'utf8')
    html = html.replace(match[0], `<style>\n${css}\n</style>`)
  }
  if (!isSelfContainedHtml(html)) throw new Error(`Panel ${entry} must be self-contained after build`)
  return html
}

export async function buildPlugin(dir: string, outputDir = join(dir, 'dist')): Promise<string> {
  const root = resolve(dir)
  const manifest = await loadManifest(root)
  const files = new Map<string, Uint8Array>()
  files.set('buckle.plugin.json', encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`))
  const workerEntry = manifest.entrypoints?.worker
  if (workerEntry) {
    let source: string | undefined
    for (const name of ['src/worker.ts', 'src/worker.js', normalizeEntry(workerEntry)]) {
      const path = localPath(root, name)
      if (await exists(path)) { source = path; break }
    }
    if (!source) throw new Error('Worker source not found (expected src/worker.ts or manifest entrypoint)')
    files.set(normalizeEntry(workerEntry), encoder.encode(await bundleScript(source)))
  }
  for (const panel of manifest.contributions?.panels ?? []) {
    files.set(normalizeEntry(panel.entry), encoder.encode(await bundlePanel(root, panel.entry)))
  }
  const zipEntries: Record<string, [Uint8Array, { mtime: Date }]> = {}
  for (const name of [...files.keys()].sort()) zipEntries[name] = [files.get(name)!, { mtime: fixedMtime }]
  const zip = zipSync(zipEntries, { level: 6 })
  parseZipBundle(zip, 'build output')
  await mkdir(outputDir, { recursive: true })
  const output = join(outputDir, `${manifest.id}-${manifest.version}.zip`)
  await writeFile(output, zip)
  return output
}

export async function generatePublisherKey(prefix: string): Promise<string> {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicJwk = publicKey.export({ format: 'jwk' })
  if (!publicJwk.x) throw new Error('Could not export publisher public key')
  await writeFile(`${prefix}.private.pem`, privateKey.export({ format: 'pem', type: 'pkcs8' }),
    { flag: 'wx', mode: 0o600 })
  const rawPublicKey = Buffer.from(publicJwk.x, 'base64url')
  await writeFile(`${prefix}.public.txt`, `${encodeBase64(rawPublicKey)}\n`,
    { flag: 'wx' })
  return createHash('sha256').update(rawPublicKey).digest('hex')
}

export async function signPluginZip(zipPath: string, keyPath: string, outputPath: string): Promise<string> {
  const bundle = parseZipBundle(await readFile(zipPath), zipPath)
  const files = new Map(bundle.files)
  files.delete(BUNDLE_SIGNATURE_FILE)
  const privateKey = createPrivateKey(await readFile(keyPath))
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Publisher key must be Ed25519')
  const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' })
  if (!publicJwk.x) throw new Error('Could not export publisher public key')
  const publicKey = Buffer.from(publicJwk.x, 'base64url')
  const message = await canonicalBundleMessage(files)
  const signature = signEd25519(null, Buffer.from(message), privateKey)
  files.set(BUNDLE_SIGNATURE_FILE, encoder.encode(`${JSON.stringify({
    format: BUNDLE_SIGNATURE_FORMAT,
    publicKey: encodeBase64(publicKey),
    signature: encodeBase64(signature),
  }, null, 2)}\n`))
  const zipEntries: Record<string, [Uint8Array, { mtime: Date }]> = {}
  for (const name of [...files.keys()].sort()) zipEntries[name] = [files.get(name)!, { mtime: fixedMtime }]
  const signedZip = zipSync(zipEntries, { level: 6 })
  await verifyBundleSignature(parseZipBundle(signedZip, outputPath))
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, signedZip)
  return outputPath
}

export async function initPlugin(dir: string): Promise<void> {
  const root = resolve(dir)
  if (await exists(root)) throw new Error(`Directory already exists: ${root}`)
  const slug = (basename(root).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'example').slice(0, 50)
  const id = `com.example.${slug}`
  await mkdir(join(root, 'src'), { recursive: true })
  const manifest = { id, name: slug, version: '0.1.0', apiVersion: 1,
    permissions: ['model.read', 'ui.notify', 'ui.panel'], entrypoints: { worker: 'worker.js' },
    contributions: { commands: [{ id: `${id}.open`, title: 'Open plugin panel' }],
      ribbonTabs: [{ id: `${id}.tab`, label: slug }],
      ribbon: [{ id: `${id}.button`, tabId: `${id}.tab`, groupId: 'main', groupLabel: 'Plugin',
        commandId: `${id}.open`, label: 'Open panel' }],
      panels: [{ id: `${id}.panel`, title: slug, entry: 'panel.html' }] } }
  await writeFile(join(root, 'buckle.plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(join(root, 'package.json'), `${JSON.stringify({ name: slug, private: true, type: 'module',
    scripts: { build: 'buckle-plugin build .', check: 'tsc --noEmit' },
    dependencies: { '@buckle/plugin-sdk': '^0.1.0-alpha.1' },
    devDependencies: { typescript: '^7.0.2' } }, null, 2)}\n`)
  await writeFile(join(root, 'tsconfig.json'), `${JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
    lib: ['ES2022', 'DOM', 'WebWorker'], strict: true, noEmit: true, skipLibCheck: true,
  }, include: ['src/**/*.ts'] }, null, 2)}\n`)
  await writeFile(join(root, 'src', 'worker.ts'), `import { createWorkerPlugin } from '@buckle/plugin-sdk'\n\nconst plugin = createWorkerPlugin({\n  '${id}.open': async api => {\n    await api.openPanel('${id}.panel')\n  },\n})\n\nvoid plugin.api.query().then(snapshot =>\n  plugin.api.notify('Plugin loaded: ' + snapshot.nodes.length + ' nodes', 'success')\n)\n`)
  await writeFile(join(root, 'src', 'panel.ts'), `import { PluginPanelClient } from '@buckle/plugin-sdk'\n\nconst api = PluginPanelClient.forParentWindow()\nconst result = document.querySelector<HTMLParagraphElement>('#result')!\ndocument.querySelector<HTMLButtonElement>('#read-model')!.addEventListener('click', async () => {\n  result.textContent = 'Reading model...'\n  try {\n    const snapshot = await api.query()\n    result.textContent = \`Nodes: \${snapshot.nodes.length}, members: \${snapshot.members.length}\`\n  } catch (error) { result.textContent = \`Query failed: \${String(error)}\` }\n})\n`)
  await writeFile(join(root, 'panel.css'), `body { font: 14px system-ui; padding: 20px; background: #17202b; color: white; }\nbutton { padding: 8px 12px; }\n`)
  await writeFile(join(root, 'panel.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>${slug}</title>\n<link rel="stylesheet" href="./panel.css">\n<h1>${slug}</h1><p>Your plugin panel is running.</p>\n<button id="read-model" type="button">Read model</button><p id="result">Ready.</p>\n<script type="module" src="./src/panel.ts"></script></html>\n`)
  await writeFile(join(root, 'README.md'), `# ${slug}\n\nInstall the SDK tarball supplied with Buckle first (the alpha SDK is not on npm):\n\n\`\`\`sh\nnpm install /path/to/buckle-plugin-sdk-0.1.0-alpha.1.tgz\nnpm run check\nnpm run build\n\`\`\`\n\nInstall \`dist/${id}-0.1.0.zip\` in Buckle through File → Manage plugins → Install. The Worker registers a ribbon command; the panel reads the model through the SDK.\n`)
}

async function main() {
  const [command, target, ...rest] = process.argv.slice(2)
  if (!command || !target) throw new Error('Usage: buckle-plugin <init|validate|build|keygen|sign> <target> [--key private.pem] [--out path]')
  if (command === 'init') {
    await initPlugin(target)
    console.log(`Created ${resolve(target)}`)
  } else if (command === 'validate') {
    if (target.toLowerCase().endsWith('.zip')) {
      const bundle = parseZipBundle(await readFile(target), target)
      const trust = await verifyBundleSignature(bundle)
      console.log(`OK ${bundle.manifest.id}@${bundle.manifest.version} (${trust.status === 'signed' ? `signed by ${trust.keySha256}` : 'unsigned'})`)
    } else {
      const manifest = await loadManifest(resolve(target))
      console.log(`OK ${manifest.id}@${manifest.version}`)
    }
  } else if (command === 'build') {
    const outIndex = rest.indexOf('--out')
    const output = await buildPlugin(target, outIndex < 0 ? join(target, 'dist') : rest[outIndex + 1])
    console.log(`Built ${output}`)
  } else if (command === 'keygen') {
    const fingerprint = await generatePublisherKey(target)
    console.log(`Created ${target}.private.pem and ${target}.public.txt; keep the private key secret`)
    console.log(`Publisher key SHA-256: ${fingerprint}`)
  } else if (command === 'sign') {
    const keyIndex = rest.indexOf('--key')
    if (keyIndex < 0 || !rest[keyIndex + 1]) throw new Error('sign requires --key private.pem')
    const outIndex = rest.indexOf('--out')
    const output = outIndex < 0 ? target.replace(/\.zip$/i, '.signed.zip') : rest[outIndex + 1]
    if (output === target) throw new Error('Signing output must differ from input ZIP')
    console.log(`Signed ${await signPluginZip(target, rest[keyIndex + 1], output)}`)
  } else throw new Error(`Unknown command ${command}`)
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
}
