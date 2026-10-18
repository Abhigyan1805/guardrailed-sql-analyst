import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { s } from '../../components/ui';
import { history } from '../../lib/app';
import type { HistoryEntry } from '../../lib/history';
import { colors } from '../../lib/theme';

export default function History() {
  const router = useRouter();
  const [items, setItems] = useState<HistoryEntry[]>([]);
  useFocusEffect(useCallback(() => { history.list().then(setItems); }, []));

  return (
    <FlatList
      style={s.screen} contentContainerStyle={s.pad} data={items} keyExtractor={e => e.id}
      ListEmptyComponent={<Text style={s.muted}>No queries yet. Ask something on the Ask tab.</Text>}
      ListHeaderComponent={items.length ? (
        <Pressable accessibilityRole="button" onPress={async () => { await history.clear(); setItems([]); }}>
          <Text style={{ color: colors.danger.fg, textAlign: 'right' }}>Clear history</Text>
        </Pressable>
      ) : undefined}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" style={s.card} onPress={() => router.push({ pathname: '/result', params: { id: item.id } })}>
          <Text style={s.cardTitle}>{item.question}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <Text style={{ color: colors[item.view.tone].fg, fontSize: 12, fontWeight: '700' }}>{item.view.banner}</Text>
            <Text style={s.muted}>{item.tenant} · {new Date(item.at).toLocaleString()}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}
