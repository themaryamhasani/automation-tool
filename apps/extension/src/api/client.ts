import { ExtensionError, type ExtensionErrorCode } from '../shared/errors';
import { authorizedFetch } from '../auth/credentials';
import { BUILD_CONFIG } from '../config';
import type {
  AuthProfile, EnvironmentSummary, FolderSummary, ProjectSummary, RunSummary, SourceValidationResult, TestFileSummary,
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
  SECRET_VALIDATION_FAILED: 'SECRET_VALIDATION_FAILED',
  EXTENSION_AUTH_EXPIRED: 'AUTH_EXPIRED',
};

export class AutomationApiClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl = BUILD_CONFIG.apiOrigin,
    private readonly authFetch: typeof authorizedFetch = authorizedFetch,
    private readonly timeoutMs = 15_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body) headers.set('Content-Type', 'application/json');
    let response: Response;
    try {
      response = await this.authFetch(`${this.baseUrl}${path}`, { ...init, headers, signal: controller.signal });
    } catch (error) {
      if (error instanceof ExtensionError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw new ExtensionError('NETWORK_TIMEOUT');
      throw new ExtensionError('API_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as ApiErrorPayload;
      const code = CODE_MAP[payload.code || ''] || (response.status === 401 ? 'AUTH_EXPIRED' : response.status === 403 ? 'ACCESS_DENIED' : 'API_UNAVAILABLE');
      throw new ExtensionError(code, payload.message || `Automation Tool API returned HTTP ${response.status}.`, true, payload.details);
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
    revision?: number;
  }): Promise<TestFileSummary> {
    return this.request('/api/files/upsert', {
      method: 'PUT',
      body: JSON.stringify({ ...input, origin: 'chrome-extension' }),
    });
  }

  validateSource(projectId: string, sourceCode: string): Promise<SourceValidationResult> {
    return this.request('/api/files/validate', {
      method: 'POST',
      body: JSON.stringify({ projectId, sourceCode }),
    });
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
