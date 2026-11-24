import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = await mkdtemp(join(tmpdir(), 'strata-native-delete-test-'));
const output = join(root, 'native-delete.mjs');
await build({
  entryPoints: [new URL('../src/lib/native.ts', import.meta.url).pathname],
  outfile: output,
  bundle: true,
  format: 'esm',
  platform: 'node',
  plugins: [{
    name: 'native-delete-test-stubs',
    setup(builder) {
      builder.onResolve({ filter: /^\.\/(client|native-catalog)$/ }, args => ({ path: args.path, namespace: 'delete-stub' }));
      builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'delete-stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'delete-stub' }, args => ({
        contents: args.path === './client'
          ? 'export const api={post:(...args)=>globalThis.__deleteApi.post(...args),get:(...args)=>globalThis.__deleteApi.get(...args)};'
          : args.path === 'react'
            ? 'export const useEffect=()=>{};export const useSyncExternalStore=()=>null;'
            : 'export const nativeVersionLabel=value=>value;',
        loader: 'js',
      }));
    },
  }],
});
const { removeNativeModel } = await import(pathToFileURL(output));
test.after(() => rm(root, { recursive: true, force: true }));

const job = (id, state, error = null) => ({ id, kind: 'remove', state, error, summary: '', result: null });
const snapshot = (current, models = [], extra = {}) => ({
  available: true, error: null, installed: { models }, jobs: [current], ...extra,
});

function mock(current, models = [], extra = {}) {
  const calls = [];
  globalThis.__deleteApi = {
    post: async (path, body) => {
      calls.push({ method: 'POST', path, body });
      return job('remove-1', 'running');
    },
    get: async path => {
      calls.push({ method: 'GET', path });
      return snapshot(current, models, extra);
    },
  };
  return calls;
}

test('browser deletion reports success only after the host confirms the model is gone', async t => {
  await t.test('a done job and an absent installed model succeed', async () => {
    const calls = mock(job('remove-1', 'done'));
    await removeNativeModel('iq2_xs', { attempts: 2, pollMs: 1 });
    assert.deepEqual(calls[0], { method: 'POST', path: '/api/native/operations', body: { kind: 'remove', args: { model: 'iq2_xs' } } });
    assert.ok(calls.filter(call => call.method === 'GET').length >= 2);
  });
  await t.test('an error job is not success', async () => {
    mock(job('remove-1', 'error', 'Permission denied'));
    await assert.rejects(removeNativeModel('iq2_xs', { attempts: 2, pollMs: 1 }), /Permission denied/);
  });
  await t.test('a cancelled job is not success', async () => {
    mock(job('remove-1', 'cancelled'));
    await assert.rejects(removeNativeModel('iq2_xs', { attempts: 2, pollMs: 1 }), /cancelled/i);
  });
  await t.test('a done job with the model still installed times out instead of closing', async () => {
    mock(job('remove-1', 'done'), [{ model: 'iq2_xs' }]);
    await assert.rejects(removeNativeModel('iq2_xs', { attempts: 2, pollMs: 1 }), /did not confirm/);
  });
  await t.test('a running job times out instead of claiming completion', async () => {
    mock(job('remove-1', 'running'));
    await assert.rejects(removeNativeModel('iq2_xs', { attempts: 2, pollMs: 1 }), /did not confirm/);
  });
  await t.test('a failed model-list read is not success', async () => {
    mock(job('remove-1', 'done'), [], { available: false });
    await assert.rejects(removeNativeModel('iq2_xs', { attempts: 2, pollMs: 1 }), /model list did not load/);
  });
  await t.test('a host error is not success', async () => {
    mock(job('remove-1', 'done'), [], { error: 'Could not read models' });
    await assert.rejects(removeNativeModel('iq2_xs', { attempts: 2, pollMs: 1 }), /Could not confirm deletion/);
  });
});
