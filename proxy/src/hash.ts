/**
 * Body hashing for the audit chain.
 *
 * For JSON bodies we canonicalize per RFC 8785 (JCS) before hashing so that
 * byte-level differences that do not change the logical JSON value (key
 * ordering, whitespace, number formatting) produce the SAME hash. Customers
 * can reproduce our hashes with any RFC 8785 implementation — no need to
 * match a proprietary serializer.
 *
 * Non-JSON bodies (binary, multipart, SSE text streams) are hashed as raw
 * bytes unchanged. SSE reconstruction to a canonical final-message shape is
 * the caller's responsibility; by default streaming responses flow through
 * the raw-byte path so the chain reflects exactly what was delivered to the
 * customer.
 *
 * JSON with embedded base64 binary: JCS preserves string values byte-for-byte,
 * so base64 blobs stay stable as long as the producer emits standard RFC 4648
 * encoding without line-wrapping — the OpenAI/Anthropic/Gemini SDKs all do.
 */

import canonicalize from 'canonicalize';

export async function sha256hex(data: ArrayBuffer | Uint8Array | string | null): Promise<string | null> {
	if (data === null) return null;
	const buf = typeof data === 'string'
		? new TextEncoder().encode(data)
		: data instanceof Uint8Array
			? data
			: new Uint8Array(data);
	if (buf.byteLength === 0) return null;
	const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
	return Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function isJsonContentType(contentType: string | null): boolean {
	if (!contentType) return false;
	const mime = contentType.toLowerCase().split(';')[0].trim();
	return mime === 'application/json' || mime.endsWith('+json');
}

/**
 * Canonicalized body hash. JSON bodies are parsed and serialized via RFC 8785
 * before SHA-256. On parse failure (malformed body despite a JSON content-type)
 * we fall back to raw-byte SHA-256 rather than drop the chain entry — an
 * unparseable body is still a delivered artifact the customer may want to
 * attest.
 */
export async function canonicalBodyHash(
	body: ArrayBuffer | null,
	contentType: string | null,
): Promise<string | null> {
	if (!body || body.byteLength === 0) return null;

	if (isJsonContentType(contentType)) {
		try {
			const text = new TextDecoder().decode(body);
			const parsed = JSON.parse(text);
			const canonical = canonicalize(parsed);
			if (typeof canonical === 'string') {
				return sha256hex(canonical);
			}
		} catch {
			// fall through to raw-byte hash
		}
	}

	return sha256hex(body);
}
