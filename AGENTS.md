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
  `.github/workflows/eval.yml` runs seed -> vitest -> validate-golds -> runner.

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

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
