import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { badRequest, error, json, readBody, requestUrl, sameSecret } from './util.mjs';
import { LANGUAGES } from './shell-prefs.mjs';
import { studioApiError, studioApiResponse, studioDiagnosticText, studioSetupStepInput, studioTunnelState } from './studio-data.mjs';

const SESSION_COOKIE = 'strata_studio_session';
const SECURE_COOKIE = '__Host-strata_studio_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_LIMIT = 8;
const SAFE_METHODS = new Set(['GET', 'HEAD']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const REMOTE_OPERATIONS = new Set(['install', 'load', 'pictures', 'benchmark', 'tune', 'autotune', 'recheck', 'update-engine', 'remove']);
const REMOTE_PLAN_FIELDS = new Set([
  'guided', 'family', 'model', 'context', 'contextChosen', 'vision', 'loadVision', 'visionUnavailable',
  'noReader', 'kv', 'low_ram', 'resourceProfile', 'gpu', 'gpus', 'gpusFromRecommendation', 'gpuRoles',
  'backend', 'drafter', 'drafting', 'mtp', 'port', 'loadAfter', 'multiple', 'values',
]);
const REMOTE_OPERATION_FIELDS = {
  install: REMOTE_PLAN_FIELDS,
  load: new Set([...REMOTE_PLAN_FIELDS, 'firstLoad', 'retrySafer', 'layerSplit']),
  pictures: new Set(['model', 'vision']),
  benchmark: new Set(['instanceId']),
  tune: new Set([...REMOTE_PLAN_FIELDS, 'profile', 'calibrate']),
  autotune: new Set(['model', 'resourceProfile', 'vision', 'visionUnavailable', 'gpus', 'values', 'mode', 'use', 'allowSmallDifferences', 'presetId', 'name']),
  recheck: new Set(['model', 'resourceProfile', 'vision', 'visionUnavailable', 'gpus', 'values', 'mode', 'use', 'allowSmallDifferences', 'presetId', 'name']),
  'update-engine': new Set(['firstRun', 'withControl', 'stopModel']),
  remove: new Set(['model']),
};
const REMOTE_SERVING_FIELDS = new Set(['pauseServing']);
const REMOTE_TUNNEL_FIELDS = new Set(['action', 'mode', 'hostname', 'token']);
const READ_ROUTES = new Set([
  '/api/health', '/api/hardware', '/api/monitor', '/api/setup', '/api/models', '/api/events',
  '/api/serving', '/api/control/status', '/api/engine/first-run', '/api/engines', '/api/engine/job',
  '/api/native', '/api/native/ram-reserve', '/api/native/model-port', '/api/native/prompt-cache-spread',
  '/api/native/benchmark', '/api/native/tune/status', '/api/native/tune/effective',
  '/api/native/tune/presets', '/api/updates/check', '/api/locale',
]);
const WRITE_ROUTES = new Set([
  '/api/setup/step', '/api/setup/complete', '/api/native/plan', '/api/native/operations',
  '/api/native/engine-restart/dismiss', '/api/native/tune/off', '/api/native/tune/undo',
  '/api/serving', '/api/shell/prefs',
]);
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

function loopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function cookies(req) {
  const out = new Map();
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) out.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return out;
}

function cookieValue(token, secure) {
  return `${secure ? SECURE_COOKIE : SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

function send(res, status, body, headers = {}) {
  if (res.headersSent) return res.end();
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  });
  res.end(text);
}

function loginPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Strata Studio</title><link rel="stylesheet" href="/studio/login.css"><script src="/studio/login.js" defer></script></head><body><main class="login"><div class="login__mark">Strata <span>Studio</span></div><h1>Open your Strata</h1><p>This private link controls the computer running Strata. Enter the Studio key from the local app.</p><form id="login"><label for="key">Studio key</label><input id="key" name="key" type="password" autocomplete="current-password" spellcheck="false" required><button type="submit">Open Studio</button><p id="message" role="status"></p></form><p class="login__note">The key is separate from your inference API key. Closing this tab does not stop Strata.</p></main></body></html>`;
}

