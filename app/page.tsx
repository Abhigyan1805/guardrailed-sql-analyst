'use client';
import { useState } from 'react';
import { Chart } from '../components/Chart';

interface Answer {
  decision: string;
  sql: string | null;
  executedSql?: string;
  rows?: Record<string, any>[];
  columns?: string[];
  chartSpec?: { type: string; x: string; y: string; title: string };
  caveats: string[];
  clarifyingQuestions?: string[];
  confidence: number;
  blockReason?: string;
  latencyMs: number;
  engine?: string;
}

const EXAMPLES = [
  'Top 5 products by revenue',
  'Revenue by month',
  'Average order value by region',
  'Orders by status',
  'show sales',
];

export default function Page() {
  const [q, setQ] = useState('Top 5 products by revenue');
  const [tenant, setTenant] = useState('tenant_a');
  const [ans, setAns] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(false);

  async function run(question: string) {
    setLoading(true);
    setAns(null);
    try {
      // Dev issuance: swap for a real login that returns a context token.
      const tok = await fetch('/api/auth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant }),
      });
      const { token } = await tok.json();
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ctx-token': token ?? '' },
        body: JSON.stringify({ question }),
      });
      setAns(await res.json());
    } finally {
      setLoading(false);
    }
  }

  const banner = !ans ? null : ans.decision === 'ALLOW'
    ? { bg: '#12351f', fg: '#7ee2a8', label: `✓ ALLOWED · confidence ${ans.confidence.toFixed(2)} · ${ans.latencyMs}ms · engine ${ans.engine}` }
    : ans.decision === 'CLARIFY'
      ? { bg: '#3d2f10', fg: '#f5c542', label: `? NEEDS CLARIFICATION · confidence ${ans.confidence.toFixed(2)} — no SQL executed` }
      : { bg: '#401818', fg: '#ff8a8a', label: `✕ BLOCKED · ${ans.blockReason ?? ''}` };

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 24 }}>Guardrailed Text-to-SQL Analyst</h1>
      <p style={{ color: '#9aa4b8' }}>Read-only role · RLS tenant isolation · cost cap · audit log · ask-first on uncertainty</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && run(q)}
          style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #334', background: '#1a2233', color: '#fff' }} />
        <select value={tenant} onChange={e => setTenant(e.target.value)}
          style={{ padding: 10, borderRadius: 8, background: '#1a2233', color: '#fff' }}>
          <option value="tenant_a">tenant_a</option>
          <option value="tenant_b">tenant_b</option>
        </select>
        <button onClick={() => run(q)} disabled={loading}
          style={{ padding: '10px 18px', borderRadius: 8, background: '#2f6fed', color: '#fff', border: 0, cursor: 'pointer' }}>
          {loading ? '…' : 'Ask'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {EXAMPLES.map(ex => (
          <button key={ex} onClick={() => { setQ(ex); run(ex); }}
            style={{ padding: '6px 10px', borderRadius: 16, background: '#1a2233', color: '#9fc0ff', border: '1px solid #2f6fed', cursor: 'pointer', fontSize: 12 }}>
            {ex}
          </button>
        ))}
      </div>

      {banner && <div style={{ background: banner.bg, color: banner.fg, padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{banner.label}</div>}

      {ans?.decision === 'CLARIFY' && (
        <div style={{ background: '#1a2233', padding: 16, borderRadius: 8, marginBottom: 12 }}>
          <b>I'm uncertain — please clarify:</b>
          <ul>{ans.clarifyingQuestions?.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}

      {ans?.decision === 'ALLOW' && (
        <>
          {ans.chartSpec && ans.rows && <Chart spec={ans.chartSpec} rows={ans.rows} />}
          {ans.rows && (
            <details open style={{ marginTop: 12 }}>
              <summary>Data ({ans.rows.length} rows)</summary>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                  <thead><tr>{ans.columns?.map(c => <th key={c} style={{ border: '1px solid #334', padding: 6 }}>{c}</th>)}</tr></thead>
                  <tbody>{ans.rows.slice(0, 50).map((r, i) => (
                    <tr key={i}>{ans.columns?.map(c => <td key={c} style={{ border: '1px solid #334', padding: 6 }}>{String(r[c])}</td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
          )}
          <details style={{ marginTop: 8 }}>
            <summary>SQL + provenance</summary>
            <pre style={{ background: '#0a0e18', padding: 12, borderRadius: 8, overflowX: 'auto', fontSize: 12 }}>{ans.executedSql ?? ans.sql}</pre>
          </details>
          {ans.caveats.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 13, color: '#f5c542' }}>
              <b>Caveats:</b>
              <ul>{ans.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </main>
  );
}
