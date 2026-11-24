import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isStudioChatId,
  studioApiError,
  studioApiResponse,
  studioChatEnvelope,
  studioChatEvent,
  studioChatFrame,
  studioChatList,
  studioChatSaveResult,
  studioChatSession,
  studioChatTurn,
  studioControlStatus,
  studioEngineFirstRun,
  studioEngineList,
  studioEvent,
  studioNativeJob,
  studioNativeState,
  studioSetupStepInput,
  studioSettings,
  studioTuneEffective,
  studioTunnelState,
  studioUpdateCheck,
} from '../server/studio-data.mjs';

const noPrivatePaths = value => assert.doesNotMatch(JSON.stringify(value), /\/home\/|\/srv\/|C:\\Users\\|STRATA_TOKEN|browser-secret/);

test('Studio setup writes keep guided choices and drop host paths and unknown nested data', () => {
  assert.deepEqual(studioSetupStepInput({
    step: 2,
    flowVersion: 2,
    dismissed: false,
    directory: '/home/alice/private',
    choices: {
      variantId: 'iq2_xs', contextLength: '32k', profile: 'balanced', batch: 2048, batchAuto: true,
      directory: '/home/alice/private', unknown: { token: 'secret' },
      onboarding: {
        step: 2, family: 'qwen', size: 'IQ2_XS', context: 32768, vision: true,
        profile: 'work', installJobId: 'job_1', calibrate: false, manual: true,
        directory: '/home/alice/private', arbitrary: 'drop',
      },
    },
  }), {
    step: 2, flowVersion: 2, dismissed: false,
    choices: {
      variantId: 'iq2_xs', contextLength: '32k', profile: 'balanced', batch: 2048, batchAuto: true,
      onboarding: {
        step: 2, family: 'qwen', size: 'IQ2_XS', context: 32768, vision: true,
        profile: 'work', installJobId: 'job_1', calibrate: false, manual: true,
      },
    },
  });
  assert.deepEqual(studioSetupStepInput({ choices: { onboarding: { installJobId: '', tuneJobId: '' } } }), { choices: { onboarding: { installJobId: '', tuneJobId: '' } } });
  assert.throws(() => studioSetupStepInput({ step: 5 }), /step from 1 to 4/);
  assert.throws(() => studioSetupStepInput({ choices: { profile: 'work' } }), /resource profile/);
  assert.throws(() => studioSetupStepInput({ choices: { onboarding: { profile: 'balanced' } } }), /resource profile/);
  assert.throws(() => studioSetupStepInput({ choices: { onboarding: { installJobId: '../job' } } }), /job is not valid/);
});

