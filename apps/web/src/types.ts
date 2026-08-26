export type Role = 'ADMIN' | 'OPERATOR' | 'VIEWER';
export type RunStatus = 'PREPARING' | 'QUEUED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'ERROR' | 'CANCEL_REQUESTED' | 'CANCELLED';
export type BrowserProject = 'chromium' | 'firefox' | 'webkit';

export interface User {
  id: string;
  fullName: string;
  email?: string | null;
  phoneNumber?: string | null;
  role: Role;
  isActive: boolean;
  projectIds?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export type SourceApproach = 'CDE' | 'IS' | 'GITHUB' | 'GIT_EDUS' | 'ZIP';
export type ToolKind = 'PLAYWRIGHT' | 'DANGER' | 'K6' | 'VITEST' | 'BIOME' | 'GITLEAKS' | 'AUDIT' | 'SEMGREP' | 'SPECTRAL' | 'AXE';

export type ProjectKind = 'NAMED' | 'WORKSPACE';

export interface Project {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  isActive: boolean;
  kind?: ProjectKind;
  sourceApproach?: SourceApproach;
  environmentCount?: number;
  fileCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Environment {
  id: string;
  projectId: string;
  name: string;
  baseUrl: string;
  apiBaseUrl?: string | null;
  gatewayBaseUrl?: string | null;
  secretReferences?: Record<string, string>;
  availableFrom?: string | null;
  availableUntil?: string | null;
  availableNow?: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TestFile {
  id: string;
  projectId: string;
  projectName?: string;
  folderPath: string;
  fileName: string;
  fullPath: string;
  description?: string | null;
  sourceCode: string;
  revision: number;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Artifact {
  id: string;
  kind: 'LOG' | 'REPORT' | 'EVIDENCE' | string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface RunReportTest {
  title: string;
  projectName: string;
  outcome: string;
  duration: number;
  error?: string | null;
  /** مسیر فایل/تستی که خطا از آن آمده */
  path?: string | null;
  /** راهنمای عملی رفع */
  hint?: string | null;
  file?: string | null;
  line?: number | null;
}

export interface RunReport {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  details: RunReportTest[];
}

export interface Run {
  id: string;
  projectId: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
  baseUrl: string;
  testFileId?: string | null;
  testFilePath: string;
  browserProjects: BrowserProject[];
  headed: boolean;
  workers: number;
  retries: number;
  maxFailures?: number | null;
  trace: string;
  reporter: string;
  timeoutSeconds: number;
  status: RunStatus;
  runnerId?: string | null;
  command?: string | null;
  logs?: string | null;
  report?: RunReport | null;
  totalTests?: number | null;
  passedTests?: number | null;
  failedTests?: number | null;
  skippedTests?: number | null;
  requestedByName: string;
  requestedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  artifacts: Artifact[];
  sourceApproach?: SourceApproach | null;
  toolKind?: ToolKind | null;
  toolTarget?: string | null;
  packId?: string | null;
  flowId?: string | null;
  reportPaths?: Record<string, string> | null;
  cdeProjectKey?: string | null;
  cdeManifest?: Record<string, unknown> | null;
  cdeSnapshot?: {
    id: string;
    status: 'PENDING' | 'MATERIALIZING' | 'READY' | 'FAILED' | 'PURGED';
    contentHash?: string | null;
    fileCount: number;
    errorCode?: string | null;
    errorMessage?: string | null;
    expiresAt: string;
    manifest?: Record<string, unknown>;
  } | null;
}

export interface RunnerSettings {
  id: number;
  enabled: boolean;
  defaultTimeoutSeconds: number;
  defaultWorkers: number;
  defaultRetries: number;
  defaultTrace: string;
  defaultReporter: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ReportColumn {
  key: string;
  label: string;
  format?: 'text' | 'number' | 'percent' | 'datetime' | 'duration' | 'status';
}

export interface ReportMetaItem {
  id: string;
  audience: string;
  audienceLabel: string;
  title: string;
  subtitle: string;
  paginated?: boolean;
  searchable?: boolean;
}

export interface ReportKpi {
  key: string;
  label: string;
  value: string | number | null;
  unit?: string;
}

export interface ReportChart {
  id: string;
  title: string;
  items: Array<{ label: string; value: number }>;
}

export interface ReportTable {
  id: string;
  title: string;
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
}

export interface ReportPayload {
  id: string;
  title: string;
  subtitle: string;
  audience: string;
  audienceLabel: string;
  generatedAt: string;
  filters: Record<string, unknown>;
  kpis: ReportKpi[];
  charts: ReportChart[];
  tables: ReportTable[];
  pagination?: { page: number; limit: number; total: number; totalPages: number } | null;
}

export interface ReportCatalog {
  reports: ReportMetaItem[];
  approaches: SourceApproach[];
  tools: ToolKind[];
  statuses: RunStatus[];
  projects: Array<{ id: string; name: string; code: string }>;
  environments: Array<{ id: string; name: string; projectId: string; projectName: string }>;
  requesters: Array<{ id: string; fullName: string }>;
}

export interface CdeConnectionStatus {
  connected: boolean;
  reconnectRequired?: boolean;
  unavailable?: boolean;
  message?: string;
  nextStep?: 'password';
  challenge?: string;
  ecreq?: boolean;
  user?: { firstName: string; lastName: string; displayName: string } | null;
}

export interface RuntimeSessionStatus {
  connected: boolean;
  phase?: string;
  environmentId?: string;
  environmentName?: string;
  projectKey?: string | null;
  origin?: string;
  origins?: string[];
  defaultOrigin?: string;
  authMode?: string;
  authModes?: string[];
  authOrigin?: string;
  appOrigin?: string;
  prostage?: string | null;
  handoff?: {
    type?: string;
    clientAccessId?: string;
    pathTemplate?: string;
  } | null;
  cookieScopes?: string[];
  readyCheck?: { key?: string; expectLogin?: boolean } | null;
  loginPath?: string | null;
  loginUrl?: string | null;
  appPath?: string;
  appUrl?: string;
  projectServiceId?: string | null;
  apiFixtures?: Record<string, unknown>;
  roleLandings?: Record<string, string>;
  userSource?: string;
  loginName?: string;
  challenge?: string;
  nextStep?: 'password';
  ecreq?: boolean;
  runtimeUser?: { firstName: string; lastName: string; displayName: string } | null;
  connectedAt?: string;
  lastUsedAt?: string;
}
export type CdeRepositoryType = 'WEB_UI' | 'DATA_SERVICE' | 'API_MODULE' | 'MESSAGE_CONSUMER';
export interface CdeBranchSelector { kind: 'PUBLIC' | 'PERSONAL'; randId?: string; index?: number }
export interface CdeBranchSummary { selector: CdeBranchSelector; versionId?: string | null; editable?: boolean; meta?: Record<string, unknown> }
export interface CdeProjectDescriptor {
  projectKey: string;
  repositories: Record<CdeRepositoryType, string>;
  editorUrls: { webUi: string; dataService: string; gateway: string };
}
export interface CdeCatalog {
  projectKey: string;
  approach: 'DATA_SERVICE' | 'GATEWAY';
  repositories: Array<{ type: CdeRepositoryType; repoName: string; packages: Array<{ id: string; branches: CdeBranchSummary[] }>; error?: { code: string; message: string } }>;
}
export interface CdePackageContent {
  projectKey: string;
  repositoryType: CdeRepositoryType;
  repoName: string;
  packId: string;
  branches: CdeBranchSummary[];
  branch: CdeBranchSummary;
  files: Array<{ path: string; code: string; language?: string; readOnly: boolean }>;
}
export interface CdeProjectBundle {
  format: number;
  projectKey: string;
  approach: 'DATA_SERVICE' | 'GATEWAY';
  fileName: string;
  generatedAt: string;
  repositoryTypes: CdeRepositoryType[];
  packages: Array<Record<string, unknown>>;
  warnings: Array<{ code: string; message?: string; repositoryType?: string; packId?: string }>;
  files: Array<{ path: string; code: string; sourceHash: string }>;
}
export interface CdeProjectMapping {
  id?: string;
  projectId: string;
  serviceId?: string;
  projectKey: string;
  webUiRepoName?: string | null;
  dataServiceRepoName?: string | null;
  apiModuleRepoName?: string | null;
  messageConsumerRepoName?: string | null;
  testRepoName?: string | null;
  testPackId?: string | null;
  enabled: boolean;
  lastValidationStatus?: string | null;
  lastValidatedAt?: string | null;
}

export interface SourceStatus {
  ready: boolean;
  approach: SourceApproach;
  message?: string;
}

export interface WorkspaceConnection {
  connected: boolean;
  ready: boolean;
  username?: string | null;
  detail?: string;
}

export type WorkspaceConnections = Record<SourceApproach, WorkspaceConnection>;

export interface IsHealthCheck { name: string; url: string; optional?: boolean; ok: boolean; status: number; ms?: number; error?: string }
export interface IsPackSummary {
  id: string; title: string; alias?: string | null; docPath: string; flows: string[];
  automatedFlows: string[]; tools: ToolKind[]; e2eBaseUrl: string;
  health: Array<{ name: string; url: string; optional: boolean }>;
}
export interface IsPackCatalog {
  id: string;
  title: string;
  alias?: string | null;
  docPath: string;
  flows: string[];
  automatedFlows: string[];
  e2eBaseUrl?: string;
  tools: Record<string, Record<string, string | string[] | undefined>>;
  reportLayout: Record<string, string>;
  tree: Array<{ path: string; type: 'dir' | 'file'; size?: number }>;
  health: { packId: string; title: string; ready: boolean; message: string; checks: IsHealthCheck[] };
}
export interface GitRemoteProject {
  id: string; name: string; fullName: string; private: boolean; defaultBranch: string;
  htmlUrl: string; cloneUrl: string; description?: string; updatedAt?: string;
}
export interface SourceBinding {
  projectId: string;
  sourceApproach: SourceApproach;
  config: Record<string, unknown>;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
}
