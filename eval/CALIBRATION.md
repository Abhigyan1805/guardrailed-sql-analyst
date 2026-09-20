# Calibration

Model: `opencode-go/deepseek-v4.1-flash` · provider: `opencode-go` · effort: low · temperature: 0 · commit: `f0c399d4643bb1ba4b6790fed7e5670117eb4b1c`
Set: dev (40 questions, 35 expected-ALLOW) · EVAL_NOW: 2025-09-01T00:00:00Z · seed: 42

The confidence signal is only meaningful for the LLM engine; the template engine returns fixed per-template constants, so this table uses the dev LLM run. Held-out is applied at the chosen point for reporting only and is never used to choose it (R2).

## Reliability (executed answers at the chosen point)

| confidence bin | n | mean confidence | observed accuracy |
|---|---|---|---|
| 0.00-0.10 | 0 | 0.000 | — |
| 0.10-0.20 | 0 | 0.000 | — |
| 0.20-0.30 | 0 | 0.000 | — |
| 0.30-0.40 | 0 | 0.000 | — |
| 0.40-0.50 | 0 | 0.000 | — |
| 0.50-0.60 | 0 | 0.000 | — |
| 0.60-0.70 | 0 | 0.000 | — |
| 0.70-0.80 | 6 | 0.742 | 0.0% |
| 0.80-0.90 | 14 | 0.834 | 57.1% |
| 0.90-1.00 | 15 | 0.911 | 53.3% |

ECE: 0.3937 · MCE: 0.7417

## Operating point

- Gate: **ALLOW >= 0.75**, caveat band [0.55, 0.75), **CLARIFY < 0.55**.
- Source: dev-only sweep below (allow × clarify over 0.40–0.90 in 0.05 steps). Selection rule: respect a 15.0% dev false-clarify budget and a 25.0% dev caveat budget, maximise executed accuracy, then coverage, then stay closest to the pre-registered 0.75/0.55 point. A challenger must beat the pre-registered point by more than 5 percentage points (about two dev questions) to replace it.
- Outcome: the pre-registered 0.75/0.55 point is retained. No dev-tuned alternative improves executed accuracy by more than 5 percentage points inside the budgets, so the sweep does not justify moving the gate.
- Dev at this point: 35 executed, accuracy 45.7%, false-clarify 0.0%, caveated 8.6%, missed-clarify 0.0%.
- Held-out cost of this point (reported, not tuned): 38/42 expected-ALLOW executed at 60.5% accuracy, 9.5% false-clarify, 12.5% missed-clarify.

## Threshold sweep (dev only, R2)

### CLARIFY boundary at the chosen ALLOW=0.75 (this is the execution tradeoff)

| CLARIFY >= | executed | correct | accuracy | false-clarify | missed-clarify | caveated |
|---|---|---|---|---|---|---|
| 0.40 | 35 | 16 | 45.7% | 0.0% | 0.0% | 8.6% |
| 0.45 | 35 | 16 | 45.7% | 0.0% | 0.0% | 8.6% |
| 0.50 | 35 | 16 | 45.7% | 0.0% | 0.0% | 8.6% |
| 0.55 | 35 | 16 | 45.7% | 0.0% | 0.0% | 8.6% |
| 0.60 | 35 | 16 | 45.7% | 0.0% | 0.0% | 8.6% |
| 0.65 | 35 | 16 | 45.7% | 0.0% | 0.0% | 8.6% |
| 0.70 | 35 | 16 | 45.7% | 0.0% | 0.0% | 8.6% |
| 0.75 | 32 | 16 | 50.0% | 8.6% | 0.0% | 0.0% |

### ALLOW boundary at the chosen CLARIFY=0.55 (caveat band only; does not move execution)

| ALLOW >= | executed | accuracy | false-clarify | caveated |
|---|---|---|---|---|
| 0.55 | 35 | 45.7% | 0.0% | 0.0% |
| 0.60 | 35 | 45.7% | 0.0% | 0.0% |
| 0.65 | 35 | 45.7% | 0.0% | 0.0% |
| 0.70 | 35 | 45.7% | 0.0% | 0.0% |
| 0.75 | 35 | 45.7% | 0.0% | 8.6% |
| 0.80 | 35 | 45.7% | 0.0% | 17.1% |
| 0.85 | 35 | 45.7% | 0.0% | 37.1% |
| 0.90 | 35 | 45.7% | 0.0% | 57.1% |

### Full dev grid — accuracy (false-clarify)

Rows: ALLOW >=; columns: CLARIFY >=. Only CLARIFY changes the executed set, so accuracy and false-clarify are constant down each column; ALLOW only moves answers into the caveat band.

| ALLOW \ CLARIFY | 0.40 | 0.45 | 0.50 | 0.55 | 0.60 | 0.65 | 0.70 | 0.75 | 0.80 | 0.85 | 0.90 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.40 | 45.7% (0.0%) | — | — | — | — | — | — | — | — | — | — |
| 0.45 | 45.7% (0.0%) | 45.7% (0.0%) | — | — | — | — | — | — | — | — | — |
| 0.50 | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | — | — | — | — | — | — | — | — |
| 0.55 | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | — | — | — | — | — | — | — |
| 0.60 | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | — | — | — | — | — | — |
| 0.65 | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | — | — | — | — | — |
| 0.70 | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | — | — | — | — |
| 0.75 | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 50.0% (8.6%) | — | — | — |
| 0.80 | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 50.0% (8.6%) | 55.2% (17.1%) | — | — |
| 0.85 | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 50.0% (8.6%) | 55.2% (17.1%) | 50.0% (37.1%) | — |
| 0.90 | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 45.7% (0.0%) | 50.0% (8.6%) | 55.2% (17.1%) | 50.0% (37.1%) | 53.3% (57.1%) |