test('Studio native state preserves model progress but removes local jobs, tools and host metadata', () => {
  const state = studioNativeState({
    available: true,
    repo: '/home/alice/Strata',
    downloadDirectory: '/home/alice/models',
    engineInfo: { source: '/home/alice/engine' },
    external: [{ pid: 42, command: '/home/alice/engine' }],
    summary: 'Preparing /srv/private/models',
    error: 'Cannot read /home/alice/private/config',
    install: { label: 'Engine /home/alice/engine', log: '/home/alice/install.log', last_lines: ['STRATA_TOKEN=secret'], download: { file: '/home/alice/model.gguf' }, command: '/home/alice/engine' },
    installed: { data_folder: '/home/alice/data', engine: { version: '1' }, models: [{ model: 'iq2_xs', config: 'strata-iq2_xs.json', ready: true }] },
    instances: [{ id: 'one', mcpServers: { files: {} }, mcpTimeoutS: 30, profile: '/home/alice/profile', error: 'Failed /srv/private/model', metrics: { mcp: { tools: 2 }, live: { running: 1 } } }],
    fields: [{ id: 'parallel', group: 'Performance' }, { id: 'mcp_timeout_s', group: 'Tools' }, { id: 'mcp_custom', group: 'Other' }],
    jobs: [
      {
        id: 'install-1', kind: 'install', state: 'running', startedAt: '2026-11-24T00:00:00Z', surface: 'studio',
        summary: 'Downloading /home/alice/model.gguf', details: 'secret details',
        result: {
          summary: 'Preparing /srv/private/model',
          install: {
            label: '/home/alice/model.gguf', step: 'Downloading /srv/private/model', running: true,
            download: { file: '/home/alice/model.gguf', done_gb: 2, total_gb: 10, percent: 20 },
            parts: [{ kind: 'weights', name: '/home/alice/weights', state: 'downloading', done_gb: 2, total_gb: 10 }],
            engine: { label: 'Engine', step: 'Ready', details: '/home/alice/engine' },
            details: 'private install details',
          },
          command: 'secret', rawResult: { token: 'secret' },
        },
        progress: { text: 'Downloading /srv/private/model', minutes_left: 2, percent: 20 },
      },
      { id: 'local-file', kind: 'install-engine-file', state: 'running', result: { path: '/home/alice/engine.zip' } },
      { id: 'local-install', kind: 'install', surface: 'local', state: 'running', summary: 'Downloading /home/alice/private.gguf' },
    ],
  });
  assert.equal(state.repo, undefined);
  assert.equal(state.downloadDirectory, undefined);
  assert.equal(state.engineInfo, undefined);
  assert.equal(state.external, undefined);
  assert.equal(state.install.log, undefined);
  assert.equal(state.install.last_lines, undefined);
  assert.equal(state.install.command, undefined);
  assert.equal(state.install.label, 'Engine [local path]');
  assert.equal(state.install.download.file, '[local path]');
  assert.equal(state.installed.data_folder, undefined);
  assert.deepEqual(state.fields, [{ id: 'parallel', group: 'Performance' }]);
  assert.equal(state.instances[0].mcpServers, undefined);
  assert.equal(state.instances[0].profile, undefined);
  assert.deepEqual(state.instances[0].metrics, { live: { running: 1 } });
  assert.equal(state.jobs.length, 1);
  const job = state.jobs[0];
  assert.equal(job.surface, undefined);
  assert.equal(job.details, undefined);
  assert.equal(job.result.install.download.percent, 20);
  assert.equal(job.result.install.download.file, '[local path]');
  assert.equal(job.result.install.parts[0].name, '[local path]');
  assert.equal(job.result.install.engine.details, undefined);
  assert.equal(job.result.install.details, undefined);
  assert.equal(job.result.command, undefined);
  assert.equal(job.progress.minutes_left, 2);
  noPrivatePaths(state);
});

test('Studio HTTP and SSE expose the same native job after one projection', () => {
  const raw = {
    available: true,
    jobs: [
      { id: 'studio-engine', kind: 'update-engine', state: 'running', surface: 'studio', summary: 'Downloading engine', details: 'private', result: { install: { step: 'Downloading', download: { percent: 25 } } } },
      { id: 'local-engine', kind: 'update-engine', state: 'running', surface: 'local', summary: 'Local engine' },
    ],
  };
  const http = studioApiResponse('/api/native', raw);
  const sse = studioEvent('native', raw);
  assert.deepEqual(http, sse);
  assert.deepEqual(http.jobs.map(job => job.id), ['studio-engine']);
  assert.deepEqual(studioApiResponse('/api/engine/job', { job: raw.jobs[0] }).job, http.jobs[0]);
  assert.equal(studioApiResponse('/api/engine/job', { job: raw.jobs[1] }).job, null);
  assert.equal(http.jobs[0].surface, undefined);
  assert.equal(http.jobs[0].details, undefined);
});

