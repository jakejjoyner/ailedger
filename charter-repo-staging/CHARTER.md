# AILedger Charter — v1.1

## Purpose

AILedger exists to make AI systems in regulated industries auditable in ways that catch actual harm to real people. Not to generate paperwork that satisfies regulators while harm continues.

## Working as intended

Users of AILedger detect bias, drift, and disparate impact in their AI systems before regulators or lawsuits do. Affected populations - job applicants, loan applicants, patients, students - experience fewer AI-caused harms because the systems affecting them are monitored substantively. Regulators trust AILedger output (Detection Events, Integrity Chain verifications, Witnessed Inferences) as evidence in enforcement actions.

## Failure mode

Customers use AILedger Detection Events, Integrity Chain verifications, and Witnessed Inferences as legal cover. Audit trails are intact and meaningless. Detection thresholds are configured to suppress findings. The product becomes shorthand for "we have a compliance tool" without changing AI behavior. Affected populations are harmed at the same or higher rates because the regulatory pressure that would have forced change is absorbed by the appearance of compliance.

## Customers we refuse

- Companies whose underlying AI use is itself the harm (predictive policing, social scoring, deceptive targeting of vulnerable populations)
- Companies that request detection configurations specifically designed to suppress findings
- Companies whose primary purpose is paperwork generation rather than catching problems
- Companies under active enforcement action who want AILedger as an improper litigation defense in bad faith to suppress harm that the regulation is meant to prevent rather than showing ongoing accountability under the regulation.

## Features we won't build

- Configurable detection thresholds that allow suppression below standards-aligned defaults*
- "Compliance mode" that generates reports without underlying detection
- Removal of required-action workflows for detected events
- Selective logging that excludes specific decision categories at customer request

*Specific standards anchoring detection defaults are listed in [STANDARDS.md](./STANDARDS.md). The principle of standards-anchoring is the Charter commitment; the specific list is maintained in that document and updates without requiring board approval.

## Decisions requiring board review

- Weakening any detection primitive below its launch sensitivity
- Accepting a customer from a refused category
- Subjective determinations of bad-faith use per Customers-we-refuse §4 (including but not limited to bad-faith litigation defense)
- Removing or making optional any required-action workflow
- Acquisition offers or exit decisions that would change product direction
- Any amendment to this charter (requires unanimous Board of Directors approval)

## Exit conditions

- Detection primitives demonstrably fail to catch harm in real customer deployments and can't be fixed
- Regulatory environment shifts such that AILedger's substantive features become commercially impossible to sell against competitors offering audit theater
- Founder no longer able to refuse customers without bankruptcy
- Majority of the Board of Directors no longer voting to maintain refusals

## Public commitment

This charter is published from day one. Customers, regulators, and the public can hold AILedger accountable to it. Amendments are versioned publicly so changes are visible.

## Review cadence

At a minimum, reviewed annually by Board of Directors.
