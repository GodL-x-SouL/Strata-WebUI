import { ApiError } from './client';
import { navigate } from './router';

export interface StudioMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  error?: string;
  streaming?: boolean;
  reasoningMs?: number;
}

export interface StudioSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StudioMessage[];
  tokensIn: number;
  tokensOut: number;
}

export interface StudioChatEntry {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  bytes: number;
}

export interface StudioChatEnvelope {
  rev: number;
  savedAt: string;
  session: StudioSession;
}

export interface StudioChatSaveResult {
  id: string;
  rev: number;
  bytes: number;
  conflict: boolean;
}

export interface StudioChatFrame {
  type: string;
  text?: string;
  message?: string;
  model?: string;
  phase?: string;
  tokens?: number;
  tokensIn?: number;
  tokensOut?: number;
  tps?: number;
  durationMs?: number;
  finishReason?: string;
}

export const newStudioChatId = () => `studio_${crypto.randomUUID().replaceAll('-', '')}`;
const WINDOW_ID = crypto.randomUUID();
const BASE = (globalThis as { __STRATA_HOST__?: string }).__STRATA_HOST__ ?? '';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('x-strata-client', 'ui');
  headers.set('x-strata-window', WINDOW_ID);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try { data = JSON.parse(text); } catch { data = undefined; }
  }
  if (res.status === 401) window.location.assign('/studio/login');
  if (!res.ok) {
    const message = (data as { error?: string } | undefined)?.error ?? `Request failed (${res.status} ${res.statusText})`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

export const STUDIO_NEW_CHAT_EVENT = 'strata:studio-new-chat';
export function startNewStudioChat() {
  navigate('chat');
  setTimeout(() => window.dispatchEvent(new Event(STUDIO_NEW_CHAT_EVENT)), 0);
}

export function listStudioChats(signal?: AbortSignal) {
  return request<{ chats: StudioChatEntry[]; damaged: string[]; newer: string[] }>('/api/chats', { signal });
}

export function readStudioChat(id: string, signal?: AbortSignal) {
  return request<StudioChatEnvelope>(`/api/chats/${encodeURIComponent(id)}`, { signal });
}

export function saveStudioChat(session: StudioSession, baseRev: number | null) {
  const headers = new Headers();
  if (baseRev !== null) headers.set('x-strata-base-rev', String(baseRev));
  return request<StudioChatSaveResult>(`/api/chats/${encodeURIComponent(session.id)}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(session),
  });
}
