// Few-shot retrieval over solved DEV questions (eval/pool/dev.json).
//
// R2: the pool is dev-only. loadPool() refuses any entry whose id is not a dev
// id, and retrieval always excludes the question being answered, so a dev run
// is leave-one-out (a dev question never sees its own solution). Similarity is
// TF-IDF cosine over light-stemmed word unigrams: deterministic, no model call,
// no extra latency.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './loader';

export interface PoolEntry {
  id: string;
  question: string;
  sql: string;
}

export interface Retrieved extends PoolEntry {
  similarity: number;
}

export const POOL_PATH = join(ROOT, 'eval', 'pool', 'dev.json');

export function loadPool(path = POOL_PATH): PoolEntry[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as PoolEntry[];
  for (const e of raw) {
    if (!/^dev-\d+$/.test(e.id)) throw new Error(`retrieval pool entry ${e.id} is not a dev question (R2)`);
  }
  return raw;
}

const STOP = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'by', 'for', 'in', 'on', 'to', 'is', 'are', 'what', 'which', 'how',
  'show', 'list', 'me', 'with', 'there', 'do', 'does', 'we', 'our', 'each', 'all', 'that', 'their', 'be', 'it',
  'have', 'has', 'from', 'as', 'at', 'give', 'many', 'much',
]);

function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9$ ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map(stem);
}

export class Retriever {
  private readonly idf = new Map<string, number>();
  private readonly vecs: Map<string, number>[];

  constructor(readonly pool: PoolEntry[]) {
    const df = new Map<string, number>();
    const docs = pool.map((p) => new Set(tokenize(p.question)));
    for (const d of docs) for (const t of d) df.set(t, (df.get(t) ?? 0) + 1);
    for (const [t, n] of df) this.idf.set(t, Math.log((1 + pool.length) / (1 + n)) + 1);
    this.vecs = pool.map((p) => this.vector(p.question));
  }

  private vector(text: string): Map<string, number> {
    const tf = new Map<string, number>();
    for (const t of tokenize(text)) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v = new Map<string, number>();
    let norm = 0;
    for (const [t, n] of tf) {
      const w = n * (this.idf.get(t) ?? Math.log(1 + this.pool.length) + 1);
      v.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  }

  /** Top-k pool entries by cosine similarity, never including `excludeId`. */
  retrieve(question: string, k: number, excludeId?: string): Retrieved[] {
    const q = this.vector(question);
    const scored = this.pool.map((p, i) => {
      let s = 0;
      for (const [t, w] of q) s += w * (this.vecs[i].get(t) ?? 0);
      return { ...p, similarity: s };
    });
    return scored
      .filter((p) => p.id !== excludeId)
      .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id))
      .slice(0, k);
  }
}
