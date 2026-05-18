// AILedger SDK — DetectionEventClient
//
// Minimum viable client surface for Detection Event emission per spec v1.0.
// Producer-facing API. SDK responsibilities per spec §9:
//   - Compute inputs_hash client-side (raw inputs never transmitted)
//   - Normalize confidence to 4-decimal precision
//   - Emit structured Detection Event
//   - For inferred events: emit extractor_* fields + anchor_event_id, with
//     extractor_params_hash computed client-side
//   - Never compute hash_chain_*; populated by DB trigger
//
// Transport layer is a stub here. v0.1.0 ships type contract + canonicalization
// + normalization. Actual HTTP transport to AILedger proxy lands when the
// SDK is wired into a deployment.

import { computeInputsHash } from './hash.js';
import { computeExtractorParamsHash } from './canonicalize.js';
import { normalizeConfidence, normalizeTimestamp } from './normalize.js';
import type {
  DetectionEvent,
  InferredDetectionEvent,
  ExtractorMethod,
  ExtractorParams,
} from './types.js';

export interface DetectionEventClientConfig {
  /** AILedger proxy base URL (e.g. https://proxy.ailedger.dev) */
  baseUrl: string;
  /** Tenant API key (x-ailedger-key header) */
  apiKey: string;
  /** Required tenant UUID; matches the key */
  tenantId: string;
  /** System UUID for this client's deployment */
  systemId: string;
}

/**
 * Producer-facing API for emitting Detection Events.
 *
 * Construct once per (tenant, system) pair. Each emit call computes the
 * client-side fields per spec §9 and POSTs the structured event to the
 * AILedger proxy ingest endpoint.
 *
 * The DB trigger populates hash_chain_prev + hash_chain_self atomically
 * at INSERT time. The SDK does not see chain state directly; clients that
 * need to verify can fetch the row back and re-compute via the dispatcher
 * function.
 */
export class DetectionEventClient {
  private config: DetectionEventClientConfig;

  constructor(config: DetectionEventClientConfig) {
    this.config = config;
  }

  /**
   * Emit a canonical (production-time) Detection Event.
   *
   * SDK computes inputs_hash + normalizes confidence + normalizes timestamp.
   * Caller supplies the structured decision content (output, protected-class
   * context, flags, required_actions, actions_taken).
   *
   * @param input.rawInputs The raw decision inputs (object hashed via JCS, or
   *   bytes/string hashed via sha256jcs path). NEVER transmitted to AILedger.
   * @param input.rawInputsContentType Content-Type hint if rawInputs is bytes.
   *   Defaults to "application/json" for object inputs.
   */
  async emit(input: {
    eventId: string;
    timestamp?: Date | string;
    rawInputs: Record<string, unknown> | ArrayBuffer | string | null;
    rawInputsContentType?: string;
    modelVersion?: string;
    modelWeightsHash?: string;
    decisionType?: string;
    subjectId?: string;
    output?: Record<string, unknown>;
    confidence?: number;
    humanInLoop?: boolean;
    protectedClassContext?: Record<string, unknown>;
    protectedClassCollectionMethod?: 'direct' | 'inferred' | 'blind';
    flagsRaised?: string[];
    requiredActions?: string[];
    actionsTaken?: string[];
  }): Promise<DetectionEvent> {
    const inputsHash = await computeInputsHash(input.rawInputs, input.rawInputsContentType);
    const event: DetectionEvent = {
      event_id: input.eventId,
      timestamp: normalizeTimestamp(input.timestamp ?? new Date()),
      tenant_id: this.config.tenantId,
      system_id: this.config.systemId,
      model_version: input.modelVersion ?? null,
      model_weights_hash: input.modelWeightsHash ?? null,
      decision_type: input.decisionType ?? null,
      subject_id: input.subjectId ?? null,
      inputs_hash: inputsHash,
      output: input.output ?? null,
      confidence: normalizeConfidence(input.confidence ?? null),
      human_in_loop: input.humanInLoop ?? null,
      protected_class_context: input.protectedClassContext ?? null,
      protected_class_collection_method: input.protectedClassCollectionMethod ?? null,
      flags_raised: input.flagsRaised ?? [],
      required_actions: input.requiredActions ?? [],
      actions_taken: input.actionsTaken ?? [],
      chain_spec_version: 2,
    };
    await this.transport(event);
    return event;
  }

  /**
   * Emit an inferred Detection Event from one of the extraction-method rungs.
   *
   * SDK computes extractor_params_hash from the canonical-serialized params
   * per spec §7.2. Caller supplies the anchor event_id pointing to the
   * canonical Detection Event being extracted from, plus the extraction
   * results.
   */
  async emitInferred(input: {
    eventId: string;
    timestamp?: Date | string;
    anchorEventId: string;
    extractorMethod: ExtractorMethod;
    extractorModel: string;
    extractorParams: ExtractorParams;
    extractionStartedAt: Date | string;
    extractionComputeMs: number;
    output?: Record<string, unknown>;
    confidence?: number;
    flagsRaised?: string[];
    requiredActions?: string[];
    actionsTaken?: string[];
  }): Promise<InferredDetectionEvent> {
    const extractorParamsHash = await computeExtractorParamsHash(
      input.extractorMethod,
      input.extractorParams,
    );
    const inferred: InferredDetectionEvent = {
      event_id: input.eventId,
      timestamp: normalizeTimestamp(input.timestamp ?? new Date()),
      tenant_id: this.config.tenantId,
      system_id: this.config.systemId,
      anchor_event_id: input.anchorEventId,
      extractor_method: input.extractorMethod,
      extractor_model: input.extractorModel,
      extractor_params: input.extractorParams as Record<string, unknown>,
      extractor_params_hash: extractorParamsHash,
      extraction_started_at: normalizeTimestamp(input.extractionStartedAt),
      extraction_compute_ms: input.extractionComputeMs,
      output: input.output ?? null,
      confidence: normalizeConfidence(input.confidence ?? null),
      flags_raised: input.flagsRaised ?? [],
      required_actions: input.requiredActions ?? [],
      actions_taken: input.actionsTaken ?? [],
      chain_spec_version: 2,
    };
    await this.transport(inferred);
    return inferred;
  }

  /**
   * Transport stub. v0.1.0 logs to console; production wires this to the
   * AILedger proxy ingest endpoint via fetch.
   *
   * TODO before v0.2.0:
   *   - POST {baseUrl}/v2/detection-events with x-ailedger-key header
   *   - Handle 429 (rate limit) with retry-after honoring
   *   - Handle 5xx with exponential backoff + durable-buffer fallback
   *   - Surface DB trigger errors (chain insert failures) clearly
   *   - Return populated hash_chain_prev + hash_chain_self from response
   */
  private async transport(event: DetectionEvent | InferredDetectionEvent): Promise<void> {
    // Placeholder: logs the structured event. Production implementation TBD.
    // Reference config to avoid TS6133 unused-private-member warning.
    void this.config.baseUrl;
    void this.config.apiKey;
    void event;
  }
}
