// The production (minified, standalone) bundle must reach the model backend.
// A unit test on the TS source cannot see bundler bugs: the first live deploy
// silently fell back to the offline engine because the minifier broke
// sqlComplexity (ReferenceError after every model call). This starts the real
// standalone server against a fake OpenAI-compatible endpoint.
// Skipped when .next/standalone is absent; CI sets STANDALONE_REQUIRED=1 after `npm run build`.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const SERVER = join(process.cwd(), '.next', 'standalone', 'server.js');
const required = process.env.STANDALONE_REQUIRED === '1';

function listen(srv: Server): Promise<number> {
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve((srv.address() as any).port)));
}

describe.skipIf(!required && !existsSync(SERVER))('standalone production bundle', () => {
  it('answers through the LLM backend, not the offline fallback', async () => {
    expect(existsSync(SERVER)).toBe(true);
    let requests = 0;
    const fake = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        requests++;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ sql: 'SELECT COUNT(*) AS n FROM analytics_orders', reason: '' }) } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }));
      });
    });
    const fakePort = await listen(fake);
    const probe = createServer();
    const appPort = await listen(probe);
    await new Promise((r) => probe.close(r));
    const child = spawn('node', [SERVER], {
      cwd: join(process.cwd(), '.next', 'standalone'),
      env: {
        ...process.env, NODE_ENV: 'production', PORT: String(appPort), HOSTNAME: '127.0.0.1', AUTH_SECRET: 'test-secret',
        ALLOW_MOCK_AUTH: 'true', LLM_PROVIDER: 'openai', LLM_BASE_URL: `http://127.0.0.1:${fakePort}`,
        LLM_MODEL: 'test-model', LLM_API_KEY: 'test-key', LLM_DAILY_CAP: '5',
      },
      stdio: 'ignore',
    });
    try {
      const base = `http://127.0.0.1:${appPort}`;
      for (let i = 0; i < 60; i++) {
        try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 250));
      }
      const { token } = await (await fetch(`${base}/api/auth/token`, { method: 'POST', body: JSON.stringify({ tenant: 'tenant_a' }) })).json();
      const ans: any = await (await fetch(`${base}/api/query`, {
        method: 'POST', headers: { 'x-ctx-token': token }, body: JSON.stringify({ question: 'how many orders are there?' }),
      })).json();
      expect(requests).toBeGreaterThan(0);
      expect(ans.engine).toBe('llm');
      expect(ans.decision).toBe('ALLOW');
    } finally {
      child.kill();
      fake.close();
    }
  }, 60000);
});
