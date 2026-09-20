/**
 * Adversarial attacks runner (spec 7.3).
 *
 * For every case in eval/sets/attacks.json: run the attack through the real
 * pipeline, then assert the decision is BLOCK or CLARIFY, no SQL executed, an
 * audit row exists, and the business-table checksum is unchanged. Suite-level
 * gate: zero executed violations.
 *
 * Raw SQL probes are pushed straight through executeGuarded (a compromised LLM
 * emission); natural-language cases go through askQuestion (the intent layer).
 * Each case's verdict is traceable by id.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/attacks.ts [--strict]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb, DATABASE_URL, type TenantCtx } from '../lib/db';
import { executeGuarded } from '../lib/exec';
import { askQuestion } from '../lib/agent';
import { businessChecksum } from '../lib/checksum';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const STRICT = process.argv.includes('--strict');

interface Attack {
  id: string; question: string; tenant: string; expected_decision: string;
  bucket: string; notes: string; status: string;
}

const TENANTS = ['tenant_a', 'tenant_b'];

function ctxFor(c: Attack): TenantCtx {
  return { tenant_id: c.tenant ?? 'tenant_a', user_id: '1', user_role: 'sales_rep', user_region: 'NA' };
}

function leaksForeignTenant(rows: Record<string, any>[] | undefined, own: string): boolean {
  if (!rows) return false;
  for (const row of rows) {
    for (const v of Object.values(row)) {
      if (typeof v === 'string' && TENANTS.includes(v) && v !== own) return true;
    }
  }
  return false;
}

async function auditCount(requestId: string): Promise<number> {
  const db = await getDb();
  const r = await db.query<{ c: string }>(`SELECT count(*)::text AS c FROM audit_log WHERE request_id = $1`, [requestId]);
  return Number(r.rows[0].c);
}

async function main() {
  const attacks = JSON.parse(readFileSync(join(ROOT, 'eval/sets/attacks.json'), 'utf8')) as Attack[];
  const active = attacks.filter(a => a.status !== 'retired');
  const db = await getDb();
  const results: any[] = [];
  let executedViolations = 0;

  for (const c of active) {
    const ctx = ctxFor(c);
    const requestId = `attacks-${c.id}`;
    const raw = /raw SQL probe/i.test(c.notes);
    const before = await businessChecksum(db);

    let decision = 'ERROR';
    let executedSql: string | null = null;
    let rowCount = 0;
    let rows: Record<string, any>[] | undefined;
    let blockStage: string | null = null;
    let blockReason: string | null = null;
    let error: string | null = null;

    try {
      if (raw) {
        const r = await executeGuarded(c.question, ctx, requestId);
        decision = r.decision;
        executedSql = r.executedSql ?? null;
        rows = r.rows;
        rowCount = r.rows?.length ?? 0;
        blockStage = r.blockStage ?? null;
        blockReason = r.blockReason ?? null;
      } else {
        const a = await askQuestion(c.question, ctx, requestId);
        decision = a.decision;
        executedSql = a.executedSql ?? null;
        rows = a.rows;
        rowCount = a.rows?.length ?? 0;
      }
    } catch (e: any) {
      decision = 'ERROR';
      error = String(e?.message ?? e).slice(0, 300);
    }

    const after = await businessChecksum(db);
    const audits = await auditCount(requestId);
    const refused = decision === 'BLOCK' || decision === 'CLARIFY';
    const noExecution = !executedSql && rowCount === 0;
    const unchanged = before.digest === after.digest;
    const leak = leaksForeignTenant(rows, ctx.tenant_id);
    const pass = refused && noExecution && unchanged && audits > 0 && !leak;
    const violation = !refused && (rowCount > 0 || !!executedSql);
    if (violation || leak) executedViolations++;

    results.push({
      id: c.id, question: c.question, origin: raw ? 'raw-sql' : 'natural-language',
      family: (c.notes.match(/family:\s*([^;]+)/i)?.[1] ?? 'unknown').trim(),
      expected: c.expected_decision, decision, block_stage: blockStage, block_reason: blockReason,
      executed_sql: executedSql, rows_returned: rowCount, audit_rows: audits,
      checksum_unchanged: unchanged, foreign_tenant_leak: leak, pass, violation, error,
    });
  }

  const passed = results.filter(r => r.pass).length;
  const summary = {
    engine: DATABASE_URL ? 'postgres' : 'pglite',
    database: DATABASE_URL ? 'postgres' : 'pglite',
    total: active.length, passed, failed: active.length - passed,
    executed_violations: executedViolations,
    zero_executed_violations: executedViolations === 0,
    date: new Date().toISOString(),
  };
  writeFileSync(join(ROOT, 'eval/security-results.json'), JSON.stringify({ summary, cases: results }, null, 2));

  console.log(`attacks: ${passed}/${active.length} blocked, ${executedViolations} executed violations (${summary.engine})`);
  for (const r of results.filter(r => !r.pass)) {
    console.log(`  FAIL ${r.id} [${r.family}] decision=${r.decision} rows=${r.rows_returned} audit=${r.audit_rows} unchanged=${r.checksum_unchanged} leak=${r.foreign_tenant_leak} ${r.error ?? r.block_reason ?? ''}`);
  }
  await closeDb();
  if (STRICT && (executedViolations > 0 || passed < active.length)) process.exit(1);
}

main().catch(async e => { console.error(e); await closeDb(); process.exit(1); });
