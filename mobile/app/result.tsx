import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text } from 'react-native';
import { ResultBody, Banner, s } from '../components/ui';
import { askAndRecord, history } from '../lib/app';
import type { HistoryEntry } from '../lib/history';

export default function Result() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [entry, setEntry] = useState<HistoryEntry | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { history.get(id).then(e => setEntry(e ?? null)); }, [id]);

  async function followUp(question: string) {
    setBusy(true);
    setError(null);
    try {
      const next = await askAndRecord(question);
      router.replace({ pathname: '/result', params: { id: next.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (entry === undefined) return <ActivityIndicator style={{ marginTop: 40 }} />;
  if (entry === null) return <Text style={[s.text, s.pad]}>This result is no longer in history.</Text>;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Stack.Screen options={{ title: entry.view.kind === 'blocked' ? 'Blocked' : 'Result' }} />
      <Text style={s.muted}>“{entry.question}” · {entry.tenant}</Text>
      {error ? <Banner tone="danger" title="Request failed">{error}</Banner> : null}
      <ResultBody view={entry.view} onFollowUp={followUp} busy={busy} />
    </ScrollView>
  );
}
