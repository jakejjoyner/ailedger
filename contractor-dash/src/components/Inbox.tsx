import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Inbox as InboxIcon, CircleAlert } from "lucide-react";
import { listInbox, type InboxEntry } from "../lib/api";

export default function Inbox() {
  const [items, setItems] = useState<InboxEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listInbox()
      .then((r) => {
        if (!cancelled) setItems(r.items);
      })
      .catch((e: Error) => {
        if (!cancelled) setErr(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return (
      <div className="px-8 py-10">
        <div className="flex items-center gap-2 text-amber-400 mb-2">
          <CircleAlert className="w-4 h-4" />
          <h2 className="font-semibold text-prose">Inbox unavailable</h2>
        </div>
        <p className="text-sm text-muted">The desktop API isn't reachable right now ({err}).</p>
      </div>
    );
  }
  if (items === null) {
    return <div className="px-8 py-10 text-subtle text-sm">Loading inbox…</div>;
  }
  if (items.length === 0) {
    return (
      <div className="px-8 py-10 text-subtle text-sm flex items-center gap-2">
        <InboxIcon className="w-4 h-4" /> No messages.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="px-6 md:px-8 py-5 sticky top-0 bg-paper/95 backdrop-blur-sm border-b border-line-soft">
        <div className="max-w-4xl mx-auto">
          <h1
            className="text-prose"
            style={{ fontFamily: "var(--font-serif)", fontSize: 30, fontWeight: 400, lineHeight: 1.25, letterSpacing: "-0.02em" }}
          >
            Inbox
          </h1>
        </div>
      </div>
      <ul className="max-w-4xl mx-auto px-2 md:px-4 py-2">
        {items.map((m) => (
          <li key={m.id}>
            <Link
              to={`/app/inbox/${encodeURIComponent(m.id)}`}
              className={`flex items-center gap-4 px-4 md:px-5 py-3.5 rounded-md transition-colors hover:bg-surface-raised ${
                m.unread ? "text-prose" : "text-muted"
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.unread ? "bg-accent" : "bg-transparent"}`} />
              <div className="w-24 uppercase tracking-wider text-subtle shrink-0" style={{ fontSize: 11, fontWeight: 500 }}>{m.from}</div>
              <div className="flex-1 truncate" style={{ fontSize: 14, fontWeight: m.unread ? 600 : 500 }}>{m.subject}</div>
              <div className="text-subtle shrink-0" style={{ fontSize: 13, fontWeight: 400 }}>{formatDate(m.date)}</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