const LOGIN_CSS = `:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f14;color:#e8edf3;font:16px/1.5 system-ui,sans-serif}.login{width:min(440px,calc(100% - 40px));padding:36px;border:1px solid #26313d;border-radius:20px;background:#121922;box-shadow:0 24px 80px #0006}.login__mark{font-weight:750;letter-spacing:-.03em}.login__mark span{color:#8fd3ff}h1{font-size:28px;line-height:1.15;margin:28px 0 10px}p{color:#aab7c4}label{display:block;margin:26px 0 8px;font-weight:650}input{width:100%;padding:12px 14px;border:1px solid #39495a;border-radius:10px;background:#0b1118;color:inherit;font:inherit}button{width:100%;margin-top:14px;padding:12px 16px;border:0;border-radius:10px;background:#d8efff;color:#08121b;font:inherit;font-weight:750;cursor:pointer}button:disabled{opacity:.6;cursor:wait}#message{min-height:24px;color:#ffb4a8}.login__note{font-size:13px;margin-bottom:0}`;
const LOGIN_JS = `const form=document.getElementById('login'),input=document.getElementById('key'),message=document.getElementById('message');async function enter(key){form.querySelector('button').disabled=true;message.textContent='Opening…';try{const r=await fetch('/studio/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key})});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||'That key was not accepted.');location.replace('/');}catch(e){message.textContent=e.message;form.querySelector('button').disabled=false;}}form.addEventListener('submit',e=>{e.preventDefault();enter(input.value)});fetch('/studio/local-key').then(r=>r.ok?r.json():null).then(v=>{if(v&&v.key){input.value=v.key;enter(v.key)}}).catch(()=>{});`;

function allowed(path, method) {
  if (method === 'GET' || method === 'HEAD') {
    if (READ_ROUTES.has(path)) return true;
    if (/^\/api\/native\/models\/[a-z0-9_.-]+\/settings$/.test(path)) return true;
    return false;
  }
  if (WRITE_ROUTES.has(path)) return true;
  if (/^\/api\/native\/operations\/[a-z0-9-]+\/cancel$/.test(path)) return true;
  if (/^\/api\/native\/instances\/[a-z0-9-]+\/(unload|default)$/.test(path)) return true;
  if (/^\/api\/native\/tune\/presets\/[0-9a-f]{8,32}\/(apply|rename|delete|undo)$/.test(path)) return true;
  if (method === 'PATCH' && /^\/api\/native\/models\/[a-z0-9_.-]+\/settings$/.test(path)) return true;
  if (method === 'POST' && /^\/api\/serving\/requests\/[a-z0-9-]+\/cancel$/.test(path)) return true;
  return false;
}

function studioPath(url) {
  const next = new URL(url);
  next.searchParams.delete('surface');
  next.searchParams.set('surface', 'studio');
  return `${next.pathname}${next.search}`;
}

function remoteObject(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Send a JSON object.');
  const result = Object.fromEntries(Object.entries(value).filter(([key]) => fields.has(key)));
  if (result.values !== undefined) {
    if (!result.values || typeof result.values !== 'object' || Array.isArray(result.values)) throw new Error('Model choices must be a JSON object.');
    result.values = Object.fromEntries(Object.entries(result.values).filter(([key]) => key === 'drafting'));
  }
  return result;
}

function remoteTunnelInput(value) {
  const result = remoteObject(value, REMOTE_TUNNEL_FIELDS);
  if (result.action !== 'start' || result.mode !== 'domain') {
    delete result.token;
    delete result.hostname;
  }
  return result;
}

