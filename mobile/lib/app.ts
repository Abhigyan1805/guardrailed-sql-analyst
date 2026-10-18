import AsyncStorage from '@react-native-async-storage/async-storage';
import { createHistory } from './history';
import { createSettings } from './settings';
import { createClient } from './api';
import { toResultView } from './viewModel';

export const history = createHistory(AsyncStorage);
export const settings = createSettings(AsyncStorage);

/** Ask with the persisted settings and record the outcome in history. */
export async function askAndRecord(question: string) {
  const s = await settings.load();
  const res = await createClient({ baseUrl: s.baseUrl, tenant: s.tenant }).ask(question);
  return history.add(question, s.tenant, toResultView(res));
}
