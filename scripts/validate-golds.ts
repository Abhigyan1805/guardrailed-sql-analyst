/**
 * validate-golds.ts — Eval v2 gold validator.
 *
 * Proves every gold before any engine is scored:
 *   1. schema   — every set record matches spec 2.1 (fail loudly on missing field)
 *   2. agreement— two independent formulations (A direct joins, B different shape)
 *                 return the same normalized row multiset
 *   3. non-degenerate — empty / single-NULL only when the record notes allow it
 *   4. invariants — non-negativity, percentage/share bounds, tenant scoping
 *   5. determinism — 3 runs against the seeded DB produce an identical hash
 *   6. time anchoring — no now()/CURRENT_DATE/random(); EVAL_NOW is injected
 *
 * Disagreements are never hand-picked: they are written to eval/GOLD_REVIEW.md
 * and excluded from scoring (excluded_golds is countable).
 *
 * Gold execution is behind one adapter (`runGold`) against a PRIVILEGED
 * connection (PGlite superuser), so the connection can be swapped without
 * touching gold text (spec 3.1).
 *
 * Usage:
 *   npx tsx scripts/validate-golds.ts            # validate + write GOLD_REVIEW.md
 *   npx tsx scripts/validate-golds.ts --regen    # (re)materialize rows.json + hashes
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SETS = ['dev', 'heldout', 'paraphrase', 'attacks'] as const;
type SetName = (typeof SETS)[number];

/** Single fixed instant inside the seeded data range (seed clamps at 2025-08-28). */
export const EVAL_NOW = '2025-09-01T00:00:00Z';
export const TENANTS = ['tenant_a', 'tenant_b'] as const;
export const DATA_DIR = process.env.PGDATA_DIR ?? join(homedir(), '.cache', 'guardrailed-sql-analyst-pglite');

export interface GoldRow { [k: string]: unknown }

/* ------------------------------------------------------------------ */
/* adapter — the ONE place the gold connection is chosen                */
/* ------------------------------------------------------------------ */

export function substitute(sql: string, tenant: string): string {
  return sql
    .replaceAll(':eval_now', `TIMESTAMPTZ '${EVAL_NOW}'`)
    .replaceAll(':tenant', `'${tenant.replace(/'/g, "''")}'`);
}

export interface QueryHandle { query(sql: string): Promise<{ rows: unknown[] }> }

/** Run gold SQL on the privileged (guardrail-bypassing) connection. */
export async function runGold(db: QueryHandle, sql: string, tenant: string): Promise<GoldRow[]> {
  const res = await db.query(substitute(sql, tenant));
  return res.rows as GoldRow[];
}

export async function openPrivileged(): Promise<PGlite> {
  // PGlite creates DATA_DIR itself, but not its parent; CI runners have no ~/.cache.
  mkdirSync(DATA_DIR, { recursive: true });
  return new PGlite(DATA_DIR);
}

/* ------------------------------------------------------------------ */
/* normalization + comparison (pure, unit-tested)                       */
/* ------------------------------------------------------------------ */

const NULL = '\u0000NULL';

function canonicalValue(v: unknown): string {
  if (v === null || v === undefined) return NULL;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return canonicalNumber(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const s = v.trim();
    if (s !== '' && /^-?\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      if (Number.isFinite(n)) return canonicalNumber(n);
    }
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s)) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return s;
  }
  return JSON.stringify(v);
}

function canonicalNumber(n: number): string {
  const r = Math.round(n * 1e6) / 1e6;
  if (Object.is(r, -0)) return '0';
  return r.toString();
}

/** Normalize a row to an ordered list of `<column>=<canonical>` cells. */
export function normalizeRow(row: GoldRow): string[] {
  return Object.entries(row).map(([k, v]) => `${k.toLowerCase()}=${canonicalValue(v)}`);
}

/**
 * Compare two row sets as multisets. Order-insensitive unless `ordered`.
 * Column order within a row is significant.
 */
