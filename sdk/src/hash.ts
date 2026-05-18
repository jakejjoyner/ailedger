// AILedger SDK — hashing primitives per param canonicalization spec v1.0
//
// All hashing is SHA-256 hex-lowercase. String encoding is UTF-8 strict.
// JSON bodies are RFC 8785 JCS-canonicalized before hashing.
//
// Ported from proxy/src/index.ts sha256hex + sha256jcs (which run in
// Cloudflare Workers). This SDK runs in Node 20+ where the Web Crypto
// API is available globally as `crypto.subtle`.
//
// Authority: docs/param-canonicalization-spec-v1.md §2

import canonicalize from 'canonicalize';

/**
 * SHA-256 hex-lowercase of arbitrary bytes or string.
 *
 * Returns null for null/undefined/empty input per spec §2: "empty/null body...
 * is stored as SQL NULL and serialized as empty string ''". The caller
 * decides whether to treat null vs empty as identical or distinct.
 */
export async function sha256hex(data: ArrayBuffer | string | null | undefined): Promise<string | null> {
  if (data === null || data === undefined) return null;
  const buf =
    typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  if (buf.byteLength === 0) return null;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Check whether a content-type header indicates JSON per spec §2.
 *
 * Matches `application/json` (case-insensitive) or any suffixed `+json`
 * (e.g. `application/vnd.api+json`).
 */
export function isJsonContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase().split(';')[0].trim();
  return ct === 'application/json' || ct.endsWith('+json');
}

/**
 * Spec §2 content branching:
 * - JSON content + parses as valid JSON → SHA-256(JCS(parsed))
 * - Anything else (binary, malformed JSON, multipart, etc.) → SHA-256(raw-bytes)
 *
 * JCS rejects NaN, Infinity, symbols, undefined. When JCS rejects or parsing
 * fails, this function falls through to raw-byte hashing without throwing.
 */
export async function sha256jcs(
  data: ArrayBuffer | string | null | undefined,
  contentType: string | null | undefined,
): Promise<string | null> {
  if (data === null || data === undefined) return null;
  const buf =
    typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  if (buf.byteLength === 0) return null;

  if (isJsonContentType(contentType)) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buf);
      const parsed = JSON.parse(text);
      const canonical = canonicalize(parsed);
      if (canonical !== undefined) {
        return sha256hex(canonical);
      }
    } catch {
      // Fall through to raw-byte hashing; matches proxy/src/index.ts behavior.
    }
  }

  return sha256hex(buf.buffer);
}

/**
 * Compute inputs_hash for a Detection Event per spec §7.3.
 *
 * Producers pass the raw decision inputs as either a structured object
 * (treated as JSON) or as raw bytes/string. The SDK never transmits the
 * raw inputs; only the hash flows to the chain.
 */
export async function computeInputsHash(
  inputs: Record<string, unknown> | ArrayBuffer | string | null,
  contentType?: string,
): Promise<string | null> {
  if (inputs === null) return null;

  if (typeof inputs === 'object' && !(inputs instanceof ArrayBuffer)) {
    // Object input: JCS-canonicalize then hash. Default content-type implicitly application/json.
    const canonical = canonicalize(inputs as Parameters<typeof canonicalize>[0]);
    if (canonical === undefined) return null;
    return sha256hex(canonical);
  }

  return sha256jcs(inputs, contentType ?? null);
}
