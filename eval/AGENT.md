# Agent engine results (November 2026)

Generated 2026-11-08T16:36:19.851Z by `scripts/agent-report.ts` from `eval/reports/{deepseek,gemini}/`. Prompt `agent-v2-2026-11-08`. EVAL_NOW 2025-09-01, seed 42, 1 pass per configuration (temperature 0 for the first draft; extra self-consistency drafts at 0.7). Same frozen sets, golds and positional exact-row scoring as `REPORT.md`; the published DeepSeek-through-opencode baseline there is unchanged history.

Integrity: every design choice was made on **dev** only. The retrieval pool is dev-only (`eval/pool/dev.json`, validated against the dev golds by `scripts/validate-pool.ts`) and a dev question never retrieves itself. The calibrator and gate are fitted on dev (`eval/calibrate.ts`). Held-out was scored once per configuration listed below and every held-out score is shown. Paraphrase was not used for tuning.

## DeepSeek (`deepseek-flash`, reasoning effort low, api.deepseek.com)

### Dev ablation (gate off: every answer executed, so this is pure generation accuracy)

| step | dev exact rows (Wilson 95%) | p50 / p95 latency | LLM calls / q | cost / q |
|---|---|---|---|---|
| baseline: existing `llm` engine (selected views, 6 fixed dev exemplars, self-reported confidence) | 17/35 · 48.6% [33.0, 64.4] | 1.3 s / 5.0 s | 1.00 | $0.00025 |
| + rich static schema: all views, value hints, business definitions, output conventions | 24/35 · 68.6% [52.0, 81.4] | 1.4 s / 5.6 s | 1.00 | $0.00018 |
| + retrieval: up to 2 most similar solved dev questions (similarity >= 0.5, leave-one-out) | 24/35 · 68.6% [52.0, 81.4] | 1.4 s / 5.6 s | 1.00 | $0.00017 |
| + execution-guided repair (one fix on guard/DB error or empty/all-NULL result) | 24/35 · 68.6% [52.0, 81.4] | 1.4 s / 5.6 s | 1.00 | $0.00017 |
| + self-consistency: 3 drafts, majority by executed result set | 25/35 · 71.4% [54.9, 83.7] | 1.5 s / 6.5 s | 3.03 | $0.00048 |
| rich schema + repair, without retrieval | 24/35 · 68.6% [52.0, 81.4] | 1.4 s / 5.6 s | 1.00 | $0.00018 |
| rich schema + repair + self-consistency, without retrieval | 25/35 · 71.4% [54.9, 83.7] | 1.6 s / 6.2 s | 3.03 | $0.00047 |

### Final configuration `sc3-noret` vs baseline

Calibrated gate (re-derived on dev leave-one-out confidences): **CLARIFY below 0.55**. Dev leave-one-out ECE 0.187.

| set | engine | exact rows (Wilson 95%) | false-clarify | missed-clarify | ECE | p50 / p95 latency | cost / q | violations |
|---|---|---|---|---|---|---|---|---|
| dev | baseline (self-reported conf.) | 17/35 · 48.6% [33.0, 64.4] | 0.0% | — | 0.360 | 1.3 s / 5.0 s | $0.00025 | 0 |
| dev | final, gate on | 23/35 · 65.7% [49.2, 79.2] | 17.1% | — | 0.150 | 1.6 s / 6.2 s | $0.00047 | 0 |
| held-out | baseline (self-reported conf.) | 17/42 · 40.5% [27.0, 55.5] | 28.6% | 12.5% | 0.327 | 1.8 s / 9.1 s | $0.00027 | 0 |
| held-out | final, gate on | 27/42 · 64.3% [49.2, 77.0] | 16.7% | 12.5% | 0.146 | 1.6 s / 7.5 s | $0.00063 | 0 |
| held-out | final, gate off (cached replay) | 32/42 · 76.2% [61.5, 86.5] | 0.0% | 25.0% | 0.130 | 1.6 s / 8.4 s | $0.00065 | 0 |
| paraphrase | baseline | 4/12 · 33.3% [13.8, 60.9] | 25.0% | — | 0.583 | 1.5 s / 2.7 s | $0.00016 | 0 |
| paraphrase | final, gate on | 10/12 · 83.3% [55.2, 95.3] | 8.3% | — | 0.123 | 1.5 s / 3.4 s | $0.00034 | 0 |

