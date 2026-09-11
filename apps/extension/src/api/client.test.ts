import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutomationApiClient } from './client';
import { ExtensionError } from '../shared/errors';

afterEach(() => vi.unstubAllGlobals());

describe('Automation API client', () => {
  it('maps expired token responses and sends bearer auth', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer eat_secret');
      return new Response(JSON.stringify({ code: 'INVALID_API_TOKEN', message: 'expired' }), { status: 401, headers: { 'content-type': 'application/json' } });
    });
    const authFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', 'Bearer eat_secret');
      return fetchMock(input, { ...init, headers });
    });
    const client = new AutomationApiClient('http://localhost:4280/', authFetch);
    await expect(client.projects()).rejects.toMatchObject({ code: 'AUTH_EXPIRED', message: 'expired' } satisfies Partial<ExtensionError>);
  });

  it('maps revision conflicts', async () => {
    const client = new AutomationApiClient('http://localhost:4280', vi.fn(async () => new Response(JSON.stringify({ code: 'REVISION_CONFLICT', message: 'changed' }), { status: 409 })));
    await expect(client.saveTest({ projectId: 'p', folderPath: 'tests', fileName: 'a.spec.ts', sourceCode: 'x' }))
      .rejects.toMatchObject({ code: 'REVISION_CONFLICT' } satisfies Partial<ExtensionError>);
  });

  it('saves with one atomic upsert request and never performs a paginated file lookup', async () => {
    const authFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      id: 'file-1', projectId: 'project-1', folderPath: 'recorded', fileName: 'checkout.spec.ts',
      fullPath: 'recorded/checkout.spec.ts', revision: 1,
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const client = new AutomationApiClient('http://localhost:4280', authFetch);

    await client.saveTest({
      projectId: 'project-1', folderPath: 'recorded', fileName: 'checkout.spec.ts', sourceCode: 'test("checkout", async () => {});',
    });

    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(authFetch.mock.calls[0]?.[0]).toBe('http://localhost:4280/api/files/upsert');
    expect(authFetch.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT' });
  });
});
