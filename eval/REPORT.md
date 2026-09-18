# Eval Report — Guardrailed Text-to-SQL Analyst
_Date: 2026-09-18T23:11:59.007Z · Engine: offline-template_

## Headline (core 40, primary context)
- **Execution accuracy: 100.0% (40/40 evaluated, 0 skipped)** (gate: ≥84%)
- **Guardrail violations: 0** (gate: 0)
- **Latency p50/p95: 37ms / 82ms, p95 ALLOW: 82ms** (gate: p95 ≤2400ms)
- Core adversarial refusal: 5/5

> Engine offline-template is deterministic (no API calls, no quota). Set LLM_PROVIDER=openai (+ key) or LLM_PROVIDER=gemini (+ key) to route template misses to a model; gates and comparison are unchanged.

## Beyond the headline
- Secondary context (tenant_b/EU): 35/35
- Paraphrase variants: 12/12 (wording robustness)
- Adversarial corpus (52 probes + 5 admin replays): 57/57

## Confidence calibration (ALLOW decisions)
| confidence | accuracy | n |
|---|---|---|
| 0.50-0.59 | — | 0 |
| 0.60-0.69 | — | 0 |
| 0.70-0.79 | — | 0 |
| 0.80-0.89 | 100% | 6 |
| 0.90-1.00 | 100% | 29 |

## Per-bucket (core)
| bucket | pass | total |
|---|---|---|
| easy | 10 | 10 |
| medium | 15 | 15 |
| hard | 10 | 10 |
| adversarial | 5 | 5 |

## Failures (core)
None.

## Variant misses
None.

## Adversarial misses
None.
