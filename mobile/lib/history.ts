import type { ResultView } from './viewModel';
import type { Tenant } from './types';

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface HistoryEntry {
  id: string;
  question: string;
  tenant: Tenant;
  at: number;
  view: ResultView;
}

export const HISTORY_KEY = 'sqlanalyst.history.v1';
export const MAX_HISTORY = 50;

export function createHistory(store: KeyValueStore, now: () => number = Date.now) {
  async function list(): Promise<HistoryEntry[]> {
    try {
      const raw = await store.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return []; // corrupt storage should never break the app
    }
  }

  async function add(question: string, tenant: Tenant, view: ResultView): Promise<HistoryEntry> {
    const at = now();
    const entry: HistoryEntry = { id: `${at}-${Math.random().toString(36).slice(2, 8)}`, question, tenant, at, view };
    const next = [entry, ...(await list())].slice(0, MAX_HISTORY);
    await store.setItem(HISTORY_KEY, JSON.stringify(next));
    return entry;
  }

  async function get(id: string): Promise<HistoryEntry | undefined> {
    return (await list()).find(e => e.id === id);
  }

  const clear = () => store.removeItem(HISTORY_KEY);

  return { list, add, get, clear };
}
