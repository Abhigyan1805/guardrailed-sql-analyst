import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Liveness + readiness: reports whether the database answers and the analytics views exist. */
export async function GET() {
  const started = Date.now();
  try {
    const db = await getDb();
    const r = await db.query<{ present: string | null }>(`SELECT to_regclass('public.analytics_orders')::text AS present`);
    const ready = Boolean(r.rows[0]?.present);
    return NextResponse.json(
      {
        status: ready ? 'ok' : 'degraded',
        db: { ready, engine: process.env.DATABASE_URL ? 'postgres' : 'pglite' },
        llmProvider: process.env.LLM_PROVIDER ?? 'offline',
        version: process.env.APP_VERSION ?? 'dev',
        latencyMs: Date.now() - started,
      },
      { status: ready ? 200 : 503 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { status: 'error', db: { ready: false }, error: String(e?.message ?? e).slice(0, 200) },
      { status: 503 }
    );
  }
}