"gate on" counts a correct answer the gate deferred to a clarifying question as a miss, exactly like the headline numbers in `REPORT.md`. "gate off" is the same configuration and the same cached model responses with every answer executed: it is the generation accuracy and the population ECE is measured on. ECE uses 10 equal-width bins over executed answers.

### ALLOW/CLARIFY trade-off on held-out (reported, not tuned)

| CLARIFY below | answered | correct | precision of answers | correct overall | false-clarify | missed-clarify |
|---|---|---|---|---|---|---|
| 0.00 | 42 | 32 | 76.2% | 32/42 · 76.2% | 0.0% | 8/8 |
| 0.35 | 42 | 32 | 76.2% | 32/42 · 76.2% | 0.0% | 2/8 |
| 0.45 | 42 | 32 | 76.2% | 32/42 · 76.2% | 0.0% | 2/8 |
| 0.55 (dev-chosen) | 36 | 28 | 77.8% | 28/42 · 66.7% | 14.3% | 1/8 |
| 0.65 | 30 | 26 | 86.7% | 26/42 · 61.9% | 28.6% | 1/8 |
| 0.75 | 23 | 22 | 95.7% | 22/42 · 52.4% | 45.2% | 1/8 |

Reliability on held-out (gate off): 0.40-0.50: n=1, conf 0.46, acc 0.0%; 0.50-0.60: n=6, conf 0.55, acc 66.7%; 0.60-0.70: n=8, conf 0.65, acc 50.0%; 0.70-0.80: n=12, conf 0.77, acc 75.0%; 0.80-0.90: n=15, conf 0.81, acc 100.0%. ECE 0.130.

Calibrator weights (logistic, L2=1, fitted on 35 dev answers): agreement 0.98, clean 0.00, empty_or_null 0.00, top_similarity 0.27, complexity -1.23, bias 0.33. A weight of 0 means the signal never varied on dev (e.g. no dev answer needed a repair).

## Gemini (`gemini-3.1-flash-lite`, free tier)

### Dev ablation (gate off: every answer executed, so this is pure generation accuracy)

| step | dev exact rows (Wilson 95%) | p50 / p95 latency | LLM calls / q | cost / q |
|---|---|---|---|---|
| baseline: existing `llm` engine (selected views, 6 fixed dev exemplars, self-reported confidence) | 18/35 · 51.4% [35.6, 67.0] | 2.4 s / 42.8 s | 1.00 | $0 (free tier); 2606 in / 188 out tokens |
| + rich static schema: all views, value hints, business definitions, output conventions | 21/35 · 60.0% [43.6, 74.4] | 1.8 s / 30.9 s | 1.00 | $0 (free tier); 3313 in / 85 out tokens |
| + retrieval: up to 2 most similar solved dev questions (similarity >= 0.5, leave-one-out) | 21/35 · 60.0% [43.6, 74.4] | 2.2 s / 26.8 s | 1.00 | $0 (free tier); 3337 in / 84 out tokens |
| + execution-guided repair (one fix on guard/DB error or empty/all-NULL result) | 21/35 · 60.0% [43.6, 74.4] | 2.2 s / 26.8 s | 1.00 | $0 (free tier); 3337 in / 84 out tokens |
| + self-consistency: 3 drafts, majority by executed result set | 21/35 · 60.0% [43.6, 74.4] | 2.8 s / 30.9 s | 3.06 | $0 (free tier); 10209 in / 255 out tokens |
| rich schema + repair, without retrieval | 21/35 · 60.0% [43.6, 74.4] | 1.7 s / 30.9 s | 1.00 | $0 (free tier); 3313 in / 85 out tokens |

### Final configuration `sc3-noret` vs baseline

Calibrated gate (re-derived on dev leave-one-out confidences): **CLARIFY below 0.6**. Dev leave-one-out ECE 0.390.

