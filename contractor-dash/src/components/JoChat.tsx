import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MessageSquareText,
  Send,
  Loader2,
  RefreshCw,
  X,
  Maximize2,
  Minimize2,
  Plus,
  PanelLeft,
  Trash2,
  Square,
  Copy,
  Check,
  RotateCcw,
} from "lucide-react";
import {
  createJoSession,
  listJoSessions,
  sendJoMessage,
  streamJo,
  closeJoSession,
  cancelJoTurn,
  type JoSession,
} from "../lib/jo";
import { renderMarkdown } from "../lib/markdown";
import {
  loadSessionIndex,
  loadMessages,
  saveMessages,
  loadScroll,
  saveScroll,
  loadActive,
  saveActive,
  upsertSessionMeta,
  removeSessionMeta,
  deriveTitle,
  migrateV1IfNeeded,
  type StoredMessage,
  type SessionMeta,
} from "../lib/chatStorage";

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string;
}

const FULLSCREEN_KEY = "jo_chat_fullscreen_v1";
const RAIL_KEY = "jo_chat_rail_v1";

const STARTER_PROMPTS = [
  "What's on my plate today?",
  "Summarize my unread inbox",
  "Draft a reply to the most recent message",
  "Find docs about onboarding",
];

function loadPref(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === "1") return true;
    if (v === "0") return false;
    return dflt;
  } catch {
    return dflt;
  }
}
function savePref(key: string, v: boolean): void {
  try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* ignore */ }
}

// Thinking indicator with elapsed-seconds counter. Turns amber >30s.
function ThinkingIndicator() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const slow = elapsed >= 30;
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 text-xs " +
        (slow ? "text-amber-400" : "text-muted")
      }
    >
      <Loader2 className="w-3.5 h-3.5 animate-spin" />
      <span>
        {slow ? "Jo is still thinking" : "Jo is thinking"}
        {elapsed > 0 ? ` · ${elapsed}s` : "…"}
      </span>
    </span>
  );
}

interface MessageBubbleProps {
  message: StoredMessage;
  fullscreen: boolean;
  streaming: boolean;
  onCopy: () => void;
  onRetry?: () => void;
  copied: boolean;
}

