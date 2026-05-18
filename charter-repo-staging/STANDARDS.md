# Detection Standards Reference

Public — referenced from AILedger Charter Features-we-won't-build §1. Maintained alongside the Charter; updates do NOT require board amendment.

## Standards currently anchoring detection defaults

| Standard | What it anchors | Concrete threshold |
|---|---|---|
| EEOC four-fifths rule | Disparate-impact detection in employment-decision AI | 0.8 ratio (selection rate of protected class vs majority must be ≥ 80%) |
| NIST AI RMF 1.0 | Bias measurement + monitoring framework; informs statistical parity + drift thresholds | Per Risk Management Framework guidance; specific thresholds context-dependent |
| ISO/IEC 42001 | AI management system standard; references statistical parity + other measures | Per standard's normative requirements |
| EU AI Act Articles 12 / 19 / 26 | Record-keeping + post-market monitoring requirements; informs what events MUST be logged + which required-action workflows trigger | Per regulation; Article 12 record-keeping is the binding mechanism |

## Cadence

This document updates as additional standards mature, are formally referenced by regulators, or are explicitly chosen for adoption. The PRINCIPLE of standards-anchoring is governed by the AILedger Charter; the specific list is operational + maintained here without requiring board amendment.

## Cross-references

- `CHARTER.md` Features-we-won't-build §1: "Configurable detection thresholds that allow suppression below standards-aligned defaults"
- Detection Layer code (open-source, Apache 2.0): default threshold values implement the table above
- Test plan: tests verify default thresholds align with the standards listed
