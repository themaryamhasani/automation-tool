import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeCredential, clearCredential, loadCredential, pairExtension } from './credentials';
import { STORAGE_KEYS } from '../shared/constants';

const values: Record<string, unknown> = {};

beforeEach(() => {
  for (const key of Object.keys(values)) delete values[key];
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async (key: string) => ({ [key]: values[key] })),
    set: vi.fn(async (next: Record<string, unknown>) => Object.assign(values, next)),
    remove: vi.fn(async (key: string) => { delete values[key]; }),
  } } });
});

afterEach(() => vi.unstubAllGlobals());

describe('extension credential manager', () => {
  it('pairs without exposing credentials to UI storage modules', async () => {
    const response = {
      sessionId: 'session-1', accessToken: 'eat_access', accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      refreshToken: 'ert_refresh', refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), projectIds: ['p1'],
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(response), { status: 201, headers: { 'content-type': 'application/json' } }));
    const paired = await pairExtension('pair_one_time', fetcher);
    expect(paired.accessToken).toBe('eat_access');
    await expect(loadCredential()).resolves.toMatchObject({ sessionId: 'session-1', projectIds: ['p1'] });
    expect(JSON.stringify(values[STORAGE_KEYS.credential])).not.toContain('pair_one_time');
  });

  it('rejects an expired refresh credential and removes it', async () => {
    values[STORAGE_KEYS.credential] = {
      sessionId: 'expired', accessToken: 'eat_access', accessExpiresAt: new Date(0).toISOString(),
      refreshToken: 'ert_refresh', refreshExpiresAt: new Date(0).toISOString(), projectIds: [], deviceId: 'device-identifier-long-enough',
    };
    await expect(activeCredential()).rejects.toMatchObject({ code: 'AUTH_EXPIRED' });
    expect(values[STORAGE_KEYS.credential]).toBeUndefined();
    await clearCredential();
  });

  it('proactively rotates both credentials shortly before access expiry', async () => {
    values[STORAGE_KEYS.credential] = {
      sessionId: 'session-1', accessToken: 'eat_old', accessExpiresAt: new Date(Date.now() + 10_000).toISOString(),
      refreshToken: 'ert_old', refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), projectIds: ['p1'],
      deviceId: 'device-identifier-long-enough',
    };
    const rotated = {
      sessionId: 'session-1', accessToken: 'eat_new', accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
      refreshToken: 'ert_new', refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), projectIds: ['p1'],
    };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ refreshToken: 'ert_old', deviceId: 'device-identifier-long-enough' });
      return new Response(JSON.stringify(rotated), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    await expect(activeCredential(fetcher)).resolves.toMatchObject({ accessToken: 'eat_new', refreshToken: 'ert_new' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(loadCredential()).resolves.toMatchObject({ accessToken: 'eat_new', refreshToken: 'ert_new' });
  });
});
