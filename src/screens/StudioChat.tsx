import { useCallback, useEffect, useRef, useState } from 'react';
import { CopyBtn } from '../components/CopyBtn';
import { Markdown } from '../components/Markdown';
import { ReasoningBlock } from '../components/ReasoningBlock';
import { Btn, Icon } from '../components/ui';
import { ApiError, streamPost } from '../lib/client';
import { tr } from '../lib/i18n';
import { useImeKeys } from '../lib/ime-keys';
import { useNative } from '../lib/native';
import { navigate } from '../lib/router';
import { composerSends } from '../lib/shortcut-bindings';
import { useStore } from '../lib/store';
import {
  listStudioChats,
  newStudioChatId,
  readStudioChat,
  saveStudioChat,
  STUDIO_NEW_CHAT_EVENT,
  type StudioChatEntry,
  type StudioChatFrame,
  type StudioMessage,
  type StudioSession,
} from '../lib/studio-chat';

const SELECTED_KEY = 'strata.studio.chat.v1';
const now = () => new Date().toISOString();
const entryOf = (session: StudioSession, bytes = 0): StudioChatEntry => ({
  id: session.id,
  title: session.title,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  bytes,
});

export function StudioChat() {
  useStore(s => s.language);
  const native = useNative();
  const currentModel = native?.instances.find(instance => instance.id === native.defaultId) ?? native?.instances[0] ?? null;
  const readyModel = currentModel?.status === 'ready' ? currentModel : null;
  const [entries, setEntries] = useState<StudioChatEntry[]>([]);
  const [session, setSession] = useState<StudioSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const sessionRef = useRef<StudioSession | null>(null);
  const revisions = useRef(new Map<string, number>());
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const abortRef = useRef<AbortController | null>(null);
  const listController = useRef<AbortController | null>(null);
  const turnRef = useRef(0);
  const transcript = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);
  const ime = useImeKeys();

  const replaceSession = useCallback((value: StudioSession | null) => {
    sessionRef.current = value;
    setSession(value);
    if (value) sessionStorage.setItem(SELECTED_KEY, value.id);
    else sessionStorage.removeItem(SELECTED_KEY);
  }, []);

  const persist = useCallback((value: StudioSession) => {
    const snapshot: StudioSession = {
      ...value,
      updatedAt: now(),
      messages: value.messages.map(message => ({ ...message, streaming: false })),
    };
    const work = saveChain.current.then(async () => {
      const result = await saveStudioChat(snapshot, revisions.current.get(snapshot.id) ?? null);
      revisions.current.set(snapshot.id, result.rev);
      setEntries(previous => [entryOf(snapshot, result.bytes), ...previous.filter(entry => entry.id !== snapshot.id)]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)));
      return result;
    });
    saveChain.current = work.then(() => undefined, () => undefined);
    return work;
  }, []);

  const openChat = useCallback(async (id: string) => {
    const turn = ++turnRef.current;
    listController.current?.abort();
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setStatus('');
    setError('');
    setLoadError('');
    setLoading(true);
    try {
      const envelope = await readStudioChat(id);
      if (turn !== turnRef.current) return;
      revisions.current.set(id, envelope.rev);
      replaceSession(envelope.session);
      pinned.current = true;
    } catch (cause) {
      if (turn === turnRef.current) setLoadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (turn === turnRef.current) setLoading(false);
    }
  }, [replaceSession]);

  const newChat = useCallback(() => {
    turnRef.current += 1;
    listController.current?.abort();
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setLoading(false);
    setStatus('');
    setError('');
    setLoadError('');
    setDraft('');
    replaceSession(null);
    pinned.current = true;
    requestAnimationFrame(() => textarea.current?.focus());
  }, [replaceSession]);

  useEffect(() => {
    const controller = new AbortController();
    listController.current = controller;
    void listStudioChats(controller.signal).then(async result => {
      if (controller.signal.aborted) return;
      setEntries(result.chats);
      const selected = sessionStorage.getItem(SELECTED_KEY);
      const id = selected && result.chats.some(chat => chat.id === selected) ? selected : result.chats[0]?.id;
      if (id) await openChat(id);
      else replaceSession(null);
    }).catch(cause => {
      if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    window.addEventListener(STUDIO_NEW_CHAT_EVENT, newChat);
    return () => {
      controller.abort();
      if (listController.current === controller) listController.current = null;
      window.removeEventListener(STUDIO_NEW_CHAT_EVENT, newChat);
      turnRef.current += 1;
      abortRef.current?.abort();
    };
  }, [newChat, openChat, replaceSession]);

  useEffect(() => {
    const refresh = () => { void listStudioChats().then(result => setEntries(result.chats)).catch(() => {}); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  useEffect(() => {
    const el = transcript.current;
    const inner = el?.querySelector('.chat__inner');
    if (!el || !inner) return undefined;
    const observer = new ResizeObserver(() => { if (pinned.current) el.scrollTop = el.scrollHeight; });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [session?.id, loading]);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(180, el.scrollHeight)}px`;
  }, [draft]);

  async function send() {
    const text = draft.trim();
    if (!text || streaming || !readyModel) return;
    const base = sessionRef.current;
    const id = base?.id ?? newStudioChatId();
    const user: StudioMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    let latest: StudioSession = {
      id,
      title: base?.messages.length ? base.title : text.slice(0, 60),
      createdAt: base?.createdAt ?? now(),
      updatedAt: now(),
      messages: [...(base?.messages ?? []), user],
      tokensIn: base?.tokensIn ?? 0,
      tokensOut: base?.tokensOut ?? 0,
    };
    const history = latest.messages.slice(0, -1)
      .filter(message => message.role === 'user' || !!message.content)
      .map(message => ({ role: message.role, content: message.content }));
    const controller = new AbortController();
    const turn = ++turnRef.current;
    abortRef.current = controller;
    replaceSession(latest);
    setDraft('');
    setError('');
    setStatus('Starting…');
    setStreaming(true);
    pinned.current = true;
    try {
      await persist(latest);
      if (turn !== turnRef.current || controller.signal.aborted) return;
      const assistantId = crypto.randomUUID();
      latest = { ...latest, messages: [...latest.messages, { id: assistantId, role: 'assistant', content: '', streaming: true }] };
      replaceSession(latest);
      let reasoningAt: number | null = null;
      const patchAssistant = (patch: Partial<StudioMessage>) => {
        latest = {
          ...latest,
          updatedAt: now(),
          messages: latest.messages.map(message => message.id === assistantId ? { ...message, ...patch } : message),
        };
        if (sessionRef.current?.id === id) replaceSession(latest);
      };
      await streamPost('/api/chat/stream', {
        sessionId: id,
        message: text,
        history,
        nativeModelId: readyModel.id,
        thinking: 'Medium',
        thinkingBudget: 0,
        agent: false,
        tools: false,
        useTools: false,
      }, (frame: Record<string, unknown>) => {
        if (turn !== turnRef.current || controller.signal.aborted) return;
        const value = frame as unknown as StudioChatFrame;
        if (value.type === 'status') setStatus(value.text ?? '');
        else if (value.type === 'reasoning') {
          reasoningAt ??= Date.now();
          patchAssistant({ reasoning: `${latest.messages.find(message => message.id === assistantId)?.reasoning ?? ''}${value.text ?? ''}` });
        } else if (value.type === 'delta') {
          const assistant = latest.messages.find(message => message.id === assistantId);
          patchAssistant({
            content: `${assistant?.content ?? ''}${value.text ?? ''}`,
            ...(reasoningAt !== null && assistant?.reasoningMs === undefined ? { reasoningMs: Date.now() - reasoningAt } : {}),
          });
          setStatus('');
        } else if (value.type === 'stats') setStatus(value.tps ? `${value.tps.toFixed(1)} tok/s` : '');
        else if (value.type === 'error') patchAssistant({ error: value.message ?? 'The model could not answer.', streaming: false });
        else if (value.type === 'done') {
          latest = {
            ...latest,
            updatedAt: now(),
            tokensIn: typeof value.tokensIn === 'number' ? value.tokensIn : latest.tokensIn,
            tokensOut: typeof value.tokensOut === 'number' ? value.tokensOut : latest.tokensOut,
            messages: latest.messages.map(message => message.id === assistantId ? { ...message, streaming: false } : message),
          };
          if (sessionRef.current?.id === id) replaceSession(latest);
          setStatus('');
        }
      }, controller.signal);
    } catch (cause) {
      if (controller.signal.aborted) {
        latest = { ...latest, messages: latest.messages.map(message => message.role === 'assistant' && message.streaming ? { ...message, error: message.error ?? 'Stopped.', streaming: false } : message) };
      } else {
        const failure = cause instanceof Error ? cause.message : String(cause);
        if (!(cause instanceof ApiError && cause.status === 401)) setError(failure);
        latest = { ...latest, messages: latest.messages.map(entry => entry.role === 'assistant' && entry.streaming ? { ...entry, error: entry.error ?? failure, streaming: false } : entry) };
      }
    } finally {
      latest = { ...latest, updatedAt: now(), messages: latest.messages.map(message => message.streaming ? { ...message, streaming: false } : message) };
      if (turn === turnRef.current) {
        replaceSession(latest);
        setStreaming(false);
        setStatus('');
        if (abortRef.current === controller) abortRef.current = null;
      }
      try { await persist(latest); }
      catch (cause) { if (turn === turnRef.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    }
  }

  const lastMessage = session?.messages.at(-1);
  const modelStatus = readyModel
    ? readyModel.phase === 'idle' ? tr('Model ready') : readyModel.phase
    : currentModel ? currentModel.status : tr('No model loaded');

  return <>
    <header className="st-header main__head studio-chat__header">
      <div className="main__titles">
        <div className="main__title-line"><h1 className="main__title">{tr(session?.title ?? 'Chat')}</h1></div>
        <p className="main__sub"><span className="api-status" data-active={!!readyModel}><span className="api-status__dot"/>{tr(modelStatus)}{readyModel ? ` · ${readyModel.label}` : ''}</span></p>
      </div>
      <div className="main__actions">
        {entries.length > 0 ? <select className="st-input studio-chat__recent" aria-label={tr('Recent chats')} value={session?.id ?? ''} disabled={loading} onChange={event => { if (event.target.value) void openChat(event.target.value); }}>
          <option value="" disabled>{tr('Recent chats')}</option>
          {entries.map(entry => <option key={entry.id} value={entry.id}>{entry.title || tr('Studio chat')}</option>)}
        </select> : null}
        <Btn variant="secondary" size="sm" icon="new-chat" onClick={newChat}>{tr('New chat')}</Btn>
      </div>
    </header>
    <div className="main__body chat studio-chat">
      <div className="studio-chat__transcript" ref={transcript} onScroll={event => {
        const el = event.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      }}>
        {loading ? <div className="chat__inner"><p className="muted" role="status">{tr('Opening Studio chats…')}</p></div>
          : loadError ? <div className="chat__inner"><div className="studio-chat__empty"><Icon name="warning" size={28}/><h2>{tr('Studio chats could not open')}</h2><p>{loadError}</p><Btn variant="secondary" onClick={() => window.location.reload()}>{tr('Retry')}</Btn></div></div>
            : session?.messages.length ? <div className="chat__inner">
              {session.messages.map((message, index) => <div key={message.id} className={`st-msg st-msg--${message.role}`} data-error={message.error ? 'true' : undefined}>
                {message.role === 'assistant' && message.reasoning ? <ReasoningBlock message={message}/> : null}
                <div className="st-bubble">
                  {message.role === 'assistant' ? <Markdown text={message.content}/> : <span className="st-bubble__text">{message.content}</span>}
                  {message.error ? <p className="studio-chat__error" role="alert">{message.error}</p> : null}
                  {message.streaming && !message.content ? <span className="caret" aria-hidden="true"/> : null}
                </div>
                {message.role === 'assistant' && index === session.messages.length - 1 && streaming && status ? <p className="xs muted studio-chat__status" role="status">{status}</p> : null}
                {!message.streaming && message.content ? <div className="st-msg__meta"><span className="st-msg__actions"><CopyBtn text={message.content} label={message.role === 'user' ? tr('Message') : tr('Response')} title={message.role === 'user' ? tr('Copy message') : tr('Copy response')}/></span></div> : null}
              </div>)}
            </div>
              : <div className="chat__inner"><div className="studio-chat__empty">
                <Icon name={readyModel ? 'new-chat' : 'models'} size={30}/>
                <h2>{readyModel ? tr('Chat with your local model') : tr('Load a model to start chatting')}</h2>
                <p>{readyModel ? tr('Your messages stay in this Studio. Chat does not run local tools or open host files.') : tr('Choose and load a model in Models, then come back here.')}</p>
                {!readyModel ? <Btn variant="primary" icon="models" onClick={() => navigate('models')}>{tr('Open {0}', [tr('Models')])}</Btn> : null}
              </div></div>}
      </div>
      <form className="studio-chat__composer" onSubmit={event => { event.preventDefault(); void send(); }}>
        {error ? <p className="studio-chat__error" role="alert">{error}</p> : null}
        <div className="studio-chat__box">
          <textarea
            ref={textarea}
            value={draft}
            rows={1}
            aria-label={tr('Message')}
            placeholder={tr(readyModel ? 'Message your model…' : 'Load a model in Models to send a message…')}
            onChange={event => setDraft(event.target.value)}
            {...ime.events}
            onKeyDown={event => {
              if (ime.owns(event)) return;
              if (composerSends(event)) { event.preventDefault(); if (!streaming) void send(); }
            }}
          />
          {streaming ? <Btn type="button" variant="secondary" size="sm" icon="stop" onClick={() => abortRef.current?.abort()}>{tr('Stop')}</Btn>
            : <Btn type="submit" variant="primary" size="sm" icon="send" disabled={!draft.trim() || !readyModel || loading}>{tr('Send')}</Btn>}
        </div>
        <p className="xs muted studio-chat__hint">{streaming ? tr(lastMessage?.error || 'Stop keeps any partial answer.') : tr('Enter to send · Shift+Enter for a new line')}</p>
      </form>
    </div>
  </>;
}
