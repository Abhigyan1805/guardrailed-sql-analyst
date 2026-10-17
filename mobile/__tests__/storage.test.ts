import { createHistory, HISTORY_KEY, MAX_HISTORY, type KeyValueStore } from '../lib/history';
import { createSettings, defaultBaseUrl, devFallbackUrl, SETTINGS_KEY } from '../lib/settings';
import { toResultView } from '../lib/viewModel';

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: async k => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v); }, removeItem: async k => { data.delete(k); } };
}
const view = toResultView({ decision: 'ALLOW', rows: [], caveats: [], confidence: 1 });

describe('history', () => {
  it('stores newest first, retrieves by id and clears', async () => {
    const h = createHistory(memStore());
    const a = await h.add('first', 'tenant_a', view);
    const b = await h.add('second', 'tenant_b', view);
    expect((await h.list()).map(e => e.question)).toEqual(['second', 'first']);
    expect((await h.get(a.id))?.tenant).toBe('tenant_a');
    expect(b.id).not.toBe(a.id);
    await h.clear();
    expect(await h.list()).toEqual([]);
  });
  it('caps the list', async () => {
    const h = createHistory(memStore());
    for (let i = 0; i < MAX_HISTORY + 5; i++) await h.add(`q${i}`, 'tenant_a', view);
    const l = await h.list();
    expect(l).toHaveLength(MAX_HISTORY);
    expect(l[0].question).toBe(`q${MAX_HISTORY + 4}`);
  });
  it('survives corrupt storage', async () => {
    const s = memStore();
    s.data.set(HISTORY_KEY, '{not json');
    expect(await createHistory(s).list()).toEqual([]);
  });
});

describe('settings', () => {
  it('defaults, then persists url and tenant', async () => {
    const s = memStore();
    const st = createSettings(s, () => 'http://localhost:3000');
    expect(await st.load()).toEqual({ baseUrl: 'http://localhost:3000', tenant: 'tenant_a' });
    await st.save({ baseUrl: 'https://api.example.com/', tenant: 'tenant_b' });
    expect(await st.load()).toEqual({ baseUrl: 'https://api.example.com', tenant: 'tenant_b' });
  });
  it('ignores an invalid stored tenant', async () => {
    const s = memStore();
    s.data.set(SETTINGS_KEY, JSON.stringify({ baseUrl: 'http://x', tenant: 'evil' }));
    expect((await createSettings(s, () => 'd').load()).tenant).toBe('tenant_a');
  });
  it('prefers env, then config, then the platform dev fallback', () => {
    expect(defaultBaseUrl('https://prod.io/', 'https://cfg.io', 'ios')).toBe('https://prod.io');
    expect(defaultBaseUrl(undefined, 'https://cfg.io', 'ios')).toBe('https://cfg.io');
    expect(defaultBaseUrl(undefined, null, 'android')).toBe('http://10.0.2.2:3000');
    expect(devFallbackUrl('ios')).toBe('http://localhost:3000');
  });
});
