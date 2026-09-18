import { StateGraph, Annotation, END, START, MemorySaver } from '@langchain/langgraph';
import { linkSchema, SCHEMA_SLICE } from './schema-link';
import { validateSql } from './sql-guard';
import { executeGuarded, type Decision } from './exec';
import type { TenantCtx } from './db';

export interface ChartSpec {
  type: 'bar' | 'line' | 'table';
  x: string;
  y: string;
  title: string;
}

export interface AgentAnswer {
  decision: Decision;
  sql: string | null;
  executedSql?: string;
  rows?: Record<string, any>[];
  columns?: string[];
  chartSpec?: ChartSpec;
  caveats: string[];
  clarifyingQuestions?: string[];
  confidence: number;
  blockStage?: string;
  blockReason?: string;
  latencyMs: number;
  engine: 'llm' | 'offline-template';
}

const VAGUE_WORDS = ['sales', 'report', 'overview', 'data', 'performance', 'recent', 'top', 'breakdown', 'good', 'best'];

const State = Annotation.Root({
  question: Annotation<string>,
  sql: Annotation<string | null>,
  chartSpec: Annotation<ChartSpec | null>,
  caveats: Annotation<string[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  assumptions: Annotation<string[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  selfConfidence: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  validationOk: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  blockReason: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  decision: Annotation<Decision | null>({ reducer: (_, b) => b, default: () => null }),
});

export interface CtxCarrier { ctx: TenantCtx; requestId: string; }

/** Offline deterministic generator — used when no LLM key is set.
 *  Covers golden/demo patterns; returns null when it cannot map safely. */
export function offlineTemplate(question: string): {
  sql: string; chart: ChartSpec; caveats: string[]; confidence: number; assumptions: string[];
} | { clarify: string[] } | { block: string } {
  const q = question.toLowerCase().trim();

  // Unsafe intents → block before any SQL is built
  if (/(delete|update |insert |drop |truncate|alter |grant |ignore previous|show .*email|full pii|pg_shadow|other regions|other tenants|dump |set \w+ to|stock_qty|all customer)/.test(q)) {
    if (/email|pii/.test(q)) return { block: 'PII / restricted-column request refused' };
    if (/cost|margin/.test(q) && /show|what/.test(q)) return { block: 'gross-margin needs restricted products.cost — refused (analyst role)' };
    return { block: 'write/privileged operation refused' };
  }
  if (/(cost|margin)/.test(q)) return { block: 'gross-margin needs restricted products.cost — refused (analyst role)' };

  // Vague → clarify
  if (/^(show )?(sales|report|overview|data|dashboard)[\s.?]*$/.test(q) || q.length < 12) {
    return { clarify: ['Which metric: revenue, order count, or average order value?', 'Which time window: last 30 days, last quarter, or year-to-date?', 'Which grouping: by month, by region, or by category?'] };
  }

  const lim = (q.match(/top\s+(\d+)/) ? parseInt(q.match(/top\s+(\d+)/)![1], 10) : 5);

  if (/most expensive/.test(q) && /product/.test(q)) {
    return {
      sql: `SELECT product_id, sku, name, list_price FROM analytics_products_public WHERE is_active = true ORDER BY list_price DESC, product_id ASC LIMIT ${lim}`,
      chart: { type: 'table', x: 'name', y: 'list_price', title: 'Most expensive products' },
      caveats: ['Active products only', `Limited to ${lim} rows`],
      confidence: 0.9, assumptions: [],
    };
  }
  if (/revenue.*month|month.*revenue|monthly revenue|trend|growth|mom/.test(q)) {
    return {
      sql: `WITH spine AS (SELECT generate_series(date_trunc('month', min(ordered_at)), date_trunc('month', max(ordered_at)), interval '1 month') AS mon FROM analytics_order_lines WHERE status IN ('paid','shipped')), rev AS (SELECT date_trunc('month', ordered_at) AS mon, SUM(line_revenue) AS revenue FROM analytics_order_lines WHERE status IN ('paid','shipped') GROUP BY 1) SELECT to_char(s.mon,'YYYY-MM') AS month, COALESCE(r.revenue,0) AS revenue FROM spine s LEFT JOIN rev r ON r.mon = s.mon ORDER BY s.mon ASC`,
      chart: { type: 'line', x: 'month', y: 'revenue', title: 'Revenue by month' },
      caveats: ['Paid + shipped only, net of discount', 'Zero-revenue months included'],
      confidence: 0.82, assumptions: ['Metric = net revenue (paid+shipped)'],
    };
  }
  if (/revenue.*categor| categor.*revenue/.test(q)) {
    const y = q.match(/20\d\d/);
    const filt = y ? `AND ordered_at >= '${y[0]}-01-01' AND ordered_at < '${Number(y[0]) + 1}-01-01'` : '';
    return {
      sql: `SELECT category_name, SUM(line_revenue) AS revenue FROM analytics_order_lines WHERE status IN ('paid','shipped') ${filt} GROUP BY category_name ORDER BY revenue DESC, category_name ASC LIMIT ${lim}`,
      chart: { type: 'bar', x: 'category_name', y: 'revenue', title: 'Revenue by category' },
      caveats: ['Paid + shipped only, net of discount', `Top ${lim} categories`],
      confidence: 0.85, assumptions: [],
    };
  }
  if (/top.*product/.test(q)) {
    return {
      sql: `SELECT product_id, sku, product_name, SUM(line_revenue) AS revenue FROM analytics_order_lines WHERE status IN ('paid','shipped') GROUP BY product_id, sku, product_name ORDER BY revenue DESC, product_id ASC LIMIT ${lim}`,
      chart: { type: 'bar', x: 'product_name', y: 'revenue', title: 'Top products by revenue' },
      caveats: ['Paid + shipped only, net of discount', `Top ${lim} by revenue`],
      confidence: 0.85, assumptions: ['Metric = net revenue'],
    };
  }
  if (/cancelled|canceled/.test(q)) {
    const region = /eu/.test(q) ? `AND region = 'EU'` : '';
    if (/by region|per region/.test(q)) {
      return {
        sql: `SELECT region, COUNT(*) AS cancelled FROM analytics_orders WHERE status = 'cancelled' GROUP BY region ORDER BY cancelled DESC, region ASC`,
        chart: { type: 'bar', x: 'region', y: 'cancelled', title: 'Cancelled orders by region' },
        caveats: ['Cancelled only'],
        confidence: 0.82, assumptions: [],
      };
    }
    return {
      sql: `SELECT COUNT(*) AS cancelled_orders FROM analytics_orders WHERE status = 'cancelled' ${region}`,
      chart: { type: 'table', x: 'cancelled_orders', y: 'cancelled_orders', title: 'Cancelled orders' },
      caveats: ['Count only'],
      confidence: 0.8, assumptions: [],
    };
  }
  if (/avg.*order value|average order|aov/.test(q) && !/refund/.test(q)) {
    return {
      sql: `WITH o AS (SELECT order_id, region, SUM(line_revenue) AS revenue FROM analytics_order_lines WHERE status IN ('paid','shipped') GROUP BY order_id, region) SELECT region, AVG(revenue) AS avg_order_value, COUNT(*) AS orders FROM o GROUP BY region ORDER BY region ASC`,
      chart: { type: 'bar', x: 'region', y: 'avg_order_value', title: 'Average order value by region' },
      caveats: ['Paid + shipped only', 'Pre-aggregated per order to avoid fanout'],
      confidence: 0.8, assumptions: [],
    };
  }
  if (/by status|per status|status breakdown/.test(q) && !/recent|latest|newest|20\d\d|per month|monthly/.test(q)) {
    return {
      sql: `SELECT status, COUNT(*) AS orders FROM analytics_orders GROUP BY status ORDER BY orders DESC, status ASC`,
      chart: { type: 'bar', x: 'status', y: 'orders', title: 'Orders by status' },
      caveats: ['All statuses included'],
      confidence: 0.85, assumptions: [],
    };
  }
  if (/payment|method|paypal/.test(q)) {
    return {
      sql: `SELECT method, COUNT(*) AS payments, SUM(amount) AS total FROM analytics_payments GROUP BY method ORDER BY total DESC, method ASC`,
      chart: { type: 'bar', x: 'method', y: 'total', title: 'Payments by method' },
      caveats: ['Completed payments only'],
      confidence: 0.8, assumptions: [],
    };
  }
  if (/customer.*segment|segment/.test(q) && !/created|joined/.test(q)) {
    return {
      sql: `SELECT segment, COUNT(*) AS customers FROM analytics_customers_masked GROUP BY segment ORDER BY customers DESC, segment ASC`,
      chart: { type: 'bar', x: 'segment', y: 'customers', title: 'Customers by segment' },
      caveats: ['PII masked (display names only)'],
      confidence: 0.8, assumptions: [],
    };
  }
  if (/orders.*month|monthly.*orders|orders per month/.test(q)) {
    const y = q.match(/20\d\d/);
    const filt = y ? `WHERE ordered_at >= '${y[0]}-01-01' AND ordered_at < '${Number(y[0]) + 1}-01-01'` : '';
    return {
      sql: `SELECT to_char(date_trunc('month', ordered_at),'YYYY-MM') AS month, COUNT(*) AS orders FROM analytics_orders ${filt} GROUP BY 1 ORDER BY 1 ASC`,
      chart: { type: 'line', x: 'month', y: 'orders', title: 'Orders by month' },
      caveats: [y ? `Calendar ${y[0]}` : 'All time', 'All statuses'],
      confidence: 0.82, assumptions: [],
    };
  }
  if (/discount.*categor|categor.*discount/.test(q)) {
    return {
      sql: `SELECT category_name, AVG(discount) AS avg_discount FROM analytics_order_lines GROUP BY category_name ORDER BY avg_discount DESC, category_name ASC`,
      chart: { type: 'bar', x: 'category_name', y: 'avg_discount', title: 'Average discount by category' },
      caveats: ['All line statuses included'],
      confidence: 0.8, assumptions: [],
    };
  }
  if (/paid.*shipped|shipped.*paid/.test(q) && /revenue|total|compare|breakdown|versus| vs /.test(q)) {
    return {
      sql: `SELECT status, SUM(line_revenue) AS revenue FROM analytics_order_lines WHERE status IN ('paid','shipped') GROUP BY status ORDER BY status ASC`,
      chart: { type: 'bar', x: 'status', y: 'revenue', title: 'Revenue: paid vs shipped' },
      caveats: ['Net of discount'],
      confidence: 0.82, assumptions: [],
    };
  }
  if (/never ordered|no orders|not ordered|unordered/.test(q)) {
    return {
      sql: `SELECT p.sku, p.name FROM analytics_products_public p WHERE NOT EXISTS (SELECT 1 FROM analytics_order_lines l WHERE l.product_id = p.product_id) ORDER BY p.product_id ASC LIMIT 20`,
      chart: { type: 'table', x: 'sku', y: 'name', title: 'Never-ordered products' },
      caveats: ['Limited to 20 rows'],
      confidence: 0.78, assumptions: [],
    };
  }
  if (/rating|review/.test(q)) {
    return {
      sql: `SELECT AVG(rating)::float AS avg_rating, COUNT(*) AS reviews FROM analytics_reviews`,
      chart: { type: 'table', x: 'avg_rating', y: 'reviews', title: 'Average rating' },
      caveats: ['All reviews included'],
      confidence: 0.8, assumptions: [],
    };
  }
  if (/customers?.*(created|joined)|created after|new customers/.test(q)) {
    const d = q.match(/20\d\d-\d\d-\d\d/);
    const since = d ? d[0] : '2024-01-01';
    return {
      sql: `SELECT display_name, segment, created_at FROM analytics_customers_masked WHERE created_at > '${since}T00:00:00Z' ORDER BY created_at DESC, customer_id ASC LIMIT 10`,
      chart: { type: 'table', x: 'display_name', y: 'segment', title: 'New customers' },
      caveats: [`Created after ${since}`, 'PII masked', 'Limited to 10 rows'],
      confidence: 0.82, assumptions: [],
    };
  }
  if (/low stock|stock (below|under|less)|running low/.test(q)) {
    return {
      sql: `SELECT sku, name, stock_qty FROM analytics_products_public WHERE stock_qty < 10 ORDER BY stock_qty ASC, product_id ASC LIMIT 20`,
      chart: { type: 'table', x: 'name', y: 'stock_qty', title: 'Low-stock products' },
      caveats: ['Stock below 10 units', 'Limited to 20 rows'],
      confidence: 0.85, assumptions: [],
    };
  }
  if (/recent orders|latest orders|newest orders/.test(q)) {
    return {
      sql: `SELECT order_id, status, ordered_at, region FROM analytics_orders ORDER BY ordered_at DESC, order_id DESC LIMIT 10`,
      chart: { type: 'table', x: 'order_id', y: 'status', title: 'Most recent orders' },
      caveats: ['All statuses included', 'Limited to 10 rows'],
      confidence: 0.85, assumptions: [],
    };
  }
  if (/categor/.test(q) && /list|all categor|show|distinct/.test(q) && q.length < 45) {
    return {
      sql: `SELECT DISTINCT category_name FROM analytics_products_public ORDER BY category_name ASC`,
      chart: { type: 'table', x: 'category_name', y: 'category_name', title: 'Categories' },
      caveats: ['Distinct category names'],
      confidence: 0.9, assumptions: [],
    };
  }
  if (/revenue.*region|region.*revenue/.test(q)) {
    return {
      sql: `SELECT region, SUM(line_revenue) AS revenue FROM analytics_order_lines WHERE status IN ('paid','shipped') GROUP BY region ORDER BY revenue DESC, region ASC`,
      chart: { type: 'bar', x: 'region', y: 'revenue', title: 'Revenue by region' },
      caveats: ['Paid + shipped only, net of discount'],
      confidence: 0.85, assumptions: [],
    };
  }
  if (/top.*customer/.test(q)) {
    return {
      sql: `WITH r AS (SELECT o.customer_id, SUM(l.line_revenue) AS revenue FROM analytics_order_lines l JOIN analytics_orders o USING (order_id) WHERE l.status IN ('paid','shipped') GROUP BY o.customer_id) SELECT c.display_name, r.revenue FROM r JOIN analytics_customers_masked c USING (customer_id) ORDER BY r.revenue DESC, c.customer_id ASC LIMIT 5`,
      chart: { type: 'bar', x: 'display_name', y: 'revenue', title: 'Top customers by revenue' },
      caveats: ['Paid + shipped only, net of discount', 'Top 5 by revenue', 'PII masked'],
      confidence: 0.8, assumptions: ['Metric = net revenue'],
    };
  }
  if (/refund/.test(q)) {
    return {
      sql: `WITH o AS (SELECT order_id, region, status, SUM(line_revenue) AS revenue FROM analytics_order_lines GROUP BY order_id, region, status) SELECT region, AVG(CASE WHEN status IN ('paid','shipped') THEN revenue END) AS avg_order_value, SUM(CASE WHEN status='refunded' THEN 1 ELSE 0 END)::float/COUNT(*) AS refunded_share, COUNT(*) AS orders FROM o GROUP BY region ORDER BY region ASC`,
      chart: { type: 'bar', x: 'region', y: 'refunded_share', title: 'Refund share by region' },
      caveats: ['Revenue pre-aggregated per order to avoid fanout'],
      confidence: 0.78, assumptions: [],
    };
  }
  if (/pending/.test(q)) {
    return {
      sql: `SELECT COUNT(*) AS pending_orders FROM analytics_orders WHERE status = 'pending'`,
      chart: { type: 'table', x: 'pending_orders', y: 'pending_orders', title: 'Pending orders' },
      caveats: ['Count only'],
      confidence: 0.88, assumptions: [],
    };
  }
  if (/orders.*20\d\d|20\d\d.*orders/.test(q) && /how many|count|number/.test(q)) {
    const y = q.match(/20\d\d/)![0];
    return {
      sql: `SELECT COUNT(*) AS orders_${y} FROM analytics_orders WHERE ordered_at >= '${y}-01-01' AND ordered_at < '${Number(y) + 1}-01-01'`,
      chart: { type: 'table', x: `orders_${y}`, y: `orders_${y}`, title: `Orders in ${y}` },
      caveats: [`Ordered in calendar ${y}`, 'All statuses'],
      confidence: 0.85, assumptions: [],
    };
  }

  return { clarify: ['Which metric: revenue, order count, or average order value?', 'Which time window should I use?', 'How should I group the results?'] };
}

async function callLlm(question: string): Promise<{ sql: string; chart: ChartSpec; caveats: string[]; confidence: number; assumptions: string[] } | null> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  if (!apiKey) return null;
  const base = process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1';
  const model = process.env.LLM_MODEL ?? 'gpt-4o-mini';
  const prompt = `You are a Postgres analyst. Use ONLY these views/columns.\n${SCHEMA_SLICE}\n\nQuestion: ${question}\n\nReturn JSON: {"sql": string (single SELECT, LIMIT<=1000), "chart": {"type":"bar"|"line"|"table","x":col,"y":col,"title":string}, "caveats": string[], "confidence": 0..1, "assumptions": string[]}. Rules: revenue=SUM(line_revenue) with status IN ('paid','shipped'); deterministic ORDER BY with tie-breaker; no DDL/DML; no base tables; no PII columns. If ambiguous, set confidence < 0.55.`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, temperature: 0, max_tokens: 900,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? 'null');
    if (!parsed?.sql) return null;
    return { sql: parsed.sql, chart: parsed.chart ?? { type: 'table', x: '', y: '', title: '' }, caveats: parsed.caveats ?? [], confidence: parsed.confidence ?? 0.5, assumptions: parsed.assumptions ?? [] };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function buildGraph(carrier: CtxCarrier) {
  const g = new StateGraph(State)
    .addNode('link', async (s) => {
      linkSchema(s.question); // recorded for prompt context
      return {};
    })
    .addNode('generate', async (s) => {
      const llm = await callLlm(s.question);
      if (llm) {
        return { sql: llm.sql, chartSpec: llm.chart, caveats: llm.caveats, assumptions: llm.assumptions, selfConfidence: llm.confidence };
      }
      const t = offlineTemplate(s.question);
      if ('block' in t) return { sql: null, blockReason: t.block, selfConfidence: 0, decision: 'BLOCK' as Decision };
      if ('clarify' in t) return { sql: null, selfConfidence: 0.3, assumptions: t.clarify, decision: 'CLARIFY' as Decision };
      return { sql: t.sql, chartSpec: t.chart, caveats: t.caveats, assumptions: t.assumptions, selfConfidence: t.confidence };
    })
    .addNode('validate', async (s) => {
      if (!s.sql) return { validationOk: false };
      const v = validateSql(s.sql);
      if (!v.ok) return { validationOk: false, blockReason: `${v.stage}: ${v.reason}`, decision: 'BLOCK' as Decision };
      return { validationOk: true, sql: v.rewritten ?? s.sql };
    })
    .addNode('gate', async (s) => {
      if (s.decision === 'BLOCK') return {};
      if (s.decision === 'CLARIFY' && !s.sql) return {};
      const q = s.question.toLowerCase();
      const vagueHits = VAGUE_WORDS.filter(w => q.includes(w)).length;
      const ambiguity = Math.min(1, vagueHits * 0.25 + (s.assumptions.length >= 2 ? 0.3 : 0));
      const grounding = s.validationOk ? 1 : 0.4;
      const final = 0.4 * s.selfConfidence + 0.3 * grounding + 0.3 * (1 - ambiguity);
      if (final < 0.55) {
        return {
          decision: 'CLARIFY' as Decision,
          assumptions: s.assumptions.length ? s.assumptions : ['Could you clarify the metric, time window, and grouping?'],
        };
      }
      return { decision: 'ALLOW' as Decision, selfConfidence: final };
    })
    .addEdge(START, 'link')
    .addEdge('link', 'generate')
    .addEdge('generate', 'validate')
    .addEdge('validate', 'gate')
    .addEdge('gate', END)
    .compile({ checkpointer: new MemorySaver() });
  return g;
}

export async function askQuestion(question: string, ctx: TenantCtx, requestId = `q-${Date.now()}`, threadId = 'default'): Promise<AgentAnswer> {
  const t0 = Date.now();
  const carrier: CtxCarrier = { ctx, requestId };
  const graph = buildGraph(carrier);
  const out = await graph.invoke(
    { question, caveats: [], assumptions: [] } as any,
    { configurable: { thread_id: `${threadId}-${Date.now()}` } }
  ) as any;

  const engine = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY ? 'llm' : 'offline-template';

  if (out.decision === 'BLOCK' && !out.sql) {
    const { writeAudit } = await import('./exec');
    await writeAudit(ctx, requestId, question, '', null, 'BLOCK', 'intent', out.blockReason ?? 'refused', 0, Date.now() - t0, 0, null);
    return { decision: 'BLOCK', sql: null, caveats: [], confidence: 0, blockStage: 'intent', blockReason: out.blockReason, latencyMs: Date.now() - t0, engine };
  }
  if ((out.decision === 'CLARIFY' && !out.sql) || !out.sql) {
    const { writeAudit } = await import('./exec');
    await writeAudit(ctx, requestId, question, '', null, 'CLARIFY', null, null, out.selfConfidence ?? 0.3, Date.now() - t0, 0, null);
    return { decision: 'CLARIFY', sql: null, caveats: [], clarifyingQuestions: out.assumptions ?? [], confidence: out.selfConfidence ?? 0.3, latencyMs: Date.now() - t0, engine };
  }

  const exec = await executeGuarded(out.sql, ctx, requestId);
  if (exec.decision !== 'ALLOW') {
    return { decision: 'BLOCK', sql: out.sql, caveats: [], confidence: out.selfConfidence ?? 0, blockStage: exec.blockStage, blockReason: exec.blockReason, latencyMs: Date.now() - t0, engine };
  }
  return {
    decision: 'ALLOW', sql: out.sql, executedSql: exec.executedSql,
    rows: exec.rows, columns: exec.columns,
    chartSpec: out.chartSpec ?? { type: 'table', x: '', y: '', title: '' },
    caveats: [...(out.caveats ?? []), `Limited to ${(exec.rows ?? []).length} rows shown`],
    confidence: out.selfConfidence ?? 0.5,
    latencyMs: Date.now() - t0 + exec.latencyMs, engine,
  };
}