| set | engine | exact rows (Wilson 95%) | false-clarify | missed-clarify | ECE | p50 / p95 latency | cost / q | violations |
|---|---|---|---|---|---|---|---|---|
| dev | baseline (self-reported conf.) | 18/35 · 51.4% [35.6, 67.0] | 0.0% | — | 0.451 | 2.4 s / 42.8 s | $0 (free tier); 2606 in / 188 out tokens | 0 |
| dev | final, gate on | 19/35 · 54.3% [38.2, 69.5] | 34.3% | — | 0.129 | 1.8 s / 31.0 s | $0 (free tier); 10137 in / 256 out tokens | 0 |
| held-out | baseline (self-reported conf.) | 20/42 · 47.6% [33.4, 62.3] | 7.1% | 12.5% | 0.404 | 1.6 s / 24.0 s | $0 (free tier); 2807 in / 178 out tokens | 0 |
| held-out | final, gate on | 20/42 · 47.6% [33.4, 62.3] | 47.6% | 25.0% | 0.224 | 2.1 s / 21.4 s | $0 (free tier); 9871 in / 277 out tokens | 0 |
| held-out | final, gate off (cached replay) | 27/42 · 64.3% [49.2, 77.0] | 2.4% | 37.5% | 0.137 | 2.6 s / 30.0 s | $0 (free tier); 10681 in / 310 out tokens | 0 |
| paraphrase | baseline | 4/12 · 33.3% [13.8, 60.9] | 0.0% | — | 0.592 | 1.4 s / 2.0 s | $0 (free tier); 2614 in / 156 out tokens | 0 |
| paraphrase | final, gate on | 5/12 · 41.7% [19.3, 68.0] | 16.7% | — | 0.335 | 1.9 s / 54.7 s | $0 (free tier); 9360 in / 174 out tokens | 0 |

"gate on" counts a correct answer the gate deferred to a clarifying question as a miss, exactly like the headline numbers in `REPORT.md`. "gate off" is the same configuration and the same cached model responses with every answer executed: it is the generation accuracy and the population ECE is measured on. ECE uses 10 equal-width bins over executed answers.

### ALLOW/CLARIFY trade-off on held-out (reported, not tuned)

| CLARIFY below | answered | correct | precision of answers | correct overall | false-clarify | missed-clarify |
|---|---|---|---|---|---|---|
| 0.00 | 41 | 27 | 65.9% | 27/42 · 64.3% | 0.0% | 8/8 |
| 0.35 | 36 | 25 | 69.4% | 25/42 · 59.5% | 14.3% | 3/8 |
| 0.45 | 32 | 24 | 75.0% | 24/42 · 57.1% | 23.8% | 3/8 |
| 0.55 | 27 | 22 | 81.5% | 22/42 · 52.4% | 35.7% | 2/8 |
| 0.65 | 21 | 18 | 85.7% | 18/42 · 42.9% | 50.0% | 2/8 |
| 0.75 | 0 | 0 | 0.0% | 0/42 · 0.0% | 100.0% | 0/8 |

Reliability on held-out (gate off): 0.20-0.30: n=2, conf 0.28, acc 0.0%; 0.30-0.40: n=4, conf 0.34, acc 50.0%; 0.40-0.50: n=4, conf 0.44, acc 25.0%; 0.50-0.60: n=4, conf 0.52, acc 50.0%; 0.60-0.70: n=10, conf 0.64, acc 70.0%; 0.70-0.80: n=17, conf 0.71, acc 88.2%. ECE 0.137.

Calibrator weights (logistic, L2=1, fitted on 35 dev answers): agreement 0.69, clean 0.00, empty_or_null 0.00, top_similarity -0.09, complexity -1.57, bias 0.22. A weight of 0 means the signal never varied on dev (e.g. no dev answer needed a repair).

## Limitations

- 42 scored held-out questions: a Wilson 95% interval is about ±13-15 points wide, so one question moves accuracy by 2.4 points. 35 scored dev questions make every ablation step below ~2 questions indistinguishable from noise; retrieval and repair measured as no change on dev.
- The calibrator is fitted on 35 dev answers; with that few points its weights are rough, and ECE on 42 held-out answers in 10 bins is itself noisy.
- The gate trades coverage for precision: at the dev-chosen threshold some correct held-out answers become clarifying questions, which the headline "gate on" accuracy counts as misses.
- Latency is end-to-end per question (local guard + EXPLAIN + execution plus provider call time on the critical path; parallel drafts count once; client-side free-tier throttle waits excluded; cached replays use the recorded original call time). Free-tier Gemini latency is dominated by provider queueing and varies widely.
- The demo model `gemini-2.5-flash` allows 20 free requests per day on this key, so the Gemini evaluation used `gemini-3.1-flash-lite` (separate free quota).
- Accuracy, LLM and calibration runs use PGlite; the security suite runs on real Postgres (`eval/SECURITY.md`).
