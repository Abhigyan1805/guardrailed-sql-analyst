/** Wire contract of POST /api/query (mirrors AgentAnswer in the server's lib/agent.ts). */
export type Decision = 'ALLOW' | 'CLARIFY' | 'BLOCK';
export type Tenant = 'tenant_a' | 'tenant_b';
export const TENANTS: Tenant[] = ['tenant_a', 'tenant_b'];

export interface ChartSpec {
  type: 'bar' | 'line' | 'table';
  x: string;
  y: string;
  title: string;
}

export interface QueryResponse {
  decision: Decision;
  sql?: string | null;
  executedSql?: string;
  rows?: Record<string, unknown>[];
  columns?: string[];
  chartSpec?: ChartSpec;
  caveats: string[];
  clarifyingQuestions?: string[];
  confidence: number;
  blockStage?: string;
  blockReason?: string;
  latencyMs?: number;
  engine?: string;
}
