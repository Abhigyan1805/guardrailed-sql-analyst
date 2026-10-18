import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';

/** Serves the OpenAPI 3 spec kept in docs/openapi.yaml. */
export async function GET() {
  const yaml = readFileSync(join(process.cwd(), 'docs', 'openapi.yaml'), 'utf8');
  return new Response(yaml, { headers: { 'content-type': 'application/yaml; charset=utf-8' } });
}
