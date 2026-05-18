-- Migration: protected_class taxonomy reference
--
-- Context: AILedger posture v2. ledger.decision_events.protected_class_context
-- is JSONB with fields drawn from a taxonomy aligned with NIST AI RMF and
-- US/EU jurisdictional protected-class categories. Spec at CLAUDE.md.
--
-- This migration creates a REFERENCE table (not an FK target — the
-- protected_class_context is JSONB and stores multiple fields, not a
-- single FK). The reference table is used for:
--   - Documentation of accepted field names + value bands
--   - CHECK functions that validate protected_class_context JSONB shape
--   - Detection-primitive query generation (each primitive iterates
--     known protected-class fields)
--
-- Idempotent.

create table if not exists ledger.protected_class_field_taxonomy (
  field_name        text primary key,
  display_name      text not null,
  description       text not null,
  value_type        text not null
    check (value_type in ('enum', 'boolean', 'iso_3166', 'free_text_standardized')),
  value_band_spec   jsonb,
    -- For enum: array of allowed values. For boolean: null. For iso_3166:
    -- null (values are ISO 3166-1 alpha-2 codes). For free_text_standardized:
    -- spec describing allowed normalization.
  source_field_name text not null,
    -- Companion field name in protected_class_context indicating provenance
    -- per-field (direct vs inferred). E.g., 'age_band_source'.
  jurisdictional_notes text,
  created_at        timestamptz not null default now()
);

comment on table ledger.protected_class_field_taxonomy is
  'Reference for accepted protected_class_context JSONB fields. Application '
  'layer validates incoming Decision Event protected_class_context against '
  'this taxonomy.';

-- ─── Seed: NIST AI RMF + US/EU jurisdictional protected-class fields ─────────

insert into ledger.protected_class_field_taxonomy
  (field_name, display_name, description, value_type, value_band_spec,
   source_field_name, jurisdictional_notes)
values
  (
    'age_band',
    'Age band',
    'Standardized age band of the subject at decision time. Bands chosen to '
    'align with common protected-class definitions while avoiding date-of-'
    'birth storage that would create deanonymization risk.',
    'enum',
    '["under_18", "18_24", "25_34", "35_44", "45_54", "55_64", "65_plus", "unknown"]'::jsonb,
    'age_band_source',
    'Age is a protected class in employment contexts (US ADEA, EU equiv).'
  ),
  (
    'gender_category',
    'Gender category',
    'Gender category aligned with NIST AI RMF gender taxonomy. Inclusive of '
    'non-binary, prefer-not-to-disclose, and unknown values.',
    'enum',
    '["woman", "man", "non_binary", "other", "prefer_not_to_disclose", "unknown"]'::jsonb,
    'gender_category_source',
    'Gender / sex is a protected class across employment, housing, credit, education.'
  ),
  (
    'race_ethnicity_category',
    'Race / ethnicity category',
    'Race or ethnicity category. US deployments: aligned with US Census '
    'categories. EU deployments: aligned with EU equivalents per local '
    'jurisdiction; some categories may be unlawful to collect directly.',
    'free_text_standardized',
    '{"us_census": ["american_indian_or_alaska_native", "asian", "black_or_african_american", "hispanic_or_latino", "native_hawaiian_or_other_pacific_islander", "white", "two_or_more_races", "other", "unknown"], "eu": "jurisdiction-specific; may require collection_method=blind"}'::jsonb,
    'race_ethnicity_category_source',
    'Direct collection prohibited in some EU member states. Use collection_method=blind with proxy variables in those contexts.'
  ),
  (
    'disability_status',
    'Disability status',
    'Disability status of subject. Boolean for "any reported disability" plus '
    'optional category from ADA / EU equivalent disability classifications.',
    'boolean',
    null,
    'disability_status_source',
    'Disability is a protected class in employment, housing, public services.'
  ),
  (
    'national_origin_category',
    'National origin',
    'Country of national origin or current nationality. ISO 3166-1 alpha-2 codes.',
    'iso_3166',
    null,
    'national_origin_category_source',
    'National origin is a protected class in employment + housing in US (Title VII, FHA).'
  ),
  (
    'religion_category',
    'Religion / belief',
    'Religion or belief system of subject. Free-text with optional '
    'standardized normalization. Many jurisdictions prohibit direct '
    'collection; use collection_method=blind where required.',
    'free_text_standardized',
    '{"standardized_options": ["buddhist", "christian", "hindu", "jewish", "muslim", "no_religion", "other", "prefer_not_to_disclose"]}'::jsonb,
    'religion_category_source',
    'Religion is a protected class in employment + accommodation. EU has stricter direct-collection rules than US.'
  ),
  (
    'sexual_orientation_category',
    'Sexual orientation',
    'Sexual orientation of subject. Standardized list with prefer-not-to-disclose.',
    'enum',
    '["heterosexual", "gay_lesbian", "bisexual", "other", "prefer_not_to_disclose", "unknown"]'::jsonb,
    'sexual_orientation_category_source',
    'Direct collection prohibited in many jurisdictions outside employment-protection contexts. Use collection_method=blind where required.'
  ),
  (
    'pregnancy_status',
    'Pregnancy status',
    'Pregnancy status of subject at decision time. Boolean. Optional.',
    'boolean',
    null,
    'pregnancy_status_source',
    'Pregnancy is a protected category in employment (US Title VII, PDA, FMLA-adjacent).'
  )
on conflict (field_name) do nothing;

-- ─── Validation helper for protected_class_context JSONB ────────────────────
-- Lightweight check: confirms protected_class_context only contains keys
-- listed in the taxonomy. Companion source fields (e.g. age_band_source)
-- are also allowed. Returns array of unknown keys (empty = valid).

create or replace function ledger.validate_protected_class_context(ctx jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  allowed_keys text[];
  unknown_keys text[];
begin
  if ctx is null then
    return '[]'::jsonb;
  end if;

  select array_agg(field_name) || array_agg(source_field_name)
    into allowed_keys
    from ledger.protected_class_field_taxonomy;

  select array_agg(key)
    into unknown_keys
    from jsonb_object_keys(ctx) as t(key)
    where key != all (allowed_keys);

  return coalesce(to_jsonb(unknown_keys), '[]'::jsonb);
end;
$$;

comment on function ledger.validate_protected_class_context(jsonb) is
  'Returns JSONB array of keys in input that are not in '
  'protected_class_field_taxonomy. Empty array = valid. Used by application '
  'layer to reject malformed protected_class_context.';
