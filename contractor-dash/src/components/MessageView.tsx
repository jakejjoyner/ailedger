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
        <div className="max-w-2xl mx-auto">
          <Link to="/app/inbox" className="text-xs text-muted hover:text-accent flex items-center gap-1 mb-2 transition-colors">
            <ArrowLeft className="w-3 h-3" /> Inbox
          </Link>
          <h1 className="text-xl font-semibold tracking-tight text-prose">{data.subject}</h1>
          <div className="text-xs text-muted mt-1.5">
            from <span className="text-prose">{data.from}</span> · {data.date}
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
