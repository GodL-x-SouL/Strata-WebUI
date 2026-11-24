const PRESET_FIELDS = ['id', 'name', 'active', 'created', 'gain_pct', 'decode_tok_s', 'baseline_decode_tok_s', 'slot'];
const RESULT_FIELDS = ['summary', 'outcome', 'message', 'gain_pct', 'seconds', 'pairs', 'faster_pairs', 'notes', 'code', 'reason_code', 'verdict', 'reason'];
const VALUE_FIELDS = ['gain_pct', 'gain_decode_pct', 'base_tok_s', 'tuned_tok_s', 'noise_pct', 'drift_pct', 'minutes', 'pairs', 'faster_pairs', 'preset_name'];
const JOB_FIELDS = ['id', 'kind', 'guided', 'model', 'family', 'state', 'startedAt', 'summary', 'error', 'result', 'progress', 'step', 'models'];
const REMOTE_JOB_KINDS = new Set(['install', 'load', 'pictures', 'benchmark', 'tune', 'autotune', 'recheck', 'update-engine', 'remove']);
const INSTALL_FIELDS = ['label', 'step', 'phase', 'running', 'exit_code', 'error', 'family', 'model', 'context', 'vision'];
const DOWNLOAD_FIELDS = ['file', 'done_gb', 'total_gb', 'remaining_gb', 'percent'];
const PART_FIELDS = ['kind', 'name', 'state', 'done_gb', 'total_gb', 'files_done', 'files_total'];
const ENGINE_PROGRESS_FIELDS = ['label', 'step', 'phase', 'running', 'exit_code', 'percent', 'done_gb', 'total_gb'];
const OPERATION_RESULT_FIELDS = ['summary', 'outcome', 'message', 'code', 'reason', 'done', 'family', 'model', 'instanceId', 'port', 'apiModelId', 'modelId', 'baseUrl', 'notes'];
const BENCHMARK_FIELDS = ['outputTps', 'promptTps', 'model', 'at', 'settings'];
const ENGINE_FIELDS = ['family', 'folder', 'version', 'backend', 'platform', 'variant', 'bytes', 'signed', 'fits', 'why_not', 'why_code', 'why_args', 'active', 'build_id', 'other_card', 'local', 'newest', 'pinned', 'running', 'can_use', 'can_delete', 'delete_blocked', 'blocked_code'];
const REQUEST_FIELDS = ['instanceId', 'gpuIds', 'id', 'at', 'client', 'endpoint', 'state', 'tokensIn', 'tokensOut', 'cancellable', 'cancelRequested', 'usageSource', 'durationMs', 'model', 'cachedTokens', 'tps', 'promptTps', 'hitRate', 'pcieShare', 'finishReason', 'error'];
const SAFE_CHANGES = new Set([
  '--kv', '--kv-grow', '--kv-resident', '--ple-io', '--expert-cache', '--expert-cache-per-layer',
  '--host-core', '--pool-affinity', '--pool-workers', '--spec', '--spec-min-p', '--mtp', '--batch-mtp',
  '--vram-reserve-mib', '--vram-elastic', '--pcie-frac', '--prompt-cache-tail', '--prompt-cache-spread',
  '--resident-experts', '--resident-cpu-experts', '--mmap-experts', '--trim-stage-weights', '--no-host-worker',
  '--no-pool', '--split-skip-if-fits', '--no-hit-poke', '--prefill', '--hybrid-rows', '--adapt-async',
  '--adapt-every', '--adapt-swaps', '--adapt-decay', '--adapt-min-gain',
]);
const PRIVATE_KEYS = new Set([
  'apiKey', 'api_key', 'args', 'argv', 'binary', 'cmdline', 'command', 'componentsDir', 'config', 'configFile',
  'configPath', 'credentials', 'cwd', 'dataDir', 'dataFolder', 'data_folder', 'data_dir', 'directory', 'downloadDirectory',
  'env', 'environment', 'exe', 'executable', 'fingerprint', 'gguf_dir', 'installDir', 'installRoot', 'install_dir', 'key', 'last_lines', 'log', 'mcp',
  'mcpServers', 'mcpTimeoutS', 'missing_files', 'model_dir', 'model_path', 'models_dir', 'ownGgufDir', 'path', 'profilePath', 'python',
  'rawResult', 'repo', 'root', 'runDataFolder', 'secret', 'strata_folder', 'target', 'token', 'trustedOrigins', 'mcpTools',
]);
const PATH_SECRET = '[local path]';
const WINDOWS_PATH = /(?<![A-Za-z0-9+.-])(?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>|,;)\]}]+/g;
const FILE_URL = /file:\/\/[^\s"'<>|,;)\]}]+/g;
const POSIX_PATH = /(?<![\w:/])\/(?:home|Users|tmp|private|var|mnt|media|opt|root|workspace|app|Applications|Volumes|data|models)(?:\/[^\s"'<>|,;)\]}]*)?/g;
const DIAGNOSTIC_PATH = /(?<![\w:/])\/(?!\/|v1(?:\/|$)|api(?:\/|$)|health(?:$|\s)|metrics(?:$|\s)|mcp(?:$|\s))[^\s"'<>|,;)\]}]+/g;

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const pick = (value, fields) => Object.fromEntries(fields.filter(name => object(value) && Object.hasOwn(value, name)).map(name => [name, value[name]]));

export function studioText(value) {
  if (typeof value !== 'string') return value;
  return value.replace(FILE_URL, PATH_SECRET).replace(WINDOWS_PATH, PATH_SECRET).replace(POSIX_PATH, PATH_SECRET);
}

export function studioDiagnosticText(value) {
  if (typeof value !== 'string') return value;
  return studioText(value).replace(DIAGNOSTIC_PATH, PATH_SECRET).replace(/\s*\(PIDs?(?:\s+\d+(?:\s*,\s*\d+)*)?\)/gi, '');
}

function labelText(value) {
  if (typeof value !== 'string' || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return studioText(value);
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value) ? PATH_SECRET : studioText(value);
}

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (!object(value)) return studioText(value);
  return Object.fromEntries(Object.entries(value).filter(([name]) => !PRIVATE_KEYS.has(name)).map(([name, child]) => [name, clean(child)]));
}

function diagnostic(value) {
  if (Array.isArray(value)) return value.map(diagnostic);
  if (!object(value)) return studioDiagnosticText(value);
  return Object.fromEntries(Object.entries(value).filter(([name]) => !PRIVATE_KEYS.has(name)).map(([name, child]) => [name, diagnostic(child)]));
}

function answers(value) {
  if (!object(value)) return clean(value);
  return clean(pick(value, ['class', 'fields', 'default_repeatable']));
}

function preset(value) {
  if (!object(value)) return null;
  const result = clean(pick(value, PRESET_FIELDS));
  if (Object.hasOwn(value, 'answers')) result.answers = answers(value.answers);
  if (object(value.recheck)) result.recheck = { ...clean(pick(value.recheck, ['last_ok'])), ...(object(value.recheck.last_result) ? { last_result: diagnostic(pick(value.recheck.last_result, ['verdict', 'reason'])) } : {}) };
  return result;
}

export function studioTuneStatus(value) {
  if (!object(value)) return clean(value);
  return {
    ...clean(pick(value, ['ok', 'slot', 'suggested_name', 'state', 'can_undo', 'switched_off'])),
    reasons: Array.isArray(value.reasons) ? value.reasons.map(studioDiagnosticText) : [],
    active: preset(value.active),
    last_active: preset(value.last_active),
    presets: Array.isArray(value.presets) ? value.presets.map(preset) : [],
  };
}

export function studioTuneEffective(value) {
  if (!object(value)) return clean(value);
  const result = {
    ...clean(pick(value, ['applied', 'why_not'])),
    preset: preset(value.preset),
    changed: Array.isArray(value.changed) ? value.changed.filter(change => object(change) && SAFE_CHANGES.has(change.flag)).map(change => {
      const raw = pick(change, ['flag', 'was', 'now']);
      return studioDiagnosticText(JSON.stringify(raw)) === JSON.stringify(raw) ? clean(raw) : null;
    }).filter(Boolean) : [],
  };
  if (Object.hasOwn(value, 'why_not')) result.why_not = studioDiagnosticText(value.why_not);
  return result;
}

export function studioTuneList(value) {
  if (!object(value)) return clean(value);
  return { ...clean(pick(value, ['ok'])), presets: Array.isArray(value.presets) ? value.presets.map(preset) : [] };
}

export function studioTuneResult(value) {
  if (!object(value)) return clean(value);
  const result = diagnostic(pick(value, RESULT_FIELDS));
  if (Object.hasOwn(value, 'answers')) result.answers = answers(value.answers);
  if (object(value.preset)) result.preset = clean(pick(value.preset, ['id', 'name']));
  if (object(value.base)) result.base = clean(pick(value.base, ['decode_tok_s']));
  if (object(value.chosen)) result.chosen = clean(pick(value.chosen, ['decode_tok_s']));
  if (object(value.values)) result.values = clean(pick(value.values, VALUE_FIELDS));
  return result;
}

export function studioTunePayload(value) {
  if (!object(value)) return clean(value);
  if (Array.isArray(value.presets)) return 'active' in value || 'suggested_name' in value ? studioTuneStatus(value) : studioTuneList(value);
  if ('applied' in value || 'changed' in value) return studioTuneEffective(value);
  return studioTuneResult(value);
}

export function studioBenchmarkReport(value) {
  if (!object(value)) return clean(value);
  const result = clean(pick(value, BENCHMARK_FIELDS));
  if (Object.hasOwn(value, 'model')) result.model = labelText(value.model);
  if (Object.hasOwn(value, 'settings')) result.settings = studioDiagnosticText(value.settings);
  return result;
}

function studioInstallProgress(value) {
  if (!object(value)) return clean(value);
  const install = clean(pick(value, INSTALL_FIELDS));
  for (const field of ['label', 'step', 'error']) if (typeof install[field] === 'string') install[field] = studioDiagnosticText(install[field]);
  if (typeof install.phase === 'string') install.phase = labelText(value.phase);
  if (object(value.download)) {
    install.download = clean(pick(value.download, DOWNLOAD_FIELDS));
    if (Object.hasOwn(install.download, 'file')) install.download.file = labelText(value.download.file);
  }
  if (Array.isArray(value.parts)) install.parts = value.parts.filter(object).map(part => {
    const safe = clean(pick(part, PART_FIELDS));
    if (Object.hasOwn(safe, 'name')) safe.name = labelText(part.name);
    return safe;
  });
  if (object(value.engine)) {
    install.engine = clean(pick(value.engine, ENGINE_PROGRESS_FIELDS));
    for (const field of ['label', 'step']) if (typeof install.engine[field] === 'string') install.engine[field] = studioDiagnosticText(install.engine[field]);
  }
  return install;
}

export function studioOperationResult(value) {
  if (!object(value)) return clean(value);
  const result = diagnostic(pick(value, OPERATION_RESULT_FIELDS));
  for (const field of ['model', 'modelId', 'apiModelId']) if (typeof result[field] === 'string') result[field] = labelText(value[field]);
  if (object(value.install)) result.install = studioInstallProgress(value.install);
  return result;
}

export function studioNativeJob(value) {
  if (!object(value)) return clean(value);
  const result = clean(pick(value, JOB_FIELDS));
  if (!REMOTE_JOB_KINDS.has(result.kind) || value.surface !== 'studio') return null;
  if (Object.hasOwn(value, 'summary')) result.summary = studioDiagnosticText(value.summary);
  if (Object.hasOwn(value, 'error')) result.error = studioDiagnosticText(value.error);
  if (['tune', 'autotune', 'recheck'].includes(result.kind)) result.result = studioTuneResult(value.result);
  else if (result.kind === 'benchmark') result.result = studioBenchmarkReport(value.result);
  else result.result = studioOperationResult(value.result);
  if (object(value.progress)) {
    result.progress = clean(pick(value.progress, ['state', 'stage', 'text', 'minutes_left', 'runs_done', 'runs_planned', 'elapsed_s', 'message', 'percent']));
    if (typeof result.progress.text === 'string') result.progress.text = studioDiagnosticText(result.progress.text);
    if (typeof result.progress.message === 'string') result.progress.message = studioDiagnosticText(result.progress.message);
  }
  return result;
}

export function studioNativeState(value) {
  const result = clean(value);
  if (!object(result)) return result;
  delete result.engineInfo;
  delete result.external;
  if (Object.hasOwn(value, 'summary')) result.summary = studioDiagnosticText(value.summary);
  if (Object.hasOwn(value, 'error')) result.error = studioDiagnosticText(value.error);
  if (Object.hasOwn(value, 'install')) result.install = studioInstallProgress(value.install);
  if (object(value.hardware)) result.hardware = studioHardware(value.hardware);
  if (Array.isArray(value.instances)) result.instances = value.instances.map(instance => {
    if (!object(instance)) return clean(instance);
    const safe = clean(instance);
    delete safe.mcpServers;
    delete safe.mcpTimeoutS;
    delete safe.profile;
    if (Object.hasOwn(instance, 'error')) safe.error = studioDiagnosticText(instance.error);
    if (Object.hasOwn(instance, 'picturesNote')) safe.picturesNote = studioDiagnosticText(instance.picturesNote);
    if (object(instance.metrics)) { safe.metrics = diagnostic(instance.metrics); delete safe.metrics.mcp; }
    return safe;
  });
  if (Array.isArray(value.jobs)) result.jobs = value.jobs.map(studioNativeJob).filter(Boolean);
  if (Array.isArray(result.fields)) result.fields = result.fields.filter(field => object(field) && field.group !== 'Tools' && !String(field.id ?? '').startsWith('mcp_'));
  return result;
}

export function studioControlStatus(value) {
  if (!object(value)) return clean(value);
  const engine = object(value.engine) ? {
    usable: value.engine.usable === true,
    ...(Object.hasOwn(value.engine, 'notice') ? { notice: studioDiagnosticText(value.engine.notice) } : {}),
    ...(Object.hasOwn(value.engine, 'wrongMake') ? { wrongMake: value.engine.wrongMake === true } : {}),
    ...(Object.hasOwn(value.engine, 'version') ? { version: studioText(value.engine.version) } : {}),
    shapes: Array.isArray(value.engine.shapes) ? value.engine.shapes.map(shape => {
      if (!object(shape)) return null;
      const safe = clean(pick(shape, ['shape', 'usable', 'version', 'backend', 'notice']));
      if (Object.hasOwn(shape, 'notice')) safe.notice = studioDiagnosticText(shape.notice);
      return safe;
    }).filter(Boolean) : [],
  } : null;
  return {
    packaged: value.packaged === true,
    engine,
    shapeEngines: Array.isArray(value.shapeEngines) ? value.shapeEngines.map(shape => object(shape) ? clean(pick(shape, ['shape', 'usable', 'version', 'backend'])) : null).filter(Boolean) : [],
    anyUsableEngine: value.anyUsableEngine === true,
    engineSetup: value.engineSetup === true,
  };
}

export function studioHardware(value) {
  const result = clean(value);
  if (!object(result)) return result;
  if (object(result.host)) result.host = pick(result.host, ['platform', 'arch', 'app']);
  if (object(result.disk)) result.disk = pick(result.disk, ['totalGb', 'freeGb']);
  if (Array.isArray(value.checks)) result.checks = value.checks.map(check => {
    if (!object(check)) return clean(check);
    const safe = clean(check);
    if (Object.hasOwn(check, 'detail')) safe.detail = studioDiagnosticText(check.detail);
    return safe;
  });
  return result;
}

export function studioEngineFirstRun(value) {
  if (!object(value)) return clean(value);
  const result = clean(pick(value, ['status', 'driver', 'message', 'reasons', 'details', 'freeBytes']));
  for (const field of ['message', 'details']) if (typeof result[field] === 'string') result[field] = studioDiagnosticText(result[field]);
  if (Array.isArray(value.reasons)) result.reasons = value.reasons.map(studioDiagnosticText);
  if (Array.isArray(value.gpus)) result.gpus = value.gpus.filter(object).map(gpu => clean(pick(gpu, ['name', 'vramGb', 'arch', 'uma', 'integrated', 'unified_gb', 'usable'])));
  if (object(value.offer)) result.offer = clean(pick(value.offer, ['version', 'bytes', 'variant', 'backend']));
  if (object(value.control)) result.control = clean(pick(value.control, ['version', 'bytes']));
  return result;
}

export function studioUpdateCheck(value) {
  if (!object(value)) return clean(value);
  const update = item => {
    if (!object(item)) return clean(item);
    const result = clean(pick(item, ['installedVersion', 'status', 'latestVersion', 'releaseUrl', 'canInstall', 'message', 'details']));
    for (const field of ['message', 'details']) if (typeof result[field] === 'string') result[field] = studioDiagnosticText(result[field]);
    return result;
  };
  return { checkedAt: clean(value.checkedAt), strata: update(value.strata), engine: update(value.engine) };
}

export function studioApiError(value) {
  const message = object(value) ? value.error ?? value.message : value;
  return { error: studioDiagnosticText(String(message ?? 'The request could not be completed.').slice(0, 2000)) };
}

const SETUP_CHOICE_FIELDS = ['variantId', 'contextLength', 'profile', 'batch', 'batchAuto'];
const ONBOARDING_FIELDS = ['step', 'family', 'size', 'context', 'vision', 'profile', 'installJobId', 'tuneJobId', 'calibrate', 'manual'];
const SPEED_SWITCH_FIELDS = ['id', 'label', 'group', 'hint', 'default', 'on', 'env', 'legacy', 'words', 'choices', 'choiceNote'];

function setupText(value, max = 100) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

function setupFlag(target, source, name) {
  if (!Object.hasOwn(source, name)) return;
  if (typeof source[name] !== 'boolean') throw new Error('Setup choices must use true or false.');
  target[name] = source[name];
}

export function studioSetupStepInput(value) {
  if (!object(value)) throw new Error('Setup progress must be a JSON object.');
  const result = {};
  if (Object.hasOwn(value, 'step')) {
    if (!Number.isInteger(value.step) || value.step < 1 || value.step > 4) throw new Error('Choose a setup step from 1 to 4.');
    result.step = value.step;
  }
  if (Object.hasOwn(value, 'flowVersion') && value.flowVersion !== 2) throw new Error('This setup flow is out of date. Reload Studio.');
  if (Object.hasOwn(value, 'flowVersion')) result.flowVersion = 2;
  setupFlag(result, value, 'dismissed');
  if (!Object.hasOwn(value, 'choices')) return result;
  if (!object(value.choices)) throw new Error('Setup choices must be a JSON object.');
  const choices = {};
  for (const name of SETUP_CHOICE_FIELDS) if (Object.hasOwn(value.choices, name)) choices[name] = value.choices[name];
  if (Object.hasOwn(value.choices, 'variantId') && !setupText(choices.variantId)) throw new Error('Choose a valid model variant.');
  if (Object.hasOwn(value.choices, 'contextLength') && (choices.contextLength !== 'recommended' && !/^\d{1,3}k$/.test(String(choices.contextLength)))) throw new Error('Choose a supported context length.');
  if (Object.hasOwn(value.choices, 'profile') && !['agentic', 'balanced', 'performance'].includes(choices.profile)) throw new Error('Choose a supported resource profile.');
  if (Object.hasOwn(value.choices, 'batch') && (!Number.isInteger(choices.batch) || choices.batch < 1 || choices.batch > 4096)) throw new Error('Choose a valid batch size.');
  setupFlag(choices, value.choices, 'batchAuto');
  if (Object.hasOwn(value.choices, 'onboarding')) {
    if (!object(value.choices.onboarding)) throw new Error('Guided setup choices must be a JSON object.');
    const source = value.choices.onboarding, onboarding = {};
    if (Object.hasOwn(source, 'step')) {
      if (!Number.isInteger(source.step) || source.step < 1 || source.step > 4) throw new Error('Choose a guided setup step from 1 to 4.');
      onboarding.step = source.step;
    }
    for (const name of ['family', 'size']) if (Object.hasOwn(source, name)) {
      if (!setupText(source[name])) throw new Error('Choose a valid model choice.');
      onboarding[name] = source[name];
    }
    if (Object.hasOwn(source, 'context') && (!Number.isInteger(source.context) || source.context < 1024 || source.context > 1048576)) throw new Error('Choose a supported context length.');
    if (Object.hasOwn(source, 'context')) onboarding.context = source.context;
    for (const name of ['vision', 'calibrate', 'manual']) setupFlag(onboarding, source, name);
    if (Object.hasOwn(source, 'profile') && !['work', 'performance'].includes(source.profile)) throw new Error('Choose a supported resource profile.');
    if (Object.hasOwn(source, 'profile')) onboarding.profile = source.profile;
    for (const name of ['installJobId', 'tuneJobId']) if (Object.hasOwn(source, name)) {
      if (source[name] === '') { onboarding[name] = ''; continue; }
      if (!setupText(source[name], 64) || !/^[A-Za-z0-9_-]+$/.test(source[name])) throw new Error('That setup job is not valid.');
      onboarding[name] = source[name];
    }
    choices.onboarding = onboarding;
  }
  result.choices = choices;
  return result;
}

export function studioSetupState(value) {
  if (!object(value)) return clean(value);
  const result = clean(pick(value, ['complete', 'dismissed', 'step', 'flowVersion', 'completedAt', 'history', 'choices', 'app']));
  if (Array.isArray(value.history)) result.history = value.history.filter(object).map(item => clean(pick(item, ['step', 'at'])));
  if (object(value.app)) result.app = clean(pick(value.app, ['version', 'modelsDirNotice']));
  if (object(value.choices)) {
    const choices = clean(pick(value.choices, SETUP_CHOICE_FIELDS));
    if (object(value.choices.onboarding)) choices.onboarding = clean(pick(value.choices.onboarding, ONBOARDING_FIELDS));
    result.choices = choices;
  }
  return result;
}

export function studioModelLibrary(value) {
  const result = clean(value);
  if (!object(result)) return result;
  if (object(result.disk)) result.disk = pick(result.disk, ['usedGb', 'freeGb']);
  if (object(result.engine)) result.engine = pick(result.engine, ['status', 'port', 'modelId']);
  return result;
}

export function studioTunnelState(value) {
  if (!object(value)) return null;
  const result = clean(pick(value, ['status', 'mode', 'url', 'error', 'warning', 'installed']));
  if (Object.hasOwn(value, 'error')) result.error = studioDiagnosticText(value.error);
  if (Object.hasOwn(value, 'warning')) result.warning = studioDiagnosticText(value.warning);
  if (object(value.connector)) result.connector = clean(pick(value.connector, ['version', 'label']));
  return result;
}

function studioRequest(value) {
  if (!object(value)) return null;
  const result = diagnostic(pick(value, REQUEST_FIELDS));
  if (Object.hasOwn(value, 'model')) result.model = labelText(value.model);
  return result;
}

export function studioServingState(value) {
  if (!object(value)) return clean(value);
  const result = clean(pick(value, ['revision', 'running', 'localUrl', 'port', 'endpoints', 'access', 'stats', 'requests', 'pauseServing']));
  if (Object.hasOwn(value, 'localUrl')) result.baseUrl = value.localUrl;
  if (Array.isArray(value.requests)) result.requests = value.requests.map(studioRequest).filter(Boolean);
  if (object(value.access)) result.access = clean(pick(value.access, ['apiKeySet']));
  return result;
}

export function studioMonitorState(value) {
  const result = clean(value);
  if (!object(result)) return result;
  delete result.mcp;
  if (Object.hasOwn(value, 'phaseLabel')) result.phaseLabel = studioDiagnosticText(value.phaseLabel);
  if (Array.isArray(value.requests)) result.requests = value.requests.map(studioRequest).filter(Boolean);
  if (object(value.engine)) result.engine = clean(pick(value.engine, ['status', 'running', 'port', 'modelId', 'metricsSource', 'startedAt', 'logCount']));
  if (object(result.conversationCache) && Object.hasOwn(value.conversationCache, 'lastEvent')) result.conversationCache.lastEvent = studioDiagnosticText(value.conversationCache.lastEvent);
  return result;
}

export function studioEngineList(value) {
  if (!object(value)) return clean(value);
  const result = clean(pick(value, ['available', 'total_bytes', 'serving', 'families']));
  if (Array.isArray(value.families)) result.families = value.families.filter(object).map(group => {
    const safe = clean(pick(group, ['family', 'shape', 'title', 'engines']));
    if (Array.isArray(group.engines)) safe.engines = group.engines.filter(object).map(engine => {
      const row = clean(pick(engine, ENGINE_FIELDS));
      for (const field of ['why_not', 'delete_blocked']) if (typeof row[field] === 'string') row[field] = studioDiagnosticText(row[field]);
      row.can_use = false;
      row.can_delete = false;
      return row;
    });
    return safe;
  });
  return result;
}

function speedSwitchEnvironment(value) {
  const allowed = new Map();
  const add = env => {
    if (!object(env)) return;
    for (const [name, text] of Object.entries(env)) {
      if (!/^STRATA_[A-Z0-9_]+$/.test(name) || typeof text !== 'string') continue;
      allowed.set(name, allowed.get(name) ?? new Set());
      allowed.get(name).add(text);
    }
  };
  for (const row of Array.isArray(value?.speedSwitches) ? value.speedSwitches.filter(object) : []) {
    add(row.env);
    add(row.legacy);
    if (object(row.env) && Array.isArray(row.choices)) for (const choice of row.choices) {
      if (!Array.isArray(choice) || typeof choice[0] !== 'string') continue;
      const name = Object.keys(row.env)[0];
      if (name && allowed.has(name)) allowed.get(name).add(choice[0]);
    }
  }
  return env => object(env) ? Object.fromEntries(Object.entries(env).filter(([name, text]) => allowed.get(name)?.has(text))) : {};
}

export function studioInstallPlan(value) {
  if (!object(value)) return clean(value);
  const result = diagnostic(pick(value, ['summary']));
  if (object(value.plan)) {
    result.plan = clean(pick(value.plan, ['title', 'download_gb', 'disk_short', 'files_complete', 'partly_downloaded', 'download_left_gb']));
    for (const field of ['title', 'disk_short']) if (Object.hasOwn(value.plan, field)) result.plan[field] = studioDiagnosticText(value.plan[field]);
  }
  if (object(value.drafting)) {
    result.drafting = clean(pick(value.drafting, ['choice', 'needed', 'gb', 'note']));
    if (Object.hasOwn(value.drafting, 'note')) result.drafting.note = studioDiagnosticText(value.drafting.note);
  }
  return result;
}

export function studioSettings(value) {
  if (!object(value)) return clean(value);
  const safeEnv = speedSwitchEnvironment(value);
  const result = clean(pick(value, ['values', 'tuned', 'hints', 'speedSwitches']));
  if (Object.hasOwn(value, 'values')) {
    result.values = clean(value.values);
    if (object(value.values.env)) result.values.env = safeEnv(value.values.env);
  }
  if (Object.hasOwn(value, 'tuned')) result.tuned = value.tuned ? studioTuneEffective(value.tuned) : null;
  if (Array.isArray(value.speedSwitches)) result.speedSwitches = value.speedSwitches.filter(object).map(row => {
    const safe = clean(pick(row, SPEED_SWITCH_FIELDS));
    if (object(row.env)) safe.env = safeEnv(row.env);
    if (object(row.legacy)) safe.legacy = safeEnv(row.legacy);
    for (const field of ['label', 'hint', 'choiceNote']) if (Object.hasOwn(row, field)) safe[field] = studioDiagnosticText(row[field]);
    return safe;
  });
  return result;
}

export const STUDIO_CHAT_PREFIX = 'studio_';
const STUDIO_CHAT_ID = /^studio_[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/;
const PLAIN_STATUS_PHASES = new Set(['starting', 'waiting', 'thinking', 'answering', 'idle']);
const CHAT_NUMBER_FIELDS = ['tokensIn', 'tokensOut', 'cachedTokens', 'tps', 'promptTps', 'hitRate', 'pcieShare', 'durationMs', 'ttftMs', 'contextTokens', 'tokens'];

export function isStudioChatId(value) {
  return typeof value === 'string' && STUDIO_CHAT_ID.test(value);
}

function chatString(value, fallback = '', max = 4_000_000) {
  if (typeof value !== 'string') return fallback;
  return value.slice(0, max);
}

function chatNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function chatMessage(value) {
  if (!object(value) || !['user', 'assistant'].includes(value.role)) throw new Error('Studio chats may contain only user and assistant messages.');
  const message = { role: value.role, content: chatString(value.content) };
  if (typeof value.id === 'string') message.id = value.id.slice(0, 128);
  if (typeof value.reasoning === 'string') message.reasoning = value.reasoning;
  if (typeof value.error === 'string') message.error = value.error;
  return message;
}

export function studioChatSession(value) {
  if (!object(value) || !isStudioChatId(value.id)) throw new Error('Studio chats need a studio_ id.');
  if (!Array.isArray(value.messages)) throw new Error('Studio chats need messages.');
  return {
    id: value.id,
    title: chatString(value.title, 'Studio chat', 200),
    createdAt: chatString(value.createdAt, new Date().toISOString(), 40),
    updatedAt: chatString(value.updatedAt, new Date().toISOString(), 40),
    messages: value.messages.map(chatMessage),
    tokensIn: chatNumber(value.tokensIn),
    tokensOut: chatNumber(value.tokensOut),
  };
}

export function studioChatList(value) {
  if (!object(value)) throw new Error('The host did not return a chat list.');
  return {
    v: 1,
    chats: Array.isArray(value.chats) ? value.chats.filter(entry => object(entry) && isStudioChatId(entry.id)).map(entry => clean(pick(entry, ['id', 'title', 'createdAt', 'updatedAt', 'bytes']))) : [],
    damaged: Array.isArray(value.damaged) ? value.damaged.filter(isStudioChatId) : [],
    newer: Array.isArray(value.newer) ? value.newer.filter(isStudioChatId) : [],
  };
}

export function studioChatEnvelope(value) {
  if (!object(value) || !object(value.session)) throw new Error('The host did not return a Studio chat.');
  return {
    rev: chatNumber(value.rev),
    savedAt: chatString(value.savedAt, new Date().toISOString(), 40),
    session: studioChatSession(value.session),
  };
}

export function studioChatSaveResult(value) {
  if (!object(value) || !isStudioChatId(value.id)) throw new Error('The host did not save the Studio chat.');
  return { id: value.id, rev: chatNumber(value.rev), bytes: chatNumber(value.bytes), conflict: value.conflict === true };
}

export function studioChatEvent(value) {
  if (!object(value) || !isStudioChatId(value.id)) return null;
  const event = { id: value.id };
  if (Object.hasOwn(value, 'rev')) event.rev = chatNumber(value.rev);
  if (Object.hasOwn(value, 'deleted')) event.deleted = value.deleted === true;
  return event;
}

export function studioChatTurn(value) {
  if (!object(value) || !isStudioChatId(value.sessionId)) throw new Error('Studio chats need a studio_ id.');
  const message = chatString(value.message, '', 1_000_000).trim();
  if (!message) throw new Error('Write a message first.');
  if (value.history !== undefined && !Array.isArray(value.history)) throw new Error('Studio chat history must be a list.');
  if ((value.history?.length ?? 0) > 500) throw new Error('This Studio chat has too many earlier messages.');
  const history = (value.history ?? []).map(chatMessage).map(({ role, content }) => ({ role, content }));
  return {
    sessionId: value.sessionId,
    message,
    history,
    thinking: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value.thinking) ? value.thinking : 'Medium',
    thinkingBudget: Number.isInteger(value.thinkingBudget) && value.thinkingBudget > 0 ? Math.min(value.thinkingBudget, 262144) : 0,
    ...(typeof value.nativeModelId === 'string' && value.nativeModelId.length > 0 && value.nativeModelId.length <= 128 ? { nativeModelId: value.nativeModelId } : {}),
    agent: false,
    tools: false,
    useTools: false,
  };
}

export function studioChatFrame(value) {
  if (!object(value)) return null;
  if (value.type === 'beat') return { type: 'beat' };
  if (value.type === 'delta' || value.type === 'reasoning') return { type: value.type, text: chatString(value.text) };
  if (value.type === 'start') return { type: 'start', model: typeof value.model === 'string' ? studioText(value.model) : '' };
  if (value.type === 'status' && PLAIN_STATUS_PHASES.has(value.phase)) return {
    type: 'status',
    seq: chatNumber(value.seq),
    phase: value.phase,
    code: typeof value.code === 'string' ? value.code.slice(0, 80) : '',
    text: studioDiagnosticText(chatString(value.text, '', 2000)),
    ...(typeof value.key === 'string' ? { key: studioDiagnosticText(value.key.slice(0, 2000)), values: Array.isArray(value.values) ? value.values.slice(0, 10).map(item => studioDiagnosticText(String(item)).slice(0, 500)) : [] } : {}),
    ...(typeof value.tokens === 'number' ? { tokens: chatNumber(value.tokens) } : {}),
    elapsedMs: chatNumber(value.elapsedMs),
  };
  if (value.type === 'stats' || value.type === 'done') {
    const frame = { type: value.type };
    for (const field of CHAT_NUMBER_FIELDS) if (typeof value[field] === 'number' && Number.isFinite(value[field])) frame[field] = value[field];
    for (const field of ['source', 'usageSource', 'finishReason']) if (typeof value[field] === 'string') frame[field] = value[field].slice(0, 80);
    return frame;
  }
  if (value.type === 'error') return {
    type: 'error',
    message: studioDiagnosticText(chatString(value.message, 'The model could not answer.', 2000)),
    ...(typeof value.code === 'string' ? { code: value.code.slice(0, 80) } : {}),
  };
  return null;
}

function tuneResponse(path, value) {
  if (path === '/api/native/tune/status') return studioTuneStatus(value);
  if (path === '/api/native/tune/effective') return studioTuneEffective(value);
  if (path === '/api/native/tune/presets' || path === '/api/native/tune/off' || path === '/api/native/tune/undo' || /^\/api\/native\/tune\/presets\/[^/]+\/(apply|rename|delete|undo)$/.test(path)) return studioTunePayload(value);
  return null;
}

export function studioApiResponse(path, value) {
  const route = String(path ?? '').split('?')[0];
  const tuned = tuneResponse(route, value);
  if (tuned !== null) return tuned;
  if (route === '/api/control/status') return studioControlStatus(value);
  if (route === '/api/hardware') return studioHardware(value);
  if (route === '/api/setup' || route === '/api/setup/step' || route === '/api/setup/complete') return studioSetupState(value);
  if (route === '/api/models') return studioModelLibrary(value);
  if (route === '/api/serving' || /^\/api\/serving\/requests\/[^/]+\/cancel$/.test(route)) return studioServingState(value);
  if (route === '/api/monitor') return studioMonitorState(value);
  if (route === '/api/engines') return studioEngineList(value);
  if (route === '/api/engine/first-run') return studioEngineFirstRun(value);
  if (route === '/api/updates/check') return studioUpdateCheck(value);
  if (route === '/api/engine/job') return object(value) ? { job: studioNativeJob(value.job) } : clean(value);
  if (route === '/api/native/benchmark') return studioBenchmarkReport(value);
  if (route === '/api/native/plan') return studioInstallPlan(value);
  if (route === '/api/native' || route === '/api/native/engine-restart/dismiss' || /^\/api\/native\/operations\/[^/]+\/cancel$/.test(route)) return studioNativeState(value);
  if (/^\/api\/native\/models\/[^/]+\/settings$/.test(route)) return studioSettings(value);
  if (route === '/api/native/operations') return studioNativeJob(value);
  if (/^\/api\/native\/instances\/[^/]+\/(unload|default)$/.test(route)) return studioNativeState(value);
  if (route === '/api/chats') return studioChatList(value);
  if (/^\/api\/chats\/[^/]+$/.test(route)) return studioChatEnvelope(value);
  return clean(value);
}

export function studioEvent(event, payload) {
  if (event === 'chats') return studioChatEvent(payload);
  if (event === 'native') return studioNativeState(payload);
  if (event === 'models') return studioModelLibrary(payload);
  if (event === 'serving') return studioServingState(payload);
  if (event === 'setup') return studioSetupState(payload);
  if (event === 'monitor') return studioMonitorState(payload);
  return clean(payload);
}
