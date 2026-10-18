import { NextRequest, NextResponse } from 'next/server';
import { askQuestion } from '@/lib/agent';
import { checkRate, checkIpRate } from '@/lib/rate';
import { resolveCtx, AuthError } from '@/lib/auth';

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = resolveCtx(req.headers);
  } catch (e: any) {
    const status = e instanceof AuthError ? e.status : 401;
    return NextResponse.json({ decision: 'BLOCK', blockReason: `auth: ${e.message}`, caveats: [], confidence: 0 }, { status });
  }
  const body = await req.json();
  const question = String(body.question ?? '').slice(0, 2000);
  if (!question.trim()) {
    return NextResponse.json({ decision: 'BLOCK', blockReason: 'empty question', caveats: [], confidence: 0 }, { status: 400 });
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  const ipRl = checkIpRate(ip);
  const rl = ipRl.ok ? checkRate(ctx.tenant_id, ctx.user_id) : ipRl;
  if (!rl.ok) {
    return NextResponse.json(
      { decision: 'BLOCK', blockReason: `rate limited — retry in ${rl.retryAfterSec}s`, caveats: [], confidence: 0 },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec ?? 60) } }
    );
  }
  const ans = await askQuestion(question, ctx, `web-${Date.now()}`);
  return NextResponse.json(ans);
}