function proxy(originPort, req, res, path, body) {
  const headers = { ...req.headers, host: `127.0.0.1:${originPort}`, 'accept-encoding': 'identity' };
  for (const name of HOP_HEADERS) delete headers[name];
  for (const name of ['cookie', 'authorization', 'origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user']) delete headers[name];
  if (body !== undefined) headers['content-length'] = Buffer.byteLength(body);
  const upstream = http.request({ hostname: '127.0.0.1', port: originPort, method: req.method, path, headers }, answer => {
    const responseHeaders = { ...answer.headers };
    for (const name of HOP_HEADERS) delete responseHeaders[name];
    delete responseHeaders['set-cookie'];
    delete responseHeaders['access-control-allow-origin'];
    const status = answer.statusCode ?? 502;
    const type = String(responseHeaders['content-type'] ?? '').toLowerCase();
    const json = type.includes('application/json') || type.includes('+json');
    if (req.method === 'HEAD' || status === 204 || status === 304 || type.includes('text/event-stream') || !json && status < 400) {
      res.writeHead(status, responseHeaders);
      answer.pipe(res);
      return;
    }
    const chunks = [];
    let size = 0;
    answer.on('data', chunk => {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) { answer.destroy(); return; }
      chunks.push(chunk);
    });
    answer.on('error', () => { if (!res.headersSent) send(res, 502, { error: 'The local Strata host did not finish that response.' }); else res.destroy(); });
    answer.on('end', () => {
      if (res.destroyed) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      let value;
      try { value = json ? JSON.parse(raw) : raw; }
      catch { return send(res, 502, { error: 'The local Strata host returned an invalid response.' }); }
      let payload;
      try { payload = status >= 400 ? studioApiError(value) : studioApiResponse(path, value); }
      catch { return send(res, 502, { error: 'Studio could not read that response safely.' }); }
      const text = JSON.stringify(payload);
      for (const name of ['content-length', 'content-encoding', 'content-md5', 'digest', 'etag', 'last-modified']) delete responseHeaders[name];
      responseHeaders['content-type'] = 'application/json; charset=utf-8';
      responseHeaders['content-length'] = Buffer.byteLength(text);
      responseHeaders['cache-control'] = 'no-store';
      responseHeaders['x-content-type-options'] = 'nosniff';
      res.writeHead(status, responseHeaders);
      res.end(text);
    });
  });
  upstream.on('error', () => {
    if (!res.headersSent) send(res, 502, { error: 'The local Strata host did not answer.' });
    else res.destroy();
  });
  req.on('error', () => upstream.destroy());
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
  if (body !== undefined) {
    upstream.write(body);
    upstream.end();
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    upstream.end();
  } else {
    req.pipe(upstream);
  }
}

