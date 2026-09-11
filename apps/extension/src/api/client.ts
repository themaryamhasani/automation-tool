import { ExtensionError, type ExtensionErrorCode } from '../shared/errors';
import type {
  AuthProfile, EnvironmentSummary, FolderSummary, Paginated, ProjectSummary, RunSummary, TestFileSummary,
} from './types';

interface ApiErrorPayload {
  code?: string;
  message?: string;
  details?: unknown;
}

const CODE_MAP: Record<string, ExtensionErrorCode> = {
  AUTH_REQUIRED: 'AUTH_EXPIRED',
  SESSION_EXPIRED: 'AUTH_EXPIRED',
  INVALID_API_TOKEN: 'AUTH_EXPIRED',
  TOKEN_SCOPE_DENIED: 'ACCESS_DENIED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  PROJECT_ACCESS_DENIED: 'ACCESS_DENIED',
  PROJECT_NOT_FOUND: 'PROJECT_REMOVED',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  DUPLICATE_VALUE: 'REVISION_CONFLICT',
  INVALID_FOLDER: 'INVALID_SOURCE',
  INVALID_FILE_NAME: 'INVALID_SOURCE',
  INVALID_FILE: 'INVALID_SOURCE',
  INVALID_SOURCE: 'INVALID_SOURCE',
};

export class AutomationApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly apiToken: string, private readonly timeoutMs = 15_000) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${this.apiToken}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers, signal: controller.signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw new ExtensionError('NETWORK_TIMEOUT');
      throw new ExtensionError('API_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as ApiErrorPayload;
      const code = CODE_MAP[payload.code || ''] || (response.status === 401 ? 'AUTH_EXPIRED' : response.status === 403 ? 'ACCESS_DENIED' : 'API_UNAVAILABLE');
      throw new ExtensionError(code, payload.message || `Automation Tool API returned HTTP ${response.status}.`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  profile(): Promise<AuthProfile> {
    return this.request('/api/auth/me');
  }

  projects(): Promise<ProjectSummary[]> {
    return this.request('/api/projects');
  }

  environments(projectId: string): Promise<EnvironmentSummary[]> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/environments`);
  }

  folders(projectId: string): Promise<FolderSummary[]> {
    return this.request(`/api/files/folders?projectId=${encodeURIComponent(projectId)}`);
  }

  async saveTest(input: {
    projectId: string;
    folderPath: string;
    fileName: string;
    sourceCode: string;
    description?: string;
  }): Promise<TestFileSummary> {
    const query = new URLSearchParams({
      projectId: input.projectId,
      search: input.fileName,
      page: '1',
      limit: '100',
    });
    const matches = await this.request<Paginated<TestFileSummary>>(`/api/files?${query}`);
    const existing = matches.data.find(file => file.folderPath === input.folderPath && file.fileName === input.fileName);
    const body = JSON.stringify({ ...input, origin: 'chrome-extension', ...(existing ? { revision: existing.revision } : {}) });
    return existing
      ? this.request(`/api/files/${encodeURIComponent(existing.id)}`, { method: 'PUT', body })
      : this.request('/api/files', { method: 'POST', body });
  }

  createRun(input: {
    projectId: string;
    testFileId: string;
    environmentId?: string;
  }): Promise<RunSummary> {
    return this.request('/api/runs', {
      method: 'POST',
      body: JSON.stringify({
        projectId: input.projectId,
        testFileId: input.testFileId,
        environmentId: input.environmentId || undefined,
        toolKind: 'PLAYWRIGHT',
        browserProjects: ['chromium'],
        headed: false,
        workers: 1,
        retries: 0,
        trace: 'retain-on-failure',
        reporter: 'json',
        triggerSource: 'chrome-extension',
      }),
    });
  }
}
