import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Guardrailed SQL Analyst',
  description: 'Ask questions in plain English — get SQL + chart + caveats over a read-only role.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, background: '#0f1420', color: '#e8ecf4' }}>
        {children}
      </body>
    </html>
  );
}
