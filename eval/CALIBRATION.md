# Calibration

Engine: llm · set: dev · model: opencode-go/deepseek-v4.1-flash · commit: 463610661eba6630db1c8bd3f35628d21e43f3f2

## Reliability (executed ALLOW answers)

| confidence bin | n | mean confidence | observed accuracy |
|---|---|---|---|
| 0.00-0.10 | 0 | 0.000 | — |
| 0.10-0.20 | 0 | 0.000 | — |
| 0.20-0.30 | 0 | 0.000 | — |
| 0.30-0.40 | 0 | 0.000 | — |
| 0.40-0.50 | 0 | 0.000 | — |
| 0.50-0.60 | 0 | 0.000 | — |
| 0.60-0.70 | 0 | 0.000 | — |
| 0.70-0.80 | 4 | 0.758 | 25.0% |
| 0.80-0.90 | 17 | 0.835 | 52.9% |
| 0.90-1.00 | 14 | 0.911 | 64.3% |

ECE: 0.3137 · MCE: 0.5075

Chosen operating point: ALLOW >= 0.75, CLARIFY < 0.55.

## Threshold sweep (dev only, R2)

| ALLOW threshold | executed | accuracy (executed) | false-clarify rate |
|---|---|---|---|
| 0.40 | 35 | 54.3% | 0.0% |
| 0.45 | 35 | 54.3% | 0.0% |
| 0.50 | 35 | 54.3% | 0.0% |
| 0.55 | 35 | 54.3% | 0.0% |
| 0.60 | 35 | 54.3% | 0.0% |
| 0.65 | 35 | 54.3% | 0.0% |
| 0.70 | 35 | 54.3% | 0.0% |
| 0.75 | 34 | 52.9% | 2.9% |
| 0.80 | 31 | 58.1% | 11.4% |
| 0.85 | 23 | 56.5% | 34.3% |
| 0.90 | 14 | 64.3% | 60.0% |