export function compareMultisets(
  a: GoldRow[], b: GoldRow[], ordered: boolean,
): { equal: boolean; onlyA: string[]; onlyB: string[] } {
  const norm = (rows: GoldRow[]) => rows.map((r) => normalizeRow(r).join(' | '));
  const na = norm(a);
  const nb = norm(b);
  if (ordered) {
    if (na.length !== nb.length) {
      return { equal: false, onlyA: na.slice(nb.length), onlyB: nb.slice(na.length) };
    }
    const bad = na.findIndex((r, i) => r !== nb[i]);
    return bad === -1
      ? { equal: true, onlyA: [], onlyB: [] }
      : { equal: false, onlyA: [`row ${bad}: ${na[bad]}`], onlyB: [`row ${bad}: ${nb[bad]}`] };
  }
  const count = (rows: string[]) => rows.reduce((m, r) => (m.set(r, (m.get(r) ?? 0) + 1), m), new Map<string, number>());
  const ca = count(na);
  const cb = count(nb);
  const onlyA: string[] = [];
  const onlyB: string[] = [];
  for (const [r, n] of ca) {
    const m = cb.get(r) ?? 0;
    if (n > m) onlyA.push(`${r} (x${n - m})`);
  }
  for (const [r, n] of cb) {
    const m = ca.get(r) ?? 0;
    if (n > m) onlyB.push(`${r} (x${n - m})`);
  }
  return { equal: onlyA.length === 0 && onlyB.length === 0, onlyA, onlyB };
}

/** Deterministic content hash of a row set (used for gold_rows_hash + determinism). */
export function hashRows(rows: GoldRow[] | Record<string, GoldRow[]>): string {
  const stable = JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  return 'sha256:' + createHash('sha256').update(stable).digest('hex');
}

/* ------------------------------------------------------------------ */
/* checks                                                               */
/* ------------------------------------------------------------------ */

