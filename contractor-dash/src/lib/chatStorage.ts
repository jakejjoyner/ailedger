// Per-session chat storage (v2) + migration from v1.
//
// v1 (obsolete):
//   jo_chat_messages_v1:<userId>         → Message[] (global per user)
//   jo_chat_scroll_v1:<userId>           → number
//
// v2:
//   jo_chat_sessions_v2:<userId>         → SessionMeta[] (index)
//   jo_chat_messages_v2:<userId>:<sid>   → Message[]
//   jo_chat_scroll_v2:<userId>:<sid>     → number
//   jo_chat_active_v2:<userId>           → sessionId | null
//   jo_chat_fullscreen_v1                → kept as-is (global UI pref)
//
// Migration: on first load of v2 for a given userId, if v1 messages exist
// we adopt them under the currently-active backend session so Pasha doesn't
// lose the transcript from before this release. v1 keys are then removed.

export interface StoredMessage {
  role: "user" | "jo" | "error";
  text: string;
  ts: number;
  code?: string;
}

export interface SessionMeta {
  id: string;
  title: string;
  lastActive: number;
}

const MSG_CACHE_MAX = 200;

const V1_MSG_PREFIX = "jo_chat_messages_v1:";
const V1_SCROLL_PREFIX = "jo_chat_scroll_v1:";

const V2_SESSIONS = (uid: string) => `jo_chat_sessions_v2:${uid}`;
const V2_MSG = (uid: string, sid: string) => `jo_chat_messages_v2:${uid}:${sid}`;
const V2_SCROLL = (uid: string, sid: string) => `jo_chat_scroll_v2:${uid}:${sid}`;
const V2_ACTIVE = (uid: string) => `jo_chat_active_v2:${uid}`;
const V2_MIGRATED = (uid: string) => `jo_chat_migrated_v2:${uid}`;

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* quota — best-effort */ }
}
function safeRemove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export function loadSessionIndex(userId: string): SessionMeta[] {
  const raw = safeGet(V2_SESSIONS(userId));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as SessionMeta[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveSessionIndex(userId: string, idx: SessionMeta[]): void {
  safeSet(V2_SESSIONS(userId), JSON.stringify(idx));
}

export function upsertSessionMeta(userId: string, meta: SessionMeta): SessionMeta[] {
  const idx = loadSessionIndex(userId);
  const existing = idx.findIndex((s) => s.id === meta.id);
  if (existing >= 0) {
    idx[existing] = { ...idx[existing], ...meta };
  } else {
    idx.unshift(meta);
  }
  saveSessionIndex(userId, idx);
  return idx;
}

export function removeSessionMeta(userId: string, sessionId: string): SessionMeta[] {
  const idx = loadSessionIndex(userId).filter((s) => s.id !== sessionId);
  saveSessionIndex(userId, idx);
  safeRemove(V2_MSG(userId, sessionId));
  safeRemove(V2_SCROLL(userId, sessionId));
  return idx;
}

export function loadMessages(userId: string, sessionId: string): StoredMessage[] {
  const raw = safeGet(V2_MSG(userId, sessionId));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as StoredMessage[];
    return Array.isArray(arr) ? arr.slice(-MSG_CACHE_MAX) : [];
  } catch {
    return [];
  }
}

export function saveMessages(userId: string, sessionId: string, messages: StoredMessage[]): void {
  const trimmed = messages.slice(-MSG_CACHE_MAX);
  safeSet(V2_MSG(userId, sessionId), JSON.stringify(trimmed));
}

export function loadScroll(userId: string, sessionId: string): number {
  const raw = safeGet(V2_SCROLL(userId, sessionId));
  return raw ? parseInt(raw, 10) || 0 : 0;
}

export function saveScroll(userId: string, sessionId: string, top: number): void {
  safeSet(V2_SCROLL(userId, sessionId), String(Math.round(top)));
}

export function loadActive(userId: string): string | null {
  return safeGet(V2_ACTIVE(userId));
}

export function saveActive(userId: string, sessionId: string | null): void {
  if (sessionId) safeSet(V2_ACTIVE(userId), sessionId);
  else safeRemove(V2_ACTIVE(userId));
}

/**
 * If v1 blob exists for this user and we haven't migrated yet, write it under
 * the supplied currentSessionId and drop v1 keys. Idempotent — a migrated
 * flag prevents re-running if the user later clears only v2 keys manually.
 */
export function migrateV1IfNeeded(userId: string, currentSessionId: string): void {
  if (safeGet(V2_MIGRATED(userId)) === "1") return;
  const v1MsgRaw = safeGet(V1_MSG_PREFIX + userId);
  const v1Scroll = safeGet(V1_SCROLL_PREFIX + userId);

  if (v1MsgRaw) {
    try {
      const arr = JSON.parse(v1MsgRaw) as StoredMessage[];
      if (Array.isArray(arr) && arr.length > 0) {
        saveMessages(userId, currentSessionId, arr);
        const title = deriveTitle(arr);
        upsertSessionMeta(userId, {
          id: currentSessionId,
          title,
          lastActive: Date.now(),
        });
      }
    } catch { /* ignore parse errors — drop silently */ }
  }
  if (v1Scroll) {
    const n = parseInt(v1Scroll, 10);
    if (!Number.isNaN(n) && n > 0) saveScroll(userId, currentSessionId, n);
  }
  safeRemove(V1_MSG_PREFIX + userId);
  safeRemove(V1_SCROLL_PREFIX + userId);
  safeSet(V2_MIGRATED(userId), "1");
}

/**
 * Title ≤40 chars from the first user message in the transcript.
 * Returns "New chat" if none found.
 */
export function deriveTitle(messages: StoredMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user" && m.text.trim());
  if (!firstUser) return "New chat";
  const one = firstUser.text.replace(/\s+/g, " ").trim();
  return one.length <= 40 ? one : one.slice(0, 39).trimEnd() + "…";
}

export function clearUser(userId: string): void {
  const idx = loadSessionIndex(userId);
  for (const s of idx) {
    safeRemove(V2_MSG(userId, s.id));
    safeRemove(V2_SCROLL(userId, s.id));
  }
  safeRemove(V2_SESSIONS(userId));
  safeRemove(V2_ACTIVE(userId));
}
