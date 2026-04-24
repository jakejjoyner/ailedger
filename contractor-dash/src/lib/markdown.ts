// Safe markdown rendering for Jo messages.
//
// marked parses the markdown; DOMPurify strips anything script-y from the
// resulting HTML before it hits React's dangerouslySetInnerHTML. A
// post-processing pass wraps <pre><code> blocks with a header row that
// surfaces the detected language and a copy-to-clipboard affordance (the
// click handler is attached at render time by JoChat via delegation).

import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({
  gfm: true,
  breaks: true,
});

// DOMPurify's default allowed set is a safe HTML subset; we only need to
// ensure code blocks keep their `class` (for lang) + `data-*` (for the
// copy handler lookup).
const PURIFY_OPTS: import("dompurify").Config = {
  ADD_ATTR: ["target", "rel", "data-lang", "data-copy-id"],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
};

let _copyIdSeq = 0;

/**
 * Render markdown → sanitized HTML with code-block wrappers.
 *
 * @param src Raw markdown (streamed text is fine — we render defensively).
 * @returns Safe HTML string ready for dangerouslySetInnerHTML.
 */
export function renderMarkdown(src: string): string {
  const html = marked.parse(src, { async: false }) as string;
  const clean = DOMPurify.sanitize(html, PURIFY_OPTS) as unknown as string;
  return wrapCodeBlocks(clean);
}

/**
 * Given already-sanitized HTML, find <pre><code class="language-xxx">…</code></pre>
 * and wrap with a scaffold that shows the language label + a copy button
 * placeholder. The copy button is rendered by the host component using event
 * delegation on the container (see JoChat.tsx).
 */
function wrapCodeBlocks(html: string): string {
  return html.replace(
    /<pre><code(?:\s+class="([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g,
    (_m, cls: string | undefined, body: string) => {
      const lang = (cls || "").replace(/^.*language-([\w+-]+).*$/, "$1") || "";
      const label = lang || "code";
      const id = `c${++_copyIdSeq}`;
      return (
        `<div class="jo-code-block" data-copy-id="${id}">` +
        `<div class="jo-code-head">` +
        `<span class="jo-code-lang">${escapeHtml(label)}</span>` +
        `<button type="button" class="jo-code-copy" data-copy-for="${id}" aria-label="Copy code">Copy</button>` +
        `</div>` +
        `<pre><code${cls ? ` class="${cls}"` : ""} data-copy-id="${id}">${body}</code></pre>` +
        `</div>`
      );
    },
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      case "'": return "&#39;";
      default: return ch;
    }
  });
}
