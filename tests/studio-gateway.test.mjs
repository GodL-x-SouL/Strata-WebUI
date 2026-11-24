import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createStudioGateway } from '../server/studio-gateway.mjs';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address().port); });
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

async function fixture(respond) {
  const seen = [];
  const origin = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: body.toString() });
    if (respond) return respond(req, res, body);
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'upstream=secret', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, method: req.method, url: req.url, body: body.toString() }));
  });
  const originPort = await listen(origin);
  const tunnelState = { status: 'idle', mode: null, url: null, error: null };
  const started = [];
  const tunnel = {
    state: () => ({ ...tunnelState }),
    start: async body => { started.push(body); Object.assign(tunnelState, { status: 'starting', mode: body.mode }); },
    stop: async () => Object.assign(tunnelState, { status: 'idle', mode: null }),
    prepare: async () => {},
  };
  const gateway = createStudioGateway({ originPort, tunnel: () => tunnel });
  await gateway.start();
  const port = new URL(gateway.url()).port;
  return { seen, origin, originPort, gateway, port, base: `http://127.0.0.1:${port}`, tunnelState, started, stop: async () => { await gateway.stop(); await close(origin); } };
}

function request(base, path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const req = http.request({
      hostname: '127.0.0.1', port: url.port, path: url.pathname + url.search, method,
      headers: { ...headers, ...(body === undefined ? {} : { 'content-length': Buffer.byteLength(body) }) },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function sessionHeaders(base) {
  return { origin: base };
}

async function loginCookie(gateway, base, headers = {}) {
  const login = await request(base, '/studio/login', {
    method: 'POST', body: JSON.stringify({ key: gateway.key }),
    headers: { ...sessionHeaders(base), ...headers, 'content-type': 'application/json' },
  });
  assert.equal(login.status, 200, login.body);
  return login.headers['set-cookie'][0].split(';')[0];
}

function jsonAnswer(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(value));
}

test('Studio login is local-only, issues an HttpOnly session, and hides the key behind a public Host', async () => {
  const { gateway, base, originPort, stop } = await fixture();
  try {
    const login = await request(base, '/studio/login');
    assert.equal(login.status, 200);
    assert.match(login.body, /Strata Studio/);
    assert.match(login.headers['content-security-policy'], /frame-ancestors 'none'/);

    const local = await request(base, '/studio/local-key');
    assert.equal(local.status, 200);
    assert.equal(JSON.parse(local.body).key, gateway.key);
    const remote = await request(base, '/studio/local-key', { headers: { host: 'strata.example' } });
    assert.equal(remote.status, 403);
    for (const name of ['cf-ray', 'cf-connecting-ip', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']) {
      assert.equal((await request(base, '/studio/local-key', { headers: { [name]: '198.51.100.10' } })).status, 403, name);
    }

    const denied = await request(base, '/studio/login', { method: 'POST', body: JSON.stringify({ key: 'wrong' }), headers: { ...sessionHeaders(base), 'content-type': 'application/json' } });
    assert.equal(denied.status, 401);
    const accepted = await request(base, '/studio/login', { method: 'POST', body: JSON.stringify({ key: gateway.key }), headers: { ...sessionHeaders(base), 'content-type': 'application/json' } });
    assert.equal(accepted.status, 200);
    const cookie = accepted.headers['set-cookie'][0];
    assert.match(cookie, /strata_studio_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.doesNotMatch(cookie, /Secure/);
    const token = cookie.split(';')[0];
    for (const name of ['cf-ray', 'cf-connecting-ip', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']) {
      assert.equal((await request(base, '/api/studio/access', { headers: { cookie: token, [name]: '198.51.100.10' } })).status, 403, name);
    }
    const status = await request(base, '/api/studio', { headers: { cookie: token } });
    assert.equal(status.status, 200, status.body);
    assert.equal((await request(base, '/api/studio')).status, 401);
  } finally { await stop(); }
});

test('Studio forwards JSON but rejects host-only uploads and strips browser credentials and upstream cookies', async () => {
  const { gateway, base, seen, originPort, stop } = await fixture();
  try {
    const login = await request(base, '/studio/login', { method: 'POST', body: JSON.stringify({ key: gateway.key }), headers: { ...sessionHeaders(base), 'content-type': 'application/json' } });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const headers = { cookie, origin: base, authorization: 'Bearer browser-secret', referer: base, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
    const result = await request(base, '/api/native/plan?model=q2_0&surface=local', { method: 'POST', body: JSON.stringify({ context: '32k', surface: 'local' }), headers });
    assert.equal(result.status, 200);
    assert.equal(result.headers['set-cookie'], undefined);
    assert.equal(result.headers['access-control-allow-origin'], undefined);
    assert.deepEqual(JSON.parse(result.body), {});
    const forwarded = seen.at(-1);
    assert.equal(forwarded.url, '/api/native/plan?model=q2_0&surface=studio');
    assert.equal(forwarded.headers.host, `127.0.0.1:${originPort}`);
    assert.equal(forwarded.headers.origin, undefined);
    assert.equal(forwarded.headers.authorization, undefined);
    assert.equal(forwarded.headers.referer, undefined);

    const status = await request(base, '/api/control/status', { headers });
    assert.equal(status.status, 200);
    assert.equal(seen.at(-1).url, '/api/control/status?surface=studio');

    const upload = await request(base, '/api/engine/from-file', { method: 'POST', headers: { ...headers, 'content-type': 'multipart/form-data; boundary=x' }, body: '--x\r\nContent-Disposition: form-data; name="file"\r\n\r\nengine-package\r\n--x--\r\n' });
    assert.equal(upload.status, 404);
    assert.equal(seen.at(-1).url, '/api/control/status?surface=studio');
  } finally { await stop(); }
});

test('Studio rejects CSRF and exposes only manager routes and operation kinds', async () => {
  const { gateway, base, seen, started, tunnelState, stop } = await fixture();
  try {
    const login = await request(base, '/studio/login', { method: 'POST', body: JSON.stringify({ key: gateway.key }), headers: { ...sessionHeaders(base), 'content-type': 'application/json' } });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    assert.equal((await request(base, '/api/serving', { method: 'PATCH', body: '{}', headers: { cookie } })).status, 403);
    assert.equal((await request(base, '/api/serving', { method: 'PATCH', body: '{}', headers: { cookie, origin: 'https://evil.example' } })).status, 403);
    assert.equal((await request(base, '/api/app/quit', { method: 'POST', body: '{}', headers: { ...sessionHeaders(base), cookie } })).status, 404);
    assert.equal((await request(base, '/api/control/ui', { method: 'POST', body: '{}', headers: { ...sessionHeaders(base), cookie } })).status, 404);
    assert.equal((await request(base, '/api/chats', { headers: { cookie } })).status, 404);
    assert.deepEqual(JSON.parse((await request(base, '/api/tasks', { headers: { cookie } })).body), { tasks: [] });
    assert.deepEqual(JSON.parse((await request(base, '/api/agent/pending', { headers: { cookie } })).body), { chats: [] });
    assert.equal((await request(base, '/api/native/operations', { method: 'POST', body: '{"kind":"calibrate"}', headers: { ...sessionHeaders(base), cookie, 'content-type': 'application/json' } })).status, 403);
    assert.equal(seen.length, 0);

    const allowed = await request(base, '/api/native/operations', { method: 'POST', body: JSON.stringify({ kind: 'load', args: { model: 'IQ2_XS', context: '32k', values: { drafting: 'auto' } } }), headers: { ...sessionHeaders(base), cookie, 'content-type': 'application/json' } });
    assert.equal(allowed.status, 200);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, '/api/native/operations?surface=studio');

    const status = await request(base, '/api/studio', { headers: { cookie } });
    assert.equal(JSON.parse(status.body).enabled, true);
    assert.equal(JSON.parse(status.body).tunnel.status, 'idle');
    const start = await request(base, '/api/studio/tunnel', { method: 'POST', body: '{"action":"start","mode":"quick"}', headers: { ...sessionHeaders(base), cookie, 'content-type': 'application/json' } });
    assert.equal(start.status, 200);
    assert.equal(JSON.parse(start.body).tunnel.status, 'starting');
    assert.deepEqual(started, [{ action: 'start', mode: 'quick' }]);
    assert.equal(tunnelState.status, 'starting');
  } finally { await stop(); }
});

test('Studio filters paths, model arguments and environment before forwarding', async () => {
  const { gateway, base, seen, stop } = await fixture();
  try {
    const login = await request(base, '/studio/login', { method: 'POST', body: JSON.stringify({ key: gateway.key }), headers: { ...sessionHeaders(base), 'content-type': 'application/json' } });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const headers = { ...sessionHeaders(base), cookie, 'content-type': 'application/json' };

    const plan = await request(base, '/api/native/plan?surface=desktop', {
      method: 'POST',
      body: JSON.stringify({
        model: 'IQ2_XS', context: '32k', loadAfter: true,
        data_dir: '/host/private', gguf_dir: '/host/weights', directory: '/host/downloads',
        values: { drafting: 'auto', args: ['--host', '0.0.0.0'], env: { STRATA_HOST: '0.0.0.0' } },
      }),
      headers,
    });
    assert.equal(plan.status, 200, plan.body);
    assert.equal(seen.at(-1).url, '/api/native/plan?surface=studio');
    assert.deepEqual(JSON.parse(seen.at(-1).body), {
      model: 'IQ2_XS', context: '32k', loadAfter: true, values: { drafting: 'auto' },
    });

    const operation = await request(base, '/api/native/operations', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'install',
        args: {
          model: 'IQ2_XS', loadAfter: false, data_dir: '/host/private', gguf_dir: '/host/weights',
          model_path: '/host/weights/model.gguf', directory: '/host/downloads',
          values: { drafting: 'mtp', args: ['--host'], env: { STRATA_TOKEN: 'secret' } },
        },
      }),
      headers,
    });
    assert.equal(operation.status, 200, operation.body);
    assert.equal(seen.at(-1).url, '/api/native/operations?surface=studio');
    assert.deepEqual(JSON.parse(seen.at(-1).body), {
      kind: 'install', args: { model: 'IQ2_XS', loadAfter: false, values: { drafting: 'mtp' } },
    });

    assert.equal((await request(base, '/api/native/operations', { method: 'POST', body: '{"kind":"restart-models","args":{}}', headers })).status, 403);
    assert.equal((await request(base, '/api/native/operations', { method: 'POST', body: '{"kind":"install-engine-file","args":{}}', headers })).status, 403);
    assert.equal((await request(base, '/api/native/operations', { method: 'POST', body: '{"kind":"install","args":[]}', headers })).status, 400);
    assert.equal(seen.length, 2);
  } finally { await stop(); }
});

test('Studio cannot edit local tools, engine arguments or hidden serving and shell settings', async () => {
  const { gateway, base, seen, stop } = await fixture();
  try {
    const login = await request(base, '/studio/login', { method: 'POST', body: JSON.stringify({ key: gateway.key }), headers: { ...sessionHeaders(base), 'content-type': 'application/json' } });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const headers = { ...sessionHeaders(base), cookie, 'content-type': 'application/json' };
    const settings = '/api/native/models/iq2_xs/settings?surface=desktop';

    assert.equal((await request(base, settings, { headers })).status, 200);
    assert.equal(seen.at(-1).url, '/api/native/models/iq2_xs/settings?surface=studio');
    assert.equal((await request(base, settings, { method: 'PATCH', body: '{"values":{"mcp_timeout_s":30},"mcp":{}}', headers })).status, 403);
    assert.equal((await request(base, settings, { method: 'PATCH', body: '{"values":{"args":["--host"]}}', headers })).status, 403);
    assert.equal((await request(base, '/api/serving', { method: 'PATCH', body: '{"trustedOrigins":["https://evil.example"]}', headers })).status, 403);
    assert.equal((await request(base, '/api/serving', { method: 'PATCH', body: '{"mcpTools":{"x":true}}', headers })).status, 403);
    assert.equal((await request(base, '/api/shell/prefs', { method: 'POST', body: '{"language":"de","port":1234,"tray":true}', headers })).status, 400);
    assert.equal((await request(base, '/api/shell/prefs', { method: 'POST', body: '{"language":"nope"}', headers })).status, 400);
    assert.equal(seen.length, 1);

    const saved = await request(base, settings, { method: 'PATCH', body: '{"values":{"parallel":2,"env":{"STRATA_KVA":"1"}}}', headers });
    assert.equal(saved.status, 200, saved.body);
    assert.equal(seen.at(-1).url, '/api/native/models/iq2_xs/settings?surface=studio');
    assert.deepEqual(JSON.parse(seen.at(-1).body), { values: { parallel: 2, env: { STRATA_KVA: '1' } } });

    assert.equal((await request(base, '/api/serving', { method: 'PATCH', body: '{"apiKey":"new-key","pauseServing":true,"trustedOrigins":["https://evil.example"]}', headers })).status, 403);
    assert.equal((await request(base, '/api/serving', { method: 'PATCH', body: '{"apiKey":"new-key","pauseServing":true}', headers })).status, 403);
    assert.equal((await request(base, '/api/serving', { method: 'PATCH', body: '{"pauseServing":true}', headers })).status, 200);
    assert.equal(seen.at(-1).url, '/api/serving?surface=studio');
    assert.deepEqual(JSON.parse(seen.at(-1).body), { pauseServing: true });

    assert.equal((await request(base, '/api/shell/prefs', { method: 'POST', body: '{"language":"de"}', headers })).status, 200);
    assert.deepEqual(JSON.parse(seen.at(-1).body), { language: 'de' });
    assert.equal((await request(base, '/api/serving/requests/request-1/cancel', { method: 'POST', headers })).status, 200);
    assert.equal(seen.at(-1).url, '/api/serving/requests/request-1/cancel?surface=studio');
  } finally { await stop(); }
});

test('Studio marks the session cookie Secure behind HTTPS and filters its event stream', async () => {
  const { gateway, base, originPort, stop } = await fixture();
  try {
    const publicBase = 'https://strata.example';
    const login = await request(base, '/studio/login', { method: 'POST', body: JSON.stringify({ key: gateway.key }), headers: { origin: publicBase, host: 'strata.example', 'x-forwarded-proto': 'https', 'content-type': 'application/json' } });
    assert.equal(login.status, 200);
    const cookie = login.headers['set-cookie'][0];
    assert.match(cookie, /^__Host-strata_studio_session=/);
    assert.match(cookie, /Secure/);
    assert.equal((await request(base, '/studio/logout', { method: 'POST', body: '{}', headers: { cookie: cookie.split(';')[0], origin: publicBase, host: 'strata.example', 'x-forwarded-proto': 'https', 'content-type': 'application/json' } })).status, 200);

    const localLogin = await request(base, '/studio/login', { method: 'POST', body: JSON.stringify({ key: gateway.key }), headers: { ...sessionHeaders(base), 'content-type': 'application/json' } });
    const localCookie = localLogin.headers['set-cookie'][0].split(';')[0];
    const mode = await request(base, '/api/app/mode', { headers: { cookie: localCookie } });
    assert.deepEqual(JSON.parse(mode.body), { mode: 'studio', reason: 'remote', canQuit: false, appUpdate: 'unavailable' });
  } finally { await stop(); }
});

test('Studio projects manager JSON and errors before they cross the gateway', async () => {
  const { base, gateway, stop } = await fixture((req, res) => {
    const path = new URL(req.url, 'http://origin').pathname;
    if (path === '/api/control/status') return jsonAnswer(res, 200, {
      packaged: true, anyUsableEngine: false, engineSetup: false, componentsDir: '/home/alice/components',
      engine: { usable: false, notice: 'Missing /srv/private/engine', exe: '/home/alice/engine' },
    }, { 'content-encoding': 'gzip', etag: 'private-etag', 'set-cookie': 'upstream=secret' });
    if (path === '/api/native/plan') return jsonAnswer(res, 200, {
      summary: 'Plan for /srv/private/model', command: '/home/alice/engine',
      plan: { title: 'Qwen', download_gb: 20, disk_short: null, path: '/home/alice/models' },
    });
    if (path === '/api/native') return jsonAnswer(res, 200, {
      available: true, repo: '/home/alice/Strata', external: [{ pid: 42 }],
      instances: [{ id: 'one', mcpServers: { files: {} }, error: 'Failed /srv/private/model' }],
      jobs: [
        { id: 'local-file', kind: 'install-engine-file', state: 'running', result: { path: '/home/alice/engine.zip' } },
        { id: 'local-install', kind: 'install', surface: 'local', state: 'running', summary: 'Downloading /home/alice/private.gguf' },
        { id: 'studio-install', kind: 'install', surface: 'studio', state: 'done', result: { summary: 'Installed' } },
      ],
    });
    if (path === '/api/native/benchmark') return jsonAnswer(res, 400, { error: 'Failed /srv/private/model', details: 'STRATA_TOKEN=secret' });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{not json');
  });
  try {
    const cookie = await loginCookie(gateway, base);
    const headers = { cookie };
    const status = await request(base, '/api/control/status', { headers });
    assert.equal(status.status, 200);
    assert.equal(status.headers['set-cookie'], undefined);
    assert.equal(status.headers['content-encoding'], undefined);
    assert.equal(status.headers.etag, undefined);
    assert.equal(Number(status.headers['content-length']), Buffer.byteLength(status.body));
    const control = JSON.parse(status.body);
    assert.equal(control.componentsDir, undefined);
    assert.equal(control.engine.exe, undefined);
    assert.equal(control.engine.notice, 'Missing [local path]');

    const plan = JSON.parse((await request(base, '/api/native/plan', { method: 'POST', body: '{"model":"IQ2_XS"}', headers: { ...headers, origin: base, 'content-type': 'application/json' } })).body);
    assert.deepEqual(plan, { summary: 'Plan for [local path]', plan: { title: 'Qwen', download_gb: 20, disk_short: null } });
    const native = JSON.parse((await request(base, '/api/native', { headers })).body);
    assert.equal(native.repo, undefined);
    assert.equal(native.external, undefined);
    assert.equal(native.instances[0].mcpServers, undefined);
    assert.equal(native.instances[0].error, 'Failed [local path]');
    assert.deepEqual(native.jobs.map(job => job.id), ['studio-install']);

    const failed = await request(base, '/api/native/benchmark', { headers });
    assert.equal(failed.status, 400);
    assert.deepEqual(JSON.parse(failed.body), { error: 'Failed [local path]' });
    const malformed = await request(base, '/api/health', { headers });
    assert.equal(malformed.status, 502);
    assert.deepEqual(JSON.parse(malformed.body), { error: 'The local Strata host returned an invalid response.' });
    assert.doesNotMatch(JSON.stringify({ control, plan, native, failed: failed.body, malformed: malformed.body }), /\/home\/|\/srv\/|STRATA_TOKEN|upstream=secret/);
  } finally { await stop(); }
});

test('Studio filters setup progress and keeps only guided management choices', async () => {
  const { base, gateway, seen, stop } = await fixture((req, res) => jsonAnswer(res, 200, {
    complete: false, step: 2, directory: '/home/alice/private',
    choices: { onboarding: { step: 2, family: 'qwen', size: 'IQ2_XS', context: 32768, directory: '/home/alice/private' } },
  }));
  try {
    const cookie = await loginCookie(gateway, base);
    const headers = { cookie, origin: base, 'content-type': 'application/json' };
    const response = await request(base, '/api/setup/step?surface=desktop', {
      method: 'POST', headers,
      body: JSON.stringify({
        step: 2, flowVersion: 2, directory: '/home/alice/private', arbitrary: { token: 'secret' },
        choices: {
          variantId: 'iq2_xs', contextLength: '32k', profile: 'balanced', batch: 2048, batchAuto: true,
          directory: '/home/alice/private', unknown: { token: 'secret' },
          onboarding: { step: 2, family: 'qwen', size: 'IQ2_XS', context: 32768, vision: true, profile: 'work', installJobId: 'job_1', directory: '/home/alice/private', arbitrary: 'drop' },
        },
      }),
    });
    assert.equal(response.status, 200, response.body);
    assert.equal(seen.at(-1).url, '/api/setup/step?surface=studio');
    assert.deepEqual(JSON.parse(seen.at(-1).body), {
      step: 2, flowVersion: 2,
      choices: {
        variantId: 'iq2_xs', contextLength: '32k', profile: 'balanced', batch: 2048, batchAuto: true,
        onboarding: { step: 2, family: 'qwen', size: 'IQ2_XS', context: 32768, vision: true, profile: 'work', installJobId: 'job_1' },
      },
    });
    const projected = JSON.parse(response.body);
    assert.equal(projected.directory, undefined);
    assert.equal(projected.choices.onboarding.directory, undefined);
    const before = seen.length;
    assert.equal((await request(base, '/api/setup/step', { method: 'POST', body: '{"step":9}', headers })).status, 400);
    assert.equal(seen.length, before);
  } finally { await stop(); }
});

test('Studio exposes a narrow manager tunnel DTO and refuses inference-tunnel routes', async () => {
  const rawTunnel = {
    status: 'connected', mode: 'domain', url: 'https://strata.example', installed: true,
    originUrl: 'http://127.0.0.1:8080', token: 'browser-secret',
    connector: { path: '/home/alice/cloudflared', source: '/home/alice/bin', version: '1', label: 'cloudflared', summary: 'Ready' },
    external: { kind: 'process', others: [42], own: [43], message: '/srv/private/process' },
  };
  const { base, gateway, seen, tunnelState, started, stop } = await fixture((req, res) => {
    if (new URL(req.url, 'http://origin').pathname === '/api/serving') return jsonAnswer(res, 200, {
      running: true, baseUrl: 'http://127.0.0.1:8080/v1', localUrl: 'http://127.0.0.1:8080/v1', tunnel: rawTunnel,
      access: { apiKeySet: true, apiKeyHint: 'browser-secret', otherDevices: true }, apiKey: 'secret',
    });
    jsonAnswer(res, 200, {});
  });
  Object.assign(tunnelState, rawTunnel);
  try {
    const cookie = await loginCookie(gateway, base);
    const headers = { cookie, origin: base, 'content-type': 'application/json' };
    const before = seen.length;
    assert.equal((await request(base, '/api/serving/tunnel?surface=desktop', { headers })).status, 404);
    assert.equal((await request(base, '/api/serving/tunnel', {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'start', mode: 'domain', hostname: 'strata.example', token: 'browser-secret' }),
    })).status, 404);
    assert.equal(seen.length, before);

    const serving = JSON.parse((await request(base, '/api/serving', { headers })).body);
    assert.equal(serving.apiKey, undefined);
    assert.equal(serving.tunnel, undefined);
    assert.deepEqual(serving.access, { apiKeySet: true });

    const studio = await request(base, '/api/studio/tunnel', { method: 'POST', body: '{"action":"start","mode":"quick","token":"ignored"}', headers });
    assert.equal(studio.status, 200);
    assert.deepEqual(started.at(-1), { action: 'start', mode: 'quick' });
    const studioState = JSON.parse(studio.body);
    assert.equal(studioState.tunnel.token, undefined);
    assert.equal(studioState.tunnel.originUrl, undefined);
    assert.equal(studioState.tunnel.external, undefined);
    assert.equal(studioState.tunnel.connector.summary, undefined);
    assert.equal(studioState.tunnel.connector.path, undefined);

    const domain = await request(base, '/api/studio/tunnel', {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'start', mode: 'domain', hostname: 'strata.example', token: 'browser-secret', originUrl: 'http://evil.example' }),
    });
    assert.equal(domain.status, 200, domain.body);
    assert.deepEqual(started.at(-1), { action: 'start', mode: 'domain', hostname: 'strata.example', token: 'browser-secret' });
    assert.doesNotMatch(JSON.stringify({ serving, studio: studio.body, domain: domain.body }), /browser-secret|\/home\/|\/srv\/|evil\.example/);
  } finally { await stop(); }
});

