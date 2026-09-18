import { NextRequest, NextResponse } from 'next/server';
import { issueCtxToken } from '@/lib/auth';

/** Dev-only self-issuance for the demo UI. Refuses unless ALLOW_MOCK_AUTH=true. */
export async function POST(req: NextRequest) {
  if (process.env.ALLOW_MOCK_AUTH !== 'true') {
    return NextResponse.json({ error: 'mock issuance disabled' }, { status: 403 });
  }
  const body = await req.json();
  const tenant = String(body.tenant ?? 'tenant_a');
  if (!['tenant_a', 'tenant_b'].includes(tenant)) {
    return NextResponse.json({ error: 'unknown tenant' }, { status: 400 });
  }
  const secret = process.env.AUTH_SECRET ?? 'dev-only-secret-change-in-prod';
  const token = issueCtxToken({ tenant, user: '1', role: 'sales_rep', region: 'NA' }, secret);
  return NextResponse.json({ token });
}
