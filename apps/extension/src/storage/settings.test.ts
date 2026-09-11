import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../shared/constants';
import { loadSettings, saveSettings } from './settings';

const values: Record<string, unknown> = {};

beforeEach(() => {
  for (const key of Object.keys(values)) delete values[key];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: values[key] })),
        set: vi.fn(async (next: Record<string, unknown>) => Object.assign(values, next)),
        remove: vi.fn(async (key: string) => { delete values[key]; }),
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('extension storage serialization', () => {
  it('merges versioned partial settings with safe defaults', async () => {
    values[STORAGE_KEYS.settings] = { slowMo: 250, selectedProjectId: 'project-1' };
    await expect(loadSettings()).resolves.toEqual({ ...DEFAULT_SETTINGS, slowMo: 250, selectedProjectId: 'project-1' });

    const next = { ...DEFAULT_SETTINGS, fileName: 'checkout.spec.ts' };
    await saveSettings(next);
    expect(values[STORAGE_KEYS.settings]).toEqual(next);
  });
});