function MessageBubble({ message, fullscreen, streaming, onCopy, onRetry, copied }: MessageBubbleProps) {
  const m = message;

  if (m.role === "error") {
    return (
      <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-200 text-sm">
        <span className="shrink-0 mt-0.5">⚠</span>
        <div className="flex-1">
          {m.code && (
            <div className="text-[11px] uppercase tracking-wide text-amber-400/80 font-semibold mb-0.5">
              Jo · {m.code}
            </div>
          )}
          <div className="whitespace-pre-wrap">{m.text}</div>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-2 inline-flex items-center gap-1 text-xs text-amber-300 hover:text-amber-100 transition-colors"
            >
              <RotateCcw className="w-3 h-3" /> Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const isUser = m.role === "user";
  const sizeProps = fullscreen
    ? { fontSize: 17, lineHeight: 1.75 }
    : { fontSize: 15.5, lineHeight: 1.65 };

  if (isUser) {
    return (
      <div className="group text-right">
        <div
          style={{ fontFamily: "var(--font-sans)", ...sizeProps }}
          className="inline-block max-w-[85%] px-4 py-2.5 rounded-2xl whitespace-pre-wrap text-prose bg-accent-soft border border-accent/20 text-left"
        >
          {m.text}
        </div>
        <div className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onCopy}
            className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-prose transition-colors"
            aria-label="Copy message"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    );
  }

  // Jo message — render markdown (unless still empty → thinking placeholder).
  if (!m.text) {
    return (
      <div className="block max-w-full px-0.5 py-0.5">
        <ThinkingIndicator />
      </div>
    );
  }
  return (
    <div className="group block max-w-full">
      <div
        className="jo-md"
        style={sizeProps}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }}
      />
      {!streaming && (
        <div className="mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onCopy}
            className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-prose transition-colors"
            aria-label="Copy message"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}

interface SessionRailProps {
  sessions: SessionMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  collapsed: boolean;
}

function SessionRail({ sessions, activeId, onSelect, onNew, onDelete, onClose, collapsed }: SessionRailProps) {
  if (collapsed) return null;
  return (
    <div className="w-60 shrink-0 flex flex-col border-r border-line-soft bg-surface">
      <div className="flex items-center gap-1 px-3 py-3">
        <button
          onClick={onNew}
          className="flex-1 flex items-center gap-2 px-3 py-2 text-sm text-prose bg-surface-raised hover:bg-accent-soft rounded-md transition-colors"
        >
          <Plus className="w-4 h-4" /> New chat
        </button>
        <button
          onClick={onClose}
          title="Hide chats"
          aria-label="Hide chats"
          className="p-2 text-muted hover:text-prose hover:bg-surface-raised rounded-md transition-colors"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {sessions.length === 0 && (
          <div className="px-3 py-4 text-xs text-subtle">No chats yet.</div>
        )}
        {sessions.map((s) => {
          const isActive = s.id === activeId;
          return (
            <div
              key={s.id}
              className={
                "group relative flex items-center gap-2 pl-3 pr-1 py-2 rounded-md text-sm cursor-pointer transition-colors " +
                (isActive
                  ? "bg-accent-soft text-prose"
                  : "text-muted hover:bg-surface-raised hover:text-prose")
              }
              onClick={() => onSelect(s.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(s.id);
                }
              }}
            >
              <span className="flex-1 truncate">{s.title || "New chat"}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
                title="Delete chat"
                aria-label="Delete chat"
                className="opacity-0 group-hover:opacity-100 p-1 text-muted hover:text-rose-400 rounded transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function JoChat({ open, onClose, userId }: Props) {
  const [sessions, setSessions] = useState<SessionMeta[]>(() => loadSessionIndex(userId));
  const [activeId, setActiveId] = useState<string | null>(() => loadActive(userId));
  const [messages, setMessages] = useState<StoredMessage[]>(() =>
    activeId ? loadMessages(userId, activeId) : []
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState<boolean>(() => loadPref(FULLSCREEN_KEY, false));
  const [railOpen, setRailOpen] = useState<boolean>(() => loadPref(RAIL_KEY, true));
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [newBelow, setNewBelow] = useState(false);

  const streamRef = useRef<{ cancel: () => void } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pinnedToBottomRef = useRef(true);
  const restoredScrollRef = useRef(false);
  const copyTimerRef = useRef<number | null>(null);
  const bootedRef = useRef(false);

  // Persist UI prefs.
  useEffect(() => { savePref(FULLSCREEN_KEY, fullscreen); }, [fullscreen]);
  useEffect(() => { savePref(RAIL_KEY, railOpen); }, [railOpen]);

  // Persist messages per active session + keep on-disk session index up to
  // date. The sessions state isn't re-read here (that would set-state in an
  // effect); the rail instead overrides the active session's title via
  // deriveTitle(messages) at render time, so typing in chat updates the
  // sidebar label immediately. On session switch / new / delete we refresh
  // the sessions state explicitly.
  useEffect(() => {
    if (!activeId) return;
    saveMessages(userId, activeId, messages);
    upsertSessionMeta(userId, {
      id: activeId,
      title: deriveTitle(messages),
      lastActive: Date.now(),
    });
  }, [messages, activeId, userId]);

  // Persist active id.
  useEffect(() => { saveActive(userId, activeId); }, [activeId, userId]);

  // ESC exits fullscreen (doesn't close the panel).
  useEffect(() => {
    if (!open || !fullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, fullscreen]);

  // "/" focuses the composer when not already typing.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      textareaRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Ref-based indirection so the onError handler can recursively call
  // openStream after session-recreation without tripping ESLint's "used
  // before declaration" rule for the useCallback.
  const openStreamRef = useRef<(sessionId: string) => void>(() => {});

  const openStream = useCallback((sessionId: string) => {
    streamRef.current?.cancel();
    streamRef.current = streamJo(sessionId, {
      onChunk: (chunk) => {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "jo") {
            return [...prev.slice(0, -1), { ...last, text: last.text + chunk }];
          }
          return [...prev, { role: "jo", text: chunk, ts: Date.now() }];
        });
        // If the user has scrolled up, surface the "new message" badge.
        // Set from the stream handler (not an effect) so lint's
        // set-state-in-effect rule stays clean.
        if (!pinnedToBottomRef.current) setNewBelow(true);
      },
      onTurnEnd: () => {
        setBusy(false);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "jo" && !last.text) return prev.slice(0, -1);
          return prev;
        });
      },
      onTurnError: (code, message) => {
        setBusy(false);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "jo" && !last.text) {
            return [...prev.slice(0, -1), { role: "error", text: message, ts: Date.now(), code }];
          }
          return [...prev, { role: "error", text: message, ts: Date.now(), code }];
        });
      },
      onDone: () => {},
      onError: async (e) => {
        // Stale session id after FastAPI restart — silently recreate.
        if (e.message === "jo_stream_404") {
          try {
            const fresh = await createJoSession();
            setActiveId(fresh.id);
            setMessages([]);
            upsertSessionMeta(userId, { id: fresh.id, title: "New chat", lastActive: Date.now() });
            setSessions(loadSessionIndex(userId));
            openStreamRef.current(fresh.id);
          } catch (e2) {
            setErr((e2 as Error).message);
          }
        } else {
          setErr(e.message);
        }
      },
    });
  }, [userId]);

  // Keep the ref pointed at the current useCallback closure.
  useEffect(() => {
    openStreamRef.current = openStream;
  }, [openStream]);

  // Boot on first open: pick an active session (prefer stored v2 active, else
  // backend first-active, else create fresh), migrate v1 data if present,
  // ensure session meta + stream are ready.
  useEffect(() => {
    if (!open || bootedRef.current) return;
    bootedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const backend = await listJoSessions().catch(() => [] as JoSession[]);
        if (cancelled) return;
        const backendActive = backend.find((s) => s.status === "active");
        const storedActive = loadActive(userId);
        let targetId: string | null = null;
        if (storedActive && backend.some((s) => s.id === storedActive)) {
          targetId = storedActive;
        } else if (backendActive) {
          targetId = backendActive.id;
        }
        if (!targetId) {
          const fresh = await createJoSession();
          if (cancelled) return;
          targetId = fresh.id;
          upsertSessionMeta(userId, { id: fresh.id, title: "New chat", lastActive: Date.now() });
        }
        migrateV1IfNeeded(userId, targetId);
        setSessions(loadSessionIndex(userId));
        setActiveId(targetId);
        setMessages(loadMessages(userId, targetId));
        openStream(targetId);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [open, userId, openStream]);

  // Cancel stream on panel close.
  useEffect(() => {
    if (!open) {
      streamRef.current?.cancel();
      bootedRef.current = false;
      restoredScrollRef.current = false;
    }
  }, [open]);

  // Restore scroll once after open + messages laid out, per active session.
  useEffect(() => {
    if (!open || !activeId) {
      restoredScrollRef.current = false;
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    restoredScrollRef.current = false;
    requestAnimationFrame(() => {
      const saved = loadScroll(userId, activeId);
      if (saved > 0) {
        el.scrollTop = saved;
        pinnedToBottomRef.current = el.scrollHeight - (el.scrollTop + el.clientHeight) < 40;
      } else {
        el.scrollTop = el.scrollHeight;
        pinnedToBottomRef.current = true;
      }
      restoredScrollRef.current = true;
      setNewBelow(false);
    });
  }, [open, activeId, userId]);

  // Auto-scroll on message change when pinned. The "scrolled up, new
  // message" badge is set from the stream handler (see openStream) — not
  // here — to keep this effect free of setState calls.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !restoredScrollRef.current) return;
    if (pinnedToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !activeId) return;
    const atBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 40;
    pinnedToBottomRef.current = atBottom;
    saveScroll(userId, activeId, el.scrollTop);
    if (atBottom) setNewBelow(false);
  }, [activeId, userId]);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    pinnedToBottomRef.current = true;
    setNewBelow(false);
  }, []);

  const sendText = useCallback(async (text: string) => {
    if (!activeId || busy || !text.trim()) return;
    setBusy(true);
    setErr(null);
    const outgoing = text.trim();
    setMessages((prev) => [
      ...prev,
      { role: "user", text: outgoing, ts: Date.now() },
      { role: "jo", text: "", ts: Date.now() },
    ]);
    // Snap to bottom on user send.
    pinnedToBottomRef.current = true;
    setNewBelow(false);
    try {
      await sendJoMessage(activeId, outgoing);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "jo_send_404") {
        try {
          const fresh = await createJoSession();
          setActiveId(fresh.id);
          upsertSessionMeta(userId, { id: fresh.id, title: "New chat", lastActive: Date.now() });
          setSessions(loadSessionIndex(userId));
          openStream(fresh.id);
          await sendJoMessage(fresh.id, outgoing);
          setErr(null);
        } catch (e2) {
          setErr((e2 as Error).message);
          setBusy(false);
        }
      } else {
        setErr(msg);
        setBusy(false);
      }
    }
  }, [activeId, busy, userId, openStream]);

  async function submit() {
    if (!input.trim() || busy) return;
    const text = input.trim();
    setInput("");
    await sendText(text);
  }

  function lastUserMessage(): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "user") return m.text;
    }
    return null;
  }

  async function retryLast() {
    const t = lastUserMessage();
    if (!t) return;
    // Drop the trailing error bubble so the retry flow is visually clean.
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "error") return prev.slice(0, -1);
      return prev;
    });
    // Also drop the prior user message — sendText re-adds it.
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "user" && last.text === t) return prev.slice(0, -1);
      return prev;
    });
    await sendText(t);
  }

  async function stopGenerating() {
    if (!activeId) return;
    streamRef.current?.cancel();
    try { await cancelJoTurn(activeId); } catch { /* best-effort */ }
    setBusy(false);
    // Re-open stream so the next turn flows normally.
    openStream(activeId);
  }

  async function newChat() {
    streamRef.current?.cancel();
    if (activeId) {
      try { await closeJoSession(activeId); } catch { /* ignore */ }
      removeSessionMeta(userId, activeId);
    }
    try {
      await fetch("/api/jo/reset-conversation", {
        method: "POST",
        credentials: "include",
      });
    } catch { /* best-effort */ }
    const fresh = await createJoSession();
    upsertSessionMeta(userId, { id: fresh.id, title: "New chat", lastActive: Date.now() });
    setSessions(loadSessionIndex(userId));
    setActiveId(fresh.id);
    setMessages([]);
    setErr(null);
    pinnedToBottomRef.current = true;
    restoredScrollRef.current = false;
    openStream(fresh.id);
  }

  async function switchTo(id: string) {
    if (id === activeId) return;
    streamRef.current?.cancel();
    setBusy(false);
    setErr(null);
    setActiveId(id);
    setMessages(loadMessages(userId, id));
    pinnedToBottomRef.current = true;
    restoredScrollRef.current = false;
    openStream(id);
  }

  async function deleteSession(id: string) {
    try { await closeJoSession(id); } catch { /* ignore */ }
    const remaining = removeSessionMeta(userId, id);
    setSessions(remaining);
    if (id === activeId) {
      if (remaining.length > 0) {
        await switchTo(remaining[0].id);
      } else {
        // Create a fresh one so the panel isn't empty.
        const fresh = await createJoSession();
        upsertSessionMeta(userId, { id: fresh.id, title: "New chat", lastActive: Date.now() });
        setSessions(loadSessionIndex(userId));
        setActiveId(fresh.id);
        setMessages([]);
        openStream(fresh.id);
      }
    }
  }

  function onCopyMessage(idx: number) {
    const m = messages[idx];
    if (!m) return;
    void navigator.clipboard.writeText(m.text).catch(() => {});
    setCopiedIdx(idx);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedIdx(null), 1500);
  }

  // Delegated click handler: catches .jo-code-copy clicks inside rendered
  // markdown and copies the associated code block's text content.
  const onScrollAreaClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>(".jo-code-copy");
    if (!btn) return;
    const id = btn.getAttribute("data-copy-for");
    if (!id) return;
    const code = btn.closest(".jo-code-block")?.querySelector<HTMLElement>("pre code");
    if (!code) return;
    void navigator.clipboard.writeText(code.innerText).catch(() => {});
    btn.setAttribute("data-copied", "1");
    btn.textContent = "Copied";
    window.setTimeout(() => {
      btn.removeAttribute("data-copied");
      btn.textContent = "Copy";
    }, 1500);
  }, []);

  const lastIsError = messages.length > 0 && messages[messages.length - 1].role === "error";

  // Show the session rail: always in fullscreen on wide screens, optionally
  // in sidebar mode. Keep mobile free of the rail unless user expanded it.
  const railCollapsed = !railOpen;

  const railEmpty = sessions.length === 0;

  // Override the active session's title with the live-derived value so the
  // rail label reflects the in-flight conversation immediately (the on-disk
  // index is updated every time messages change, but sessions state is
  // only refreshed on switch/new/delete to keep the messages-change effect
  // free of setState calls).
  const liveTitle = deriveTitle(messages);
  const sortedSessions = useMemo(
    () =>
      [...sessions]
        .map((s) => (s.id === activeId ? { ...s, title: liveTitle } : s))
        .sort((a, b) => b.lastActive - a.lastActive),
    [sessions, activeId, liveTitle],
  );

  if (!open) return null;

  return (
    <aside
      className={
        fullscreen
          ? "fixed inset-0 shadow-2xl flex z-50 bg-paper"
          : "fixed right-0 top-0 bottom-0 w-full sm:w-[40rem] lg:w-[52rem] bg-surface border-l border-line shadow-2xl flex z-20"
      }
    >
      <SessionRail
        sessions={sortedSessions}
        activeId={activeId}
        onSelect={switchTo}
        onNew={newChat}
        onDelete={deleteSession}
        onClose={() => setRailOpen(false)}
        collapsed={railCollapsed || railEmpty && !activeId}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-line-soft">
          <div className="flex items-center gap-2 min-w-0">
            {railCollapsed && (
              <button
                onClick={() => setRailOpen(true)}
                title="Show chats"
                aria-label="Show chats"
                className="p-1.5 text-muted hover:text-prose hover:bg-surface-raised rounded transition-colors"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}
            <MessageSquareText className="w-4 h-4 text-accent shrink-0" />
            <span className="text-sm font-semibold text-prose truncate">
              {sortedSessions.find((s) => s.id === activeId)?.title || "Jo"}
            </span>
            {activeId && (
              <span className="text-[11px] text-subtle font-mono shrink-0">#{activeId.slice(0, 8)}</span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setFullscreen((v) => !v)}
              title={fullscreen ? "Exit full-screen (Esc)" : "Full-screen"}
              aria-label={fullscreen ? "Exit full-screen" : "Full-screen"}
              className="p-1.5 text-muted hover:text-prose hover:bg-surface-raised rounded transition-colors"
            >
              {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              onClick={newChat}
              title="New chat"
              className="p-1.5 text-muted hover:text-prose hover:bg-surface-raised rounded transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              title="Close panel"
              className="p-1.5 text-muted hover:text-prose hover:bg-surface-raised rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 relative min-h-0">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            onClick={onScrollAreaClick}
            style={{ overscrollBehavior: "contain" }}
            className={
              fullscreen
                ? "absolute inset-0 overflow-y-auto"
                : "absolute inset-0 overflow-y-auto px-5 py-5"
            }
          >
            <div
              className={
                fullscreen
                  ? "max-w-[720px] mx-auto px-6 pt-14 pb-6 space-y-5"
                  : "space-y-4"
              }
            >
              {messages.length === 0 && (
                <div className={fullscreen ? "pt-8 pb-4" : "pt-2"}>
                  <div
                    style={{ fontFamily: "var(--font-serif)" }}
                    className={
                      fullscreen
                        ? "text-2xl text-prose leading-relaxed text-center"
                        : "text-base text-muted leading-relaxed"
                    }
                  >
                    How can I help?
                  </div>
                  <div
                    className={
                      fullscreen
                        ? "mt-6 flex flex-wrap gap-2 justify-center"
                        : "mt-4 flex flex-wrap gap-2"
                    }
                  >
                    {STARTER_PROMPTS.map((p) => (
                      <button
                        key={p}
                        onClick={() => void sendText(p)}
                        className="px-3.5 py-2 text-sm text-prose bg-surface-raised hover:bg-accent-soft border border-line hover:border-accent/30 rounded-full transition-colors"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <MessageBubble
                  key={i}
                  message={m}
                  fullscreen={fullscreen}
                  streaming={busy && i === messages.length - 1 && m.role === "jo"}
                  onCopy={() => onCopyMessage(i)}
                  onRetry={
                    lastIsError && i === messages.length - 1
                      ? () => void retryLast()
                      : undefined
                  }
                  copied={copiedIdx === i}
                />
              ))}
              {err && <p className="text-xs text-rose-400">{err}</p>}
            </div>
          </div>

          {newBelow && (
            <button
              onClick={() => scrollToBottom(true)}
              className="absolute left-1/2 -translate-x-1/2 bottom-3 px-3 py-1.5 text-xs rounded-full bg-accent text-white shadow-lg hover:bg-accent-hover transition-colors"
            >
              New message ↓
            </button>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className={
            fullscreen
              ? "border-t border-line-soft py-3"
              : "border-t border-line-soft p-3"
          }
        >
          <div
            className={
              fullscreen
                ? "max-w-[720px] mx-auto px-6 flex items-end gap-2 w-full"
                : "flex items-end gap-2"
            }
          >
            <textarea
              ref={(el) => {
                textareaRef.current = el;
                if (!el) return;
                el.style.height = "auto";
                const next = Math.min(Math.max(el.scrollHeight, 120), 400);
                el.style.height = `${next}px`;
              }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Message Jo…  (press "/" to focus)'
              style={{ minHeight: 120, maxHeight: 400 }}
              className="flex-1 resize-none px-4 py-3 bg-paper border border-line rounded-lg text-base leading-relaxed text-prose placeholder:text-subtle focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-colors"
              onKeyDown={(e) => {
                // Enter or Cmd/Ctrl+Enter sends; Shift+Enter inserts newline.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            {busy ? (
              <button
                type="button"
                onClick={() => void stopGenerating()}
                className="p-2.5 bg-surface-raised hover:bg-surface border border-line hover:border-muted text-prose rounded-lg transition-colors"
                title="Stop generating"
                aria-label="Stop generating"
              >
                <Square className="w-4 h-4" fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="p-2.5 bg-accent hover:bg-accent-hover rounded-lg text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Send (Enter or Cmd+Enter)"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </form>
      </div>
    </aside>
  );
}
