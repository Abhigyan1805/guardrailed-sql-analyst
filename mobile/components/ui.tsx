import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../lib/theme';
import type { ResultView, Tone } from '../lib/viewModel';

export function Chip({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.chip, disabled && { opacity: 0.5 }]}>
      <Text style={s.chipText}>{label}</Text>
    </Pressable>
  );
}

export function Banner({ tone, title, children }: { tone: Tone; title: string; children?: string }) {
  return (
    <View accessibilityRole="alert" style={[s.banner, { backgroundColor: colors[tone].bg }]}>
      <Text style={[s.bannerTitle, { color: colors[tone].fg }]}>{tone === 'danger' ? '✕ ' : tone === 'warning' ? '? ' : '✓ '}{title}</Text>
      {children ? <Text style={[s.bannerBody, { color: colors[tone].fg }]}>{children}</Text> : null}
    </View>
  );
}

export function Collapsible({ title, children, initiallyOpen = false }: { title: string; children: React.ReactNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={s.card}>
      <Pressable accessibilityRole="button" onPress={() => setOpen(o => !o)}>
        <Text style={s.cardTitle}>{open ? '▾' : '▸'} {title}</Text>
      </Pressable>
      {open ? <View style={{ marginTop: 8 }}>{children}</View> : null}
    </View>
  );
}

export function BarChart({ title, bars }: { title: string; bars: { label: string; value: number }[] }) {
  const max = Math.max(...bars.map(b => Math.abs(b.value)), 1);
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{title}</Text>
      {bars.map((b, i) => (
        <View key={i} style={{ marginTop: 8 }}>
          <View style={s.barRow}>
            <Text style={s.barLabel} numberOfLines={1}>{b.label}</Text>
            <Text style={s.barValue}>{Number.isInteger(b.value) ? b.value : b.value.toFixed(2)}</Text>
          </View>
          <View style={s.barTrack}><View style={[s.barFill, { width: `${(Math.abs(b.value) / max) * 100}%` }]} /></View>
        </View>
      ))}
    </View>
  );
}

export function DataTable({ columns, rows, total }: { columns: string[]; rows: string[][]; total: number }) {
  return (
    <View>
      <ScrollView horizontal>
        <View>
          <View style={s.tr}>{columns.map(c => <Text key={c} style={[s.td, s.th]}>{c}</Text>)}</View>
          {rows.map((r, i) => <View key={i} style={s.tr}>{r.map((v, j) => <Text key={j} style={s.td}>{v}</Text>)}</View>)}
        </View>
      </ScrollView>
      {total > rows.length ? <Text style={s.muted}>Showing {rows.length} of {total} rows</Text> : null}
    </View>
  );
}

/** Renders a stored/live result: blocked banner, clarification chips, or answer + data + SQL. */
export function ResultBody({ view, onFollowUp, busy }: { view: ResultView; onFollowUp?: (q: string) => void; busy?: boolean }) {
  if (view.kind === 'blocked') {
    return (
      <>
        <Banner tone="danger" title="BLOCKED">{view.blockReason ?? ''}</Banner>
        <Text style={s.muted}>{view.meta}</Text>
      </>
    );
  }
  return (
    <>
      <Banner tone={view.tone} title={view.banner}>{view.meta}</Banner>
      <Text style={s.headline}>{view.headline}</Text>
      {view.kind === 'clarify' ? (
        <View style={s.card}>
          {view.clarifyingQuestions.map((q, i) => <Text key={i} style={s.text}>• {q}</Text>)}
          <Text style={[s.muted, { marginTop: 8 }]}>Pick a follow-up:</Text>
          <View style={s.chips}>{view.followUps.map(f => <Chip key={f} label={f} disabled={busy} onPress={() => onFollowUp?.(f)} />)}</View>
        </View>
      ) : (
        <>
          {view.chart ? <BarChart title={view.chart.title} bars={view.chart.bars} /> : null}
          <Collapsible title={`Data (${view.totalRows} rows)`} initiallyOpen>
            <DataTable columns={view.columns} rows={view.rows} total={view.totalRows} />
          </Collapsible>
          {view.sql ? <Collapsible title="Guarded SQL"><Text selectable style={s.code}>{view.sql}</Text></Collapsible> : null}
        </>
      )}
      {view.caveats.length > 0 ? (
        <View style={s.card}>
          <Text style={[s.cardTitle, { color: colors.warning.fg }]}>Caveats</Text>
          {view.caveats.map((c, i) => <Text key={i} style={s.text}>• {c}</Text>)}
        </View>
      ) : null}
    </>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: 16, gap: 12 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accent },
  chipText: { color: colors.chip, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  banner: { padding: 12, borderRadius: 8 },
  bannerTitle: { fontWeight: '700', fontSize: 14 },
  bannerBody: { marginTop: 4, fontSize: 13 },
  card: { backgroundColor: colors.card, padding: 12, borderRadius: 8 },
  cardTitle: { color: colors.text, fontWeight: '600', fontSize: 14 },
  headline: { color: colors.text, fontSize: 18, fontWeight: '600' },
  text: { color: colors.text, fontSize: 14, marginTop: 4 },
  muted: { color: colors.muted, fontSize: 12, marginTop: 4 },
  code: { color: '#c9d6ee', fontFamily: 'monospace', fontSize: 12 },
  barRow: { flexDirection: 'row', justifyContent: 'space-between' },
  barLabel: { color: colors.text, fontSize: 12, flex: 1, marginRight: 8 },
  barValue: { color: colors.muted, fontSize: 12 },
  barTrack: { height: 8, backgroundColor: '#0b0f1a', borderRadius: 4, marginTop: 3 },
  barFill: { height: 8, backgroundColor: colors.accent, borderRadius: 4 },
  tr: { flexDirection: 'row' },
  td: { color: colors.text, fontSize: 12, padding: 6, minWidth: 90, borderWidth: StyleSheet.hairlineWidth, borderColor: '#445' },
  th: { fontWeight: '700', backgroundColor: '#0f1626' },
  input: { backgroundColor: colors.card, color: colors.text, borderRadius: 8, padding: 12, fontSize: 16, borderWidth: 1, borderColor: colors.border },
  button: { backgroundColor: colors.accent, padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
