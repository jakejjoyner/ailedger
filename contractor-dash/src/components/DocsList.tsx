import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, CircleAlert, Search, X } from "lucide-react";
import { listDocs, type DocEntry } from "../lib/api";

type SortMode = "title" | "id-desc" | "id-asc";

const SORT_LABELS: Record<SortMode, string> = {
  "title": "Title (A–Z)",
  "id-desc": "Newest first",
  "id-asc": "Oldest first",
};

// localStorage persistence — Pasha explicitly asked: "leave off from where I
// was reading so I don't have to find it again every time it refreshes."
// Persist scroll, query, sort, and last-opened id per user so the reading room
// picks up exactly where the contractor left it.
const DOCS_STATE_PREFIX = "docs_list_state_v1:";

interface DocsListState {
  scrollTop: number;
  query: string;
  sort: SortMode;
  lastOpenedId: string | null;
}

function loadState(userId: string): DocsListState {
  try {
    const raw = localStorage.getItem(DOCS_STATE_PREFIX + userId);
    if (!raw) return { scrollTop: 0, query: "", sort: "id-desc", lastOpenedId: null };
    const p = JSON.parse(raw) as Partial<DocsListState>;
    return {
      scrollTop: typeof p.scrollTop === "number" ? p.scrollTop : 0,
      query: typeof p.query === "string" ? p.query : "",
      sort: (p.sort as SortMode) || "id-desc",
      lastOpenedId: typeof p.lastOpenedId === "string" ? p.lastOpenedId : null,
    };
  } catch {
    return { scrollTop: 0, query: "", sort: "id-desc", lastOpenedId: null };
  }
}

function saveState(userId: string, s: DocsListState): void {
  try {
    localStorage.setItem(DOCS_STATE_PREFIX + userId, JSON.stringify(s));
  } catch {
    /* quota / private — best-effort */
  }
}

interface Props {
  userId: string;
}

export default function DocsList({ userId }: Props) {
  const initial = loadState(userId);
  const [items, setItems] = useState<DocEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState(initial.query);
  const [sort, setSort] = useState<SortMode>(initial.sort);
  const [lastOpenedId, setLastOpenedId] = useState<string | null>(initial.lastOpenedId);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const initialScroll = useRef(initial.scrollTop);
  const restoredScroll = useRef(false);

  useEffect(() => {
    let cancelled = false;
    listDocs()
      .then((r) => !cancelled && setItems(r.items))
      .catch((e: Error) => !cancelled && setErr(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist state changes (debounce-free; localStorage writes are cheap).
  useEffect(() => {
    saveState(userId, { scrollTop: scrollRef.current?.scrollTop ?? 0, query, sort, lastOpenedId });
  }, [userId, query, sort, lastOpenedId]);

  // After items load, restore prior scroll position once (layout stable).
  useEffect(() => {
    if (items && !restoredScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = initialScroll.current;
      restoredScroll.current = true;
    }
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return null;
    const q = query.trim().toLowerCase();
    const rows = q
      ? items.filter(
          (d) =>
            d.title.toLowerCase().includes(q) ||
            d.id.toLowerCase().includes(q),
        )
      : [...items];
    rows.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "id-asc") return a.id.localeCompare(b.id);
      return b.id.localeCompare(a.id); // "id-desc" (newest first by ISO-like id)
    });
    return rows;
  }, [items, query, sort]);

  if (err) {
    return (
      <div className="px-8 py-10">
        <div className="flex items-center gap-2 text-amber-400 mb-2">
          <CircleAlert className="w-4 h-4" />
          <h2 className="font-semibold text-prose">Reading room unavailable</h2>
        </div>
        <p className="text-sm text-muted">{err}</p>
      </div>
    );
  }
  if (items === null) return <div className="px-8 py-10 text-subtle text-sm">Loading…</div>;

  const total = items.length;
  const shown = filtered?.length ?? 0;

  // Record scroll position on scroll (throttled via rAF implicit). Write to
  // state effect re-saves. Cheap since we only write on meaningful changes.
  function onScroll() {
    const top = scrollRef.current?.scrollTop ?? 0;
    // Persist scroll directly (doesn't feed state to avoid re-render loop).
    try {
      const raw = localStorage.getItem(DOCS_STATE_PREFIX + userId);
      const prev = raw ? JSON.parse(raw) : {};
      localStorage.setItem(
        DOCS_STATE_PREFIX + userId,
        JSON.stringify({ ...prev, scrollTop: top }),
      );
    } catch {
      /* ignore */
    }
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-auto">
      <div className="px-6 md:px-8 py-5 sticky top-0 bg-paper/95 backdrop-blur-sm border-b border-line-soft z-10">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h1
              className="text-prose"
              style={{ fontFamily: "var(--font-serif)", fontSize: 30, fontWeight: 400, lineHeight: 1.25, letterSpacing: "-0.02em" }}
            >
              Reading room
            </h1>
            <span className="text-subtle" style={{ fontSize: 13, fontWeight: 400 }}>
              {query ? `${shown} of ${total}` : `${total} documents`}
            </span>
          </div>
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[12rem]">
              <Search className="w-4 h-4 text-subtle absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by title or filename…"
                className="w-full pl-9 pr-9 py-2 bg-surface border border-line rounded-md text-sm text-prose placeholder:text-subtle focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-colors"
                aria-label="Search documents"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-subtle hover:text-prose transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="px-3 py-2 bg-surface border border-line rounded-md text-sm text-prose focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-colors"
              aria-label="Sort order"
            >
              {Object.entries(SORT_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      {total === 0 ? (
        <div className="px-8 py-10 text-subtle text-sm flex items-center gap-2">
          <BookOpen className="w-4 h-4" /> Nothing here yet.
        </div>
      ) : shown === 0 ? (
        <div className="px-8 py-10 text-subtle text-sm">No documents match "{query}".</div>
      ) : (
        <ul className="max-w-4xl mx-auto px-2 md:px-4 py-2">
          {filtered!.map((d) => {
            const isLastOpened = d.id === lastOpenedId;
            return (
              <li key={d.id}>
                <Link
                  to={`/app/docs/${encodeURIComponent(d.id)}`}
                  onClick={() => setLastOpenedId(d.id)}
                  className={
                    "flex items-center gap-3.5 px-4 md:px-5 py-3.5 rounded-md transition-colors " +
                    (isLastOpened ? "bg-accent-soft" : "hover:bg-surface-raised")
                  }
                >
                  <BookOpen className={"w-4 h-4 shrink-0 " + (isLastOpened ? "text-accent" : "text-subtle")} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-prose" style={{ fontSize: 14, fontWeight: 500 }}>{d.title}</div>
                    <div className="truncate text-subtle mt-0.5" style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 400 }}>{d.id}</div>
                  </div>
                  {isLastOpened && (
                    <span className="text-accent shrink-0 uppercase tracking-wider" style={{ fontSize: 11, fontWeight: 500 }} aria-label="Last read">
                      Last read
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
