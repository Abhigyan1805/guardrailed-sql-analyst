// One Engine interface for all three paths (spec 5.1). The engine changes
// generation only; guardrail, gate and execution are identical for every
// engine and live in the runner.
import type { UsageSource } from '../metrics/cost';

export type Decision = 'ALLOW' | 'CLARIFY' | 'BLOCK';
export type EngineName = 'templates' | 'llm' | 'hybrid';

export interface Question {
  id: string;
  set: string;
  bucket: string;
  question: string;
  tenant: string;
  expected_decision: Decision;
  order_sensitive: boolean;
  gold_sql: string | null;
  gold_sql_path: string | null;
  /** Materialized gold row set (`<id>.rows.json`), preferred over executing gold SQL. */
  gold_rows_path: string | null;
  gold_rows_hash: string | null;
  paraphrase_of: string | null;
  status: 'active' | 'retired';
  retired_reason: string | null;
  notes: string | null;
}

export interface ColumnSpec {
  name: string;
  type: string;
  description: string;
}

export interface ViewSpec {
  name: string;
  description: string;
  columns: ColumnSpec[];
  /** 3 PII-free sample rows from seeded data. */
  sampleRows: Record<string, unknown>[];
  /** Enumerated values for low-cardinality columns. */
  enums: Record<string, string[]>;
}

export interface SchemaContext {
  /** The 3-5 analytics_* views selected for this question (spec 4.2). */
  tables: string[];
  views: ViewSpec[];
  hint: string;
}

export interface Generation {
  sql: string | null;
  confidence: number;
  tokensIn: number;
  tokensOut: number;
  retries: number;
  latencyMs: number;
  /** Superset of spec 5.1: how the token counts were obtained. */
  usageSource?: UsageSource;
  costUsd?: number | null;
  error?: string;
}

export interface Engine {
  name: EngineName;
  generate(q: Question, ctx: SchemaContext): Promise<Generation>;
}
