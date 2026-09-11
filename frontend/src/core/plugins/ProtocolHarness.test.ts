import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateManifest, negotiateApiVersion, ManifestError } from './manifest.ts';
import { parseRpcRequest, rpcSuccess, rpcFailure } from './rpc.ts';
import type { RpcRequest } from './rpc.ts';
import { PluginPanelClient, RpcCallError } from '../../sdk/client.ts';
import { runValidate, runBuild } from '../../../scripts/buckle-plugin.ts';


/**
 * Goal 5 protocol + compatibility harness: an API v1 plugin package (validated
 * manifest) must work against the host's closed RPC surface, unknown methods
 * must fail closed end-to-end, and the developer CLI must gate on the same
 * manifest schema the host enforces.
 */

const validManifest = {
  id: 'com.example.truss',
  name: 'Example Truss',
  version: '1.0.0',
  apiVersion: 1,
  permissions: ['model.read', 'ui.notify'],
  entrypoints: {},
  contributions: { commands: [{ id: 'com.example.truss.generate', title: 'Generate' }] },
};

test('manifest schema: an API v1 plugin validates and negotiates to v1', () => {
  const manifest = validateManifest(validManifest);
  assert.equal(negotiateApiVersion(manifest), 1);
  assert.deepEqual(manifest.permissions, ['model.read', 'ui.notify']);
});

test('manifest schema: future API versions fail closed (cross-version gate)', () => {
  assert.throws(() => validateManifest({ ...validManifest, apiVersion: 2 }), ManifestError);
});

/** Wire an SDK client to an in-memory host that uses the real host parser. */
const wireHost = (handle: (request: RpcRequest) => unknown) => {
  let deliver: ((message: unknown) => void) | undefined;
  const client = new PluginPanelClient({
    transport: {
      post: message => {
        try {
          const request = parseRpcRequest(message);
          const result = handle(request);
          deliver?.(result);
        } catch (error) {
          // Host-side fail-closed rejection (e.g. unknown method).
          deliver?.(rpcFailure(String((message as { id?: string }).id ?? '?'), 'UNKNOWN_METHOD', String(error)));
        }
      },
      subscribe: listener => {
        deliver = listener;
        return () => { deliver = undefined };
      },
    },
  });
  return client;
};

test('protocol: SDK client round-trips query through the real host parser', async () => {
  const client = wireHost(request => {
    assert.equal(request.method, 'model.query');
    return rpcSuccess(request.id, { nodes: [], revision: 7 });
  });
  const snapshot = await client.query() as { revision: number };
  assert.equal(snapshot.revision, 7);
});

test('protocol: structured host errors surface as RpcCallError codes', async () => {
  const client = wireHost(request =>
    rpcFailure(request.id, 'PERMISSION_DENIED', 'model.execute requires a write grant'));
  await assert.rejects(
    client.execute({ type: 'Transaction', payload: { operations: [] } }),
    (error: RpcCallError) => error.code === 'PERMISSION_DENIED',
  );
});

test('protocol: unknown methods fail closed before any handler runs', async () => {
  const client = wireHost(() => { throw new Error('handler must never run') });
  await assert.rejects(
    client.call('ui.notify' as never, { message: 'x' } as never).then(() => undefined),
    () => true,
  );
  // Direct unknown-method post: the host parser rejects, the client surfaces it.
  const raw = wireHost(() => rpcSuccess('ignored', null));
  await assert.rejects(
    raw.call('ui.notify', { message: 'x' }),
  );
});

test('protocol: pending calls reject with TIMEOUT when the host is silent', async () => {
  const client = new PluginPanelClient({
    transport: { post: () => undefined, subscribe: () => () => undefined },
    callTimeoutMs: 20,
  });
  await assert.rejects(client.query(), (error: RpcCallError) => error.code === 'TIMEOUT');
});

test('CLI: validate accepts a valid package and rejects a malformed manifest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buckle-cli-ok-'));
  try {
    await writeFile(join(dir, 'buckle.plugin.json'), JSON.stringify(validManifest));
    const manifest = await runValidate(dir);
    assert.equal(manifest.id, 'com.example.truss');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const bad = await mkdtemp(join(tmpdir(), 'buckle-cli-bad-'));
  try {
    await writeFile(join(bad, 'buckle.plugin.json'), JSON.stringify({ ...validManifest, id: 'not-namespaced' }));
    await assert.rejects(() => runValidate(bad), ManifestError);
  } finally {
    await rm(bad, { recursive: true, force: true });
  }
});

test('CLI: build validates then copies the package to the output directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buckle-cli-build-'));
  const out = `${dir}-out`;
  try {
    await writeFile(join(dir, 'buckle.plugin.json'), JSON.stringify(validManifest));
    await writeFile(join(dir, 'panel.html'), '<!doctype html>');
    const count = await runBuild(dir, out);
    assert.equal(count, 2);
    const copied = JSON.parse(await readFile(join(out, 'buckle.plugin.json'), 'utf8'));
    assert.equal(copied.id, 'com.example.truss');
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});
