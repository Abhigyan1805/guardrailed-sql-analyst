import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GeminiBackend } from './gemini';
import { QuotaExhausted, parseQuotaError } from '../../lib/gemini';

beforeAll(() => { process.env.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? 'test-key'; process.env.EVAL_GEMINI_MIN_INTERVAL_MS = '0'; });

const ok = { text: '{"sql":"SELECT 1"}', tokensIn: 5, tokensOut: 3, cachedTokens: 0 };

describe('GeminiBackend cache + backoff', () => {
  it('serves a repeated prompt from the disk cache without a second call', async () => {
    let calls = 0;
    const dir = mkdtempSync(join(tmpdir(), 'gcache-'));
    const b = new GeminiBackend('m', dir, async () => { calls++; return ok; }, async () => {});
    const a = await b.generate('p');
    const c = await b.generate('p');
    expect(calls).toBe(1);
    expect(a.cached).toBe(false);
    expect(c.cached).toBe(true);
    expect(c.text).toBe(ok.text);
    // A different sample index is a different cache entry.
    await b.generate('p', { sample: 1, temperature: 0.7 });
    expect(calls).toBe(2);
  });

  it('backs off and retries a per-minute 429', async () => {
    let calls = 0;
    const waits: number[] = [];
    const b = new GeminiBackend('m', null, async () => {
      calls++;
      if (calls < 3) throw new QuotaExhausted('m', { daily: false, retryAfterMs: 1234 });
      return ok;
    }, async (ms) => { waits.push(ms); });
    const r = await b.generate('p');
    expect(r.text).toBe(ok.text);
    expect(waits).toEqual([1234, 1234]);
  });

  it('surfaces a daily 429 immediately so the run can pause', async () => {
    const b = new GeminiBackend('m', null, async () => { throw new QuotaExhausted('m', { daily: true }); }, async () => {});
    await expect(b.generate('p')).rejects.toMatchObject({ name: 'QuotaExhausted', daily: true });
  });

  it('classifies 429 bodies', () => {
    expect(parseQuotaError('{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}').daily).toBe(true);
    expect(parseQuotaError('{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier","retryDelay":"17s"}')).toEqual({ daily: false, retryAfterMs: 17000 });
  });
});
