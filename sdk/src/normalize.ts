// AILedger SDK — numeric + timestamp normalization per spec v1.0
//
// Per spec §4 Option A (Jake-ratified): Postgres numeric::text IS the
// canonical form. SDK normalizes confidence to 4-decimal precision before
// emitting; other numeric fields trust the producer.
//
// SDK-wide normalization (all numeric fields) is flagged in spec §10 as a
// v1.0.1 follow-up; not enabled by default.

/**
 * Normalize confidence to 4-decimal precision per spec §4 SDK contract.
 *
 * Producers may emit any precision (e.g. model returns 0.8523847291) and the
 * SDK truncates to 4 decimals (0.8524) before insert. Two producers emitting
 * different precisions of the same logical confidence will hash identically
 * after normalization.
 *
 * Range: [0, 1]. Out-of-range values throw.
 */
export function normalizeConfidence(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) {
    throw new Error(`confidence must be a finite number; got ${value}`);
  }
  if (value < 0 || value > 1) {
    throw new Error(`confidence must be in [0, 1]; got ${value}`);
  }
  // Round-half-to-even at 4 decimals.
  // 0.84235 → 0.8424, 0.84245 → 0.8424 (banker's rounding)
  const scaled = value * 10000;
  const rounded = Math.round(scaled);
  // Banker's rounding fix-up: if exactly halfway, round to even.
  // Math.round rounds half away from zero; we adjust the .5 case to even.
  const fractional = scaled - Math.floor(scaled);
  let final: number;
  if (Math.abs(fractional - 0.5) < Number.EPSILON) {
    const floored = Math.floor(scaled);
    final = floored % 2 === 0 ? floored : floored + 1;
  } else {
    final = rounded;
  }
  return final / 10000;
}

/**
 * Normalize a Date or ISO-8601 string to the spec §3 timestamp shape:
 * "YYYY-MM-DDTHH:MM:SS.UUUUUUZ" (microsecond precision in UTC).
 *
 * Postgres stores TIMESTAMPTZ with microsecond precision. JavaScript Dates
 * carry millisecond precision; the SDK pads to microsecond format with the
 * final three digits as `000`. Producers wanting true microsecond precision
 * pass the timestamp as a pre-formatted string.
 */
export function normalizeTimestamp(input: Date | string | null | undefined): string {
  if (input === null || input === undefined) {
    throw new Error('timestamp is required for Detection Event emission');
  }
  let date: Date;
  if (typeof input === 'string') {
    // Allow pre-formatted strings to pass through unchanged if they match.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(input)) return input;
    date = new Date(input);
  } else {
    date = input;
  }
  if (Number.isNaN(date.getTime())) {
    throw new Error(`timestamp could not be parsed: ${String(input)}`);
  }
  // Format as ISO-8601 UTC with microsecond padding (ms * 1000).
  const iso = date.toISOString(); // "YYYY-MM-DDTHH:MM:SS.mmmZ"
  // Replace ".mmmZ" with ".mmm000Z".
  return iso.replace(/\.(\d{3})Z$/, '.$1000Z');
}
