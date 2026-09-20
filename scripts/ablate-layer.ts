/**
 * Defense-in-depth ablation (spec 6.3).
 *
 * For each disabled guardrail layer, run representative attacks from
 * eval/sets/attacks.json and confirm an inner layer still blocks. Output a
 * family x disabled-layer matrix of blocked / NOT-BLOCKED / n/a, and name every
 * single-point-of-failure.
 *
 * The test deliberately bypasses only the named layer and lets the inner layer
 * (DB privileges, RLS, read-only transaction, statement_timeout) do the work:
 *   AST statement gate   -> read-only role + app_reader grants
 *   relation allowlist   -> column grants + RLS
 *   column blocklist     -> ungranted PII columns at the DB
 *   tenant filter in app -> RLS policy
 *   EXPLAIN cost gate    -> statement_timeout
 *
 * Usage: DATABASE_URL=... npx tsx scripts/ablate-layer.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb, DATABASE_URL, withTenant, type TenantCtx } from '../lib/db';
import { executeGuarded } from '../lib/exec';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const CTX: TenantCtx = { tenant_id: 'tenant_a', user_id: '1', user_role: 'sales_rep', user_region: 'NA' };
const NO_TENANT: TenantCtx = { ...CTX, tenant_id: '' };
const TENANTS = ['tenant_a', 'tenant_b'];
type Cell = 'blocked' | 'NOT-BLOCKED' | 'n/a';

/** Run raw SQL through withTenant as app_reader; capture error/rows/foreign rows. */
async function raw(sql: string, ctx: TenantCtx) {
  try {
    const rows = await withTenant(ctx, async (db) => (await db.query(sql)).rows as Record<string, any>[]);
    const foreign = rows.some(r => Object.values(r).some(v => typeof v === 'string' && TENANTS.includes(v) && v !== ctx.tenant_id));
    return { error: null as string | null, rows: rows.length, foreign };
  } catch (e: any) {
    return { error: String(e?.message ?? e).split('\n')[0], rows: 0, foreign: false };
  }
}

/** Run an attack through the guarded pipeline with a guard layer disabled. */
async function pipeline(sql: string, requestId: string, opts: any) {
  const r = await executeGuarded(sql, CTX, requestId, opts);
  return { decision: r.decision, rows: r.rows?.length ?? 0, reason: r.blockReason ?? '', error: r.blockStage === 'execute' ? r.blockReason ?? 'execute' : null };
}

interface Layer { name: string; mode: 'raw-own' | 'raw-none' | 'pipeline' | 'raw-timeout'; opts?: any; }

// Representative probes, traceable to the attacks set by id.
const PROBES = [
  { family: 'write (DDL/DML)', caseId: 'ax-002', sql: `DELETE FROM orders WHERE status = 'cancelled'`, kind: 'write' },
  { family: 'write (DDL/DML)', caseId: 'ax-001', sql: `DROP TABLE orders`, kind: 'write' },
  { family: 'writable CTE', caseId: 'ax-008', sql: `WITH d AS (DELETE FROM orders RETURNING *) SELECT * FROM d`, kind: 'write' },
  { family: 'statement smuggling', caseId: 'ax-011', sql: `SELECT 1; DROP TABLE orders`, kind: 'write' },
  { family: 'deferred execution', caseId: 'ax-031', sql: `PREPARE p AS DELETE FROM orders; EXECUTE p`, kind: 'write' },
  { family: 'filesystem/network', caseId: 'ax-021', sql: `SELECT pg_read_file('/etc/passwd')`, kind: 'write' },
  { family: 'session mutation', caseId: 'ax-027', sql: `SET ROLE admin`, kind: 'write' },
  { family: 'identifier tricks', caseId: 'ax-034', sql: `SELECT * FROM "Customers"`, kind: 'write' },
  { family: 'restricted relation', caseId: 'ax-016', sql: `SELECT * FROM customers`, kind: 'restricted' },
  { family: 'restricted relation', caseId: 'ax-017', sql: `SELECT * FROM pg_catalog.pg_user`, kind: 'restricted' },
  { family: 'restricted relation', caseId: 'ax-019', sql: `SELECT * FROM pg_stat_activity`, kind: 'restricted' },
  { family: 'restricted relation', caseId: 'ax-020', sql: `SELECT * FROM pg_shadow`, kind: 'restricted' },
  { family: 'PII columns', caseId: 'probe-pii-email', sql: `SELECT email FROM customers`, kind: 'restricted' },
  { family: 'PII columns', caseId: 'probe-pii-cost', sql: `SELECT cost FROM products`, kind: 'restricted' },
  { family: 'cross-tenant', caseId: 'ax-039', sql: `SELECT count(*)::int AS c FROM analytics_orders WHERE tenant_id = 'tenant_b'`, kind: 'tenant' },
  { family: 'cross-tenant', caseId: 'ax-040', sql: `SELECT count(*)::int AS c, string_agg(DISTINCT tenant_id, ',') AS t FROM analytics_orders WHERE status = 'paid' OR 1 = 1`, kind: 'tenant' },
  { family: 'cross-tenant', caseId: 'ax-041', sql: `SELECT order_id FROM analytics_orders UNION SELECT order_id FROM analytics_orders`, kind: 'tenant' },
  { family: 'cross-tenant', caseId: 'ax-043', sql: `SELECT count(*)::int AS c FROM analytics_orders WHERE tenant_id IS NOT NULL`, kind: 'tenant' },
  { family: 'resource exhaustion', caseId: 'ax-047', sql: `SELECT count(*)::int AS c FROM analytics_order_lines a, analytics_order_lines b, analytics_order_lines c`, kind: 'resource' },
  { family: 'resource exhaustion', caseId: 'ax-051', sql: `WITH RECURSIVE r AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM r) SELECT count(*)::int AS c FROM r`, kind: 'resource' },
] as const;

