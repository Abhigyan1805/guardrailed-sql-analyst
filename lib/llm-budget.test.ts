import { describe, it, expect, beforeEach } from 'vitest';
import { takeLlmCall, llmCapReached, resetLlmBudget } from './llm-budget';

describe('llm daily cap', () => {
  beforeEach(() => { resetLlmBudget(); process.env.LLM_DAILY_CAP = '2'; });
  it('allows calls up to the cap then refuses', () => {
    expect(takeLlmCall()).toBe(true);
    expect(llmCapReached()).toBe(false);
    expect(takeLlmCall()).toBe(true);
    expect(llmCapReached()).toBe(true);
    expect(takeLlmCall()).toBe(false);
  });
  it('cap 0 disables the LLM', () => {
    process.env.LLM_DAILY_CAP = '0';
    expect(takeLlmCall()).toBe(false);
  });
});
