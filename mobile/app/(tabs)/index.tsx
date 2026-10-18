import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Banner, Chip, s } from '../../components/ui';
import { askAndRecord } from '../../lib/app';
import { colors } from '../../lib/theme';

export const EXAMPLES = ['Top 5 products by revenue', 'Delete all cancelled orders from 2023', 'show all customer emails', 'show sales', 'Revenue by month'];

export default function Ask() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(question: string) {
    if (!question.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const entry = await askAndRecord(question.trim());
      router.push({ pathname: '/result', params: { id: entry.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.muted }}>Ask your data in plain English. Queries are read-only, tenant-isolated and audited.</Text>
        <TextInput
          style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]} multiline value={q} onChangeText={setQ}
          placeholder="e.g. Top 5 products by revenue" placeholderTextColor={colors.muted} accessibilityLabel="Question"
        />
        <Pressable accessibilityRole="button" style={[s.button, loading && { opacity: 0.6 }]} disabled={loading} onPress={() => run(q)}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>Ask</Text>}
        </Pressable>
        {error ? <Banner tone="danger" title="Request failed">{error}</Banner> : null}
        <Text style={s.muted}>Try one of these:</Text>
        <View style={s.chips}>{EXAMPLES.map(ex => <Chip key={ex} label={ex} disabled={loading} onPress={() => { setQ(ex); run(ex); }} />)}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
