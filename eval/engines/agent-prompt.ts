// Prompt pieces for the agent engine.
//
// The prompt is split into a STATIC prefix (role, the full analytics schema
// with value hints, business definitions, output conventions) that is
// byte-identical for every question, and a short DYNAMIC suffix (retrieved dev
// examples + the question). Keeping the large part identical lets Gemini's
// implicit prefix cache serve it, and it is built once per process.
//
// Every definition and convention below was written from the DEV set and the
// schema only (R2): no held-out or paraphrase question informed it.
import type { Queryable } from '../schema-context';
import { VIEW_REGISTRY } from '../schema-context';
import type { Retrieved } from '../retrieval';

export const PROMPT_VERSION = 'agent-v2-2026-11-08';

// Columns whose seeded values are not deterministic across re-seeds (they are
// stamped at seed time); they are described but never sampled, so the static
// prefix, and with it the response cache, stays stable.
const UNSTABLE_COLUMNS = new Set(['analytics_payments.paid_at', 'analytics_reviews.created_at']);
const RANGE_COLUMNS: [string, string][] = [
  ['analytics_orders', 'ordered_at'],
  ['analytics_customers_masked', 'created_at'],
];

export const GLOSSARY = `BUSINESS DEFINITIONS
- Revenue = SUM(line_revenue) from analytics_order_lines. Unless the question names other statuses, revenue counts only status IN ('paid','shipped').
- Order value = SUM(line_revenue) of one order. Average/median order value = AVG/percentile_cont(0.5) over per-order values of paid and shipped orders (aggregate per order_id in a CTE first).
- Customer lifetime revenue = SUM(line_revenue) of that customer's paid and shipped orders. analytics_order_lines has no customer_id: JOIN analytics_orders ON order_id to get it.
- Order counts come from analytics_orders and include every status unless the question filters one. Counting orders through analytics_order_lines needs COUNT(DISTINCT order_id).
- "Share", "rate" or "percent of" = a fraction in 0..1 (cast to ::float), not multiplied by 100.
- Customers are identified in output by display_name from analytics_customers_masked (never raw names).
- "Active products" means is_active = true. Category questions use category_name.`;

export const CONVENTIONS = `OUTPUT CONVENTIONS (the result is compared by value and column position)
- Column order: grouping/identifying columns first, then the measures in the order the question asks for them.
- Select only what is needed: identifying columns plus the asked measures. Do not add extra columns.
- Ranked product lists ("top N products", "most expensive"): product_id, sku, name (product_name in order_lines), then the measure.
- Filtered product lists ("which products ..."): sku, name, then the column the filter or question is about.
- Customer lists: display_name, then the measures. ORDER BY the main measure DESC, customer_id ASC.
- Order lists: order_id first, then the asked fields.
- When rows are sorted by a timestamp or measure the question names ("newest first", "most recent", "highest"), include that column in the output.
- When a list question gives no size, LIMIT 20. When it gives a size (top 5, 10 most recent), use exactly that LIMIT.
- Monthly series: to_char(date_trunc('month', ts), 'YYYY-MM') AS month, ordered by month ASC. A "trend" or "including months with zero" series needs a generate_series month spine LEFT JOINed to the data, with COALESCE(..., 0).
- Grouped counts/sums with no explicit order: ORDER BY the measure DESC, then the group key ASC. Always add a deterministic tie-breaker.
- Most recent first: ORDER BY the timestamp DESC, then the id DESC.
- Time windows: explicit literal bounds, e.g. ordered_at >= '2025-01-01' AND ordered_at < '2026-01-01'. Never now(), CURRENT_DATE or random().
- A comparison "A vs B" returns one row per compared value (group key, measure).`;

export const SAFETY = `RULES
- One read-only SELECT (CTEs allowed). No DDL/DML, no comments, no stacked statements.
- Use ONLY the analytics_* views above. Never base tables, pg_*, or information_schema. Never filter or select tenant_id (row-level security already scopes the tenant).
- PII (emails, phones, real names) and finance-only cost/margin are not available: return "sql": null with a reason instead of guessing.
- If the question is too vague to answer (no metric, or no way to choose a grouping/window), return "sql": null with a reason.`;

