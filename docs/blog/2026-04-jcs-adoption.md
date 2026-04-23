---
title: "Why AILedger adopted RFC 8785 for audit hash canonicalization"
date: 2026-04-22
status: DRAFT — pending Jake voice-review
---

# Why AILedger adopted RFC 8785 for audit hash canonicalization

A short post about a small change that quietly fixes a category of customer-support headaches we'd otherwise have spent years explaining away.

## The problem: same JSON, different hash

AILedger's promise is straightforward — every AI inference your application makes gets recorded to a tamper-evident, append-only chain. When a regulator (or your security team, or a curious auditor) asks "what did your model produce on April 14, at 2:07pm, for user 8819?" you can answer with mathematical certainty: here is the request, here is the response, here is the SHA-256 hash, here is the chain link that proves nobody has touched it since.

The catch is that "the SHA-256 hash" implies "of what bytes?" And that's where JSON gets mischievous.

Consider two requests your SDK might emit for the same logical inference:

```json
{"model":"gpt-4","temperature":0.7,"messages":[{"role":"user","content":"hi"}]}
```

```json
{
  "messages": [{"content": "hi", "role": "user"}],
  "model": "gpt-4",
  "temperature": 0.7
}
```

Semantically identical. Byte-wise different. And SHA-256 doesn't care about your intent — it cares about your bytes. Hash the first, hash the second, and you get two different fingerprints for what is, by every reasonable definition, the same call.

This isn't a hypothetical. JavaScript's `JSON.stringify` preserves insertion order. Python's `json.dumps` defaults to insertion order but flips to sorted on `sort_keys=True`. Go's `encoding/json` sorts struct fields. Different SDK versions add or remove default whitespace. Numbers serialize as `1`, `1.0`, or `1e0` depending on whether they came in as `int`, `float`, or scientific notation.

Multiply that by every customer, every SDK, every language, every version, and you get a long tail of "why doesn't my hash match yours?" tickets that have nothing to do with the chain itself and everything to do with serialization roulette.

## The fix: a thirty-year-old idea, finally standardized

The fix is to canonicalize the JSON before hashing — pick one and only one byte representation per logical value, hash that, and you're done.

People have been writing canonical-JSON helpers since the late 1990s. The trouble is that everyone's helper was slightly different, which meant everyone's hash was slightly different, which meant the canonicalization step itself became the new "why doesn't my hash match yours?" The thing that was supposed to fix the problem became the problem.

[RFC 8785 — JSON Canonicalization Scheme (JCS)][rfc8785], published by the IETF in 2020, settles this. It specifies, byte for byte, exactly how to serialize any JSON value: keys sorted lexicographically, no insignificant whitespace, numbers normalized to the ECMAScript `Number.prototype.toString` form, strings escaped per RFC 8259 with a fixed set of rules. It's short, it's unambiguous, and there are conforming implementations in TypeScript, Python, Go, Rust, Java, C, and most other languages a customer might reach for.

Starting this release, AILedger's proxy canonicalizes JSON request and response bodies per RFC 8785 before computing their SHA-256. If your SDK sends keys in a different order than ours expects, the bytes go through JCS first, the hashes line up, and nobody has to know.

## What this means for you

If you're a customer:

- **You don't need to match a proprietary serializer.** Pick any RFC 8785 implementation in your language — `canonicalize` on npm, `rfc8785` on PyPI, `gowebpki/jcs` in Go — and you can independently reproduce any of our hashes with one library call.
- **Your existing chain rows are unchanged.** Hashes written before this release reflect the bytes that were actually stored at the time. We don't rewrite history; the chain's `chain_prev_hash` linkage stays intact across the boundary.
- **The customer-side verification flow stays a single SQL call.** `verify_chain()` doesn't care which derivation rule produced the hashes — it just walks the linkage. JCS makes the upstream hash *reproducible by you*; the chain itself was already verifiable.

## Edge cases we considered

Two paths deliberately do not go through JCS:

1. **Streaming responses (Server-Sent Events).** SSE chunks are hashed as raw bytes — exactly what the customer's SDK received. Reconstructing a stream into a logical final JSON object and canonicalizing that is an opt-in pattern (and the test suite proves it produces a chunk-boundary-stable hash when callers do choose it), but the default is faithful-to-the-wire.

2. **Binary and multipart bodies.** Image uploads, audio, multipart form data — all hashed as raw bytes. JCS only governs JSON; everything else stays on the byte-equality path it was already on.

For JSON bodies that contain embedded base64 (vision API calls, file uploads as data URIs), JCS preserves string contents byte-for-byte, so as long as your producer emits standard RFC 4648 base64 without line wrapping — which the OpenAI, Anthropic, and Gemini SDKs all do — the embedded payloads remain stable across the canonicalization boundary.

## Thanks

This was a small change in our codebase that resolves a large class of cross-SDK verification problems for our customers, and we owe that to the people who did the hard work upstream:

- **Anders Rundgren**, primary author of RFC 8785 and a long-time advocate for interoperable JSON canonicalization. The standard exists because he kept pushing on it.
- **Samuel Erdtman**, co-author of RFC 8785 and maintainer of the `canonicalize` npm package we depend on.
- **Bret Jordan**, co-author of RFC 8785.
- The **IETF JOSE Working Group**, which shepherded the RFC through to publication and gave the broader ecosystem a stable target to converge on.

If you're building anything where two parties need to agree on the hash of a JSON value — audit chains, signed envelopes, content-addressed storage, replay-safe APIs — RFC 8785 is the answer, and it's the answer because of these folks. Thank you.

[rfc8785]: https://www.rfc-editor.org/rfc/rfc8785
