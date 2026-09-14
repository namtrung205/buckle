import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { generatePublisherKey, signPluginZip } from '../src/cli.ts'
import { parseZipBundle } from '../src/bundle.ts'
import { verifyBundleSignature } from '../src/signature.ts'

const unsignedZip = () => zipSync({
  'buckle.plugin.json': strToU8(JSON.stringify({
    id: 'com.example.signed', name: 'Signed', version: '1.0.0', apiVersion: 1,
    entrypoints: { worker: 'worker.js' },
  })),
  'worker.js': strToU8('console.log("reviewed")'),
})

test('publisher signs the whole logical ZIP and tampering fails verification', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buckle-sign-'))
  try {
    const keyPrefix = join(dir, 'publisher')
    const input = join(dir, 'plugin.zip')
    const output = join(dir, 'plugin.signed.zip')
    await generatePublisherKey(keyPrefix)
    await writeFile(input, unsignedZip())
    await signPluginZip(input, `${keyPrefix}.private.pem`, output)
    const signed = parseZipBundle(await readFile(output), output)
    const trust = await verifyBundleSignature(signed)
    assert.equal(trust.status, 'signed')
    if (trust.status === 'signed') assert.match(trust.keySha256, /^[a-f0-9]{64}$/)

    const tampered = unzipSync(await readFile(output))
    tampered['worker.js'] = strToU8('console.log("changed")')
    await assert.rejects(verifyBundleSignature(parseZipBundle(zipSync(tampered))), /does not match/)
    tampered['worker.js'] = strToU8('console.log("reviewed")')
    tampered['buckle.plugin.json'] = strToU8(JSON.stringify({
      id: 'com.example.signed', name: 'Signed', version: '2.0.0', apiVersion: 1,
      entrypoints: { worker: 'worker.js' },
    }))
    await assert.rejects(verifyBundleSignature(parseZipBundle(zipSync(tampered))), /does not match/)
    const signedFiles = unzipSync(await readFile(output))
    assert.throws(() => parseZipBundle(zipSync({
      ...Object.fromEntries(Object.entries(signedFiles).map(([path, bytes]) => [`dist/${path}`, bytes])),
      'outside.txt': strToU8('ignored but unsigned'),
    })), /outside dist/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
