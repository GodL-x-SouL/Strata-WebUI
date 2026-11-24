import { useEffect, useState } from 'react';
import { tr } from '../lib/i18n';
import { api } from '../lib/client';
import { CopyBtn } from './CopyBtn';
import { Btn, ErrorNotice, Icon, Select } from './ui';
import type { TunnelState } from '../lib/types';

interface StudioState {
  enabled: boolean;
  url: string;
  tunnel: TunnelState;
}

export function StudioAccess() {
  const [state, setState] = useState<StudioState | null>(null);
  const [mode, setMode] = useState<'quick' | 'domain'>('quick');
  const [hostname, setHostname] = useState('');
  const [token, setToken] = useState('');
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

  async function read() {
    try { setState(await api.get<StudioState>('/api/studio')); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => { void read(); }, []);
  useEffect(() => {
    if (!state || !['starting', 'stopping'].includes(state.tunnel.status)) return;
    const timer = window.setInterval(() => void read(), 2000);
    return () => window.clearInterval(timer);
  }, [state?.tunnel.status]);

  async function action(body: Record<string, unknown>) {
    setPending(true); setError('');
    try { setState(await api.post<StudioState>('/api/studio/tunnel', body)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setPending(false); }
  }
  async function revealKey() {
    setError('');
    try { const answer = await api.get<{ key: string }>('/api/studio/access'); setKey(answer.key); setShowKey(true); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  const tunnel = state?.tunnel;
  return <section className="st-card studio-access" aria-labelledby="studio-access-title">
    <div className="section-toolbar"><div><span className="st-pill st-pill--accent">{tr('Studio')}</span><h2 id="studio-access-title" className="h4">{tr('Private manager access')}</h2></div><Icon name="shield" size={24}/></div>
    <p className="small muted">{tr('Open the model manager and chat from a browser. Install an engine, download and load models, tune them, chat with the loaded model, and read the API connection details without starting a server first.')}</p>
    <dl className="summary-list">
      <div><dt>{tr('On this computer')}</dt><dd className="row"><code style={{ overflowWrap: 'anywhere' }}>{state?.url ?? window.location.origin}</code><CopyBtn text={state?.url ?? window.location.origin} label="Studio URL" title="Copy Studio URL"/></dd></div>
      {tunnel?.status === 'connected' && tunnel.url ? <div><dt>{tr('Private internet link')}</dt><dd className="row"><code style={{ overflowWrap: 'anywhere' }}>{tunnel.url}</code><CopyBtn text={tunnel.url} label="Studio tunnel URL" title="Copy Studio tunnel URL"/><a className="st-btn st-btn--sm" href={tunnel.url} target="_blank" rel="noreferrer">{tr('Open')}</a></dd></div> : null}
    </dl>
    <div className="studio-key">
      <div><strong>{tr('Studio key')}</strong><p className="xs muted">{tr('This key protects the manager. It is not the inference API key. Anyone with it can control this Strata installation.')}</p></div>
      {local ? <Btn size="sm" onClick={() => void revealKey()}>{tr(key && showKey ? 'Hide key' : 'Show key')}</Btn> : <span className="st-pill">{tr('Shown only on the host computer')}</span>}
      {key && showKey ? <div className="row studio-key__value"><code>{key}</code><CopyBtn text={key} label="Studio key" title="Copy Studio key"/></div> : null}
    </div>
    <div className="studio-tunnel-controls">
      {tunnel?.status === 'connected' || tunnel?.status === 'starting' ? <Btn variant="secondary" disabled={pending} onClick={() => void action({ action: 'stop' })}>{tr(tunnel.status === 'starting' ? 'Cancel connection' : 'Stop private link')}</Btn> : <>
        <Select ariaLabel={tr('Studio tunnel type')} value={mode} options={[{ value: 'quick', label: tr('Temporary Cloudflare link') }, { value: 'domain', label: tr('Your Cloudflare domain') }]} onChange={value => setMode(value as 'quick' | 'domain')}/>
        {mode === 'domain' ? <><input className="st-input" aria-label={tr('Domain')} placeholder="studio.example.com" value={hostname} onChange={e => setHostname(e.target.value)}/><input className="st-input" aria-label={tr('Cloudflare tunnel token')} type="password" autoComplete="off" placeholder={tr('Tunnel token')} value={token} onChange={e => setToken(e.target.value)}/></> : null}
        <Btn variant="primary" icon="link" disabled={pending || mode === 'domain' && (!hostname.trim() || !token.trim())} onClick={() => void action({ action: 'start', mode, ...(mode === 'domain' ? { hostname: hostname.trim(), token: token.trim() } : {}) })}>{tr(pending ? 'Connecting…' : 'Create private link')}</Btn>
      </>}
      {tunnel?.status === 'starting' ? <p className="small muted" role="status">{tr('Cloudflare is connecting. This can take up to a minute.')}</p> : null}
      {tunnel?.error ? <ErrorNotice message={tunnel.error}/> : null}
    </div>
    <p className="xs muted studio-access__note"><Icon name="warning" size={16}/>{tr(' The computer running Strata must stay on. The link asks for the Studio key. Studio can chat with the loaded model, but it cannot browse host files, run a shell, edit local tools, or run local agent tools.')}</p>
    {error ? <ErrorNotice message={error}/> : null}
  </section>;
}