test('Studio streams the host-projected event feed and refuses raw logs', async () => {
  const { base, gateway, seen, stop } = await fixture((req, res) => {
    if (new URL(req.url, 'http://origin').pathname !== '/api/events') return jsonAnswer(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'set-cookie': 'upstream=secret' });
    res.write('event: native\ndata: {"available":true,"jobs":[]}\n\n');
    res.end();
  });
  try {
    const cookie = await loginCookie(gateway, base);
    const headers = { cookie };
    const events = await request(base, '/api/events?surface=desktop', { headers });
    assert.equal(events.status, 200);
    assert.match(events.headers['content-type'], /text\/event-stream/);
    assert.equal(events.headers['set-cookie'], undefined);
    assert.equal(seen.at(-1).url, '/api/events?surface=studio');
    assert.match(events.body, /event: native/);
    assert.match(events.body, /"available":true/);
    const before = seen.length;
    assert.equal((await request(base, '/api/native/logs', { headers })).status, 404);
    assert.equal(seen.length, before);
  } finally { await stop(); }
});

test('Studio throttles failed logins per source but always accepts the valid key', async () => {
  const { base, gateway, stop } = await fixture();
  try {
    const headers = { host: 'strata.example', origin: 'http://strata.example', 'cf-connecting-ip': '198.51.100.10', 'content-type': 'application/json' };
    const attempt = key => request(base, '/studio/login', { method: 'POST', headers, body: JSON.stringify({ key }) });
    for (let i = 0; i < 8; i++) assert.equal((await attempt('wrong')).status, 401);
    assert.equal((await attempt('wrong')).status, 429);
    assert.equal((await attempt(gateway.key)).status, 200);
    assert.equal((await attempt('wrong')).status, 401);
    const other = await request(base, '/studio/login', { method: 'POST', headers: { ...headers, 'cf-connecting-ip': '198.51.100.11' }, body: '{"key":"wrong"}' });
    assert.equal(other.status, 401);
  } finally { await stop(); }
});
