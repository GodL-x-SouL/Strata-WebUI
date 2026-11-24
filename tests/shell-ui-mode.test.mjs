// #5072 / #4721: a link in an answer opened nothing in the Windows and macOS app. The page hands a link to the host only when the host
// says it runs in the app window (src/lib/open-external.ts); otherwise it calls window.open, which the app window ignores. The Linux shell
// (supervisor.rs) sets STRATA_UI_MODE for its host; the Windows/macOS start (main.rs start_host) did not, so /api/app/mode answered
// mode: null there (the reporter's live check on 0.2.13).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAppUi } from '../server/app-ui.mjs';

const read = p => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

function fn(source, name) {
  const at = source.indexOf(`fn ${name}(`);
  assert.ok(at >= 0, `fn ${name} in main.rs`);
  const next = source.indexOf('\nfn ', at + 1), nextCfg = source.indexOf('\n#[cfg', at + 1);
  return source.slice(at, Math.min(...[next, nextCfg].filter(i => i > 0)));
}

test('the Windows and macOS app tells the host it shows the page in the app window', () => {
  const start = fn(read('../../desktop/src-tauri/src/main.rs'), 'start_host');
  assert.match(start, /let mut cmd = host_command\(/);
  assert.match(start, /cmd\.env\("STRATA_UI_MODE", "window"\)/, 'start_host sets the mode the page reads at /api/app/mode');
});

test('the Linux shell still sets the mode it starts in and enables the Studio gateway only on request', () => {
  const shell = read('../../desktop/src-tauri/src/supervisor.rs');
  assert.match(shell, /cmd\.env\("STRATA_UI_MODE", if opts\.browser \{ "browser" \} else \{ "window" \}\)/);
  assert.match(shell, /if opts\.studio \{ cmd\.env\("STRATA_STUDIO", "1"\); \}/);
  assert.match(shell, /"--studio" => \{ o\.studio = true; o\.browser = true; \}/);
  assert.match(shell, /if studio && s\.mode != "studio"/);
});

test('in window mode the page sends links to the host; with no mode it has nothing to hand them to', () => {
  assert.equal(createAppUi({ env: { STRATA_UI_MODE: 'window' }, createUpdater: () => null }).state().mode, 'window');
  assert.equal(createAppUi({ env: {}, createUpdater: () => null }).state().mode, null);
  const opener = read('../src/lib/open-external.ts');
  assert.match(opener, /if \(mode\.mode === 'window'\) \{\s*try \{ await d\.post\('\/api\/artifacts\/open', \{ action: 'open', url \}\); return; \}/);
});
