// Deterministic template engine (spec 5.1): the offline path only. A miss
// returns sql: null with confidence 0. Unsafe intents are handled by the
// shared pre-generation guardrail in the runner, so nothing here decides
// BLOCK/CLARIFY on its own.
import { offlineTemplate } from '../../lib/agent';
import type { Engine, Generation, Question, SchemaContext } from './engine';

export class TemplatesEngine implements Engine {
  readonly name = 'templates' as const;
  readonly usageSource = 'provider' as const; // deterministic: exact zero usage

  async generate(q: Question, _ctx: SchemaContext): Promise<Generation> {
    const t0 = Date.now();
    const r = offlineTemplate(q.question);
    const latencyMs = Date.now() - t0;
    if ('sql' in r) {
      return { sql: r.sql, confidence: r.confidence, tokensIn: 0, tokensOut: 0, retries: 0, latencyMs, usageSource: 'provider', costUsd: 0 };
    }
    return { sql: null, confidence: 0, tokensIn: 0, tokensOut: 0, retries: 0, latencyMs, usageSource: 'provider', costUsd: 0 };
  }
}
