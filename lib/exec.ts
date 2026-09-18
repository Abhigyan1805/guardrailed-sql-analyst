import { getDb, withTenant, type TenantCtx } from './db';
import { validateSql } from './sql-guard';

export const EXPLAIN_COST_CAP = 500_000;
export const EXPLAIN_ROWS_CAP = 100_000;
// Absolute costs ≥1e9 indicate planner penalties (e.g. PGlite/disabled
// seqscan adds exactly 1e10), not real expense — fall back to row-count.
export const EXPLAIN_ABSURD_COST = 1_000_000_000;

export type Decision = 'ALLOW' | 'BLOCK' | 'CLARIFY';

export interface ExecResult {
  decision: Decision;
  blockStage?: string;
  blockReason?: string;
  rows?: Record<string, any>[];
  columns?: string[];
  executedSql?: string;
  explainCost?: number;
  latencyMs: number;
}

export async function explainCost(sql: string, ctx: TenantCtx): Promise<{ cost: number; rows: number }> {
  return withTenant(ctx, async (db) => {
    const r = (await db.query(`EXPLAIN (FORMAT JSON, COSTS ON) ${sql}`)).rows as any[];
    const plan = r[0]['QUERY PLAN'][0].Plan;
    return { cost: Number(plan['Total Cost'] ?? 0), rows: Number(plan['Plan Rows'] ?? 0) };
  });
}

export async function executeGuarded(proposedSql: string, ctx: TenantCtx, requestId = ''): Promise<ExecResult> {
  const t0 = Date.now();
  const v = validateSql(proposedSql);
  if (!v.ok) {
    await writeAudit(ctx, requestId, '', proposedSql, null, 'BLOCK', v.stage, v.reason, null, Date.now() - t0, 0, null);
    return { decision: 'BLOCK', blockStage: v.stage, blockReason: v.reason, latencyMs: Date.now() - t0 };
  }
  const finalSql = v.rewritten!;

  // Cost gate (Plan Rows always enforced; absolute cost ignored when absurd)
  let cost = 0;
  let planRows = 0;
  try {
    const ex = await explainCost(finalSql, ctx);
    cost = ex.cost; planRows = ex.rows;
  } catch (e: any) {
    await writeAudit(ctx, requestId, '', proposedSql, finalSql, 'BLOCK', 'explain', String(e?.message ?? e).slice(0, 300), null, Date.now() - t0, 0, null);
    return { decision: 'BLOCK', blockStage: 'explain', blockReason: 'EXPLAIN failed or timed out', latencyMs: Date.now() - t0 };
  }
  if (planRows > EXPLAIN_ROWS_CAP) {
    await writeAudit(ctx, requestId, '', proposedSql, finalSql, 'BLOCK', 'cost', `EXPLAIN plan rows ${planRows} > cap`, null, Date.now() - t0, 0, cost);
    return { decision: 'BLOCK', blockStage: 'cost', blockReason: `query touches too many rows (${planRows})`, explainCost: cost, latencyMs: Date.now() - t0 };
  }
  if (cost > EXPLAIN_COST_CAP && cost < EXPLAIN_ABSURD_COST) {
    await writeAudit(ctx, requestId, '', proposedSql, finalSql, 'BLOCK', 'cost', `EXPLAIN cost ${Math.round(cost)} > cap`, null, Date.now() - t0, 0, cost);
    return { decision: 'BLOCK', blockStage: 'cost', blockReason: `query too expensive (${Math.round(cost)})`, explainCost: cost, latencyMs: Date.now() - t0 };
  }

  try {
    const out = await withTenant(ctx, async (db) => {
      const r = await db.query(finalSql);
      return { rows: r.rows as Record<string, any>[], fields: (r as any).fields?.map((f: any) => f.name) ?? Object.keys((r.rows as any[])[0] ?? {}) };
    });
    const latencyMs = Date.now() - t0;
    await writeAudit(ctx, requestId, '', proposedSql, finalSql, 'ALLOW', null, null, null, latencyMs, out.rows.length, cost);
    return { decision: 'ALLOW', rows: out.rows, columns: out.fields, executedSql: finalSql, explainCost: cost, latencyMs };
  } catch (e: any) {
    const latencyMs = Date.now() - t0;
    await writeAudit(ctx, requestId, '', proposedSql, finalSql, 'BLOCK', 'execute', String(e?.message ?? e).slice(0, 300), null, latencyMs, 0, cost);
    return { decision: 'BLOCK', blockStage: 'execute', blockReason: String(e?.message ?? e).slice(0, 300), latencyMs };
  }
}

export async function writeAudit(
  ctx: TenantCtx, requestId: string, nlQuery: string, proposedSql: string,
  executedSql: string | null, decision: Decision,
  blockStage: string | null | undefined, blockReason: string | null | undefined,
  confidence: number | null | undefined, latencyMs: number, rowsReturned: number,
  explainCost: number | null | undefined,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO audit_log(tenant_id,user_id,user_role,request_id,nl_query,proposed_sql,executed_sql,decision,block_stage,block_reason,confidence,latency_ms,rows_returned,explain_cost)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [ctx.tenant_id, ctx.user_id, ctx.user_role, requestId, nlQuery, proposedSql, executedSql,
     decision, blockStage ?? null, blockReason ?? null, confidence ?? null, latencyMs, rowsReturned, explainCost ?? null]
  );
}
