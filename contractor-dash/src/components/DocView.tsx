import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { readDoc } from "../lib/api";

export default function DocView() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ name: string; html: string; title: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    readDoc(id)
      .then((r) => !cancelled && setData(r))
      .catch((e: Error) => !cancelled && setErr(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (err) {
    return (
      <div className="px-8 py-10">
        <Link to="/app/docs" className="text-sm text-accent hover:text-accent-hover flex items-center gap-1 mb-4">
          <ArrowLeft className="w-3 h-3" /> Reading room
        </Link>
        <p className="text-sm text-rose-400">{err}</p>
      </div>
    );
  }
  if (!data) return <div className="px-8 py-10 text-subtle text-sm">Loading…</div>;

  return (
    <div className="h-full overflow-auto">
      <div className="px-8 py-6 sticky top-0 bg-paper/95 backdrop-blur-sm border-b border-line-soft">
        <div className="max-w-2xl mx-auto">
          <Link to="/app/docs" className="text-xs text-muted hover:text-accent flex items-center gap-1 mb-2 transition-colors">
            <ArrowLeft className="w-3 h-3" /> Reading room
          </Link>
          <h1 className="text-xl font-semibold tracking-tight text-prose">{data.title}</h1>
        </div>
      </div>
      <article
        className="prose-editorial mx-auto px-8 py-10"
        dangerouslySetInnerHTML={{ __html: data.html }}
      />
    </div>
  );
}
