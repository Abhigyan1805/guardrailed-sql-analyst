import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, withTenant } from '../lib/db';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

async function main() {
  const db = await getDb();
  await db.exec(readFileSync(join(ROOT, 'db/002_views_rls.sql'), 'utf8'));
  const qs = JSON.parse(readFileSync(join(ROOT, 'eval/questions.json'), 'utf8')) as any[];
  const ctx = { tenant_id: 'tenant_a', user_id: '1', user_role: 'sales_rep', user_region: 'NA' };
  let ok = 0, fail = 0;
  for (const q of qs) {
    if (q.bucket === 'adversarial') continue;
    try {
      const rows = await withTenant(ctx, async (d) => (await d.query(q.gold)).rows as any[]);
      console.log(`${q.id} OK rows=${rows.length}`);
      ok++;
    } catch (e: any) {
      console.log(`${q.id} FAIL: ${String(e?.message ?? e).slice(0, 220)}`);
      fail++;
    }
  }
  console.log(`\ngolds: ${ok} ok, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