test('Studio settings keep speed-switch env and legacy values while rejecting path-like tuning changes', () => {
  const projected = studioSettings({
    values: { parallel: 2, args: ['--host'], env: { STRATA_TOKEN: 'secret', STRATA_KVA: '1' } },
    speedSwitches: [{ id: 'faster_long_prompts', on: true, env: { STRATA_KVA: '1' }, legacy: { STRATA_OLD_KVA: '0' }, hint: 'Faster cache' }],
    tuned: { applied: true, args: ['--host'], changed: [{ flag: '--kv-resident', was: '32768', now: '65536' }, { flag: '--host', was: '127.0.0.1', now: '0.0.0.0' }, { flag: '--kv', was: '/home/alice/private', now: 'int8' }] },
    hints: { drafting: 'Auto' },
  });
  assert.deepEqual(projected.values, { parallel: 2, env: { STRATA_KVA: '1' } });
  assert.deepEqual(projected.speedSwitches[0].env, { STRATA_KVA: '1' });
  assert.deepEqual(projected.speedSwitches[0].legacy, { STRATA_OLD_KVA: '0' });
  assert.deepEqual(projected.tuned.changed, [{ flag: '--kv-resident', was: '32768', now: '65536' }]);
  assert.deepEqual(studioTuneEffective({ applied: false, changed: [{ flag: '--kv', was: '/home/alice/private', now: 'int8' }] }).changed, []);
});

test('Studio HTTP and event projections remove credentials, local sharing and connector process details', () => {
  const rawTunnel = { status: 'connected', mode: 'domain', url: 'https://strata.example', installed: true, originUrl: 'http://127.0.0.1:8080', connector: { path: '/home/alice/cloudflared', source: '/home/alice/bin', version: '1', label: 'cloudflared', summary: 'Ready' }, external: { kind: 'process', others: [42], message: '/srv/private/process (PID 42)' } };
  const serving = studioApiResponse('/api/serving', {
    running: true, baseUrl: 'http://192.0.2.1:8081/v1', localUrl: 'http://127.0.0.1:8080/v1',
    sharing: { active: true, url: 'http://192.0.2.1:8081/v1' },
    access: { apiKeySet: true, apiKeyHint: 'browser-secret', otherDevices: true, allowOrigin: '*' },
    trustedOrigins: ['https://evil.example'], mcpTools: ['iq2_xs'], apiKey: 'secret', tunnel: rawTunnel,
    requests: [{ id: 'one', error: 'Failed /srv/private/model' }],
  });
  assert.equal(serving.sharing, undefined);
  assert.equal(serving.trustedOrigins, undefined);
  assert.equal(serving.mcpTools, undefined);
  assert.equal(serving.apiKey, undefined);
  assert.equal(serving.tunnel, undefined);
  assert.deepEqual(serving.access, { apiKeySet: true });
  assert.equal(serving.baseUrl, 'http://127.0.0.1:8080/v1');
  assert.equal(serving.requests[0].error, 'Failed [local path]');

  const tunnel = studioTunnelState(rawTunnel);
  assert.equal(tunnel.originUrl, undefined);
  assert.equal(tunnel.connector.path, undefined);
  assert.equal(tunnel.connector.source, undefined);
  assert.equal(tunnel.connector.summary, undefined);
  assert.equal(tunnel.external, undefined);
  assert.equal(studioTunnelState({ ...rawTunnel, error: 'Another process failed (PIDs 42, 43) at /srv/private/process' }).error, 'Another process failed at [local path]');
  const models = studioEvent('models', { disk: { path: '/home/alice/models', modelsDir: '/home/alice/models', usedGb: 1, freeGb: 2 }, engine: { status: 'ok', binary: '/home/alice/engine', port: 1, modelId: 'iq2_xs' } });
  assert.deepEqual(models.disk, { usedGb: 1, freeGb: 2 });
  assert.deepEqual(models.engine, { status: 'ok', port: 1, modelId: 'iq2_xs' });
  const monitor = studioEvent('monitor', { mcp: { tools: 2 }, engine: { pid: 42, command: '/home/aline/engine', binary: '/home/alice/engine', running: true }, requests: [{ id: 'two', error: 'Failed /srv/private/model' }] });
  assert.equal(monitor.mcp, undefined);
  assert.equal(monitor.engine.command, undefined);
  assert.equal(monitor.engine.binary, undefined);
  assert.equal(monitor.engine.pid, undefined);
  assert.equal(monitor.requests[0].error, 'Failed [local path]');
  noPrivatePaths({ serving, tunnel, models, monitor });
});

