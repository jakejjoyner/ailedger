import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { readMessage, markRead } from "../lib/api";

export default function MessageView() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ name: string; html: string; subject: string; from: string; date: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    readMessage(id)
      .then((r) => {
        if (!cancelled) setData(r);
        // Mark read on successful render. Ignore mark-read failures.
        markRead(id).catch(() => {});
      })
      .catch((e: Error) => {
        if (!cancelled) setErr(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (err) {
    return (
      <div className="px-8 py-10">
        <Link to="/app/inbox" className="text-sm text-accent hover:text-accent-hover flex items-center gap-1 mb-4">
          <ArrowLeft className="w-3 h-3" /> Inbox
        </Link>
        <p className="text-sm text-rose-400">Failed to load message: {err}</p>
      </div>
    );
  }
  if (!data) {
    return <div className="px-8 py-10 text-subtle text-sm">Loading…</div>;
  }

  return (
    <div className="h-full overflow-auto">
      <div className="px-8 py-6 sticky top-0 bg-paper/95 backdrop-blur-sm border-b border-line-soft">
        <div className="max-w-[768px] mx-auto">
          <Link to="/app/inbox" className="text-muted hover:text-accent inline-flex items-center gap-1 mb-3 transition-colors" style={{ fontSize: 14, fontWeight: 500 }}>
            <ArrowLeft className="w-3.5 h-3.5" /> Inbox
          </Link>
          <h1
            className="text-prose"
            style={{ fontFamily: "var(--font-serif)", fontSize: 30, fontWeight: 400, lineHeight: 1.25, letterSpacing: "-0.02em" }}
          >
            {data.subject}
          </h1>
          <div className="text-muted mt-2" style={{ fontSize: 13, fontWeight: 400 }}>
            from <span className="text-prose" style={{ fontWeight: 500 }}>{data.from}</span> · {data.date}
          </div>
        </div>
      </div>
      <article
        className="prose-editorial mx-auto px-8 py-10"
        dangerouslySetInnerHTML={{ __html: data.html }}
      />
    </div>
  );
}
