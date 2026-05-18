// AILedger SDK — Detection Event types
//
// Mirrors ledger.decision_events schema (proxy/migrations/20260512_*) plus the
// inferred-event extension (proxy/migrations/20260518_*). SQL identifiers retain
// "decision_events" naming until coordinated rename migration (bead hq-4yh);
// TypeScript types and prose use "Detection Event" per ratified naming
// 2026-05-17.
//
// Authority: docs/param-canonicalization-spec-v1.md (Jake-ratified 2026-05-18)

/** Method ladder per spec §6 + docs/compliance-architecture/HANDOFF-decision-event-layer.md */
export type ExtractorMethod =
  | 'detection.parse'
  | 'detection.restructure'
  | 'detection.replay'
  | 'detection.perturb';

/** Protected-class collection method per Annex III taxonomy */
export type ProtectedClassCollectionMethod = 'direct' | 'inferred' | 'blind';

/** Chain spec version pinned per row */
export type ChainSpecVersion = 1 | 2;

/**
 * Canonical (production-time) Detection Event.
 *
 * Emitted at AI decision time. Hash-chained at INSERT by the database trigger
 * (BEFORE INSERT). The SDK does NOT compute hash_chain_prev / hash_chain_self;
 * those are populated server-side.
 */
export interface DetectionEvent {
  /** UUID; SDK generates or producer supplies */
  event_id: string;

  /** ISO-8601 UTC microsecond precision; SDK normalizes */
  timestamp: string;

  /** UUID; per-tenant scope */
  tenant_id: string;

  /** UUID; per-system identifier (which deployment within the tenant) */
  system_id: string;

  /** Model name + version (e.g. "claude-opus-4-7") */
  model_version?: string | null;

  /** SHA-256 hex of model weights (if known); empty string in canonical if null */
  model_weights_hash?: string | null;

  /** Decision type from Annex III + custom taxonomy */
  decision_type?: string | null;

  /** HMAC-pseudonymized subject identifier; same subject yields same id */
  subject_id?: string | null;

  /** SHA-256 hex of canonical-serialized inputs; SDK computes client-side */
  inputs_hash?: string | null;

  /** Structured decision output (JSONB on the DB side) */
  output?: Record<string, unknown> | null;

  /** Confidence; SDK normalizes to 4-decimal precision before insert */
  confidence?: number | null;

  /** Whether a human reviewed the decision before action */
  human_in_loop?: boolean | null;

  /** Protected-class context (JSONB on DB side) */
  protected_class_context?: Record<string, unknown> | null;

  /** How protected-class data was obtained */
  protected_class_collection_method?: ProtectedClassCollectionMethod | null;

  /** Flags raised by the decision pipeline */
  flags_raised?: string[];

  /** Required actions identified by the decision pipeline */
  required_actions?: string[];

  /** Actions actually taken downstream */
  actions_taken?: string[];

  /**
   * Defaults to 2 for new inserts. v1 rows preserved as-was.
   * Set by SDK at emit time; trigger respects.
   */
  chain_spec_version?: ChainSpecVersion;
}

/**
 * Inferred Detection Event — produced by the extraction method ladder.
 *
 * Lives in the same `ledger.decision_events` table as canonical events;
 * distinguished by extractor_* fields + anchor_event_id. New chain entries,
 * hash-chained at extraction time. Re-running inference produces NEW
 * evidentiary objects, not amendments per spec §5.
 */
export interface InferredDetectionEvent extends DetectionEvent {
  /** Model name + version of the extractor (e.g. "claude-opus-4-7@1m") */
  extractor_model: string;

  /** Which rung of the method ladder this row came from */
  extractor_method: ExtractorMethod;

  /** Extractor parameters (JSONB on DB side); see method-specific schemas */
  extractor_params: Record<string, unknown>;

  /** SHA-256 hex of canonical-serialized extractor_params; SDK computes */
  extractor_params_hash: string;

  /** UUID of the canonical Detection Event being extracted from */
  anchor_event_id: string;

  /** ISO-8601 UTC: when the extraction job started */
  extraction_started_at: string;

  /** Extraction compute time in milliseconds */
  extraction_compute_ms: number;
}

/** Method-specific param schemas per spec §6 */
export interface DetectionParseParams {
  trace_source: 'chain-of-thought' | 'structured-output' | 'tool-call-sequence';
  parse_strategy: 'pattern-match' | 'regex-named-groups' | 'json-path';
  parse_strategy_version: string;
  ontology_ref: string;
}

export interface DetectionRestructureParams {
  extractor_model: string;
  extractor_temperature: number;
  extractor_seed: number;
  prompt_template_ref: string;
  ontology_ref: string;
  max_tokens: number;
}

export interface DetectionReplayParams {
  extractor_model: string;
  replay_count: number;
  temperature_grid: number[];
  seed_grid: number[];
  prompt_template_ref: string;
  ontology_ref: string;
  branch_points: string[];
}

export interface DetectionPerturbParams {
  extractor_model: string;
  perturbation_strategy: 'lexical-substitution' | 'entity-swap' | 'numeric-bounded-jitter' | 'protected-class-flip';
  perturbation_strategy_version: string;
  perturbation_count: number;
  bounds_spec: Record<string, unknown>;
  prompt_template_ref: string;
  ontology_ref: string;
  holdout_fields: string[];
}

/** Union of all method param shapes */
export type ExtractorParams =
  | DetectionParseParams
  | DetectionRestructureParams
  | DetectionReplayParams
  | DetectionPerturbParams;