test('Studio first-run, updates, benchmarks and engine lists expose only safe management facts', () => {
  const firstRun = studioEngineFirstRun({
    status: 'offer', message: 'Download /srv/private/engine', reasons: ['Missing /home/alice/engine'], details: 'Failed /srv/private/feed', freeBytes: 10,
    gpus: [{ name: 'GPU', vramGb: 24, path: '/home/alice/gpu', secret: 'x' }],
    offer: { version: '1', bytes: 100, variant: 'cuda', backend: 'cuda', url: 'https://example.invalid/token' },
    control: { version: '2', bytes: 50, dir: '/home/alice/control' },
  });
  assert.equal(firstRun.gpus[0].path, undefined);
  assert.equal(firstRun.offer.url, undefined);
  assert.equal(firstRun.control.dir, undefined);
  assert.equal(firstRun.message, 'Download [local path]');
  const updates = studioUpdateCheck({
    checkedAt: '2026-11-24T00:00:00Z', private: 'secret',
    strata: { installedVersion: '1', status: 'current', canInstall: false, message: 'Ready', details: '/home/alice/app', installPathWarning: '/home/alice/private' },
    engine: { installedVersion: '2', status: 'current', canInstall: false, message: 'Ready' },
  });
  assert.equal(updates.strata.details, '[local path]');
  assert.equal(updates.strata.installPathWarning, undefined);
  const benchmark = studioApiResponse('/api/native/benchmark', { outputTps: 42, promptTps: 1000, model: '/home/alice/model.gguf', settings: '--host 127.0.0.1 /srv/private/config', raw: { token: 'secret' } });
  assert.equal(benchmark.model, '[local path]');
  assert.equal(benchmark.settings, '--host 127.0.0.1 [local path]');
  assert.equal(benchmark.raw, undefined);
  const engines = studioEngineList({ available: true, total_bytes: 100, families: [{ family: 'qwen', title: 'Qwen', engines: [{ folder: 'one', version: '1', path: '/home/alice/engine', root: '/home/alice', can_use: true, can_delete: true, detail: '/srv/private/engine' }] }] });
  assert.equal(engines.families[0].engines[0].path, undefined);
  assert.equal(engines.families[0].engines[0].root, undefined);
  assert.equal(engines.families[0].engines[0].detail, undefined);
  assert.equal(engines.families[0].engines[0].can_use, false);
  assert.equal(engines.families[0].engines[0].can_delete, false);
  noPrivatePaths({ firstRun, updates, benchmark, engines });
});

test('Studio chat storage accepts only the namespace and keeps plain user and assistant messages', () => {
  assert.equal(isStudioChatId('studio_a'), true);
  for (const id of ['s_host', 'studio_', 'studio_../x', 'studio_a/b', 'studio_ä']) assert.equal(isStudioChatId(id), false, id);
  const session = studioChatSession({
    id: 'studio_one', title: 'Local model', createdAt: '2026-11-24T00:00:00.000Z', updatedAt: '2026-11-24T00:00:01.000Z',
    tokensIn: 12, tokensOut: 7, workspaceId: 'host-work', remoteModel: { connectionId: 'secret' }, agent: true,
    messages: [
      { id: 'm1', role: 'user', content: 'Hello', tools: [{ name: 'shell' }] },
      { id: 'm2', role: 'assistant', content: 'Hi', reasoning: 'Think', artifacts: ['host.txt'], tools: [{ name: 'read' }] },
    ],
  });
  assert.deepEqual(session, {
    id: 'studio_one', title: 'Local model', createdAt: '2026-11-24T00:00:00.000Z', updatedAt: '2026-11-24T00:00:01.000Z', tokensIn: 12, tokensOut: 7,
    messages: [
      { id: 'm1', role: 'user', content: 'Hello' },
      { id: 'm2', role: 'assistant', content: 'Hi', reasoning: 'Think' },
    ],
  });
  assert.throws(() => studioChatSession({ id: 's_host', messages: [] }), /studio_ id/);
  assert.throws(() => studioChatSession({ id: 'studio_one', messages: [{ role: 'tool', content: 'secret' }] }), /user and assistant/);

  const list = studioChatList({ v: 1, chats: [
    { id: 'studio_one', title: 'Mine', createdAt: 'a', updatedAt: 'b', bytes: 50, workspaceId: 'private' },
    { id: 's_host', title: 'Host', workspaceId: 'private' },
  ], damaged: ['s_bad', 'studio_bad'], newer: ['s_next'] });
  assert.deepEqual(list, { v: 1, chats: [{ id: 'studio_one', title: 'Mine', createdAt: 'a', updatedAt: 'b', bytes: 50 }], damaged: ['studio_bad'], newer: [] });
  assert.deepEqual(studioChatEnvelope({ rev: 3, savedAt: 'then', session, workspace: 'private' }), { rev: 3, savedAt: 'then', session });
  assert.deepEqual(studioChatSaveResult({ id: 'studio_one', rev: 4, bytes: 80, conflict: false, path: '/home/alice/private' }), { id: 'studio_one', rev: 4, bytes: 80, conflict: false });
  assert.deepEqual(studioChatEvent({ id: 'studio_one', rev: 5, from: 'window-A', path: '/home/alice/private' }), { id: 'studio_one', rev: 5 });
  assert.equal(studioChatEvent({ id: 's_host', rev: 5 }), null);
});

