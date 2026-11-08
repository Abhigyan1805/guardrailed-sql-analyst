// Validates the dev retrieval pool (eval/pool/dev.json): every entry must be a
// dev question, pass the production guard, and reproduce the materialized dev
// gold rows when run through executeGuarded as the question's tenant.
//   npx tsx scripts/validate-pool.ts
import { getDb } from '../lib/db';
import { executeGuarded } from '../lib/exec';
import { loadSet } from '../eval/loader';
import { loadPool } from '../eval/retrieval';
import { tenantCtx, parseGoldRows } from '../eval/pipeline';
import { compareRows } from '../eval/metrics/accuracy';
import { readFileSync } from 'node:fs';

async function main(): Promise<void> {
  await getDb();
  const dev = new Map(loadSet('dev').questions.map((q) => [q.id, q]));
  let bad = 0;
  for (const p of loadPool()) {
    const q = dev.get(p.id);
    if (!q || q.question !== p.question) { console.error(`${p.id}: not a dev question`); bad++; continue; }
    const ex = await executeGuarded(p.sql, tenantCtx(q.tenant), `pool-${p.id}`);
    if (ex.decision !== 'ALLOW') { console.error(`${p.id}: ${ex.blockStage} ${ex.blockReason}`); bad++; continue; }
    const gold = parseGoldRows(JSON.parse(readFileSync(q.gold_rows_path!, 'utf8')), q.tenant)!;
    const cmp = compareRows(ex.rows ?? [], gold, q.order_sensitive);
    if (!cmp.pass) { console.error(`${p.id}: ${cmp.reason}`); bad++; }
  }
  console.log(bad ? `pool INVALID (${bad} entries)` : 'pool OK');
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