const FORBIDDEN_TIME = /\b(now|clock_timestamp|statement_timestamp|transaction_timestamp|timeofday|random|random_normal|setseed|gen_random_uuid|uuid_generate_v4)\b\s*\(|\b(current_date|current_timestamp|localtime|localtimestamp|current_time)\b/i;

/** No gold may call now(), CURRENT_DATE, random(), etc. (spec 3.3 time anchoring). */
export function timeAnchoringError(sqlA: string, sqlB: string): string | null {
  for (const [name, sql] of [['A', sqlA], ['B', sqlB]] as const) {
    if (FORBIDDEN_TIME.test(sql)) return `formulation ${name} uses a forbidden time/random function`;
  }
  return null;
}

export function degeneracyError(rows: GoldRow[], allowEmpty: boolean): string | null {
  if (rows.length === 0) return allowEmpty ? null : 'empty result set';
  if (rows.length === 1 && Object.values(rows[0]).every((v) => v === null || v === undefined)) {
    return allowEmpty ? null : 'single all-NULL row';
  }
  return null;
}

const NONNEG = /(revenue|amount|total|count|orders|customers|payments|reviews|units|qty|stock|price|days)/i;
const NONNEG_SKIP = /(growth|pct|share|rate)/i;

/** Generic invariant checks: non-negativity and percentage/share bounds. */
export function invariantErrors(rows: GoldRow[]): string[] {
  const errors: string[] = [];
  if (!rows.length) return errors;
  for (const col of Object.keys(rows[0])) {
    const name = col.toLowerCase();
    const values = rows
      .map((r) => r[col])
      .filter((v) => v !== null && v !== undefined)
      .map((v) => (typeof v === 'number' ? v : Number(v)));
    if (values.some((v) => Number.isNaN(v))) continue; // non-numeric column
    if (values.length === 0) continue;
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (NONNEG.test(name) && !NONNEG_SKIP.test(name) && min < 0) {
      errors.push(`column ${col} has a negative value (${min})`);
    }
    if (/(_pct|percentage)/i.test(name) && (min < 0 || max > 100)) {
      errors.push(`column ${col} is outside [0,100] (${min}..${max})`);
    }
    if (/(growth)/i.test(name) && (min < -100 || max > 100)) {
      errors.push(`column ${col} growth is outside [-100,100] (${min}..${max})`);
    }
  }
  // partition share: an exact `share` column across multiple rows sums to ~1
  const shareCol = Object.keys(rows[0]).find((c) => c.toLowerCase() === 'share');
  if (shareCol && rows.length > 1) {
    const sum = rows.reduce((s, r) => s + Number(r[shareCol]), 0);
    if (Math.abs(sum - 1) > 0.01 && Math.abs(sum - 100) > 1) {
      errors.push(`partition share column ${shareCol} sums to ${sum}, expected ~1 (or ~100)`);
    }
  }
  return errors;
}

/** Tenant-scoped records must not let rows bleed between tenants. */
export function tenantLeakError(a: GoldRow[], b: GoldRow[]): string | null {
  const na = new Set(a.map((r) => normalizeRow(r).join(' | ')));
  const overlap = b.map((r) => normalizeRow(r).join(' | ')).filter((r) => na.has(r));
  return overlap.length ? `tenant_a and tenant_b share ${overlap.length} identical row(s)` : null;
}

/* ------------------------------------------------------------------ */
/* schema                                                               */
/* ------------------------------------------------------------------ */

const REQUIRED_FIELDS: Array<[string, string]> = [
  ['id', 'string'], ['set', 'string'], ['bucket', 'string'], ['question', 'string'],
  ['tenant', 'string'], ['expected_decision', 'string'], ['order_sensitive', 'boolean'],
  ['gold_sql_path', 'object'], ['gold_rows_hash', 'object'], ['paraphrase_of', 'object'],
  ['status', 'string'], ['retired_reason', 'object'], ['notes', 'string'],
];
const SET_VALUES = new Set(['dev', 'heldout', 'paraphrase', 'attacks']);
const BUCKET_VALUES = new Set(['easy', 'hard', 'ambiguous', 'hostile', 'tenant', 'paraphrase']);
const DECISIONS = new Set(['ALLOW', 'CLARIFY', 'BLOCK']);

export function validateRecordShape(rec: Record<string, unknown>, set: SetName): string[] {
  const errs: string[] = [];
  for (const [field, type] of REQUIRED_FIELDS) {
    if (!(field in rec)) { errs.push(`missing field "${field}"`); continue; }
    const v = rec[field];
    if (type === 'object') {
      if (v !== null && typeof v !== 'string') errs.push(`field "${field}" must be string|null`);
    } else if (typeof v !== type) {
      errs.push(`field "${field}" must be ${type}`);
    }
  }
  if (typeof rec.set === 'string' && rec.set !== set) errs.push(`record set "${rec.set}" != file set "${set}"`);
  if (typeof rec.set === 'string' && !SET_VALUES.has(rec.set)) errs.push(`invalid set "${rec.set}"`);
  if (typeof rec.bucket === 'string' && !BUCKET_VALUES.has(rec.bucket)) errs.push(`invalid bucket "${rec.bucket}"`);
  if (typeof rec.expected_decision === 'string' && !DECISIONS.has(rec.expected_decision)) errs.push(`invalid expected_decision "${rec.expected_decision}"`);
  if (typeof rec.id === 'string' && !/^[a-z]{2,4}-\d{3}$/.test(rec.id)) errs.push(`id "${rec.id}" does not match <prefix>-<3 digits>`);
  const allow = rec.expected_decision === 'ALLOW';
  if (allow && !rec.gold_sql_path) errs.push('ALLOW record must have gold_sql_path');
  if (!allow && rec.gold_sql_path) errs.push('non-ALLOW record must have gold_sql_path = null');
  return errs;
}

/* ------------------------------------------------------------------ */
/* driver                                                               */
/* ------------------------------------------------------------------ */

interface ManifestEntry { set: string; bucket: string; allow_empty: boolean; tenant_pair: boolean; has_gold: boolean }
interface Failure { id: string; set: string; bucket: string; question: string; reasons: string[]; a?: string; b?: string; rowsA?: unknown; rowsB?: unknown; onlyA?: string[]; onlyB?: string[] }

function readJson<T>(p: string): T { return JSON.parse(readFileSync(p, 'utf8')) as T; }

async function main() {
  const regen = process.argv.includes('--regen');
  const db = await openPrivileged();
  const manifest = readJson<Record<string, ManifestEntry>>(join(ROOT, 'eval/golds/manifest.json'));

  const failures: Failure[] = [];
  let checked = 0;
  let excluded = 0;
  let shapeErrors = 0;

  for (const set of SETS) {
    const path = join(ROOT, `eval/sets/${set}.json`);
    const records = readJson<Record<string, unknown>[]>(path);
    for (const rec of records) {
      const id = String(rec.id);
      const shapeErrs = validateRecordShape(rec, set);
      if (shapeErrs.length) {
        shapeErrors++;
        failures.push({ id, set, bucket: String(rec.bucket), question: String(rec.question), reasons: shapeErrs.map((e) => `schema: ${e}`) });
        continue;
      }
      // non-ALLOW records are scored behaviorally: no gold, no execution here.
      if (rec.expected_decision !== 'ALLOW') continue;

      const m = manifest[id];
      const allowEmpty = !!m?.allow_empty;
      const tenantPair = !!m?.tenant_pair;
      checked++;
      const goldDir = join(ROOT, 'eval/golds', set);
      const sqlA = readFileSync(join(goldDir, `${id}.sql`), 'utf8');
      const sqlB = readFileSync(join(goldDir, `${id}.b.sql`), 'utf8');
      const reasons: string[] = [];
      const tz = timeAnchoringError(sqlA, sqlB);
      if (tz) reasons.push(tz);

      const tenants = tenantPair ? [...TENANTS] : [String(rec.tenant)];
      const rowsFor: Record<string, GoldRow[]> = {};
      let anyRows: GoldRow[] = [];
      let diff: { onlyA: string[]; onlyB: string[] } | null = null;
      try {
        for (const tenant of tenants) {
          const a = await runGold(db, sqlA, tenant);
          const b = await runGold(db, sqlB, tenant);
          const cmp = compareMultisets(a, b, rec.order_sensitive === true);
          if (!cmp.equal) {
            reasons.push(`A/B disagree (${tenant}): ${cmp.onlyA.length} only in A, ${cmp.onlyB.length} only in B`);
            diff = diff ?? { onlyA: cmp.onlyA, onlyB: cmp.onlyB };
          }
          const deg = degeneracyError(a, allowEmpty);
          if (deg) reasons.push(`non-degenerate: ${deg}`);
          reasons.push(...invariantErrors(a));

          // determinism: 3 identical runs of formulation A
          const hashes = new Set<string>();
          for (let i = 0; i < 3; i++) hashes.add(hashRows(await runGold(db, sqlA, tenant)));
          if (hashes.size !== 1) reasons.push(`determinism: ${hashes.size} distinct hashes over 3 runs (${tenant})`);
          rowsFor[tenant] = a;
          anyRows = a;
        }
        if (tenantPair) {
          const leak = tenantLeakError(rowsFor[tenants[0]], rowsFor[tenants[1]]);
          if (leak) reasons.push(`tenant scoping: ${leak}`);
        }
      } catch (e: unknown) {
        reasons.push(`execution error: ${String((e as Error)?.message ?? e).slice(0, 300)}`);
      }

      if (!reasons.length) {
        const payload: GoldRow[] | Record<string, GoldRow[]> = tenantPair ? rowsFor : anyRows;
        const rowsPath = join(goldDir, `${id}.rows.json`);
        if (regen) {
          writeFileSync(rowsPath, JSON.stringify(payload, null, 2) + '\n');
          rec.gold_rows_hash = hashRows(payload);
        } else if (!existsSync(rowsPath)) {
          reasons.push('missing materialized rows.json (run with --regen)');
        } else {
          const fresh = hashRows(payload);
          const committed = hashRows(readJson<GoldRow[] | Record<string, GoldRow[]>>(rowsPath));
          if (committed !== fresh) reasons.push('materialized rows.json drifted from a fresh run');
          else if (rec.gold_rows_hash !== fresh) reasons.push(`gold_rows_hash mismatch (stored ${String(rec.gold_rows_hash)}, fresh ${fresh})`);
        }
      }

      if (reasons.length) {
        excluded++;
        failures.push({
          id, set, bucket: String(rec.bucket), question: String(rec.question), reasons,
          a: sqlA, b: sqlB, rowsA: rowsFor[tenants[0]], rowsB: rowsFor[tenants[1]],
          onlyA: diff?.onlyA, onlyB: diff?.onlyB,
        });
      }
    }
    if (regen) {
      writeFileSync(path, JSON.stringify(records, null, 2) + '\n');
    }
  }

  writeReview(failures, checked, excluded, shapeErrors);
  console.log(`golds: ${checked} ALLOW checked, ${excluded} excluded, ${shapeErrors} schema errors`);
  console.log(`excluded_golds=${excluded}; report: eval/GOLD_REVIEW.md`);
  if (shapeErrors || failures.length) process.exit(1);
}

function writeReview(failures: Failure[], checked: number, excluded: number, shapeErrors: number) {
  const lines: string[] = [];
  lines.push('# Gold review');
  lines.push('');
  lines.push('Generated by `scripts/validate-golds.ts`. Disagreements between the two independent');
  lines.push('gold formulations are never hand-picked: the record is listed here and excluded from');
  lines.push('scoring until adjudicated (R6). An empty log means every ALLOW gold agreed, was');
  lines.push('non-degenerate, satisfied its invariants, was deterministic, and was time-anchored.');
  lines.push('');
  lines.push(`- ALLOW golds checked: ${checked}`);
  lines.push(`- excluded_golds: ${excluded}`);
  lines.push(`- schema errors: ${shapeErrors}`);
  lines.push(`- EVAL_NOW: \`${EVAL_NOW}\``);
  lines.push('');
  lines.push('## Method');
  lines.push('');
  lines.push('- Gold SQL is written against the **base tables** (`customers`, `orders`,');
  lines.push('  `products`, `categories`, `order_items`, `payments`, `reviews`), not the');
  lines.push('  `analytics_*` views, and is executed on a privileged connection that bypasses');
  lines.push('  the guardrails. Every tenant-scoped gold filters `tenant_id` explicitly.');
  lines.push('- Each ALLOW record carries two formulations: `A` (direct joins + GROUP BY, in');
  lines.push('  `<id>.sql`) and `B` (a different shape — CTE, window, EXISTS, subquery, set');
  lines.push('  operation — in `<id>.b.sql`). Agreement is machine-proven here, never asserted.');
  lines.push('- Relative time is anchored to one injected `EVAL_NOW` via the `:eval_now` token;');
  lines.push('  the `:tenant` token is substituted per record. No gold may call `now()`,');
  lines.push('  `CURRENT_DATE`, `random()`, or any other unstable function.');
  lines.push('');
  lines.push('> Authorship caveat (R3): both formulations were authored from the question and');
  lines.push('> schema, A before B, but by the same authoring session. The independent-review');
  lines.push('> control is the machine agreement check plus structural difference, not literal');
  lines.push('> author isolation; a second human/model pass over `.b.sql` is a good next step.');
  lines.push('');
  if (!failures.length) {
    lines.push('_No disagreements or validation failures._');
  } else {
    lines.push('| id | set | bucket | reasons |');
    lines.push('|---|---|---|---|');
    for (const f of failures) lines.push(`| ${f.id} | ${f.set} | ${f.bucket} | ${f.reasons.join('; ').replace(/\|/g, '\\|')} |`);
    lines.push('');
    for (const f of failures) {
      lines.push(`## ${f.id} — ${f.question}`);
      lines.push('');
      lines.push(`Reasons: ${f.reasons.join('; ')}`);
      lines.push('');
      if (f.a) lines.push('Formulation A:\n```sql\n' + f.a.trim() + '\n```\n');
      if (f.b) lines.push('Formulation B:\n```sql\n' + f.b.trim() + '\n```\n');
      if (f.onlyA?.length) lines.push('Only in A:\n```\n' + f.onlyA.join('\n') + '\n```\n');
      if (f.onlyB?.length) lines.push('Only in B:\n```\n' + f.onlyB.join('\n') + '\n```\n');
    }
  }
  writeFileSync(join(ROOT, 'eval/GOLD_REVIEW.md'), lines.join('\n') + '\n');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