test('Studio turns discard tools, remote providers, images, workspace, plans and local skills', () => {
  const turn = studioChatTurn({
    sessionId: 'studio_one', message: '  Hello  ', thinking: 'Medium', thinkingBudget: 999999,
    nativeModelId: 'qwen', history: [{ role: 'assistant', content: 'Earlier', tools: ['shell'], artifacts: ['file'] }],
    agent: true, tools: true, useTools: true, remoteModel: { connectionId: 'host-secret', modelId: 'cloud' },
    images: ['data:image/png;base64,private'], imageIds: ['upload'], workspaceId: 'host-work',
    planId: 'plan', goalAction: 'resume', timeSkip: true, skills: ['shell'], selectedSkills: ['shell'], userRules: 'secret',
  });
  assert.deepEqual(turn, {
    sessionId: 'studio_one', message: 'Hello', history: [{ role: 'assistant', content: 'Earlier' }],
    thinking: 'Medium', thinkingBudget: 262144, nativeModelId: 'qwen', agent: false, tools: false, useTools: false,
  });
  assert.throws(() => studioChatTurn({ sessionId: 's_host', message: 'Hello' }), /studio_ id/);
  assert.throws(() => studioChatTurn({ sessionId: 'studio_one', message: '   ' }), /Write a message/);
  assert.throws(() => studioChatTurn({ sessionId: 'studio_one', message: 'Hello', history: {} }), /must be a list/);
  assert.throws(() => studioChatTurn({ sessionId: 'studio_one', message: 'Hello', history: Array(501).fill({ role: 'user', content: 'x' }) }), /too many/);
});

