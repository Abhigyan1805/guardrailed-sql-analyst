import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { KeyValueStore } from './history';
import { normalizeBaseUrl } from './api';
import { TENANTS, type Tenant } from './types';

export interface Settings {
  baseUrl: string;
  tenant: Tenant;
}

export const SETTINGS_KEY = 'sqlanalyst.settings.v1';

/** Android emulators reach the host machine at 10.0.2.2, not localhost. */
export function devFallbackUrl(os: string = Platform.OS): string {
  return os === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
}

/** Deployed URL from EXPO_PUBLIC_API_URL / app config `extra.apiUrl`, else the local dev server. */
export function defaultBaseUrl(
  env: string | undefined = process.env.EXPO_PUBLIC_API_URL,
  extra: string | null | undefined = (Constants.expoConfig?.extra as { apiUrl?: string | null } | undefined)?.apiUrl,
  os: string = Platform.OS,
): string {
  return normalizeBaseUrl(env || extra || devFallbackUrl(os));
}

export function createSettings(store: KeyValueStore, defaults: () => string = defaultBaseUrl) {
  async function load(): Promise<Settings> {
    const fallback: Settings = { baseUrl: defaults(), tenant: 'tenant_a' };
    try {
      const p = JSON.parse((await store.getItem(SETTINGS_KEY)) ?? 'null') as Partial<Settings> | null;
      return {
        baseUrl: p?.baseUrl ? normalizeBaseUrl(p.baseUrl) : fallback.baseUrl,
        tenant: p?.tenant && TENANTS.includes(p.tenant) ? p.tenant : fallback.tenant,
      };
    } catch {
      return fallback;
    }
  }
  async function save(s: Settings) {
    await store.setItem(SETTINGS_KEY, JSON.stringify({ ...s, baseUrl: normalizeBaseUrl(s.baseUrl) }));
  }
  return { load, save };
}
