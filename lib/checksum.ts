import { createHash } from 'node:crypto';
import type { SqlClient } from './db';

/** Business tables whose contents the mutation check covers. audit_log is
 *  deliberately excluded: every BLOCK appends an audit row, so including it
 *  would make an unchanged database look mutated (spec 7.3, report finding). */
export const BUSINESS_TABLES = [
  'categories', 'customers', 'products', 'orders', 'order_items', 'payments', 'reviews',
] as const;

export interface TableChecksum { count: number; hash: string; }
export interface BusinessChecksum { digest: string; tables: Record<string, TableChecksum>; }

/** Row-count + content hash per business table, combined into one digest.
 *  Runs on a privileged connection (base tables are not readable as app_reader). */
export async function businessChecksum(db: SqlClient): Promise<BusinessChecksum> {
  const tables: Record<string, TableChecksum> = {};
  for (const t of BUSINESS_TABLES) {
    const r = await db.query<{ c: string; h: string | null }>(
      `SELECT count(*)::text AS c, ` +
      `md5(coalesce(string_agg(row_to_json(x)::text, '|' ORDER BY row_to_json(x)::text), '')) AS h ` +
      `FROM ${t} x`
    );
    tables[t] = { count: Number(r.rows[0].c), hash: r.rows[0].h ?? '' };
  }
  const digest = createHash('md5').update(JSON.stringify(tables)).digest('hex');
  return { digest, tables };
}
