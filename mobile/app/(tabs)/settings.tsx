import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Banner, Chip, s } from '../../components/ui';
import { settings } from '../../lib/app';
import { createClient } from '../../lib/api';
import { defaultBaseUrl } from '../../lib/settings';
import { colors } from '../../lib/theme';
import { TENANTS, type Tenant } from '../../lib/types';

export default function Settings() {
  const [baseUrl, setBaseUrl] = useState('');
  const [tenant, setTenant] = useState<Tenant>('tenant_a');
  const [status, setStatus] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => { settings.load().then(v => { setBaseUrl(v.baseUrl); setTenant(v.tenant); }); }, []);

  async function save() {
    await settings.save({ baseUrl, tenant });
    try {
      await createClient({ baseUrl, tenant }).getToken();
      setStatus({ tone: 'success', text: 'Saved. Backend reachable.' });
    } catch (e) {
      setStatus({ tone: 'danger', text: `Saved, but: ${e instanceof Error ? e.message : 'unreachable'}` });
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Text style={s.cardTitle}>API base URL</Text>
      <TextInput style={s.input} value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="API base URL" />
      <Pressable onPress={() => setBaseUrl(defaultBaseUrl())}><Text style={{ color: colors.chip }}>Reset to default ({defaultBaseUrl()})</Text></Pressable>
      <Text style={[s.cardTitle, { marginTop: 8 }]}>Demo tenant</Text>
      <View style={s.chips}>{TENANTS.map(t => <Chip key={t} label={(t === tenant ? '● ' : '○ ') + t} onPress={() => setTenant(t)} />)}</View>
      <Text style={s.muted}>Uses the backend's mock auth: the app requests a signed context token for the selected tenant.</Text>
      <Pressable accessibilityRole="button" style={[s.button, { marginTop: 8 }]} onPress={save}><Text style={s.buttonText}>Save & test connection</Text></Pressable>
      {status ? <Banner tone={status.tone} title={status.tone === 'success' ? 'OK' : 'Connection problem'}>{status.text}</Banner> : null}
    </ScrollView>
  );
}
