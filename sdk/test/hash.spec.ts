// SDK sanity tests for hashing + normalization
//
// Run: pnpm test  (or: cd sdk && npx vitest run)

import { describe, expect, it } from 'vitest';
import { sha256hex, sha256jcs, isJsonContentType, computeInputsHash } from '../src/hash.js';
import { computeExtractorParamsHash } from '../src/canonicalize.js';
import { normalizeConfidence, normalizeTimestamp } from '../src/normalize.js';
import type { DetectionParseParams, DetectionReplayParams } from '../src/types.js';

describe('sha256hex', () => {
  it('returns null for null/undefined input', async () => {
    expect(await sha256hex(null)).toBeNull();
    expect(await sha256hex(undefined)).toBeNull();
  });

  it('returns null for empty string', async () => {
    expect(await sha256hex('')).toBeNull();
  });

  it('returns lowercase hex 64 chars for non-empty input', async () => {
    const result = await sha256hex('hello');
    expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });
});

describe('isJsonContentType', () => {
  it('matches application/json', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true);
    expect(isJsonContentType('APPLICATION/JSON')).toBe(true);
  });

  it('matches +json suffix', () => {
    expect(isJsonContentType('application/vnd.api+json')).toBe(true);
  });

  it('rejects non-JSON', () => {
    expect(isJsonContentType('text/plain')).toBe(false);
    expect(isJsonContentType('application/octet-stream')).toBe(false);
    expect(isJsonContentType(null)).toBe(false);
    expect(isJsonContentType(undefined)).toBe(false);
  });
});

describe('sha256jcs', () => {
  it('canonicalizes JSON keys regardless of insertion order', async () => {
    const a = JSON.stringify({ b: 2, a: 1 });
    const b = JSON.stringify({ a: 1, b: 2 });
    const ha = await sha256jcs(a, 'application/json');
    const hb = await sha256jcs(b, 'application/json');
    expect(ha).toBe(hb);
    expect(ha).not.toBeNull();
  });

  it('falls back to raw-byte hashing for non-JSON content', async () => {
    const result = await sha256jcs('hello', 'text/plain');
    expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('falls back to raw-byte hashing for malformed JSON', async () => {
    const result = await sha256jcs('{ not json', 'application/json');
    expect(result).not.toBeNull();
  });
});

describe('computeInputsHash', () => {
  it('canonicalizes object inputs regardless of key order', async () => {
    const a = await computeInputsHash({ b: 2, a: 1 });
    const b = await computeInputsHash({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('returns null for null inputs', async () => {
    expect(await computeInputsHash(null)).toBeNull();
  });
});

describe('normalizeConfidence', () => {
  it('truncates to 4 decimals', () => {
    expect(normalizeConfidence(0.85)).toBe(0.85);
    expect(normalizeConfidence(0.85238)).toBe(0.8524);
    expect(normalizeConfidence(0.123456789)).toBe(0.1235);
  });

  it('passes null through', () => {
    expect(normalizeConfidence(null)).toBeNull();
  });

  it('rejects out-of-range', () => {
    expect(() => normalizeConfidence(-0.1)).toThrow();
    expect(() => normalizeConfidence(1.5)).toThrow();
    expect(() => normalizeConfidence(Number.NaN)).toThrow();
    expect(() => normalizeConfidence(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('handles edge cases', () => {
    expect(normalizeConfidence(0)).toBe(0);
    expect(normalizeConfidence(1)).toBe(1);
  });
});

describe('normalizeTimestamp', () => {
  it('formats Date to microsecond-padded ISO', () => {
    const d = new Date('2026-05-18T12:34:56.789Z');
    expect(normalizeTimestamp(d)).toBe('2026-05-18T12:34:56.789000Z');
  });

  it('passes pre-formatted spec-shape string through unchanged', () => {
    const s = '2026-05-18T12:34:56.123456Z';
    expect(normalizeTimestamp(s)).toBe(s);
  });

  it('parses ISO strings and pads', () => {
    expect(normalizeTimestamp('2026-05-18T12:34:56.789Z')).toBe('2026-05-18T12:34:56.789000Z');
  });

  it('rejects invalid inputs', () => {
    expect(() => normalizeTimestamp(null)).toThrow();
    expect(() => normalizeTimestamp('not a timestamp')).toThrow();
  });
});

describe('computeExtractorParamsHash', () => {
  it('produces stable hash for detection.parse params', async () => {
    const p: DetectionParseParams = {
      trace_source: 'chain-of-thought',
      parse_strategy: 'pattern-match',
      parse_strategy_version: 'v1.0',
      ontology_ref: 'ailedger-generic:v0.1.0',
    };
    const h1 = await computeExtractorParamsHash('detection.parse', p);
    const h2 = await computeExtractorParamsHash('detection.parse', p);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it('throws on detection.replay invariant violation', async () => {
    const p: DetectionReplayParams = {
      extractor_model: 'claude-opus-4-7',
      replay_count: 3,
      temperature_grid: [0.0, 0.5, 1.0],
      // seed_grid length should be 3 * 3 = 9; supplying 4 violates invariant
      seed_grid: [1, 2, 3, 4],
      prompt_template_ref: 'template:v1',
      ontology_ref: 'ailedger-generic:v0.1.0',
      branch_points: ['t=100', 't=200'],
    };
    await expect(computeExtractorParamsHash('detection.replay', p)).rejects.toThrow();
  });
});
