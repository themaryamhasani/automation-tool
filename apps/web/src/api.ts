const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
let sessionToken = '';

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getToken() {
  return sessionToken;
}

export function setToken(token: string | null) {
  sessionToken = token || '';
}

function canRetry(path: string, method: string) {
  if (method === 'GET' || method === 'HEAD') return true;
  return /\/(session|catalog|connections|products|health|dir)(\?|$)/.test(path);
}

function withAuth(headers: Headers) {
  if (sessionToken && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${sessionToken}`);
  return headers;
}

async function requestOnce<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = withAuth(new Headers(options.headers));
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'ارتباط با سرور برقرار نشد. دوباره تلاش کنید.');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ code: 'HTTP_ERROR', message: 'ارتباط با سرور ناموفق بود.' }));
    if (response.status === 401 && path !== '/api/auth/login' && ['AUTH_REQUIRED', 'SESSION_EXPIRED', 'INVALID_CREDENTIALS'].includes(payload.code)) setToken(null);
    throw new ApiError(response.status, payload.code || 'HTTP_ERROR', payload.message || 'درخواست ناموفق بود.', payload.details);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function fetchText(path: string): Promise<string> {
  const headers = withAuth(new Headers());
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { headers, credentials: 'include' });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'ارتباط با سرور برقرار نشد. دوباره تلاش کنید.');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ code: 'HTTP_ERROR', message: 'خواندن لاگ ناموفق بود.' }));
    throw new ApiError(response.status, payload.code || 'HTTP_ERROR', payload.message || 'خواندن لاگ ناموفق بود.', payload.details);
  }
  return response.text();
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase();
  try {
    return await requestOnce<T>(path, options);
  } catch (error) {
    const retryable = error instanceof ApiError && (error.status === 0 || error.status >= 500) && canRetry(path, method);
    if (!retryable) throw error;
    await new Promise(resolve => setTimeout(resolve, 400));
    return requestOnce<T>(path, options);
  }
}

export async function uploadBinary<T>(path: string, body: Blob, fileName: string): Promise<T> {
  const headers = withAuth(new Headers());
  headers.set('Content-Type', 'application/zip');
  headers.set('x-file-name', encodeURIComponent(fileName));
  const response = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body, credentials: 'include' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ code: 'HTTP_ERROR', message: 'آپلود ناموفق بود.' }));
    throw new ApiError(response.status, payload.code || 'HTTP_ERROR', payload.message || 'آپلود ناموفق بود.', payload.details);
  }
  return response.json() as Promise<T>;
}

export async function downloadArtifact(id: string, fileName: string) {
  const headers = withAuth(new Headers());
  const response = await fetch(`${API_BASE}/api/artifacts/${encodeURIComponent(id)}/download`, {
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || 'دانلود فایل ناموفق بود.');
  }
  const blob = await response.blob();
  triggerDownload(blob, fileName);
}

export async function downloadReportExcel(reportId: string, query: URLSearchParams, fileName: string) {
  const headers = withAuth(new Headers());
  const response = await fetch(`${API_BASE}/api/reports/${encodeURIComponent(reportId)}/excel?${query}`, {
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || 'دانلود اکسل ناموفق بود.');
  }
  triggerDownload(await response.blob(), fileName);
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function runEventsUrl(runId: string) {
  return `${API_BASE}/api/runs/${encodeURIComponent(runId)}/events`;
}

export function opsEventsUrl() {
  return `${API_BASE}/api/ops/events`;
}
