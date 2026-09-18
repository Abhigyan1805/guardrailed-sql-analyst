import { askQuestion } from '../lib/agent';
async function main() {
  const ctx = { tenant_id: 'tenant_a', user_id: '1', user_role: 'sales_rep', user_region: 'NA' };
  for (const q of ['Top 5 products by revenue', 'Revenue by month', 'show sales', 'Delete all cancelled orders', 'What is our gross margin by category?']) {
    const a = await askQuestion(q, ctx, 'smoke');
    console.log(JSON.stringify({ q, decision: a.decision, conf: Number(a.confidence ?? 0).toFixed(2), rows: a.rows?.length ?? 0, engine: (a as any).engine, block: (a as any).blockReason ?? null, clarify: (a as any).clarifyingQuestions?.[0] ?? null }));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
