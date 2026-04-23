# AILedger Proxy Changelog

## Unreleased

### Added

- **RFC 8785 JSON Canonicalization Scheme (JCS) for audit-chain body hashes.**
  JSON request and response bodies are now canonicalized per [RFC 8785][rfc8785]
  before SHA-256 hashing, so semantically-equal JSON (e.g. differing only in
  key order, whitespace, or number formatting) produces the same hash. Customers
  can now reproduce our audit hashes with any conforming RFC 8785 library
  without matching a proprietary serializer. Non-JSON bodies (binary,
  multipart, `text/event-stream`) continue to hash as raw bytes unchanged.

  Migration note: existing rows in the tamper-evident chain retain the
  raw-byte hashes they were written with — those reflect what was actually
  stored at the time and are not rewritten. All new rows from this release
  forward use JCS for JSON bodies. The chain's `chain_prev_hash` linkage
  remains intact across the boundary; only the `input_hash` / `output_hash`
  derivation changes for JSON content-types going forward.

### Thanks

Adopting JCS was a tiny code change that resolves a large class of cross-SDK
verification problems for our customers. We're grateful to:

- **Anders Rundgren** — primary author of RFC 8785 and a long-time advocate
  for interoperable JSON canonicalization.
- **Samuel Erdtman** — co-author of RFC 8785 and maintainer of the
  [`canonicalize`](https://www.npmjs.com/package/canonicalize) npm package
  we depend on.
- **Bret Jordan** — co-author of RFC 8785.
- The **IETF JOSE Working Group**, which shepherded the RFC through to
  publication.

[rfc8785]: https://www.rfc-editor.org/rfc/rfc8785
