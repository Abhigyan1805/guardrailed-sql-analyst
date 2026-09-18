import { parseFirst } from 'pgsql-ast-parser';

// Tables the LLM is allowed to touch. Base tables (customers, products,
// orders, ...) are NEVER in this list — only PII-stripped analytics views.
export const ALLOWED_TABLES = new Set([
  'analytics_orders',
  'analytics_customers_masked',
  'analytics_products_public',
  'analytics_order_lines',
  'analytics_payments',
  'analytics_reviews',
]);

// Column fragments that must never appear (PII / secrets / catalog).
const BLOCKED_COL_FRAGMENTS = [
  'email', 'full_name', 'phone', 'address', 'card_', 'ssn', 'password',
  'cost', // products.cost is finance-only
];

const BLOCKED_FN_FRAGMENTS = [
  'pg_sleep', 'pg_read_file', 'dblink', 'copy', 'current_setting',
  'pg_cancel', 'lo_', 'pg_',
];

const BLOCKED_KEYWORDS = [
  'insert', 'update', 'delete', 'merge', 'truncate', 'drop', 'alter',
  'create', 'grant', 'revoke', 'copy', 'vacuum', 'call', 'do',
  'for update', 'for share', ' into ',
];

export interface GuardResult {
  ok: boolean;
  stage?: string;
  reason?: string;
  rewritten?: string;
  tables?: string[];
}

export const MAX_SQL_LEN = 8000;
export const DEFAULT_LIMIT = 200;
export const HARD_LIMIT = 1000;

function collectTables(node: any, out: string[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => collectTables(n, out)); return; }
  if (node.type === 'table' && node.name?.name) out.push(node.name.name.toLowerCase());
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') collectTables(v, out);
  }
}

function collectCteNames(node: any, out: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => collectCteNames(n, out)); return; }
  if (node.type === 'with') {
    for (const b of node.bind ?? []) {
      if (b.alias?.name) out.add(b.alias.name.toLowerCase());
      collectCteNames(b.statement, out);
    }
    collectCteNames(node.in, out);
    return;
  }
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') collectCteNames(v, out);
  }
}

export function validateSql(rawSql: string): GuardResult {
  const sql = rawSql.trim().replace(/;+\s*$/, '');
  if (!sql) return { ok: false, stage: 'normalize', reason: 'empty query' };
  if (sql.length > MAX_SQL_LEN) return { ok: false, stage: 'normalize', reason: 'query too long' };
  if (sql.includes('\0')) return { ok: false, stage: 'normalize', reason: 'null byte' };
  if (/;\s*\S/.test(sql)) return { ok: false, stage: 'normalize', reason: 'stacked statements (;)' };

  const lower = ` ${sql.toLowerCase()} `;
  for (const kw of BLOCKED_KEYWORDS) {
    const pattern = kw.trim().includes(' ') ? kw.trim() : `\\b${kw.trim()}\\b`;
    if (new RegExp(pattern).test(lower)) return { ok: false, stage: 'statement-type', reason: `blocked keyword: ${kw.trim()}` };
  }
  if (/--[^\n]*\n|--[^\n]*$/.test(sql) || /\/\*/.test(sql)) {
    return { ok: false, stage: 'comments', reason: 'SQL comments not allowed' };
  }
  for (const fn of BLOCKED_FN_FRAGMENTS) {
    if (lower.includes(fn)) return { ok: false, stage: 'blocklist', reason: `blocked function/catalog: ${fn}` };
  }
  for (const col of BLOCKED_COL_FRAGMENTS) {
    // word-ish match on identifiers (covers customers.email, products.cost, etc.)
    if (new RegExp(`(^|[^a-z_])${col}([^a-z_]|$)`, 'i').test(sql)) {
      return { ok: false, stage: 'columns', reason: `restricted column: ${col}` };
    }
  }

  let ast: any;
  try {
    ast = parseFirst(sql);
  } catch (e: any) {
    return { ok: false, stage: 'parse', reason: `parse error: ${String(e?.message ?? e).slice(0, 200)}` };
  }
  if (!ast || (ast.type !== 'select' && ast.type !== 'with')) {
    return { ok: false, stage: 'statement-type', reason: 'only single SELECT allowed' };
  }
  // WITH queries: every CTE body and the inner query must themselves be
  // read-only SELECTs (rejects writable CTEs like WITH d AS (DELETE ...) ...).
  if (ast.type === 'with') {
    const checkReadOnly = (node: any): boolean => {
      if (!node) return false;
      if (node.type === 'select') return true;
      if (node.type === 'with') {
        return (node.bind ?? []).every((b: any) => checkReadOnly(b.statement)) && checkReadOnly(node.in);
      }
      return false;
    };
    if (!checkReadOnly(ast)) {
      return { ok: false, stage: 'statement-type', reason: 'only read-only SELECT CTEs allowed' };
    }
  }

  const tables: string[] = [];
  collectTables(ast, tables);
  const cteNames = new Set<string>();
  collectCteNames(ast, cteNames);
  const unique = [...new Set(tables)].filter(t => !cteNames.has(t));
  if (unique.length === 0) return { ok: false, stage: 'schema', reason: 'no tables found' };
  for (const t of unique) {
    if (!ALLOWED_TABLES.has(t)) {
      return { ok: false, stage: 'schema', reason: `table not in allowlist: ${t}` };
    }
  }

  // LIMIT injection
  let rewritten = sql;
  const hasLimit = /limit\s+\d+/i.test(sql);
  if (!hasLimit) {
    rewritten = `${sql} LIMIT ${DEFAULT_LIMIT}`;
  } else {
    const m = sql.match(/limit\s+(\d+)/i);
    const n = m ? parseInt(m[1], 10) : DEFAULT_LIMIT;
    if (n > HARD_LIMIT) {
      rewritten = sql.replace(/limit\s+\d+/i, `LIMIT ${HARD_LIMIT}`);
    }
  }

  return { ok: true, rewritten, tables: unique };
}