export function createStudioGateway({ originPort, port = 0, tunnel = () => null, open = async () => false, now = Date.now, random = randomBytes } = {}) {
  if (!Number.isInteger(originPort) || originPort < 1 || originPort > 65535) throw new Error('A local host port is required.');
  const key = random(32).toString('base64url');
  const sessions = new Map();
  const failures = new Map();
  const sockets = new Set();
  let server = null, listening = false;

  const clean = () => {
    const at = now();
    for (const [token, session] of sessions) if (session.expiresAt <= at) sessions.delete(token);
    for (const [source, attempts] of failures) {
      const recent = attempts.filter(atFailed => at - atFailed < LOGIN_WINDOW_MS);
      if (recent.length) failures.set(source, recent);
      else failures.delete(source);
    }
    while (failures.size > 1024) failures.delete(failures.keys().next().value);
    if (sessions.size > 32) sessions.delete(sessions.keys().next().value);
  };
  const maintenance = setInterval(clean, 60_000);
  maintenance.unref?.();

  const sessionFor = req => {
    clean();
    const values = cookies(req);
    const token = values.get(SESSION_COOKIE) ?? values.get(SECURE_COOKIE);
    const session = token ? sessions.get(token) : null;
    return session && session.expiresAt > now() ? { token, session } : null;
  };
  const localOnly = (req, url) => loopback(req.socket.remoteAddress) && LOCAL_HOSTS.has(url.hostname) && !['cf-ray', 'cf-connecting-ip', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'].some(name => req.headers[name] !== undefined);
  const loginSource = (req, url) => {
    if (LOCAL_HOSTS.has(url.hostname)) return `socket:${req.socket.remoteAddress ?? 'unknown'}`;
    const forwarded = String(req.headers['cf-connecting-ip'] ?? '').trim();
    return /^[0-9a-fA-F:.]{2,64}$/.test(forwarded) ? `remote:${forwarded}` : `socket:${req.socket.remoteAddress ?? 'unknown'}`;
  };
  const expectedOrigin = (req, url) => {
    const forwarded = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
    const scheme = forwarded === 'https' ? 'https' : 'http';
    return { scheme, value: `${scheme}://${req.headers.host}` };
  };
  const sameOrigin = (req, url) => {
    const origin = req.headers.origin;
    if (!origin) return false;
    const expected = expectedOrigin(req, url).value;
    if (origin !== expected) return false;
    const site = req.headers['sec-fetch-site'];
    return !site || site === 'same-origin';
  };

  async function handle(req, res) {
    const url = requestUrl(req);
    if (!url) return badRequest(res);
    const path = url.pathname;
    const requestPath = `${url.pathname}${url.search}`;
    const method = req.method ?? 'GET';
    const secure = expectedOrigin(req, url).scheme === 'https';

    if (path === '/studio/login.css') return send(res, 200, LOGIN_CSS, { 'content-type': 'text/css; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'self'" });
    if (path === '/studio/login.js') return send(res, 200, LOGIN_JS, { 'content-type': 'text/javascript; charset=utf-8', 'content-security-policy': "default-src 'none'; script-src 'self'; connect-src 'self'" });
    if (path === '/studio/login' && method === 'GET') return send(res, 200, loginPage(), { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
    if (path === '/studio/local-key' && method === 'GET') {
      if (!localOnly(req, url)) return error(res, 403, 'The Studio key is available only on the computer running Strata.');
      return json(res, 200, { key });
    }
    if (path === '/studio/login' && method === 'POST') {
      if (!sameOrigin(req, url)) return error(res, 403, 'Open the Studio login page on this same address.');
      clean();
      let body;
      try { body = await readBody(req, 4096); } catch { return error(res, 400, 'Send the Studio key as JSON.'); }
      const source = loginSource(req, url);
      if (!sameSecret(body?.key, key)) {
        const attempts = failures.get(source) ?? [];
        if (attempts.length >= LOGIN_LIMIT) return error(res, 429, 'Too many attempts. Wait five minutes and try again.');
        attempts.push(now());
        failures.set(source, attempts);
        return error(res, 401, 'That Studio key was not accepted.');
      }
      failures.delete(source);
      const token = random(32).toString('base64url');
      sessions.set(token, { expiresAt: now() + SESSION_MS });
      res.setHeader('set-cookie', cookieValue(token, secure));
      return json(res, 200, { ok: true });
    }
    if (path === '/studio/logout' && method === 'POST') {
      if (!sameOrigin(req, url)) return error(res, 403, 'Open Studio on this same address.');
      const current = sessionFor(req);
      if (current) sessions.delete(current.token);
      res.setHeader('set-cookie', cookieValue('', secure) + '; Max-Age=0');
      return json(res, 200, { ok: true });
    }

    const current = sessionFor(req);
    if (!current) {
      if (path.startsWith('/api/')) return error(res, 401, 'Sign in to Studio first.');
      res.writeHead(302, { location: '/studio/login', 'cache-control': 'no-store' });
      return res.end();
    }
    if (!SAFE_METHODS.has(method) && !sameOrigin(req, url)) return error(res, 403, 'Studio controls must be opened from this same address.');

    if (path === '/api/studio' && method === 'GET') return json(res, 200, { enabled: true, url: `http://127.0.0.1:${server.address().port}/`, tunnel: studioTunnelState(tunnel()?.state?.()) ?? { status: 'idle', mode: null, url: null, error: null, installed: false } });
    if (path === '/api/studio/access' && method === 'GET') {
      if (!localOnly(req, url)) return error(res, 403, 'Open Studio on the computer running Strata to copy its key.');
      return json(res, 200, { key });
    }
    if (path === '/api/studio/tunnel' && method === 'POST') {
      try {
        const body = remoteTunnelInput(await readBody(req, 64 * 1024));
        if (!tunnel()) throw new Error('Studio sharing is not available.');
        if (body.action === 'stop') await tunnel().stop();
        else if (body.action === 'prepare') await tunnel().prepare();
        else if (body.action === 'start') await tunnel().start(body);
        else throw new Error('Unknown Studio tunnel action.');
        return json(res, 200, { enabled: true, url: `http://127.0.0.1:${server.address().port}/`, tunnel: studioTunnelState(tunnel().state()) });
      } catch (e) { return error(res, 400, studioDiagnosticText(e.message)); }
    }
    if (path === '/api/app/mode' && method === 'GET') return json(res, 200, { mode: 'studio', reason: 'remote', canQuit: false, appUpdate: 'unavailable' });
    if (path === '/api/tasks' && method === 'GET') return json(res, 200, { tasks: [] });
    if (path === '/api/agent/pending' && method === 'GET') return json(res, 200, { chats: [] });
    if (path.startsWith('/api/')) {
      if (!allowed(path, method)) return error(res, 404, 'That control is not available in Studio.');
      const upstreamPath = studioPath(url);
      if (path === '/api/setup/step' && method === 'POST') {
        let body;
        try { body = studioSetupStepInput(await readBody(req, 64 * 1024)); } catch (e) { return error(res, 400, e.message); }
        return proxy(originPort, req, res, upstreamPath, Buffer.from(JSON.stringify(body)));
      }
      if (path === '/api/native/plan' && method === 'POST') {
        let body;
        try { body = remoteObject(await readBody(req, 1024 * 1024), REMOTE_PLAN_FIELDS); } catch (e) { return error(res, 400, e.message); }
        return proxy(originPort, req, res, upstreamPath, Buffer.from(JSON.stringify(body)));
      }
      if (path === '/api/native/operations' && method === 'POST') {
        let body;
        try { body = await readBody(req, 1024 * 1024); } catch { return error(res, 400, 'The model operation must be JSON.'); }
        if (!REMOTE_OPERATIONS.has(body?.kind)) return error(res, 403, 'That operation is not available in Studio.');
        try { body = { kind: body.kind, args: remoteObject(body.args ?? {}, REMOTE_OPERATION_FIELDS[body.kind]) }; } catch (e) { return error(res, 400, e.message); }
        return proxy(originPort, req, res, upstreamPath, Buffer.from(JSON.stringify(body)));
      }
      if (/^\/api\/native\/models\/[a-z0-9_.-]+\/settings$/.test(path) && method === 'PATCH') {
        let body;
        try { body = await readBody(req, 1024 * 1024); } catch { return error(res, 400, 'Model settings must be JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.hasOwn(body, 'mcp') || Object.hasOwn(body.values ?? {}, 'args')) return error(res, 403, 'Local programs and engine arguments are edited only on the computer running Strata.');
        return proxy(originPort, req, res, upstreamPath, Buffer.from(JSON.stringify(body)));
      }
      if (path === '/api/serving' && method === 'PATCH') {
        let body;
        try { body = await readBody(req, 64 * 1024); } catch { return error(res, 400, 'Serving settings must be JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !REMOTE_SERVING_FIELDS.has(key))) return error(res, 403, 'That serving setting is not available in Studio.');
        return proxy(originPort, req, res, upstreamPath, Buffer.from(JSON.stringify(body)));
      }
      if (path === '/api/shell/prefs' && method === 'POST') {
        let body;
        try { body = await readBody(req, 4096); } catch { return error(res, 400, 'Language settings must be JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'language') || !LANGUAGES.includes(body.language)) return error(res, 400, 'Choose a supported Studio language.');
        return proxy(originPort, req, res, upstreamPath, Buffer.from(JSON.stringify({ language: body.language })));
      }
      return proxy(originPort, req, res, upstreamPath);
    }
    if (method !== 'GET' && method !== 'HEAD') return error(res, 405, 'Method not allowed.');
    return proxy(originPort, req, res, requestPath);
  }

  return {
    get key() { return key; },
    url: () => `http://127.0.0.1:${server?.address()?.port ?? port}/`,
    open: url => open(url || `http://127.0.0.1:${server?.address()?.port ?? port}/`),
    state: () => ({ enabled: true, url: `http://127.0.0.1:${server?.address()?.port ?? port}/`, tunnel: studioTunnelState(tunnel()?.state?.()) }),
    async start() {
      if (listening) return;
      server = http.createServer((req, res) => { void handle(req, res).catch(() => { if (!res.headersSent) send(res, 500, { error: 'Studio could not handle that request.' }); else res.destroy(); }); });
      server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
      server.requestTimeout = 0;
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => { listening = true; server.removeListener('error', reject); resolve(); });
      });
    },
    async stop() {
      clearInterval(maintenance);
      if (!server) return;
      const ref = server; server = null; listening = false; sessions.clear();
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => ref.close(() => resolve()));
    },
  };
}
