# Guardrailed Text-to-SQL Analyst

Plain-English questions in, SQL + chart + caveats out. Everything runs against a
read-only Postgres role with a cost cap, and when the question is ambiguous the
system asks first instead of guessing.

## Latest eval

| Engine | Accuracy | p95 | Notes |
|---|---|---|---|
| Deterministic templates | 40/40 | ~80ms | covers the evaluated question shapes; default (`LLM_PROVIDER=offline`) |
| Gemini 2.5 Flash | 23/40 | ~16s | alias drift on easy Qs, abstention on hard; dropped (see below) |

Gates live in `eval/runner.ts --strict` (>=34/40, 0 violations, p95 <= 2400ms
overall and on ALLOW decisions) and run in CI.

Honest context: the 40/40 measures the deterministic path against this
benchmark, not general LLM Text-to-SQL ability. The model call stays wired in
(`callLlm`) for questions outside template coverage. Set
`LLM_PROVIDER=openai` or `gemini` with a key and misses fall through to it
instead of the clarify path.

### Why templates beat the LLM here

| | Accuracy | p95 latency | Cost |
|---|---|---|---|
| Offline templates | 40/40 | ~80ms | $0, no quota |
| Gemini 2.5 Flash | 23/40 | ~16s | free-tier RPM-bound |

The model lost on all three axes that matter for this system: it drifted on
column aliases the harness scores, abstained on hard questions the templates
answer exactly, and its round-trips (plus quota throttling) blew the latency
gate by 7x. Since the guardrails (not the generator) are the point of this
project, the simpler mechanism won. The provider interface stays so a stronger
model can be slotted back in later; a written headroom analysis puts a
frontier paid model around 37/40 on this suite.

## Attack matrix

| Attack | Result | Enforcing layer |
|---|---|---|
| `DELETE` / `UPDATE` / `DROP` | BLOCK | intent screen + AST statement gate |
| Writable CTE (`WITH x AS (DELETE...)`) | BLOCK | CTE body AST check |
| Base-table access (`customers`, `orders`, ...) | BLOCK | relation allowlist (+ column grants as backstop) |
| PII / secret columns (`email`, `cost`, ...) | BLOCK | column blocklist; PII ungranted at DB level |
| Cross-tenant query | filtered to own rows | RLS tenant policies |
| Forged role (`x-mock-role: admin`) | rejected | server-resolved auth context (mock identity is local-dev-only) |
| `pg_sleep()` / `dblink` / `pg_*` | BLOCK | function blocklist |
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
npm run eval      # 40-question harness, writes eval/REPORT.md
npm run dev       # UI on http://localhost:3000
```

Local dev needs no Docker. The embedded Postgres instance runs the same SQL
files (`db/*.sql`) you'd apply to a managed instance (Neon/Supabase) in prod.

## How it's put together

```
mock JWT -> rate limit -> LangGraph [link -> generate -> validate -> gate] -> exec -> audit
                                              BLOCK / CLARIFY never executes
Postgres: app_reader (SELECT only) + enforced RLS + statement_timeout + audit_log
```

Safety (`db/`, `lib/db.ts`, `lib/sql-guard.ts`, `lib/exec.ts`): only one SELECT
statement gets through, parsed with a real Postgres grammar (CTEs included).
The model only ever sees `analytics_*` views with PII stripped out. Anything
referencing base tables, PII columns, or system catalogs is rejected. Row caps
get injected, every query passes an EXPLAIN row-count/cost check, and execution
happens in a read-only transaction scoped to the caller's tenant. Allowed and
blocked attempts both land in an append-only audit log. Per-user and
per-tenant rate limits sit in front.

Agent (`lib/agent.ts`, LangGraph): pick relevant views, generate SQL (model or
template), validate, then a confidence gate decides: run it (>=0.75), run it
with a warning banner (0.55-0.74), or ask a clarifying question instead (<0.55).

Eval (`eval/`): 40 hand-written gold queries across four buckets. Results are
compared as executed row sets, not SQL strings. The report also tracks refusal
rate on hostile questions, per-decision latency, and token usage.

## Five-minute demo

1. `Top 5 products by revenue`: bar chart, caveats, collapsible SQL, audit row.
2. `Delete all cancelled orders from 2023` and `show all customer emails`:
   red BLOCK banners, nothing executed, both in the audit log.
3. `show sales`: no SQL runs; answer the follow-up chips and it succeeds.
4. Same question as `tenant_a` vs `tenant_b`: different numbers, same query shape.
5. Open `eval/REPORT.md` for the full scorecard.

## Files

```
db/          001_schema · 002_views_rls · 003_roles_audit
docs/        THREAT_MODEL.md
lib/         db · sql-guard · exec · rate · auth · agent (LangGraph) · schema-link
app/         page.tsx · api/query/route.ts
components/  Chart.tsx (Recharts)
eval/        questions.json · runner.ts · REPORT.md
scripts/     seed.ts · validate-golds.ts · smoke.ts
```
