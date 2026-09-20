import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
export const DATA_DIR = process.env.PGDATA_DIR ?? join(homedir(), '.cache', 'guardrailed-sql-analyst-pglite');
export const DATABASE_URL = process.env.DATABASE_URL ?? '';

/** Engine-agnostic query surface shared by PGlite and node-postgres. */
export interface SqlClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; fields?: { name: string }[] }>;
  exec(sql: string): Promise<void>;
}

let _pglite: PGlite | null = null;
let _pool: pg.Pool | null = null;
let _schemaEnsured = false;

function wrapPglite(db: PGlite): SqlClient {
  return {
    query: async <T = any>(sql: string, params?: any[]) => {
      const r = await db.query<T>(sql, params);
      return { rows: r.rows as T[], fields: (r.fields as any) };
    },
    exec: async (sql: string) => { await db.exec(sql); },
  };
}

function pool(): pg.Pool {
  if (!_pool) _pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  return _pool;
}

function wrapPg(client: pg.Pool | pg.PoolClient): SqlClient {
  return {
    query: async <T = any>(sql: string, params?: any[]) => {
      const r = await client.query(sql, params);
      return { rows: r.rows as T[], fields: (r.fields as any) };
    },
    exec: async (sql: string) => { await client.query(sql); },
  };
}

async function applySchema(db: SqlClient): Promise<void> {
  // 003 creates app_reader + audit_log; 002 grants to app_reader and defines
  // the views, so it MUST run last (a fresh PGlite dir wraps each exec in one
  // implicit transaction, so a failing 002 would roll back wholesale).
  await db.exec(readFileSync(join(ROOT, 'db/001_schema.sql'), 'utf8'));
  await db.exec(readFileSync(join(ROOT, 'db/003_roles_audit.sql'), 'utf8'));
  await db.exec(readFileSync(join(ROOT, 'db/002_views_rls.sql'), 'utf8'));
}

async function ensureSchema(client: SqlClient): Promise<void> {
  const r = await client.query<{ present: string | null }>(
    `SELECT to_regclass('public.analytics_orders')::text AS present`
  );
  if (!r.rows[0]?.present) await applySchema(client);
}

/** Privileged connection (schema owner / superuser). Bypasses RLS, so callers
 *  must scope tenant reads themselves. Used for audit writes and DB setup. */
export async function getDb(): Promise<SqlClient> {
  if (DATABASE_URL) {
    const client = wrapPg(pool());
    if (!_schemaEnsured) { await ensureSchema(client); _schemaEnsured = true; }
    return client;
  }
  if (_pglite) return wrapPglite(_pglite);
  _pglite = new PGlite(DATA_DIR);
  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) {
    await applySchema(wrapPglite(_pglite));
  }
  return wrapPglite(_pglite);
}

export interface TenantCtx {
  tenant_id: string;
  user_id: string;
  user_role: string;
  user_region: string;
}

function escLit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function tenantPrelude(ctx: TenantCtx): string {
  return (
    `SET LOCAL ROLE app_reader; ` +
    `SET LOCAL app.tenant_id = ${escLit(ctx.tenant_id)}; ` +
    `SET LOCAL app.user_id = ${escLit(ctx.user_id)}; ` +
    `SET LOCAL app.user_role = ${escLit(ctx.user_role)}; ` +
    `SET LOCAL app.user_region = ${escLit(ctx.user_region)}; ` +
    // PGlite defaults enable_seqscan=off, which adds a fixed 1e10 planner
    // penalty that corrupts costs; real Postgres already defaults to on.
    `SET LOCAL enable_seqscan = on; ` +
    `SET LOCAL statement_timeout = '2000'; ` +
    `SET LOCAL idle_in_transaction_session_timeout = '5000';`
  );
}

/** Run fn in a genuinely read-only transaction (BEGIN READ ONLY works on both
 *  engines) as the least-privilege app_reader role, with per-transaction tenant
 *  context set via SET LOCAL — never SET, so the caller cannot leak it out. */
export async function withTenant<T>(ctx: TenantCtx, fn: (db: SqlClient) => Promise<T>): Promise<T> {
  if (DATABASE_URL) {
    const client = await pool().connect();
    try {
      await client.query('BEGIN READ ONLY;');
      await client.query(tenantPrelude(ctx));
      const out = await fn(wrapPg(client));
      await client.query('COMMIT;');
      return out;
    } catch (e) {
      try { await client.query('ROLLBACK;'); } catch { /* noop */ }
      throw e;
    } finally {
      client.release();
    }
  }
  const db = await getDb();
  await db.exec('BEGIN READ ONLY;');
  try {
    await db.exec(tenantPrelude(ctx));
    const out = await fn(db);
    await db.exec('COMMIT;');
    return out;
  } catch (e) {
    try { await db.exec('ROLLBACK;'); } catch { /* noop */ }
    throw e;
  }
}

export async function closeDb(): Promise<void> {
  if (_pool) { await _pool.end(); _pool = null; }
  if (_pglite) { await _pglite.close(); _pglite = null; }
  _schemaEnsured = false;
}
