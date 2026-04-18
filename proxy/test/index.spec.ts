import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker, { parseAnthropicKeyPool, fetchAnthropicWithPool, type Env } from "../src";

describe("AILedger proxy worker", () => {
	describe("GET /health", () => {
		it("returns 200 with status:ok (unit style)", async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>(
				"http://example.com/health"
			);
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ status: "ok" });
		});

		it("returns 200 with status:ok (integration style)", async () => {
			const response = await SELF.fetch("http://example.com/health");
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ status: "ok" });
		});
	});

	describe("unknown routes", () => {
		it("returns 404 for unmatched paths", async () => {
			const response = await SELF.fetch("http://example.com/does-not-exist");
			expect(response.status).toBe(404);
		});
	});

	describe("/proxy/<provider> auth", () => {
		it("rejects missing x-ailedger-key with 401", async () => {
			const response = await SELF.fetch(
				"http://example.com/proxy/openai/chat/completions",
				{ method: "POST" }
			);
			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({
				error: "Missing x-ailedger-key header",
			});
		});

		it("rejects unknown provider with 400", async () => {
			const response = await SELF.fetch(
				"http://example.com/proxy/bogus/anything",
				{
					method: "POST",
					headers: { "x-ailedger-key": "agl_sk_fake" },
				}
			);
			expect(response.status).toBe(400);
		});
	});
});

// ai-55i: Anthropic multi-key upstream pool unit tests.
// The majority of the proxy is tested via integration against upstream APIs.
// These cover the pool logic (rotation, exhaustion, KV marking) in isolation.

const POOL_KEY_A = 'sk-ant-test-AAA';
const POOL_KEY_B = 'sk-ant-test-BBB';
const POOL_KEY_C = 'sk-ant-test-CCC';

async function clearPoolKV(): Promise<void> {
	const list = await env.AILEDGER_CACHE.list({ prefix: 'anthropic_pool:exhausted:' });
	await Promise.all(list.keys.map((k) => env.AILEDGER_CACHE.delete(k.name)));
}

function makeEnv(poolKeys: string[]): Env {
	return { ...env, ANTHROPIC_KEY_POOL: poolKeys.join(',') };
}

describe('parseAnthropicKeyPool', () => {
	it('returns [] when unset', () => {
		expect(parseAnthropicKeyPool(env)).toEqual([]);
	});

	it('splits on comma and trims whitespace', () => {
		const e = { ...env, ANTHROPIC_KEY_POOL: ' sk-a , sk-b ,sk-c ' } as Env;
		expect(parseAnthropicKeyPool(e)).toEqual(['sk-a', 'sk-b', 'sk-c']);
	});

	it('filters empty entries from trailing commas', () => {
		const e = { ...env, ANTHROPIC_KEY_POOL: 'sk-a,,sk-b,' } as Env;
		expect(parseAnthropicKeyPool(e)).toEqual(['sk-a', 'sk-b']);
	});
});

