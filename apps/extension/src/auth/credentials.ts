import { BUILD_CONFIG } from '../config';
import { STORAGE_KEYS } from '../shared/constants';
import { ExtensionError } from '../shared/errors';

export interface ExtensionCredential {
  sessionId: string;
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  projectIds: string[];
  deviceId: string;
}

type CredentialResponse = Omit<ExtensionCredential, 'deviceId'>;

let refreshInFlight: Promise<ExtensionCredential> | null = null;

function validResponse(value: unknown): value is CredentialResponse {
  const item = value as Partial<CredentialResponse> | null;
  return Boolean(item
    && typeof item.sessionId === 'string'
    && item.accessToken?.startsWith('eat_')
    && item.refreshToken?.startsWith('ert_')
    && !Number.isNaN(Date.parse(item.accessExpiresAt || ''))
    && !Number.isNaN(Date.parse(item.refreshExpiresAt || ''))
    && Array.isArray(item.projectIds));
}

async function jsonRequest(path: string, body: unknown, fetcher: typeof fetch): Promise<CredentialResponse> {
  const response = await fetcher(`${BUILD_CONFIG.apiOrigin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { code?: string; message?: string };
  if (!response.ok || !validResponse(payload)) {
    throw new ExtensionError('AUTH_EXPIRED', response.ok ? undefined : payload.message);
  }
  return payload;
}

async function deviceId(): Promise<string> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.deviceId);
  const current = stored[STORAGE_KEYS.deviceId];
  if (typeof current === 'string' && current.length >= 20) return current;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const next = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await chrome.storage.local.set({ [STORAGE_KEYS.deviceId]: next });
  return next;
}

export async function loadCredential(): Promise<ExtensionCredential | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.credential);
  const value = stored[STORAGE_KEYS.credential] as Partial<ExtensionCredential> | undefined;
  return value && validResponse(value) && typeof (value as Partial<ExtensionCredential>).deviceId === 'string' ? value as ExtensionCredential : null;
}

async function saveCredential(value: ExtensionCredential): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.credential]: value });
}

export async function clearCredential(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.credential);
}

export async function pairExtension(pairingCode: string, fetcher: typeof fetch = fetch): Promise<ExtensionCredential> {
  const id = await deviceId();
  const response = await jsonRequest('/api/extension/pairings/exchange', { pairingCode, deviceId: id }, fetcher);
  const credential = { ...response, deviceId: id };
  await saveCredential(credential);
  return credential;
}

export async function refreshCredential(fetcher: typeof fetch = fetch): Promise<ExtensionCredential> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const current = await loadCredential();
    if (!current || Date.parse(current.refreshExpiresAt) <= Date.now()) {
      await clearCredential();
      throw new ExtensionError('AUTH_EXPIRED');
    }
    try {
      const response = await jsonRequest('/api/extension/auth/refresh', {
        refreshToken: current.refreshToken,
        deviceId: current.deviceId,
      }, fetcher);
      const next = { ...response, deviceId: current.deviceId };
      await saveCredential(next);
      return next;
    } catch (error) {
      await clearCredential();
      throw error;
    }
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

export async function activeCredential(fetcher: typeof fetch = fetch): Promise<ExtensionCredential> {
  const credential = await loadCredential();
  if (!credential) throw new ExtensionError('AUTH_EXPIRED');
  if (Date.parse(credential.refreshExpiresAt) <= Date.now()) {
    await clearCredential();
    throw new ExtensionError('AUTH_EXPIRED');
  }
  if (Date.parse(credential.accessExpiresAt) <= Date.now() + 30_000) return refreshCredential(fetcher);
  return credential;
}

export async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<Response> {
  let credential = await activeCredential(fetcher);
  const send = () => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${credential.accessToken}`);
    return fetcher(input, { ...init, headers });
  };
  let response = await send();
  if (response.status === 401) {
    credential = await refreshCredential(fetcher);
    response = await send();
  }
  return response;
}

export async function credentialStatus(): Promise<{ connected: boolean; sessionId: string | null }> {
  const credential = await loadCredential();
  if (!credential || Date.parse(credential.refreshExpiresAt) <= Date.now()) {
    if (credential) await clearCredential();
    return { connected: false, sessionId: null };
  }
  return { connected: true, sessionId: credential.sessionId };
}

export async function revokeCredential(fetcher: typeof fetch = fetch): Promise<void> {
  try {
    await authorizedFetch(`${BUILD_CONFIG.apiOrigin}/api/extension/auth/session`, { method: 'DELETE' }, fetcher);
  } finally {
    await clearCredential();
  }
}
