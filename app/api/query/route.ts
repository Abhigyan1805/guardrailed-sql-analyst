import { NextRequest, NextResponse } from 'next/server';
import { askQuestion } from '@/lib/agent';
import { checkRate } from '@/lib/rate';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const question = String(body.question ?? '').slice(0, 2000);
  const tenant_id = String(body.tenant_id ?? 'tenant_a');
  // Mock auth: tenant/user/region from headers with safe defaults
  const ctx = {
    tenant_id,
    user_id: String(req.headers.get('x-mock-user') ?? '1'),
    user_role: String(req.headers.get('x-mock-role') ?? 'sales_rep'),
    user_region: String(req.headers.get('x-mock-region') ?? 'NA'),
  };
  if (!question.trim()) {
    return NextResponse.json({ decision: 'BLOCK', blockReason: 'empty question', caveats: [], confidence: 0 }, { status: 400 });
  }
  const rl = checkRate(ctx.tenant_id, ctx.user_id);
  if (!rl.ok) {
    return NextResponse.json(
      { decision: 'BLOCK', blockReason: `rate limited — retry in ${rl.retryAfterSec}s`, caveats: [], confidence: 0 },
      { status: 429 }
    );
  }
  const ans = await askQuestion(question, ctx, `web-${Date.now()}`);
  return NextResponse.json(ans);
}