async function stableSamples(db: Queryable, view: string, cols: string[], orderBy: string): Promise<Record<string, unknown>[]> {
  const r = await db.query(`SELECT ${cols.join(', ')} FROM ${view} ORDER BY ${orderBy} LIMIT 2`);
  return r.rows;
}

async function enumValues(db: Queryable, view: string, col: string): Promise<string[] | null> {
  const r = await db.query(`SELECT DISTINCT ${col}::text AS v FROM ${view} WHERE ${col} IS NOT NULL ORDER BY 1 LIMIT 21`);
  const vals = r.rows.map((x) => String(x.v));
  return vals.length <= 20 ? vals : null;
}

/** Render every analytics view with descriptions, enums, ranges and stable samples. */
export async function buildStaticSchema(db: Queryable, evalNow: string): Promise<string> {
  const blocks: string[] = [];
  for (const def of Object.values(VIEW_REGISTRY)) {
    const cols = def.columns.map((c) => `    - ${c.name} ${c.type}: ${c.description}`).join('\n');
    const enumLines: string[] = [];
    for (const col of def.enumColumns) {
      const vals = await enumValues(db, def.name, col);
      if (vals) enumLines.push(`    - ${col}: ${vals.map((v) => JSON.stringify(v)).join(', ')}`);
    }
    for (const [view, col] of RANGE_COLUMNS) {
      if (view !== def.name) continue;
      const r = await db.query(`SELECT to_char(MIN(${col}), 'YYYY-MM-DD') AS lo, to_char(MAX(${col}), 'YYYY-MM-DD') AS hi FROM ${view}`);
      enumLines.push(`    - ${col} range: ${r.rows[0].lo} .. ${r.rows[0].hi}`);
    }
    const sampleCols = def.columns.map((c) => c.name).filter((c) => !UNSTABLE_COLUMNS.has(`${def.name}.${c}`) && c !== 'tenant_id');
    const samples = (await stableSamples(db, def.name, sampleCols, def.orderBy)).map((r) => `    ${JSON.stringify(r)}`).join('\n');
    blocks.push(`VIEW ${def.name}: ${def.description}\n  columns:\n${cols}${enumLines.length ? `\n  values:\n${enumLines.join('\n')}` : ''}\n  sample rows:\n${samples}`);
  }
  return `You are a careful Postgres analyst. Write ONE read-only SQL query that answers the question exactly, or refuse.
Reference time (treat as "now"; resolve relative windows such as "this year" or "last 30 days" against it with literal bounds): ${evalNow}

SCHEMA (the only relations you may use):
${blocks.join('\n\n')}

${GLOSSARY}

${CONVENTIONS}

${SAFETY}

OUTPUT: a single JSON object and nothing else: {"sql": <string or null>, "reason": <short string; required when sql is null>}`;
}

export function examplesBlock(examples: Retrieved[]): string {
  if (!examples.length) return '';
  return `SOLVED EXAMPLES (closely related questions answered correctly on this schema; reuse their conventions, but answer THIS question, not theirs):\n${examples
    .map((e) => `Q: ${e.question}\nA: ${JSON.stringify({ sql: e.sql })}`)
    .join('\n\n')}\n\n`;
}

export function buildAgentPrompt(staticPrefix: string, examples: Retrieved[], question: string): string {
  return `${staticPrefix}\n\n${examplesBlock(examples)}QUESTION: ${question}\nJSON:`;
}

export interface RepairObservation {
  sql: string;
  /** Guard or database error, if the query was rejected or failed. */
  error?: string;
  /** Result shape notes for a query that ran but looks degenerate. */
  observation?: string;
}

export function buildRepairPrompt(basePrompt: string, obs: RepairObservation): string {
  const what = obs.error
    ? `It was rejected or failed with: ${obs.error}`
    : `It ran, but the result looks wrong: ${obs.observation}`;
  return `${basePrompt}\n\nYOUR PREVIOUS ANSWER:\n${obs.sql}\n${what}\nFix the query (same JSON contract). If the previous query is in fact correct, return it unchanged. If it cannot be answered, return "sql": null with a reason.\nJSON:`;
}