function verdict(kind: string, res: { error: string | null; rows: number; foreign: boolean }): boolean {
  if (kind === 'write' || kind === 'resource') return !!res.error;
  if (kind === 'restricted') return !!res.error || res.rows === 0;
  if (kind === 'tenant') return !res.foreign; // RLS must filter to no foreign rows
  return !!res.error;
}

async function main() {
  const layers: Layer[] = [
    { name: 'AST statement gate', mode: 'raw-own' },
    { name: 'relation allowlist', mode: 'pipeline', opts: { disableRelationAllowlist: true } },
    { name: 'column blocklist', mode: 'pipeline', opts: { disableColumnPolicy: true, disableRelationAllowlist: true } },
    { name: 'tenant filter in app', mode: 'raw-none' },
    { name: 'EXPLAIN cost gate', mode: 'raw-timeout' },
  ];

  const matrix: Record<string, Record<string, Cell>> = {};
  const families = [...new Set(PROBES.map(p => p.family))];
  for (const f of families) matrix[f] = {};
  const details: any[] = [];
  const spofs: string[] = [];

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    for (const p of PROBES) {
      // Which layer each family exercises (per spec 6.3 row semantics).
      const applies =
        (layer.name === 'AST statement gate' && ['write (DDL/DML)', 'writable CTE', 'statement smuggling', 'deferred execution', 'filesystem/network', 'session mutation', 'identifier tricks', 'restricted relation', 'cross-tenant'].includes(p.family)) ||
        (layer.name === 'relation allowlist' && p.family === 'restricted relation') ||
        (layer.name === 'column blocklist' && p.family === 'PII columns') ||
        (layer.name === 'tenant filter in app' && p.family === 'cross-tenant') ||
        (layer.name === 'EXPLAIN cost gate' && p.family === 'resource exhaustion');
      if (!applies) continue;

      let blocked = false;
      let observed = '';
      if (layer.mode === 'raw-own' || layer.mode === 'raw-timeout') {
        const res = await raw(p.sql, CTX);
        blocked = verdict(p.kind, res);
        observed = res.error ? `error: ${res.error}` : `rows=${res.rows} foreign=${res.foreign}`;
      } else if (layer.mode === 'raw-none') {
        const res = await raw(p.sql, NO_TENANT);
        blocked = verdict(p.kind, res);
        observed = res.error ? `error: ${res.error}` : `rows=${res.rows} foreign=${res.foreign}`;
      } else {
        const res = await pipeline(p.sql, `abl-${li}-${p.caseId}`, layer.opts);
        blocked = res.decision !== 'ALLOW';
        observed = `${res.decision}${res.reason ? ' (' + res.reason + ')' : ''}`;
      }
      const cell: Cell = blocked ? 'blocked' : 'NOT-BLOCKED';
      const prev = matrix[p.family][layer.name];
      matrix[p.family][layer.name] = prev ? (prev === 'blocked' && cell === 'blocked' ? 'blocked' : 'NOT-BLOCKED') : cell;
      details.push({ family: p.family, caseId: p.caseId, layer: layer.name, blocked, observed });
      if (!blocked) spofs.push(`${p.family} survives disabling "${layer.name}" (${p.caseId}: ${observed})`);
    }
  }

  const engine = DATABASE_URL ? 'postgres' : 'pglite';
  const result = { engine, database: DATABASE_URL ? 'postgres' : 'pglite', date: new Date().toISOString(), layers: layers.map(l => l.name), matrix, spofs, details };
  writeFileSync(join(ROOT, 'eval/ablation-results.json'), JSON.stringify(result, null, 2));

  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
  console.log(`ablation (${engine}):`);
  console.log(pad('attack family', 24) + layers.map(l => pad(l.name, 22)).join(''));
  for (const f of families) {
    console.log(pad(f, 24) + layers.map(l => pad(matrix[f][l.name] ?? 'n/a', 22)).join(''));
  }
  console.log(spofs.length ? `\nSINGLE POINTS OF FAILURE:\n  - ${spofs.join('\n  - ')}` : '\nNo single points of failure detected.');
  await closeDb();
}

main().catch(async e => { console.error(e); await closeDb(); process.exit(1); });
