# Eval Report — Guardrailed Text-to-SQL Analyst

Generated: 2026-09-20T15:17:28.964Z · EVAL_NOW: 2025-09-01T00:00:00Z · seed: 42

Costs marked `*` are **estimated** from a pinned tokenizer and published prices, not measured.

## dev

| Engine | exact rows | accuracy (Wilson 95%) | p95 ALLOW | $/100q (retries incl.) | violations |
|---|---|---|---|---|---|
| templates | 35/35 | 100.0% [90.1%, 100.0%] | 79ms | $0.0000 | 0 |
| llm | 17/35 | 45.7% (42.9–48.6%) [33.0%, 64.4%] | 22332ms | $0.0484* | 0 |
| hybrid | 35/35 | 100.0% [90.1%, 100.0%] | 45ms | $0.0000* | 0 |

Model: `opencode/big-pickle` · provider: `opencode` · temperature: 0 · commit: `0ca90b5000759ff0ced5f182b2098ac906deef2b` · repeats: 1/3

Cost basis: DeepSeek V4.1 Flash off-peak reference prices ($0.15/$0.60 per 1M in/out); model actually served: `opencode/big-pickle` (free (OpenCode Zen)); peak rate 2x (peak hours (01:00-04:00 and 06:00-10:00 UTC Mon-Fri) are 2x these rates); snapshot 2026-09-20, https://api-docs.deepseek.com/quick_start/pricing; usage_source=`estimated`.

## heldout

| Engine | exact rows | accuracy (Wilson 95%) | p95 ALLOW | $/100q (retries incl.) | violations |
|---|---|---|---|---|---|
| templates | 3/42 | 7.1% [2.5%, 19.0%] | 49ms | $0.0000 | 0 |
| llm | 21/42 | 51.6% (50.0–54.8%) [35.5%, 64.5%] | 28991ms | $0.0502* | 0 |
| hybrid | 12/42 | 27.8% (26.2–28.6%) [17.2%, 43.6%] | 16951ms | $0.0267* | 0 |

Model: `opencode/big-pickle` · provider: `opencode` · temperature: 0 · commit: `0ca90b5000759ff0ced5f182b2098ac906deef2b` · repeats: 1/3

Cost basis: DeepSeek V4.1 Flash off-peak reference prices ($0.15/$0.60 per 1M in/out); model actually served: `opencode/big-pickle` (free (OpenCode Zen)); peak rate 2x (peak hours (01:00-04:00 and 06:00-10:00 UTC Mon-Fri) are 2x these rates); snapshot 2026-09-20, https://api-docs.deepseek.com/quick_start/pricing; usage_source=`estimated`.

## paraphrase

| Engine | exact rows | accuracy (Wilson 95%) | p95 ALLOW | $/100q (retries incl.) | violations |
|---|---|---|---|---|---|
| templates | 0/12 | 0.0% [0.0%, 24.2%] | 19ms | $0.0000 | 0 |
| llm | 2/12 | 19.4% (8.3–33.3%) [4.7%, 44.8%] | 15499ms | $0.0372* | 0 |
| hybrid | 0/12 | 0.0% [0.0%, 24.2%] | 24ms | $0.0000* | 0 |

Model: `opencode/big-pickle` · provider: `opencode` · temperature: 0 · commit: `0ca90b5000759ff0ced5f182b2098ac906deef2b` · repeats: 1/3

Cost basis: DeepSeek V4.1 Flash off-peak reference prices ($0.15/$0.60 per 1M in/out); model actually served: `opencode/big-pickle` (free (OpenCode Zen)); peak rate 2x (peak hours (01:00-04:00 and 06:00-10:00 UTC Mon-Fri) are 2x these rates); snapshot 2026-09-20, https://api-docs.deepseek.com/quick_start/pricing; usage_source=`estimated`.

## Adversarial

- blocked: 51/51
- executed violations: 0 (gate: 0)
- DB fingerprint unchanged: yes
