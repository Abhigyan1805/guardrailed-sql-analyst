import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPool, Retriever } from './retrieval';
import { loadSet } from './loader';

describe('retrieval pool (R2: dev only)', () => {
  const pool = loadPool();

  it('contains only dev questions, verbatim', () => {
    const dev = new Map(loadSet('dev').questions.map((q) => [q.id, q.question]));
    for (const p of pool) expect(dev.get(p.id)).toBe(p.question);
  });

  it('shares no id or question text with held-out or paraphrase', () => {
    for (const set of ['heldout', 'paraphrase']) {
      const other = loadSet(set).questions;
      const ids = new Set(other.map((q) => q.id));
      const texts = new Set(other.map((q) => q.question.trim().toLowerCase()));
      for (const p of pool) {
        expect(ids.has(p.id)).toBe(false);
        expect(texts.has(p.question.trim().toLowerCase())).toBe(false);
      }
    }
  });

  it('refuses a pool entry that is not a dev id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pool-'));
    const path = join(dir, 'pool.json');
    writeFileSync(path, JSON.stringify([{ id: 'he-001', question: 'x', sql: 'SELECT 1' }]));
    expect(() => loadPool(path)).toThrow(/not a dev question/);
  });

  it('never returns the question being answered (leave-one-out)', () => {
    const r = new Retriever(pool);
    const self = pool[13];
    const hits = r.retrieve(self.question, 3, self.id);
    expect(hits.map((h) => h.id)).not.toContain(self.id);
    expect(hits).toHaveLength(3);
  });

  it('ranks a near-duplicate first', () => {
    const r = new Retriever(pool);
    const hits = r.retrieve('Top 3 most expensive active products.', 1, 'dev-023');
    expect(hits[0].id).toBe('dev-001');
    expect(hits[0].similarity).toBeGreaterThan(0.5);
  });
});
