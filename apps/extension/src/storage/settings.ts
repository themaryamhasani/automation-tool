import { DEFAULT_SETTINGS, STORAGE_KEYS, type ExtensionSettings } from '../shared/constants';

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const partial = stored[STORAGE_KEYS.settings] as Partial<ExtensionSettings> | undefined;
  if (!partial) return { ...DEFAULT_SETTINGS };
  return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(key => [
    key,
    partial[key as keyof ExtensionSettings] ?? DEFAULT_SETTINGS[key as keyof ExtensionSettings],
  ])) as unknown as ExtensionSettings;
}

export async function saveSettings(next: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
}
