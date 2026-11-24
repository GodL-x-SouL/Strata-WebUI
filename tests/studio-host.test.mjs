import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const delay = ms => new Promise(r => setTimeout(r, ms));

async function freePort() {
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise(r => server.close(r));
  return port;
}

async function startHost({ studio = false } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'strata-studio-host-'));
  for (const name of ['home', 'Local', 'Roaming', 'xdg-data', 'xdg-state', 'xdg-config', 'components']) await mkdir(join(home, name));
  const mainPort = await freePort(), studioPort = await freePort();
  const args = ['server/index.mjs', '--dist', resolve(root, 'dist')];
  if (studio) args.push('--studio');
  const host = spawn(process.execPath, args, {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOME: join(home, 'home'), USERPROFILE: join(home, 'home'), STRATA_HOME: join(home, 'home'),
      LOCALAPPDATA: join(home, 'Local'), APPDATA: join(home, 'Roaming'),
      XDG_DATA_HOME: join(home, 'xdg-data'), XDG_STATE_HOME: join(home, 'xdg-state'), XDG_CONFIG_HOME: join(home, 'xdg-config'),
      STRATA_SETTINGS_FILE: join(home, 'settings.json'), STRATA_COMPONENTS_DIR: join(home, 'components'),
      STRATA_MODELS_DIR: join(home, 'models'), STRATA_WORKSPACE: join(home, 'workspace'),
      STRATA_PORT: String(mainPort), STRATA_STUDIO_PORT: String(studioPort),
      STRATA_SHARE_PORT: String(await freePort()), STRATA_TUNNEL_PORT: String(await freePort()),
      STRATA_UI_MODE: 'browser', STRATA_NO_ACQUIRE: '1', STRATA_NO_BUNDLED_ENGINE: '1',
    },
  });
  let output = '';
  host.stdout.on('data', chunk => { output += chunk; });
  host.stderr.on('data', chunk => { output += chunk; });
  const exited = new Promise(resolve => host.once('exit', code => resolve(code)));
  return { home, host, exited, output: () => output, main: `http://127.0.0.1:${mainPort}`, studio: `http://127.0.0.1:${studioPort}` };
}

async function waitFor(url, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not listening yet */ }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

test('a Studio host opens before an engine or model exists and serves the manager through its authenticated gateway', async () => {
  const { home, host, exited, output, main, studio } = await startHost({ studio: true });
  try {
    await waitFor(`${studio}/studio/login`);
    await waitFor(`${main}/api/health`);
    assert.equal((await fetch(`${main}/api/app/mode`)).status, 200);
    assert.equal((await fetch(`${studio}/api/health`)).status, 401);

    const local = await fetch(`${studio}/studio/local-key`);
    assert.equal(local.status, 200);
    const { key } = await local.json();
    assert.ok(key.length >= 32);
    const login = await fetch(`${studio}/studio/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: studio }, body: JSON.stringify({ key }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const headers = { cookie, origin: studio };
    for (const path of ['/api/health', '/api/hardware', '/api/setup', '/api/native', '/api/serving', '/api/studio', '/api/control/status']) {
      const response = await fetch(`${studio}${path}`, { headers });
      assert.equal(response.status, 200, `${path}: ${await response.text()}`);
    }
    const localStatus = await (await fetch(`${main}/api/control/status`)).json();
    assert.ok(Object.hasOwn(localStatus, 'componentsDir'));
    const studioStatus = await (await fetch(`${studio}/api/control/status`, { headers })).json();
    assert.deepEqual(Object.keys(studioStatus), ['packaged', 'engine', 'shapeEngines', 'anyUsableEngine', 'engineSetup']);
    assert.equal(studioStatus.engineSetup, false);
    assert.equal(studioStatus.anyUsableEngine, false);
    const mode = await (await fetch(`${studio}/api/app/mode`, { headers })).json();
    assert.deepEqual(mode, { mode: 'studio', reason: 'remote', canQuit: false, appUpdate: 'unavailable' });
    const page = await fetch(`${studio}/#/models`, { headers });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<div id="root"><\/div>/);
    const asset = page.headers.get('content-type');
    assert.match(asset, /text\/html/);
  } finally {
    host.kill('SIGTERM');
    assert.equal(await Promise.race([exited, delay(20000).then(() => 'still running')]), 0, output());
    await rm(home, { recursive: true, force: true });
  }
});

test('Studio engine polling keeps the Studio job and matches the native snapshot', async () => {
  const { home, host, exited, output, main, studio } = await startHost({ studio: true });
  try {
    await waitFor(`${studio}/studio/login`);
    await waitFor(`${main}/api/health`);
    const { key } = await (await fetch(`${studio}/studio/local-key`)).json();
    const login = await fetch(`${studio}/studio/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: studio }, body: JSON.stringify({ key }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const headers = { cookie, origin: studio, 'content-type': 'application/json' };
    for (let i = 0; i < 200; i++) {
      const state = await (await fetch(`${studio}/api/native`, { headers })).json();
      if (state.available) break;
      await delay(50);
    }
    const local = await fetch(`${main}/api/native/operations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'update-engine', args: {} }) });
    assert.equal(local.status, 202);
    const started = await fetch(`${studio}/api/native/operations`, { method: 'POST', headers, body: JSON.stringify({ kind: 'update-engine', args: {} }) });
    assert.equal(started.status, 202, await started.clone().text());
    const created = await started.json();
    assert.ok(created.id);
    let engine = null, snapshot = null;
    for (let i = 0; i < 200; i++) {
      engine = await (await fetch(`${studio}/api/engine/job`, { headers })).json();
      snapshot = await (await fetch(`${studio}/api/native?refresh=1`, { headers })).json();
      const current = snapshot.jobs?.find(job => job.id === created.id);
      if (engine.job && current && engine.job.state !== 'running' && current.state !== 'running') break;
      await delay(50);
    }
    assert.ok(engine.job, 'the engine polling route must not erase the Studio job');
    assert.deepEqual(engine.job, snapshot.jobs.find(job => job.id === created.id));
    assert.deepEqual(snapshot.jobs.map(job => job.id), [created.id], 'local host jobs stay out of Studio');
    assert.equal(engine.job.surface, undefined);
    assert.equal(engine.job.details, undefined);
  } finally {
    host.kill('SIGTERM');
    assert.equal(await Promise.race([exited, delay(20000).then(() => 'still running')]), 0, output());
    await rm(home, { recursive: true, force: true });
  }
});

test('an ordinary host keeps its unauthenticated UI and does not open a Studio listener', async () => {
  const { home, host, exited, output, main, studio } = await startHost();
  try {
    await waitFor(`${main}/api/health`);
    await assert.rejects(fetch(`${studio}/studio/login`));
    const mode = await (await fetch(`${main}/api/app/mode`)).json();
    assert.equal(mode.mode, 'browser');
    assert.equal(mode.canQuit, true);
    const page = await fetch(`${main}/#/models`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<div id="root"><\/div>/);
  } finally {
    host.kill('SIGTERM');
    assert.equal(await Promise.race([exited, delay(20000).then(() => 'still running')]), 0, output());
    await rm(home, { recursive: true, force: true });
  }
});