describe('fetchAnthropicWithPool', () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;
	const fetchCalls: { url: string; key: string | null }[] = [];

	beforeEach(async () => {
		await clearPoolKV();
		fetchCalls.length = 0;
		fetchSpy = vi.spyOn(globalThis, 'fetch');
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	function setUpstream(responses: Array<(req: Request) => Response>): void {
		let idx = 0;
		fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const req = input instanceof Request ? input : new Request(input as string, init);
			fetchCalls.push({ url: req.url, key: req.headers.get('x-api-key') });
			const handler = responses[Math.min(idx, responses.length - 1)];
			idx++;
			return handler(req);
		});
	}

	it('serves from first key when not exhausted', async () => {
		setUpstream([() => new Response('{"ok":true}', { status: 200 })]);

		const result = await fetchAnthropicWithPool({
			env: makeEnv([POOL_KEY_A, POOL_KEY_B]),
			pool: [POOL_KEY_A, POOL_KEY_B],
			upstreamUrl: 'https://api.anthropic.com/v1/messages',
			method: 'POST',
			baseHeaders: new Headers({ 'content-type': 'application/json' }),
			body: new TextEncoder().encode('{}').buffer,
		});

		expect(result.kind).toBe('ok');
		if (result.kind === 'ok') {
			expect(result.keyIndex).toBe(0);
			expect(result.rotations).toBe(0);
			expect(result.response.status).toBe(200);
		}
		expect(fetchCalls).toHaveLength(1);
		expect(fetchCalls[0].key).toBe(POOL_KEY_A);
	});

	it('rotates to next key on 429 and succeeds', async () => {
		setUpstream([
			() => new Response('{"error":"rate_limit"}', { status: 429 }),
			() => new Response('{"ok":true}', { status: 200 }),
		]);

		const result = await fetchAnthropicWithPool({
			env: makeEnv([POOL_KEY_A, POOL_KEY_B]),
			pool: [POOL_KEY_A, POOL_KEY_B],
			upstreamUrl: 'https://api.anthropic.com/v1/messages',
			method: 'POST',
			baseHeaders: new Headers(),
			body: null,
		});

		expect(result.kind).toBe('ok');
		if (result.kind === 'ok') {
			expect(result.keyIndex).toBe(1);
			expect(result.rotations).toBe(1);
			expect(result.response.status).toBe(200);
		}
		expect(fetchCalls.map((c) => c.key)).toEqual([POOL_KEY_A, POOL_KEY_B]);

		// First key marked exhausted in KV.
		const mark = await env.AILEDGER_CACHE.get('anthropic_pool:exhausted:0');
		expect(mark).toBeTruthy();
	});

	it('returns exhausted when all keys are already marked in KV', async () => {
		const now = Math.floor(Date.now() / 1000);
		await env.AILEDGER_CACHE.put('anthropic_pool:exhausted:0', String(now + 600), { expirationTtl: 600 });
		await env.AILEDGER_CACHE.put('anthropic_pool:exhausted:1', String(now + 300), { expirationTtl: 300 });

		setUpstream([() => new Response('unreachable', { status: 200 })]);

		const result = await fetchAnthropicWithPool({
			env: makeEnv([POOL_KEY_A, POOL_KEY_B]),
			pool: [POOL_KEY_A, POOL_KEY_B],
			upstreamUrl: 'https://api.anthropic.com/v1/messages',
			method: 'POST',
			baseHeaders: new Headers(),
			body: null,
		});

		expect(result.kind).toBe('exhausted');
		if (result.kind === 'exhausted') {
			// Earliest expiry is key 1 (300 seconds out).
			expect(result.earliestExpirySeconds).toBe(now + 300);
		}
		expect(fetchCalls).toHaveLength(0);
	});

	it('returns exhausted when every key in the pool 429s in sequence', async () => {
		setUpstream([
			() => new Response('{"error":"rate_limit"}', { status: 429 }),
			() => new Response('{"error":"rate_limit"}', { status: 429 }),
			() => new Response('{"error":"rate_limit"}', { status: 429 }),
		]);

		const result = await fetchAnthropicWithPool({
			env: makeEnv([POOL_KEY_A, POOL_KEY_B, POOL_KEY_C]),
			pool: [POOL_KEY_A, POOL_KEY_B, POOL_KEY_C],
			upstreamUrl: 'https://api.anthropic.com/v1/messages',
			method: 'POST',
			baseHeaders: new Headers(),
			body: null,
		});

		expect(result.kind).toBe('exhausted');
		expect(fetchCalls).toHaveLength(3);
		// All three keys got marked exhausted.
		for (let i = 0; i < 3; i++) {
			const mark = await env.AILEDGER_CACHE.get(`anthropic_pool:exhausted:${i}`);
			expect(mark).toBeTruthy();
		}
	});

	it('skips keys already marked exhausted', async () => {
		const now = Math.floor(Date.now() / 1000);
		await env.AILEDGER_CACHE.put('anthropic_pool:exhausted:0', String(now + 600), { expirationTtl: 600 });

		setUpstream([() => new Response('{"ok":true}', { status: 200 })]);

		const result = await fetchAnthropicWithPool({
			env: makeEnv([POOL_KEY_A, POOL_KEY_B]),
			pool: [POOL_KEY_A, POOL_KEY_B],
			upstreamUrl: 'https://api.anthropic.com/v1/messages',
			method: 'POST',
			baseHeaders: new Headers(),
			body: null,
		});

		expect(result.kind).toBe('ok');
		if (result.kind === 'ok') {
			expect(result.keyIndex).toBe(1);
			expect(result.rotations).toBe(0);
		}
		expect(fetchCalls).toHaveLength(1);
		expect(fetchCalls[0].key).toBe(POOL_KEY_B);
	});

	it('does not propagate non-429 upstream errors as rotations', async () => {
		setUpstream([() => new Response('{"error":"invalid"}', { status: 400 })]);

		const result = await fetchAnthropicWithPool({
			env: makeEnv([POOL_KEY_A, POOL_KEY_B]),
			pool: [POOL_KEY_A, POOL_KEY_B],
			upstreamUrl: 'https://api.anthropic.com/v1/messages',
			method: 'POST',
			baseHeaders: new Headers(),
			body: null,
		});

		expect(result.kind).toBe('ok');
		if (result.kind === 'ok') {
			expect(result.response.status).toBe(400);
			expect(result.keyIndex).toBe(0);
			expect(result.rotations).toBe(0);
		}
		// First key was NOT marked exhausted for a 400.
		const mark = await env.AILEDGER_CACHE.get('anthropic_pool:exhausted:0');
		expect(mark).toBeNull();
	});

	it('overrides any incoming Authorization header with x-api-key', async () => {
		setUpstream([() => new Response('{"ok":true}', { status: 200 })]);

		await fetchAnthropicWithPool({
			env: makeEnv([POOL_KEY_A]),
			pool: [POOL_KEY_A],
			upstreamUrl: 'https://api.anthropic.com/v1/messages',
			method: 'POST',
			baseHeaders: new Headers({
				authorization: 'Bearer client-supplied-token',
				'x-api-key': 'client-supplied-key',
			}),
			body: null,
		});

		const req = fetchSpy.mock.calls[0][0] as Request;
		expect(req.headers.get('x-api-key')).toBe(POOL_KEY_A);
		expect(req.headers.get('authorization')).toBeNull();
	});

	it('burst of 50 requests with one-of-two pool never leaks a 429 to the client', async () => {
		// Key 0 429s, key 1 always 200. Simulates "low-quota test account + second key".
		fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const req = input instanceof Request ? input : new Request(input as string, init);
			const key = req.headers.get('x-api-key');
			if (key === POOL_KEY_A) return new Response('{"error":"rate_limit"}', { status: 429 });
			return new Response('{"ok":true}', { status: 200 });
		});

		const results = await Promise.all(
			Array.from({ length: 50 }, () =>
				fetchAnthropicWithPool({
					env: makeEnv([POOL_KEY_A, POOL_KEY_B]),
					pool: [POOL_KEY_A, POOL_KEY_B],
					upstreamUrl: 'https://api.anthropic.com/v1/messages',
					method: 'POST',
					baseHeaders: new Headers(),
					body: null,
				})
			)
		);

		for (const r of results) {
			expect(r.kind).toBe('ok');
			if (r.kind === 'ok') {
				expect(r.response.status).toBe(200);
				expect(r.keyIndex).toBe(1);
			}
		}
	});
});
