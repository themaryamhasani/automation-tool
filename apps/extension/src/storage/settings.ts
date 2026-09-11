import { DEFAULT_SETTINGS, STORAGE_KEYS, type ExtensionSettings } from '../shared/constants';

export interface StoredCredential {
  apiToken: string;
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const partial = stored[STORAGE_KEYS.settings] as Partial<ExtensionSettings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(partial || {}) };
}

export async function saveSettings(next: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
}

export async function loadCredential(): Promise<StoredCredential | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.credential);
  const value = stored[STORAGE_KEYS.credential] as StoredCredential | undefined;
  return value?.apiToken ? value : null;
}

export async function saveCredential(apiToken: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.credential]: { apiToken } satisfies StoredCredential });
}

export async function clearCredential(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.credential);
}
