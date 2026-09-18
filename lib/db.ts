import { PGlite } from '@electric-sql/pglite';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
export const DATA_DIR = process.env.PGDATA_DIR ?? join(homedir(), '.cache', 'guardrailed-sql-analyst-pglite');

let _db: PGlite | null = null;

export async function getDb(): Promise<PGlite> {
  if (_db) return _db;
  _db = new PGlite(DATA_DIR);
  // Ensure schema objects exist (seed creates data; this is a safety net)
  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) {
    await _db.exec(readFileSync(join(ROOT, 'db/001_schema.sql'), 'utf8'));
    await _db.exec(readFileSync(join(ROOT, 'db/002_views_rls.sql'), 'utf8'));
    await _db.exec(readFileSync(join(ROOT, 'db/003_roles_audit.sql'), 'utf8'));
  }
  return _db;
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

/** Run fn with per-transaction tenant context (SET LOCAL — never SET).
 *  Also drops to the least-privilege app_reader role so RLS binds
 *  (PGlite/local runs as superuser, which bypasses RLS otherwise). */
export async function withTenant<T>(ctx: TenantCtx, fn: (db: PGlite) => Promise<T>): Promise<T> {
  const db = await getDb();
  await db.exec('BEGIN;');
  try {
    await db.exec(
      `SET LOCAL ROLE app_reader; ` +
      `SET LOCAL app.tenant_id = ${escLit(ctx.tenant_id)}; ` +
      `SET LOCAL app.user_id = ${escLit(ctx.user_id)}; ` +
      `SET LOCAL app.user_role = ${escLit(ctx.user_role)}; ` +
      `SET LOCAL app.user_region = ${escLit(ctx.user_region)}; ` +
      `SET LOCAL statement_timeout = '2000';`
    );
    const out = await fn(db);
    await db.exec('COMMIT;');
    return out;
  } catch (e) {
    try { await db.exec('ROLLBACK;'); } catch { /* noop */ }
    throw e;
  }
}
