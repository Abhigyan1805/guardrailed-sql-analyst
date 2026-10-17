import type { ChartSpec, QueryResponse } from './types';

export type Tone = 'success' | 'warning' | 'danger';

export interface BarDatum {
  label: string;
  value: number;
}

export interface ResultView {
  kind: 'answer' | 'clarify' | 'blocked';
  tone: Tone;
  banner: string;
  /** One-sentence answer summary shown above the data. */
  headline: string;
  sql: string | null;
  columns: string[];
  rows: string[][];
  totalRows: number;
  chart: { title: string; bars: BarDatum[] } | null;
  caveats: string[];
  clarifyingQuestions: string[];
  /** Tappable follow-ups for a CLARIFY decision. */
  followUps: string[];
  blockReason: string | null;
  meta: string;
}

export const MAX_ROWS = 50;

/** Concrete refinements offered after a CLARIFY (the "show sales" flow). */
export const CLARIFY_FOLLOW_UPS = ['Revenue by month', 'Orders by status', 'Average order value by region', 'Top 5 products by revenue'];

export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'string' && v.length > 0 && /^-?\d+\.\d{3,}$/.test(v)) return Number(v).toFixed(2);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Bar chart only when x is a category and every y value is numeric. */
export function buildBars(spec: ChartSpec | undefined, rows: Record<string, unknown>[]): BarDatum[] | null {
  if (!spec || spec.type === 'table' || rows.length === 0) return null;
  const bars: BarDatum[] = [];
  for (const r of rows.slice(0, 12)) {
    const value = toNumber(r[spec.y]);
    if (value === null) return null;
    bars.push({ label: formatCell(r[spec.x]), value });
  }
  return bars;
}

export function toResultView(res: QueryResponse): ResultView {
  const caveats = res.caveats ?? [];
  const base = { caveats, clarifyingQuestions: [] as string[], followUps: [] as string[], blockReason: null as string | null };
  const conf = (res.confidence ?? 0).toFixed(2);

  if (res.decision === 'BLOCK') {
    const reason = res.blockReason ?? 'Request blocked by guardrails';
    return {
      ...base, kind: 'blocked', tone: 'danger', banner: 'BLOCKED', headline: reason, sql: null,
      columns: [], rows: [], totalRows: 0, chart: null, blockReason: reason,
      meta: res.blockStage ? `Stopped at: ${res.blockStage} · nothing was executed` : 'Nothing was executed',
    };
  }

  if (res.decision === 'CLARIFY') {
    return {
      ...base, kind: 'clarify', tone: 'warning', banner: 'NEEDS CLARIFICATION', sql: null,
      headline: 'I need a bit more detail before I run anything.',
      columns: [], rows: [], totalRows: 0, chart: null,
      clarifyingQuestions: res.clarifyingQuestions ?? [], followUps: CLARIFY_FOLLOW_UPS,
      meta: `Confidence ${conf} · no SQL executed`,
    };
  }

  const columns = res.columns ?? (res.rows?.[0] ? Object.keys(res.rows[0]) : []);
  const allRows = res.rows ?? [];
  const bars = buildBars(res.chartSpec, allRows);
  const n = allRows.length;
  return {
    ...base, kind: 'answer', tone: 'success', banner: 'ALLOWED',
    headline: res.chartSpec?.title ?? `${n} ${n === 1 ? 'row' : 'rows'} returned`,
    sql: res.executedSql ?? res.sql ?? null,
    columns,
    rows: allRows.slice(0, MAX_ROWS).map(r => columns.map(c => formatCell(r[c]))),
    totalRows: n,
    chart: bars ? { title: res.chartSpec!.title, bars } : null,
    meta: [`Confidence ${conf}`, res.latencyMs != null ? `${res.latencyMs}ms` : null, res.engine ? `engine ${res.engine}` : null]
      .filter(Boolean).join(' · '),
  };
}
