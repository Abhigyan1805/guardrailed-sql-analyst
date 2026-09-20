// Set + gold loading and shared run constants. Supports the v2 eval/sets
// schema and the legacy v1 files (dev/questions.json, paraphrase/paraphrases
// .json, attacks/adversarial.json) so the harness runs before the sibling sets
// slice lands, without modifying those files (R1/R4).
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { Decision, Question } from './engines/engine';

export const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
export const REPORTS_DIR = join(ROOT, 'eval', 'reports');
export const SETS_DIR = join(ROOT, 'eval', 'sets');

export const EVAL_NOW = process.env.EVAL_NOW ?? '2025-09-01T00:00:00Z';
export const EVAL_SEED = Number(process.env.EVAL_SEED ?? 42);

// Gate bands (spec 6.2): >= allow is the high-confidence ALLOW band, >= clarify
// is ALLOW-with-caveat, below clarify becomes CLARIFY. Only the clarify
// boundary changes the executed set, so that is what the dev sweep varies.
export const GATE = {
  allow: Number(process.env.EVAL_GATE_ALLOW ?? 0.75),
  clarify: Number(process.env.EVAL_GATE_CLARIFY ?? 0.55),
};

export interface CliArgs {
  set?: string;
  engine?: string;
  attacks: boolean;
  matrix: boolean;
  strict: boolean;
  repeats?: number;
  limit?: number;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { attacks: false, matrix: false, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') args.set = argv[++i];
    else if (a === '--engine') args.engine = argv[++i];
    else if (a === '--attacks') args.attacks = true;
    else if (a === '--matrix') args.matrix = true;
    else if (a === '--strict') args.strict = true;
    else if (a === '--repeats') args.repeats = Number(argv[++i]);
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
  }
  return args;
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function gitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim();
  } catch {
    return 'unknown';
  }
}

export function loadEnv(): void {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

export const LEGACY_SETS: Record<string, string> = {
  dev: 'questions.json',
  paraphrase: 'paraphrases.json',
  attacks: 'adversarial.json',
};

interface RawQuestion {
  id: string;
  bucket?: string;
  question?: string;
  input?: string;
  gold?: string;
  ordered?: boolean;
  order_sensitive?: boolean;
  variant_of?: string | null;
  tenant?: string;
  expected_decision?: Decision;
  gold_sql_path?: string | null;
  gold_rows_hash?: string | null;
  paraphrase_of?: string | null;
  status?: 'active' | 'retired';
  retired_reason?: string | null;
  notes?: string | null;
  set?: string;
}

export function normalizeRecord(r: RawQuestion, set: string): Question {
  const question = r.question ?? r.input;
  if (!r.id) throw new Error(`set ${set}: record missing id`);
  if (!question) throw new Error(`set ${set}: record ${r.id} missing question/input`);
  const bucket = r.bucket ?? (set === 'attacks' ? 'hostile' : 'unknown');
  const expected: Decision = r.expected_decision ?? (bucket === 'adversarial' || bucket === 'hostile' ? 'BLOCK' : 'ALLOW');
  let gold = r.gold ?? null;
  let goldRowsPath: string | null = null;
  if (r.gold_sql_path) {
    const p = resolve(ROOT, 'eval', r.gold_sql_path);
    if (existsSync(p) && !gold) gold = readFileSync(p, 'utf8').trim();
    if (/\.sql$/.test(r.gold_sql_path)) {
      const rp = p.replace(/\.sql$/, '.rows.json');
      if (existsSync(rp)) goldRowsPath = rp;
    }
  }
  return {
    id: r.id,
    set: r.set ?? set,
    bucket,
    question,
    tenant: r.tenant ?? 'tenant_a',
    expected_decision: expected,
    order_sensitive: r.order_sensitive ?? r.ordered ?? false,
    gold_sql: gold,
    gold_sql_path: r.gold_sql_path ?? null,
    gold_rows_path: goldRowsPath,
    gold_rows_hash: r.gold_rows_hash ?? null,
    paraphrase_of: r.paraphrase_of ?? r.variant_of ?? null,
    status: r.status ?? 'active',
    retired_reason: r.retired_reason ?? null,
    notes: r.notes ?? null,
  };
}

export function setPath(set: string): string | null {
  const direct = join(SETS_DIR, `${set}.json`);
  if (existsSync(direct)) return direct;
  const legacy = LEGACY_SETS[set];
  if (legacy) {
    const p = join(ROOT, 'eval', legacy);
    if (existsSync(p)) return p;
  }
  return null;
}

export function setExists(set: string): boolean {
  return setPath(set) !== null;
}

export function loadSet(set: string): { questions: Question[]; hash: string; source: string } {
  const path = setPath(set);
  if (!path) throw new Error(`no set file for "${set}"`);
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as RawQuestion[];
  if (!Array.isArray(parsed)) throw new Error(`set ${set} is not a JSON array`);
  return { questions: parsed.map((r) => normalizeRecord(r, set)), hash: sha256(raw), source: path.replace(`${ROOT}/`, '') };
}
