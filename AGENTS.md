# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Build, test, run

- `npm install` then `npm run db:seed` then `npm test`. The seed is deterministic
  (mulberry32, seed=42) and writes to `$PGDATA_DIR` or `~/.cache/guardrailed-sql-analyst-pglite`.
- `scripts/seed.ts` must apply `db/003_roles_audit.sql` (creates `app_reader`) **before**
  `db/002_views_rls.sql` (grants to it); reversing that order aborts seeding.
- PGlite data directories are single-process. Two processes opening the same
  `$PGDATA_DIR` at once can corrupt it; if the DB aborts on open, delete the dir and re-seed.
- Gold validation: `npx tsx scripts/validate-golds.ts` (add `--regen` to rematerialize
  `eval/golds/**/<id>.rows.json` and rewrite `gold_rows_hash`). The CI workflow
  `.github/workflows/eval.yml` runs seed -> vitest -> validate-golds -> runner, then
  seeds real Postgres and runs the attacks + ablation security suite.

## Security suite (real Postgres, spec 6.3/7)

- `npm run eval:attacks` (add `--strict` for the CI gate) runs `eval/sets/attacks.json`
  through the pipeline and asserts BLOCK/CLARIFY, no execution, an audit row, and an
  unchanged business-table checksum. `npm run eval:ablate` writes the defense-in-depth
  matrix. `npm run eval:security` runs attacks -> ablation -> `scripts/security-report.ts`,
  which regenerates `eval/SECURITY.md` from the JSON results.
- Security claims run against real Postgres via `DATABASE_URL`; accuracy/LLM/calibration
  stays on PGlite. PGlite silently ignores `statement_timeout` and can't exercise
  filesystem/network functions, so it cannot prove the layer-fidelity claims.
  `DATABASE_URL` is the only switch in `lib/db.ts`; both engines share the `withTenant` API.
- No-root local real Postgres: unpack the PG debs to a private prefix, `initdb` and
  `pg_ctl` as the normal user, then `DATABASE_URL=postgresql://postgres@127.0.0.1:55432/shop
  npm run db:seed` (the seed now drives either engine).
- `lib/checksum.ts` hashes business tables only; `audit_log` is excluded because every
  BLOCK appends a row. `lib/sql-guard.ts` has a default-deny function allowlist plus
  structural blocks for `tenant_id`, `OR 1=1`, huge LIMIT, and view-to-view cartesians.

## Eval v2 (frozen sets + dual golds)

- Sets live in `eval/sets/{dev,heldout,paraphrase,attacks}.json`, one gold per record in
  `eval/golds/<set>/<id>.sql` (formulation A) and `<id>.b.sql` (formulation B).
- Gold SQL runs against **base tables** on a privileged (guardrail-bypassing) connection;
  it must filter `tenant_id` explicitly because RLS is bypassed. It never touches `analytics_*`.
- Two tokens are substituted by `scripts/validate-golds.ts`: `:eval_now` (fixed
  `EVAL_NOW = 2025-09-01T00:00:00Z`) and `:tenant`. No gold may use `now()`/`CURRENT_DATE`/`random()`.
- Eval context assumption: golds scope to one tenant only (admin-within-tenant). The
  sales_rep/region scope in `orders` RLS and the missing tenant column on `customers`
  mean the runner must use an admin-role context for gold comparison to match.
- `set` in the spec's 2.1 schema omits `attacks`; new set files use `set: "attacks"`.
- A/B disagreements are excluded and logged to `eval/GOLD_REVIEW.md` (`excluded_golds`);
  never hand-pick a formulation.
- `scripts/seed.ts` inserts one inactive product (`SKU-INJ`) carrying a prompt-injection
  name for adversarial data-injection coverage (spec 7.2). It is inserted after all
  generated data so it does not shift the seeded dataset.

## Measurement harness (three engines)

- Entry point `eval/runner.ts`: `npm run eval -- --set <dev|heldout|paraphrase> --engine
  <templates|llm|hybrid> [--repeats N] [--strict]`, `--attacks`, and `npm run eval:matrix`
  (writes `eval/REPORT.md`, `eval/CALIBRATION.md`, `eval/reports/<set>-<engine>-<sha>.json`).
  Default repeats: 1 for templates, 3 for LLM-involving engines.
- Scoring is positional by value with normalized types, never by column name, and requires
  matching arity (`eval/metrics/accuracy.ts`); the LLM prompt contract is built in
  `eval/engines/llm.ts` with dev-only exemplars in `lib/prompts/exemplars.ts`.
- LLM backend: one fresh headless `opencode run --pure --agent <agent> --model <pinned>
  --format json` per generation. The agent is defined inline via `OPENCODE_CONFIG_CONTENT`
  (temperature 0, every tool denied) and MCP hosts are disabled; model is pinned by
  `EVAL_LLM_MODEL`. Reports carry model, provider, temperature and `usage_source`
  (`provider` = exact backend tokens/cost; `estimated` must be labelled wherever shown).
- Use the materialized `eval/golds/<set>/<id>.rows.json` for comparison; the runner loads it
  directly and only falls back to executing gold SQL on the privileged `getDb()` connection.
- When another worktree may run at the same time, point `PGDATA_DIR` at a worktree-local
  path before `db:seed`/eval: the default dir is single-process and shared.

## Calibration, costs, CI (spec 6.2/8/9)

- `eval/runner.ts --report` regenerates `eval/REPORT.md` + `eval/CALIBRATION.md` from the
  newest committed report per (set, engine) without re-running any engine. Use it after a
  reporting-code change; `--matrix` regenerates them at the end of a full run.
- Calibration is tuned on dev only (R2): `eval/metrics/calibration.ts` sweeps ALLOW x CLARIFY
  over 0.40-0.90 and `chooseOperatingPoint` retains the pre-registered 0.75/0.55 unless a
  challenger beats it by >5pp inside the false-clarify/caveat budgets. CALIBRATION.md reports
  the held-out cost of the chosen point without tuning on it.
- Cost: provider-reported cost is preferred (amended R5); `eval/metrics/cost.ts` falls back to
  `PRICE_BASES` (DeepSeek V4.1 Flash off-peak, GLM-5.3-Flash) priced from the same token
  counts. REPORT.md shows all bases; the README `$/100q` is the measured provider figure.
- `--strict` enforces `LATENCY_GATES_MS` per engine and `ACCURACY_FLOORS` (dev/templates = 1.0)
  in `eval/loader.ts`, plus 0 violations. CI: PR/push runs unit + validate-golds + dev/templates
  + real-PG security; the nightly `schedule`/`workflow_dispatch` job runs the full matrix and
  commits reports. The nightly LLM matrix needs the `OPENCODE_AUTH_JSON` repo secret (an
  `~/.local/share/opencode/auth.json` dump); without it the job skips rather than overwrite
  LLM reports with templates-only output.
- Published numbers come from the committed `eval/reports/**` at a resolvable git SHA. The
  served model is `opencode-go/deepseek-v4.1-flash` at effort low, temperature 0, 3 repeats.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
