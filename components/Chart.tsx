'use client';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';

interface Props {
  spec: { type: string; x: string; y: string; title: string };
  rows: Record<string, any>[];
}

export function Chart({ spec, rows }: Props) {
  if (spec.type === 'table' || !spec.x || !spec.y || rows.length === 0) {
    return <p style={{ color: '#9aa4b8' }}>Table view — see data below.</p>;
  }
  const data = rows.slice(0, 60).map(r => ({ x: String(r[spec.x]), y: Number(r[spec.y]) || 0 }));
  return (
    <div style={{ background: '#1a2233', padding: 16, borderRadius: 8 }}>
      <b>{spec.title}</b>
      <div style={{ height: 280, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          {spec.type === 'line' ? (
            <LineChart data={data}>
              <CartesianGrid stroke="#334" />
              <XAxis dataKey="x" tick={{ fill: '#9aa4b8', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9aa4b8', fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="y" stroke="#2f6fed" dot={false} />
            </LineChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid stroke="#334" />
              <XAxis dataKey="x" tick={{ fill: '#9aa4b8', fontSize: 11 }} interval={0} angle={-20} height={60} />
              <YAxis tick={{ fill: '#9aa4b8', fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="y" fill="#2f6fed" />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
