import { describe, it, expect } from 'vitest';
import { sha256hex, canonicalBodyHash } from '../src/hash';

const enc = (s: string): ArrayBuffer => {
	const bytes = new TextEncoder().encode(s);
	const ab = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(ab).set(bytes);
	return ab;
};

describe('canonicalBodyHash — RFC 8785 canonicalization', () => {
	it('equates JSON bodies that differ only in key order', async () => {
		const a = enc('{"model":"gpt-4","temperature":0.7,"messages":[{"role":"user","content":"hi"}]}');
		const b = enc('{"messages":[{"content":"hi","role":"user"}],"temperature":0.7,"model":"gpt-4"}');
		const ha = await canonicalBodyHash(a, 'application/json');
		const hb = await canonicalBodyHash(b, 'application/json');
		expect(ha).toBe(hb);
		expect(ha).toMatch(/^[a-f0-9]{64}$/);
	});

	it('equates JSON bodies that differ only in whitespace', async () => {
		const compact = enc('{"a":1,"b":[2,3]}');
		const pretty = enc('{\n  "a" : 1,\n  "b" : [ 2, 3 ]\n}');
		const hc = await canonicalBodyHash(compact, 'application/json');
		const hp = await canonicalBodyHash(pretty, 'application/json');
		expect(hc).toBe(hp);
	});

	it('equates JSON bodies that differ only in number formatting', async () => {
		// RFC 8785 §3.2.2.3 normalizes numbers to ES6 Number.prototype.toString form.
		const a = enc('{"x":1.0}');
		const b = enc('{"x":1}');
		const c = enc('{"x":1e0}');
		const ha = await canonicalBodyHash(a, 'application/json');
		const hb = await canonicalBodyHash(b, 'application/json');
		const hc = await canonicalBodyHash(c, 'application/json');
		expect(ha).toBe(hb);
		expect(hb).toBe(hc);
	});

	it('preserves embedded base64 strings byte-for-byte (RFC 4648, no linewrap)', async () => {
		// JCS only touches JSON structure, not string contents, so base64 payloads
		// hash stably regardless of surrounding JSON layout.
		const payload = 'SGVsbG8sIHdvcmxkISBUaGlzIGlzIGEgYmFzZTY0IHN0cmluZy4=';
		const a = enc(`{"data":"${payload}","name":"blob"}`);
		const b = enc(`{ "name" : "blob" , "data" : "${payload}" }`);
		expect(await canonicalBodyHash(a, 'application/json'))
			.toBe(await canonicalBodyHash(b, 'application/json'));
	});

	it('accepts +json subtype content-types', async () => {
		const body = enc('{"a":1,"b":2}');
		const asJson = await canonicalBodyHash(body, 'application/json');
		const asMerge = await canonicalBodyHash(body, 'application/merge-patch+json');
		expect(asJson).toBe(asMerge);
	});

	it('tolerates content-type charset suffixes', async () => {
		const body = enc('{"a":1}');
		expect(await canonicalBodyHash(body, 'application/json; charset=utf-8'))
			.toBe(await canonicalBodyHash(body, 'application/json'));
	});

	it('falls back to raw-byte SHA-256 for non-JSON content (binary)', async () => {
		// Simulate a binary body (e.g. multipart upload). Two byte sequences that
		// decode to the same "JSON-looking" text must still hash differently
		// if the bytes differ — non-JSON path is raw-byte.
		const bin = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe]).buffer;
		const h = await canonicalBodyHash(bin, 'application/octet-stream');
		const raw = await sha256hex(bin);
		expect(h).toBe(raw);
	});

	it('falls back to raw-byte SHA-256 for SSE streams', async () => {
		// SSE is text/event-stream — the chain stores exactly the bytes delivered
		// to the customer. Reconstruction + canonicalization is an opt-in
		// callsite concern, not the default body-hash path.
		const sse = enc(
			'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
			'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
			'data: [DONE]\n\n'
		);
		const h = await canonicalBodyHash(sse, 'text/event-stream');
		const raw = await sha256hex(sse);
		expect(h).toBe(raw);
	});

	it('falls back to raw-byte SHA-256 when content-type is missing', async () => {
		const body = enc('{"a":1}');
		const h = await canonicalBodyHash(body, null);
		const raw = await sha256hex(body);
		expect(h).toBe(raw);
	});

	it('falls back to raw-byte SHA-256 on malformed JSON despite JSON content-type', async () => {
		// Unparseable body with JSON content-type: still hash something (raw
		// bytes) so the chain entry is preserved.
		const bad = enc('{this is not, json[');
		const h = await canonicalBodyHash(bad, 'application/json');
		const raw = await sha256hex(bad);
		expect(h).toBe(raw);
		expect(h).toMatch(/^[a-f0-9]{64}$/);
	});

	it('returns null for null or empty bodies', async () => {
		expect(await canonicalBodyHash(null, 'application/json')).toBeNull();
		expect(await canonicalBodyHash(new ArrayBuffer(0), 'application/json')).toBeNull();
	});

	it('reconstructed SSE → canonicalized JSON yields chunk-boundary-stable hash', async () => {
		// If a callsite chooses to reconstruct a streaming response into its
		// logical final JSON, JCS makes that hash independent of how the stream
		// was chunked upstream. This is the "streaming-reconstruction" property
		// the chain relies on when customers replay their own SDK traces.
		const reconstruct = (chunks: string[]) => {
			let text = '';
			for (const chunk of chunks) {
				for (const line of chunk.split('\n')) {
					if (!line.startsWith('data:')) continue;
					const payload = line.slice(5).trim();
					if (!payload || payload === '[DONE]') continue;
					const obj = JSON.parse(payload);
					const delta = obj?.choices?.[0]?.delta?.content ?? '';
					text += delta;
				}
			}
			return { role: 'assistant', content: text };
		};

		const chunkingA = [
			'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
			'data: {"choices":[{"delta":{"content":"lo, "}}]}\n\n',
			'data: {"choices":[{"delta":{"content":"world!"}}]}\n\n',
			'data: [DONE]\n\n',
		];
		const chunkingB = [
			'data: {"choices":[{"delta":{"content":"H"}}]}\n\ndata: {"choices":[{"delta":{"content":"ello, world!"}}]}\n\n',
			'data: [DONE]\n\n',
		];

		const reconA = reconstruct(chunkingA);
		const reconB = reconstruct(chunkingB);
		expect(reconA).toEqual(reconB);

		const encodeObj = (o: unknown) => enc(JSON.stringify(o));
		// Different JSON.stringify output is fine — JCS will normalize.
		const ha = await canonicalBodyHash(encodeObj(reconA), 'application/json');
		const hb = await canonicalBodyHash(
			enc('{"content":"Hello, world!","role":"assistant"}'),
			'application/json',
		);
		expect(ha).toBe(hb);
	});
});

describe('sha256hex', () => {
	it('hashes strings to lowercase hex', async () => {
		const h = await sha256hex('hello');
		expect(h).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
	});

	it('returns null for empty or null input', async () => {
		expect(await sha256hex('')).toBeNull();
		expect(await sha256hex(null)).toBeNull();
		expect(await sha256hex(new ArrayBuffer(0))).toBeNull();
	});
});
