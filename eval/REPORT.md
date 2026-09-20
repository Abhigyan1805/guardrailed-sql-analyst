# Eval Report — Guardrailed Text-to-SQL Analyst

Generated: 2026-09-20T19:18:45.538Z · EVAL_NOW: 2025-09-01T00:00:00Z · seed: 42

## dev

| Engine | exact rows | accuracy (Wilson 95%) | p95 ALLOW | $/100q (retries incl.) | violations |
|---|---|---|---|---|---|
| hybrid | 35/35 | 100.0% [90.1%, 100.0%] | 101ms | $0.0000 | 0 |
| llm | 16/35 | 45.7% [30.5%, 61.8%] | 22607ms | $0.2100 | 0 |
| templates | 35/35 | 100.0% [90.1%, 100.0%] | 56ms | $0.0000 | 0 |

Model: `opencode-go/deepseek-v4.1-flash` · provider: `opencode-go` · temperature: 0 · effort: low · commit: `f0c399d4643bb1ba4b6790fed7e5670117eb4b1c` · repeats: 3/1

Cost (provider-reported cost): served model `opencode-go/deepseek-v4.1-flash` (effort low); reference sheet DeepSeek V4.1 Flash off-peak published rates ($0.15/$0.60 per 1M in/out); snapshot 2026-09-20, https://api-docs.deepseek.com/quick_start/pricing; usage_source=`provider`. Both published bases are compared below.

## heldout

| Engine | exact rows | accuracy (Wilson 95%) | p95 ALLOW | $/100q (retries incl.) | violations |
|---|---|---|---|---|---|
| hybrid | 12/42 | 32.5% (28.6–35.7%) [17.2%, 43.6%] | 10935ms | $0.1532 | 0 |
| llm | 23/42 | 53.2% (50.0–54.8%) [39.9%, 68.8%] | 29469ms | $0.2972 | 0 |
| templates | 3/42 | 7.1% [2.5%, 19.0%] | 222ms | $0.0000 | 0 |

Model: `opencode-go/deepseek-v4.1-flash` · provider: `opencode-go` · temperature: 0 · effort: low · commit: `f0c399d4643bb1ba4b6790fed7e5670117eb4b1c` · repeats: 3/1

Cost (provider-reported cost): served model `opencode-go/deepseek-v4.1-flash` (effort low); reference sheet DeepSeek V4.1 Flash off-peak published rates ($0.15/$0.60 per 1M in/out); snapshot 2026-09-20, https://api-docs.deepseek.com/quick_start/pricing; usage_source=`provider`. Both published bases are compared below.

## paraphrase

| Engine | exact rows | accuracy (Wilson 95%) | p95 ALLOW | $/100q (retries incl.) | violations |
|---|---|---|---|---|---|
| hybrid | 4/12 | 25.0% (16.7–33.3%) [13.8%, 60.9%] | 23414ms | $0.2118 | 0 |
| llm | 3/12 | 27.8% (25.0–33.3%) [8.9%, 53.2%] | 56258ms | $0.2164 | 0 |
| templates | 0/12 | 0.0% [0.0%, 24.2%] | 124ms | $0.0000 | 0 |

Model: `opencode-go/deepseek-v4.1-flash` · provider: `opencode-go` · temperature: 0 · effort: low · commit: `f0c399d4643bb1ba4b6790fed7e5670117eb4b1c` · repeats: 3/1

Cost (provider-reported cost): served model `opencode-go/deepseek-v4.1-flash` (effort low); reference sheet DeepSeek V4.1 Flash off-peak published rates ($0.15/$0.60 per 1M in/out); snapshot 2026-09-20, https://api-docs.deepseek.com/quick_start/pricing; usage_source=`provider`. Both published bases are compared below.

## Cost basis comparison

The same measured token counts (one repeat pass, retries included) priced under each published list. The model actually served is recorded per run; the non-served basis is a comparison, not a charge.

| set / engine | tokens in | tokens out | provider $/100q (measured) | DeepSeek V4.1 Flash off-peak cache-miss $/100q (est) | GLM-5.3-Flash flat list $/100q (est) |
|---|--:|--:|--:|--:|--:|
| dev / hybrid | 0 | 0 | $0.0000 | $0.0000 | $0.0000 |
| dev / llm | 441032 | 4630 | $0.2100 | $0.1970 | $0.1956 |
| heldout / hybrid | 380852 | 3429 | $0.1532 | $0.1409 | $0.1401 |
| heldout / llm | 715841 | 9826 | $0.2972 | $0.2697 | $0.2674 |
| paraphrase / hybrid | 141705 | 2286 | $0.2118 | $0.1886 | $0.1867 |
| paraphrase / llm | 142611 | 1943 | $0.2164 | $0.1880 | $0.1864 |

- DeepSeek V4.1 Flash off-peak cache-miss: $0.150 in ($0.003 cached) / $0.60 out per 1M — https://api-docs.deepseek.com/quick_start/pricing, retrieved 2026-09-20, off-peak; peak is 2x. cache-miss input; cached input $0.003 off-peak; peak hours (01:00-04:00, 06:00-10:00 UTC Mon-Fri) are 2x.
- GLM-5.3-Flash flat list: $0.150 in ($0.030 cached) / $0.50 out per 1M — https://docs.z.ai/guides/overview/pricing, retrieved 2026-09-20, flat. flat list, no peak/off-peak split; comparison basis only, the served model is DeepSeek V4.1 Flash.

## Adversarial

- blocked: 51/51
- executed violations: 0 (gate: 0)
- DB fingerprint unchanged: yes
