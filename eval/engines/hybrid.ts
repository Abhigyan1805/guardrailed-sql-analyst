// Hybrid engine (spec 5.1): template first, fall through to the LLM on a miss
// or when the template's confidence is below the configured threshold.
import type { Engine, Generation, Question, SchemaContext } from './engine';

export const DEFAULT_HYBRID_THRESHOLD = 0.55;

export class HybridEngine implements Engine {
  readonly name = 'hybrid' as const;

  constructor(
    private readonly templates: Engine,
    private readonly llm: Engine,
    private readonly threshold: number = DEFAULT_HYBRID_THRESHOLD,
  ) {}

  async generate(q: Question, ctx: SchemaContext): Promise<Generation> {
    const tg = await this.templates.generate(q, ctx);
    if (tg.sql !== null && tg.confidence >= this.threshold) {
      return { ...tg };
    }
    const lg = await this.llm.generate(q, ctx);
    return {
      sql: lg.sql,
      confidence: lg.confidence,
      tokensIn: tg.tokensIn + lg.tokensIn,
      tokensOut: tg.tokensOut + lg.tokensOut,
      retries: lg.retries,
      latencyMs: tg.latencyMs + lg.latencyMs,
      usageSource: lg.usageSource ?? tg.usageSource,
      costUsd: (tg.costUsd ?? 0) + (lg.costUsd ?? 0),
      error: lg.error,
    };
  }
}
