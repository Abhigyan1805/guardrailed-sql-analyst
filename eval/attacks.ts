// Adversarial suite (spec 7.3). Each case is fed through the guardrail and
// execution pipeline; a pass is a BLOCK/CLARIFY decision, no executed SQL, and
// an unchanged DB fingerprint. Any executed query is a violation and fails CI.
import { preScreen } from '../lib/agent';
import { validateSql } from '../lib/sql-guard';
import { executeGuarded } from '../lib/exec';
import type { Queryable } from './schema-context';
import type { Decision } from './engines/engine';
import { loadSet } from './loader';
import { tenantCtx } from './pipeline';

export interface AttackResult {
  id: string;
  input: string;
  decision: Decision | 'ERROR';
  verdict: 'pass' | 'fail';
  note: string;
  latencyMs: number;
}

export interface AttackReport {
  items: AttackResult[];
  violations: number;
  dbUnchanged: boolean;
  fingerprintBefore: string;
  fingerprintAfter: string;
}

async function dbFingerprint(db: Queryable): Promise<string> {
  const r = await db.query(
    `SELECT (SELECT count(*) FROM orders)::text || ':' || (SELECT count(*) FROM customers)::text || ':' || (SELECT count(*) FROM products)::text AS fp`,
  );
  return String(r.rows[0].fp);
}

export async function runAttacks(db: Queryable): Promise<AttackReport> {
  const { questions } = loadSet('attacks');
  const ctx = tenantCtx('tenant_a');
  const before = await dbFingerprint(db);
  const items: AttackResult[] = [];
  let violations = 0;

  for (const q of questions) {
    const t0 = Date.now();
    const screen = preScreen(q.question);
    if (screen && 'block' in screen) {
      items.push({ id: q.id, input: q.question, decision: 'BLOCK', verdict: 'pass', note: screen.block, latencyMs: Date.now() - t0 });
      continue;
    }
    if (screen && 'clarify' in screen) {
      items.push({ id: q.id, input: q.question, decision: 'CLARIFY', verdict: 'pass', note: 'pre-screen clarify', latencyMs: Date.now() - t0 });
      continue;
    }
    const v = validateSql(q.question);
    if (!v.ok) {
      items.push({ id: q.id, input: q.question, decision: 'BLOCK', verdict: 'pass', note: `${v.stage}: ${v.reason}`, latencyMs: Date.now() - t0 });
      continue;
    }
    const exec = await executeGuarded(v.rewritten ?? q.question, ctx, `attack-${q.id}`);
    const safe = exec.decision === 'BLOCK' && !exec.executedSql;
    if (!safe) violations++;
    items.push({
      id: q.id,
      input: q.question.slice(0, 100),
      decision: exec.decision,
      verdict: safe ? 'pass' : 'fail',
      note: exec.blockReason ?? (safe ? 'blocked' : 'executed'),
      latencyMs: Date.now() - t0,
    });
  }
  const after = await dbFingerprint(db);
  return { items, violations, dbUnchanged: before === after, fingerprintBefore: before, fingerprintAfter: after };
}
