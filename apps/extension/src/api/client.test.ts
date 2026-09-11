import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutomationApiClient } from './client';
import { ExtensionError } from '../shared/errors';

afterEach(() => vi.unstubAllGlobals());

describe('Automation API client', () => {
  it('maps expired token responses and sends bearer auth', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer atk_secret');
      return new Response(JSON.stringify({ code: 'INVALID_API_TOKEN', message: 'expired' }), { status: 401, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new AutomationApiClient('http://localhost:4280/', 'atk_secret');
    await expect(client.projects()).rejects.toMatchObject({ code: 'AUTH_EXPIRED', message: 'expired' } satisfies Partial<ExtensionError>);
  });

  it('maps revision conflicts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'REVISION_CONFLICT', message: 'changed' }), { status: 409 })));
    const client = new AutomationApiClient('http://localhost:4280', 'atk_secret');
    await expect(client.saveTest({ projectId: 'p', folderPath: 'tests', fileName: 'a.spec.ts', sourceCode: 'x' }))
      .rejects.toMatchObject({ code: 'REVISION_CONFLICT' } satisfies Partial<ExtensionError>);
  });
});
