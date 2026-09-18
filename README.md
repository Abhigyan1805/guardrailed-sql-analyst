# Guardrailed Text-to-SQL Analyst

Ask questions in plain English, get back **SQL + chart + caveats** — over a read-only
role, with a query-cost cap and an *"uncertain, ask first"* path instead of guessing.

## Current status (offline-template engine, no LLM key)

- **Execution accuracy: 72.5% (29/40)** — easy 10/10, medium 14/15, hard 0/10, adversarial 5/5 refused
- **Guardrail violations: 0** · **p95 latency: ~100ms** (local embedded PG)
- Attach `OPENAI_API_KEY` (or any OpenAI-compatible `LLM_BASE_URL`+key) to enable the
  LLM path (`lib/agent.ts → callLlm`) that targets the **84% gate** (`eval/runner.ts --strict`).

## Quickstart

```bash
npm install
npm run db:seed   # deterministic seed (seed=42) into embedded Postgres (PGlite)
npm run test      # guardrail + RLS tests
npm run eval      # 40-Q harness → eval/REPORT.md
npm run dev       # UI at http://localhost:3000
```

No Docker needed locally: embedded Postgres speaks the same SQL files (`db/*.sql`)
as managed Postgres (Neon/Supabase) for deploy.

## Architecture

```
mock JWT → rate-limit → LangGraph [link → generate → validate → gate] → exec → audit
                                        ↓ BLOCK/CLARIFY never executes
Postgres: app_reader (SELECT-only) + FORCE RLS + statement_timeout + audit_log
```

- **Safety** (`db/`, `lib/db.ts`, `lib/sql-guard.ts`, `lib/exec.ts`): single-SELECT
  AST allowlist (CTE-aware), table allowlist (PII-stripped `analytics_*` views only),
  column/function blocklists, `LIMIT` injection, EXPLAIN row-count + cost gates,
  `READ ONLY` txn with `SET LOCAL` tenant context + `SET LOCAL ROLE app_reader`,
  append-only `audit_log`, token-bucket rate limits.
- **Agent** (`lib/agent.ts`, LangGraph): schema linking → generation (LLM if key,
  else deterministic offline templates for golden patterns) → validation →
  confidence gate (auto ≥0.75, caution 0.55–0.74, ask-first <0.55).
- **Eval** (`eval/`): 40 gold queries (10/15/10/5), normalized multiset comparison,
  refusal + violation tracking, `REPORT.md`, CI gates.

## Demo script (5 min)

1. Happy path: `Top 5 products by revenue` → bar chart + caveats + SQL + audit row.
2. Blocked injection: `Delete all cancelled orders…` and `…show all customer emails…` → red BLOCK, nothing executed.
3. Clarify: `show sales` → no SQL run, chip questions → answer → re-run succeeds.
4. Multitenancy: same question as `tenant_a` vs `tenant_b` → different numbers.
5. Open `eval/REPORT.md`: accuracy, 0 violations, p95, refusal rate.

## Layout

```
db/          001_schema · 002_views_rls · 003_roles_audit
lib/         db · sql-guard · exec · rate · agent (LangGraph) · schema-link
app/         page.tsx · api/query/route.ts
components/  Chart.tsx (Recharts)
eval/        questions.json · runner.ts · REPORT.md
scripts/     seed.ts · validate-golds.ts · smoke.ts
```
