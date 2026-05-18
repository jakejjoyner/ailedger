// AILedger SDK — extractor params canonical serialization per spec §7.2
//
// For each method (parse / restructure / replay / perturb), serialize the
// params block in canonical field order using pipe-delimited concatenation
// with the same null/empty conventions as spec §3:
//   - Scalars: coalesce(value::text, '')
//   - JSONB arrays: coalesce(value::text, '[]')
//   - JSONB objects: coalesce(value::text, '{}')
//
// For JSONB values within the param block (temperature_grid, seed_grid,
// bounds_spec, holdout_fields, branch_points), the canonical form is
// JCS applied to the JSON value, then the JCS output is hashed as part
// of the pipe-delimited blob.

import canonicalize from 'canonicalize';
import { sha256hex } from './hash.js';
import type {
  DetectionParseParams,
  DetectionReplayParams,
  DetectionRestructureParams,
  DetectionPerturbParams,
  ExtractorMethod,
  ExtractorParams,
} from './types.js';

/** Canonicalize a single value per spec §3 null/empty conventions. */
function canonicalizeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    // Per spec §4 Option A: storage precision IS canonical. JS Number doesn't
    // carry trailing-zero info; producers responsible for emitting via String()
    // conversion that matches their storage precision when known. For SDK-
    // computed params (e.g. seed), Number → String is unambiguous.
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    const c = canonicalize(value);
    return c ?? '[]';
  }
  if (typeof value === 'object') {
    const c = canonicalize(value as Parameters<typeof canonicalize>[0]);
    return c ?? '{}';
  }
  return String(value);
}

/** detection.parse canonical order per spec §6.1 */
function canonicalizeParse(p: DetectionParseParams): string {
  return [
    canonicalizeValue(p.trace_source),
    canonicalizeValue(p.parse_strategy),
    canonicalizeValue(p.parse_strategy_version),
    canonicalizeValue(p.ontology_ref),
  ].join('|');
}

/** detection.restructure canonical order per spec §6.2 */
function canonicalizeRestructure(p: DetectionRestructureParams): string {
  return [
    canonicalizeValue(p.extractor_model),
    canonicalizeValue(p.extractor_temperature),
    canonicalizeValue(p.extractor_seed),
    canonicalizeValue(p.prompt_template_ref),
    canonicalizeValue(p.ontology_ref),
    canonicalizeValue(p.max_tokens),
  ].join('|');
}

/** detection.replay canonical order per spec §6.3 */
function canonicalizeReplay(p: DetectionReplayParams): string {
  if (p.seed_grid.length !== p.replay_count * p.temperature_grid.length) {
    throw new Error(
      `detection.replay invariant violated: seed_grid length ${p.seed_grid.length} must equal replay_count (${p.replay_count}) * temperature_grid length (${p.temperature_grid.length}) = ${p.replay_count * p.temperature_grid.length}`,
    );
  }
  return [
    canonicalizeValue(p.extractor_model),
    canonicalizeValue(p.replay_count),
    canonicalizeValue(p.temperature_grid),
    canonicalizeValue(p.seed_grid),
    canonicalizeValue(p.prompt_template_ref),
    canonicalizeValue(p.ontology_ref),
    canonicalizeValue(p.branch_points),
  ].join('|');
}

/** detection.perturb canonical order per spec §6.4 */
function canonicalizePerturb(p: DetectionPerturbParams): string {
  return [
    canonicalizeValue(p.extractor_model),
    canonicalizeValue(p.perturbation_strategy),
    canonicalizeValue(p.perturbation_strategy_version),
    canonicalizeValue(p.perturbation_count),
    canonicalizeValue(p.bounds_spec),
    canonicalizeValue(p.prompt_template_ref),
    canonicalizeValue(p.ontology_ref),
    canonicalizeValue(p.holdout_fields),
  ].join('|');
}

/**
 * Compute extractor_params_hash for a given method + params.
 *
 * Returns SHA-256 hex-lowercase of the canonical-serialized param block
 * per spec §7.2. Stored on the inferred Detection Event row.
 */
export async function computeExtractorParamsHash(
  method: ExtractorMethod,
  params: ExtractorParams,
): Promise<string> {
  let canonical: string;
  switch (method) {
    case 'detection.parse':
      canonical = canonicalizeParse(params as DetectionParseParams);
      break;
    case 'detection.restructure':
      canonical = canonicalizeRestructure(params as DetectionRestructureParams);
      break;
    case 'detection.replay':
      canonical = canonicalizeReplay(params as DetectionReplayParams);
      break;
    case 'detection.perturb':
      canonical = canonicalizePerturb(params as DetectionPerturbParams);
      break;
    default: {
      const exhaustive: never = method;
      throw new Error(`Unknown extractor method: ${String(exhaustive)}`);
    }
  }
  const hash = await sha256hex(canonical);
  if (hash === null) throw new Error('SHA-256 returned null for non-empty canonical input');
  return hash;
}
