# Guardrailed Text-to-SQL Analyst

Plain-English questions in, SQL + chart + caveats out. Everything runs against a
read-only Postgres role with a cost cap and enforced row-level security, and when
the question is ambiguous the system asks first instead of guessing.

`text-to-sql` · `llm-guardrails` · `postgres` · `rls` · `langgraph` · `evaluation`

## Latest eval

Model: `opencode-go/deepseek-v4.1-flash` (effort low, temperature 0) · commit `f0c399d` · 3 repeats for LLM engines · EVAL_NOW 2025-09-01 · seed 42

| Engine | dev (35 of 40 scored) | held-out (42 of 60) | paraphrase (12) | p95 ALLOW | $/100q (held-out) |
|---|---|---|---|---|---|
| templates | 35/35 · 100.0% [90.1, 100.0] | 3/42 · 7.1% [2.5, 19.0] | 0/12 · 0.0% [0.0, 24.2] | 56-222 ms | $0 |
| llm | 16/35 · 45.7% [30.5, 61.8] | 23/42 · 53.2% [39.9, 68.8] | 3/12 · 27.8% [8.9, 53.2] | 22.6-29.5 s | $0.30 |
| hybrid | 35/35 · 100.0% [90.1, 100.0] | 12/42 · 32.5% [17.2, 43.6] | 4/12 · 25.0% [13.8, 60.9] | 0.10-10.9 s | $0.15 |

Every accuracy is an exact row-multiset match over the scored questions, with a
Wilson 95% interval. Interval width is the honest part of this table: on 42
scored held-out questions the interval is about ±14 points wide, and on 12
paraphrases it spans more than 40 points, so treat rank order and intervals as
the signal, not point differences. Accuracy denominators exclude expected
BLOCK/CLARIFY questions and any gold excluded by the validator (0 excluded
today). Costs are provider-reported for the LLM/hybrid engines, retries
included; `eval/REPORT.md` prices the same measured token counts under both the
DeepSeek V4.1 Flash and GLM-5.3-Flash published rate cards.

Adversarial: 51/51 attacks blocked or clarified, 0 executed violations, business-table
checksum unchanged (real Postgres; see `eval/SECURITY.md`). Defense-in-depth ablation:
11 of 13 family x layer cells still block with one layer disabled; the 2 gaps are
catalog metadata when the relation allowlist is disabled, and are named in
`eval/SECURITY.md`.

Calibration: ECE 0.39, MCE 0.74 at the retained ALLOW >= 0.75 / CLARIFY < 0.55
operating point. The dev-only threshold sweep does not justify moving the gate
(no challenger beats it by more than 5 points inside the false-clarify and caveat
budgets); what that point costs on held-out is reported in `eval/CALIBRATION.md`.

dev is the set the templates were built against and is reported for continuity
only. Held-out and paraphrase are the numbers that generalize.

## Attack matrix

| Attack | Result | Enforcing layer |
|---|---|---|
| `DELETE` / `UPDATE` / `DROP` | BLOCK | intent screen + AST statement gate |
| Writable CTE (`WITH x AS (DELETE...)`) | BLOCK | CTE body AST check |
| Base-table access (`customers`, `orders`, ...) | BLOCK | relation allowlist (+ column grants as backstop) |
| PII / secret columns (`email`, `cost`, ...) | BLOCK | column blocklist; PII ungranted at DB level |
| Cross-tenant query | filtered to own rows | RLS tenant policies |
| Forged role (`x-mock-role: admin`) | rejected | server-resolved auth context (mock identity is local-dev-only) |
| `pg_sleep()` / `dblink` / `pg_*` | BLOCK | function allowlist (default-deny) |
| Huge LIMIT | rewritten to cap | LIMIT injection (default 200, hard 1000) |
| Expensive plan | BLOCK | EXPLAIN row-count + cost gate |
| SQL comments / stacked statements | BLOCK | parser preprocessing |
| Vague question (`show sales`) | CLARIFY, nothing runs | confidence gate |
| Rate abuse | 429 + audit | token-bucket limiter |

## Run it

```bash
npm install
npm run db:seed   # deterministic seed (seed=42) into embedded Postgres
npm run test      # guardrail + RLS tests
npm run eval      # one set x engine, writes a report JSON
npm run eval:matrix   # every set x every engine, writes eval/REPORT.md
npm run dev       # UI on http://localhost:3000
```

Local dev needs no Docker. The embedded Postgres instance runs the same SQL
files (`db/*.sql`) you'd apply to a managed instance (Neon/Supabase) in prod.
Security claims are measured against real Postgres via `DATABASE_URL`
(`npm run eval:security`); the accuracy and LLM eval stays on PGlite.

## How it's put together

```
mock JWT -> rate limit -> LangGraph [link -> generate -> validate -> gate] -> exec -> audit
                                              BLOCK / CLARIFY never executes
Postgres: app_reader (SELECT only) + enforced RLS + statement_timeout + audit_log
```

Safety (`db/`, `lib/db.ts`, `lib/sql-guard.ts`, `lib/exec.ts`): only one SELECT
statement gets through, parsed with a real Postgres grammar (CTEs included).
The model only ever sees `analytics_*` views with PII stripped out. Anything
referencing base tables, PII columns, or system catalogs is rejected. The
function blocklist is a default-deny allowlist. Row caps get injected, every
query passes an EXPLAIN row-count/cost check, and execution happens in a
read-only transaction scoped to the caller's tenant. Allowed and blocked
attempts both land in an append-only audit log. Per-user and per-tenant rate
limits sit in front.

Agent (`lib/agent.ts`, LangGraph): pick relevant views, generate SQL (model or
template), validate, then a confidence gate decides whether to run it or ask a
clarifying question instead (the production gate clarifies below 0.55; the eval
models 0.75 as the upper edge of its caveat band).

Eval (`eval/`): frozen dev (40), held-out (60), paraphrase (12) and attack (51)
sets, two independent gold formulations per ALLOW question validated for
agreement, determinism and time-anchoring, and three engines
(`templates`/`llm`/`hybrid`) through one shared guardrail + gate + execution
pipeline. Scoring is positional by value, never by column name, and every
accuracy carries a Wilson 95% interval. Reports record git SHA, EVAL_NOW, model,
provider, effort, temperature, seed, set hash and timestamp.

## Five-minute demo

1. `Top 5 products by revenue`: bar chart, caveats, collapsible SQL, audit row.
2. `Delete all cancelled orders from 2023` and `show all customer emails`:
   red BLOCK banners, nothing executed, both in the audit log.
3. `show sales`: no SQL runs; answer the follow-up chips and it succeeds.
4. Same question as `tenant_a` vs `tenant_b`: different numbers, same query shape.
5. Open `eval/REPORT.md` for the full scorecard and `eval/SECURITY.md` for the
   attack and ablation evidence.

## Files

```
db/          001_schema · 002_views_rls · 003_roles_audit
docs/        THREAT_MODEL.md
lib/         db · sql-guard · exec · rate · auth · agent (LangGraph) · schema-link
app/         page.tsx · api/query/route.ts
components/  Chart.tsx (Recharts)
eval/        sets/ · golds/ · runner.ts · engines/ · metrics/ · reports/ · REPORT.md · CALIBRATION.md · SECURITY.md
scripts/     seed.ts · validate-golds.ts · attacks.ts · ablate-layer.ts · security-report.ts
```
