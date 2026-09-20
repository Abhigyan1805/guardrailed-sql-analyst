# Eval Report — Guardrailed Text-to-SQL Analyst

Generated: 2026-09-20T17:07:39.809Z · EVAL_NOW: 2025-09-01T00:00:00Z · seed: 42

Costs marked `*` are **estimated** from a pinned tokenizer and published prices, not measured.

## dev

| Engine | exact rows | accuracy (Wilson 95%) | p95 ALLOW | $/100q (retries incl.) | violations |
|---|---|---|---|---|---|
| templates | 35/35 | 100.0% [90.1%, 100.0%] | 208ms | $0.0000 | 0 |
| llm | 19/35 | 52.4% (51.4–54.3%) [38.2%, 69.5%] | 26616ms | $0.2015* | 0 |
| hybrid | 35/35 | 100.0% [90.1%, 100.0%] | 58ms | $0.0000* | 0 |

Model: `opencode-go/deepseek-v4.1-flash` · provider: `opencode-go` · temperature: 0 · effort: low · commit: `463610661eba6630db1c8bd3f35628d21e43f3f2` · repeats: 1/3

Cost basis: DeepSeek V4.1 Flash off-peak published rates ($0.15/$0.60 per 1M in/out); served model: `opencode-go/deepseek-v4.1-flash` (effort low); peak rate 2x (peak hours (01:00-04:00 and 06:00-10:00 UTC Mon-Fri) are 2x these rates); snapshot 2026-09-20, https://api-docs.deepseek.com/quick_start/pricing; usage_source=`estimated`.

## heldout

| Engine | exact rows | accuracy (Wilson 95%) | p95 ALLOW | $/100q (retries incl.) | violations |
|---|---|---|---|---|---|
| templates | 3/42 | 7.1% [2.5%, 19.0%] | 74ms | $0.0000 | 0 |
| llm | 23/42 | 53.2% (45.2–59.5%) [39.9%, 68.8%] | 32971ms | $0.2624* | 0 |
| hybrid | 12/42 | 27.8% (26.2–28.6%) [17.2%, 43.6%] | 24561ms | $0.1478* | 0 |

Model: `opencode-go/deepseek-v4.1-flash` · provider: `opencode-go` · temperature: 0 · effort: low · commit: `463610661eba6630db1c8bd3f35628d21e43f3f2` · repeats: 1/3

Cost basis: DeepSeek V4.1 Flash off-peak published rates ($0.15/$0.60 per 1M in/out); served model: `opencode-go/deepseek-v4.1-flash` (effort low); peak rate 2x (peak hours (01:00-04:00 and 06:00-10:00 UTC Mon-Fri) are 2x these rates); snapshot 2026-09-20, https://api-docs.deepseek.com/quick_start/pricing; usage_source=`estimated`.

## paraphrase

| Engine | exact rows | accuracy (Wilson 95%) | p95 ALLOW | $/100q (retries incl.) | violations |
|---|---|---|---|---|---|
| templates | 0/12 | 0.0% [0.0%, 24.2%] | 26ms | $0.0000 | 0 |
| llm | 1/12 | 13.9% (8.3–25.0%) [1.5%, 35.4%] | 12187ms | $0.1887* | 0 |
| hybrid | 2/12 | 19.4% (16.7–25.0%) [4.7%, 44.8%] | 17506ms | $0.1748* | 0 |

Model: `opencode-go/deepseek-v4.1-flash` · provider: `opencode-go` · temperature: 0 · effort: low · commit: `463610661eba6630db1c8bd3f35628d21e43f3f2` · repeats: 1/3

Cost basis: DeepSeek V4.1 Flash off-peak published rates ($0.15/$0.60 per 1M in/out); served model: `opencode-go/deepseek-v4.1-flash` (effort low); peak rate 2x (peak hours (01:00-04:00 and 06:00-10:00 UTC Mon-Fri) are 2x these rates); snapshot 2026-09-20, https://api-docs.deepseek.com/quick_start/pricing; usage_source=`estimated`.

## Adversarial

- blocked: 51/51
- executed violations: 0 (gate: 0)
- DB fingerprint unchanged: yes
