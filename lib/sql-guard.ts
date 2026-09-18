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
export const MAX_OFFSET = 5000;

// Mirrors db/002_views_rls.sql. Refs outside these sets are rejected before
// execution (the DB column grants backstop the same rule).
const VIEW_COLS: Record<string, Set<string>> = {
  analytics_orders: new Set(['order_id', 'customer_id', 'status', 'ordered_at', 'region', 'sales_rep_id', 'tenant_id']),
  analytics_customers_masked: new Set(['customer_id', 'display_name', 'region', 'segment', 'created_at']),
  analytics_products_public: new Set(['product_id', 'sku', 'name', 'category_id', 'category_name', 'list_price', 'is_active', 'stock_qty']),
  analytics_order_lines: new Set(['order_id', 'product_id', 'sku', 'product_name', 'category_name', 'qty', 'unit_price', 'discount', 'line_revenue', 'status', 'ordered_at', 'region', 'tenant_id']),
  analytics_payments: new Set(['payment_id', 'order_id', 'method', 'amount', 'paid_at', 'region', 'tenant_id', 'status']),
  analytics_reviews: new Set(['review_id', 'product_id', 'product_name', 'sku', 'customer_id', 'rating', 'created_at']),
};

interface Scope {
  aliases: Map<string, string | null>; // alias -> real table, or null for derived (subquery)
  ctes: Set<string>;
  outAliases: Set<string>; // SELECT output aliases visible in ORDER BY etc.
  hasDerived: boolean; // a CTE/subquery is in scope: unresolvable refs defer to the DB
  selectedNames: Set<string>; // every bare name selected anywhere (CTE outputs surface here)
}

/** Pre-pass: bare names + aliases appearing in SELECT lists (recursing into
 *  CTEs/subqueries). A CTE's outputs always surface here, so unqualified refs
 *  to CTE outputs stay allowed while genuinely unknown identifiers fail. */
function collectSelectedNames(node: any, out: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => collectSelectedNames(n, out)); return; }
  if ((node.type === 'select' || node.type === 'statement') && Array.isArray(node.columns)) {
    for (const c of node.columns) {
      const e = c?.expr ?? c;
      if (e?.type === 'ref' && typeof e.name === 'string' && e.name !== '*') out.add(e.name.toLowerCase());
      if (typeof c?.alias?.name === 'string') out.add(c.alias.name.toLowerCase());
    }
  }
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') collectSelectedNames(v, out);
  }
}

function childScope(parent: Scope): Scope {
  return { aliases: new Map(parent.aliases), ctes: new Set(parent.ctes), outAliases: new Set(), hasDerived: parent.hasDerived, selectedNames: parent.selectedNames };
}

function collectFromItems(from: any[], scope: Scope): void {
  for (const item of from ?? []) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'table' && item.name?.name) {
      // An alias of a CTE is a derived source, not a table: the DB resolves it.
      const real = item.name.name.toLowerCase();
      const mapped = scope.ctes.has(real) ? null : real;
      scope.aliases.set(real, mapped);
      if (item.name.alias) scope.aliases.set(item.name.alias.toLowerCase(), mapped);
    } else if (item.type === 'statement' && item.alias) {
      scope.aliases.set(item.alias.toLowerCase(), null);
      scope.hasDerived = true;
    }
    if (item.join) { /* join target already an item; handled by recursion */ }
  }
}

function checkRef(ref: any, scope: Scope): string | null {
  const name = String(ref.name ?? '').toLowerCase();
  if (!name || name === '*') return null;
  if (ref.table?.name) {
    const q = ref.table.name.toLowerCase();
    if (scope.ctes.has(q)) return null;
    if (!scope.aliases.has(q)) return `unknown table reference: ${q}`;
    const real = scope.aliases.get(q);
    if (real === null || real === undefined) return null; // derived source: DB decides
    const cols = VIEW_COLS[real];
    if (!cols) return `table not in allowlist: ${real}`;
    if (!cols.has(name)) return `column not exposed: ${real}.${name}`;
    return null;
  }
  // Unqualified: must resolve to a real-table column, an output alias, or a
  // name actually selected somewhere (CTE outputs). Otherwise it can only be
  // an unknown identifier.
  for (const [, real] of scope.aliases) {
    if (real && VIEW_COLS[real]?.has(name)) return null;
  }
  if (scope.outAliases.has(name)) return null;
  if (scope.hasDerived && scope.selectedNames.has(name)) return null;
  return `unknown column: ${name}`;
}

function checkNode(node: any, scope: Scope): string | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const err = checkNode(n, scope);
      if (err) return err;
    }
    return null;
  }
  if (node.type === 'with') {
    const inner = childScope(scope);
    for (const b of node.bind ?? []) if (b.alias?.name) inner.ctes.add(b.alias.name.toLowerCase());
    inner.hasDerived = true;
    for (const b of node.bind ?? []) {
      const err = checkNode(b.statement, inner);
      if (err) return err;
    }
    return checkNode(node.in, inner);
  }
  if (node.type === 'select') {
    const inner = childScope(scope);
    // Pre-collect output aliases so ORDER BY / outer refs resolve.
    for (const c of node.columns ?? []) {
      if (c?.alias?.name) inner.outAliases.add(c.alias.name.toLowerCase());
    }
    collectFromItems(node.from, inner);
    // Walk everything except re-entering FROM items as plain nodes is fine:
    // table items contain no refs, statement items recurse with fresh scope below.
    for (const [k, v] of Object.entries(node)) {
      if (k === 'from') {
        for (const item of (v as any[]) ?? []) {
          if (item?.type === 'statement') {
            const sub = childScope(inner);
            const err = checkNode(item.statement, sub);
            if (err) return err;
          }
          if (item?.join?.on) {
            const err = checkNode(item.join.on, inner);
            if (err) return err;
          }
        }
        continue;
      }
      const err = checkNode(v, inner);
      if (err) return err;
    }
    return null;
  }
  if (node.type === 'ref') return checkRef(node, scope);
  for (const v of Object.values(node)) {
    const err = checkNode(v, scope);
    if (err) return err;
  }
  return null;
}

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

  // Structured column authorization: every resolvable identifier must be an
  // exposed view column. Unresolvable refs (CTE/subquery outputs) defer to the
  // DB, where column grants enforce the same rule.
  const selectedNames = new Set<string>();
  collectSelectedNames(ast, selectedNames);
  const colErr = checkNode(ast, { aliases: new Map(), ctes: new Set(), outAliases: new Set(), hasDerived: false, selectedNames });
  if (colErr) return { ok: false, stage: 'columns', reason: colErr };

  // OFFSET cap: unbounded paging would bypass the row cap for bulk exfiltration.
  const offRaw = (ast as any).limit?.offset ?? (ast as any).offset;
  const offVal = offRaw?.value ?? offRaw?.limit?.value;
  if (typeof offVal === 'number' && offVal > MAX_OFFSET) {
    return { ok: false, stage: 'limit', reason: `OFFSET ${offVal} exceeds cap ${MAX_OFFSET}` };
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