test('Studio frames keep incremental text and safe metrics while dropping host-only frames and diagnostics', () => {
  assert.deepEqual(studioChatFrame({ type: 'beat', secret: 'x' }), { type: 'beat' });
  assert.deepEqual(studioChatFrame({ type: 'delta', text: 'Hello', tools: ['shell'] }), { type: 'delta', text: 'Hello' });
  assert.deepEqual(studioChatFrame({ type: 'reasoning', text: 'Think', requestId: 'private' }), { type: 'reasoning', text: 'Think' });
  assert.deepEqual(studioChatFrame({ type: 'start', model: '/home/alice/model', promptTokens: 10, skills: ['shell'] }), { type: 'start', model: '[local path]' });
  const status = studioChatFrame({ type: 'status', phase: 'answering', seq: 2, code: 'writing', text: 'Failed /srv/private/model', key: '/home/alice/key', values: ['/srv/private/value', 'ok'], tokens: 4, elapsedMs: 20, requestId: 'private' });
  assert.deepEqual(status, { type: 'status', seq: 2, phase: 'answering', code: 'writing', text: 'Failed [local path]', key: '[local path]', values: ['[local path]', 'ok'], tokens: 4, elapsedMs: 20 });
  assert.equal(studioChatFrame({ type: 'status', phase: 'tool', text: 'Running shell' }), null);
  assert.deepEqual(studioChatFrame({ type: 'done', tokensIn: 10, tokensOut: 3, tps: 20, requestId: 'private', tools: ['shell'] }), { type: 'done', tokensIn: 10, tokensOut: 3, tps: 20 });
  assert.deepEqual(studioChatFrame({ type: 'error', message: 'Failed /home/alice/model', code: 'failed', details: 'STRATA_TOKEN=secret' }), { type: 'error', message: 'Failed [local path]', code: 'failed' });
  for (const type of ['tool', 'native-tool', 'notice', 'artifact', 'file', 'media', 'agent', 'helper', 'approval', 'unknown']) assert.equal(studioChatFrame({ type, text: 'secret' }), null, type);
  noPrivatePaths(status);
});

test('Studio control status and errors retain first-run facts without host paths or credentials', () => {
  const status = studioControlStatus({
    packaged: true, anyUsableEngine: false, engineSetup: true,
    engine: { usable: false, notice: 'Missing /home/alice/engine', exe: '/home/alice/engine', shapes: [{ shape: 'qwen', usable: false, version: '1', backend: 'cpu', notice: 'Missing /srv/private/engine', path: '/home/alice/engine' }] },
    shapeEngines: [{ shape: 'inkling', usable: true, version: '1', backend: 'cpu', component: '/home/alice/component' }],
    componentsDir: '/home/alice/components', acquisition: { env: 'SECRET=value' }, control: { dir: '/home/alice/control', python: '/home/alice/python' },
  });
  assert.deepEqual(Object.keys(status), ['packaged', 'engine', 'shapeEngines', 'anyUsableEngine', 'engineSetup']);
  assert.equal(status.engine.exe, undefined);
  assert.equal(status.engine.shapes[0].path, undefined);
  assert.equal(status.shapeEngines[0].component, undefined);
  assert.equal(status.componentsDir, undefined);
  assert.equal(status.engine.shapes[0].notice, 'Missing [local path]');
  assert.deepEqual(studioApiError({ error: 'Failed /srv/private/model', details: 'STRATA_TOKEN=secret' }), { error: 'Failed [local path]' });
  assert.deepEqual(studioNativeJob({ id: 'local', kind: 'calibrate', state: 'running' }), null);
  assert.equal(studioNativeJob({ id: 'local-install', kind: 'install', surface: 'local', state: 'running' }), null);
  const plan = studioApiResponse('/api/native/plan', {
    summary: 'Plan for /srv/private/model', command: '/home/alice/engine',
    plan: { title: 'Qwen', download_gb: 20, disk_short: 'Need space in /srv/private/models', files_complete: true, path: '/home/alice/models' },
    drafting: { choice: 'mtp', needed: true, gb: 1.1, note: 'Uses /srv/private/drafter', path: '/home/alice/drafter' },
  });
  assert.equal(plan.summary, 'Plan for [local path]');
  assert.equal(plan.command, undefined);
  assert.equal(plan.plan.disk_short, 'Need space in [local path]');
  assert.equal(plan.plan.path, undefined);
  assert.equal(plan.drafting.note, 'Uses [local path]');
  assert.equal(plan.drafting.path, undefined);
  const cancelled = studioApiResponse('/api/native/operations/job_1/cancel', { available: true, jobs: [{ id: 'job_1', kind: 'load', surface: 'studio', state: 'cancelled' }], external: { pid: 42 } });
  assert.equal(cancelled.jobs[0].state, 'cancelled');
  assert.equal(cancelled.external, undefined);
  assert.equal(studioTuneEffective({ applied: false, why_not: 'Missing /srv/private/engine' }).why_not, 'Missing [local path]');
  noPrivatePaths({ status, plan, cancelled });
});
