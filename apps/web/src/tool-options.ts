import type { BrowserProject, ToolKind } from './types';

export type PlaywrightRunOptions = {
  channel: 'chrome' | 'msedge' | 'chromium';
  extraHeaders: string;
  testTimeoutMs: number;
  actionTimeoutMs: number;
  navigationTimeoutMs: number;
};

export type AxeRunOptions = {
  channel: 'chrome' | 'msedge' | 'chromium';
  wcagTags: string[];
  disableRules: string;
  includeTags: string;
};

export type K6RunOptions = {
  vus: number;
  duration: string;
  iterations: number | null;
  httpDebug: boolean;
  insecureSkipTlsVerify: boolean;
};

export type DangerRunOptions = {
  requestTimeoutMs: number;
  bailOnFirstFailure: boolean;
};

export type VitestRunOptions = {
  bail: boolean;
  coverage: boolean;
  pool: 'threads' | 'forks';
  reporter: 'default' | 'verbose' | 'json';
  passWithNoTests: boolean;
};

export type BiomeRunOptions = {
  formatterEnabled: boolean;
  maxDepth: number;
};

export type GitleaksRunOptions = {
  verbose: boolean;
  redact: boolean;
};

export type AuditRunOptions = {
  failOn: 'high' | 'moderate' | 'low';
  includeDev: boolean;
  runExtras: boolean;
};

export type SemgrepRunOptions = {
  configPath: string;
  severity: 'ERROR' | 'WARNING';
};

export type SpectralRunOptions = {
  rulesetPath: string;
  failSeverity: 'error' | 'warn' | 'hint' | 'info';
};

export type ToolOptionsMap = {
  PLAYWRIGHT: PlaywrightRunOptions;
  AXE: AxeRunOptions;
  K6: K6RunOptions;
  DANGER: DangerRunOptions;
  VITEST: VitestRunOptions;
  BIOME: BiomeRunOptions;
  GITLEAKS: GitleaksRunOptions;
  AUDIT: AuditRunOptions;
  SEMGREP: SemgrepRunOptions;
  SPECTRAL: SpectralRunOptions;
};

export type SharedRunFields = {
  browserProjects: BrowserProject[];
  headed: boolean;
  workers: number;
  retries: number;
  maxFailures: number | null;
  trace: 'off' | 'on' | 'retain-on-failure' | 'on-first-retry';
  reporter: 'html' | 'json' | 'junit';
  timeoutSeconds: number;
};

export type RunConfigState = SharedRunFields & {
  toolOptions: Record<string, unknown>;
};

const STORAGE_PREFIX = 'tool-run-config-';

export function defaultSharedRunFields(): SharedRunFields {
  return {
    browserProjects: ['chromium'],
    headed: false,
    workers: 1,
    retries: 0,
    maxFailures: null,
    trace: 'retain-on-failure',
    reporter: 'json',
    timeoutSeconds: 900,
  };
}

export function defaultToolOptions(tool: ToolKind): ToolOptionsMap[ToolKind] | Record<string, unknown> {
  switch (tool) {
    case 'PLAYWRIGHT':
      return {
        channel: 'chrome',
        extraHeaders: '',
        testTimeoutMs: 60_000,
        actionTimeoutMs: 15_000,
        navigationTimeoutMs: 30_000,
      };
    case 'AXE':
      return { channel: 'chrome', wcagTags: ['wcag2a', 'wcag2aa'], disableRules: '', includeTags: '' };
    case 'K6':
      return { vus: 1, duration: '30s', iterations: null, httpDebug: false, insecureSkipTlsVerify: false };
    case 'DANGER':
      return { requestTimeoutMs: 30_000, bailOnFirstFailure: false };
    case 'VITEST':
      return { bail: false, coverage: false, pool: 'threads', reporter: 'default', passWithNoTests: false };
    case 'BIOME':
      return { formatterEnabled: false, maxDepth: 5 };
    case 'GITLEAKS':
      return { verbose: false, redact: true };
    case 'AUDIT':
      return { failOn: 'high', includeDev: false, runExtras: true };
    case 'SEMGREP':
      return { configPath: '', severity: 'ERROR' };
    case 'SPECTRAL':
      return { rulesetPath: '', failSeverity: 'error' };
    default:
      return {};
  }
}

export function defaultRunConfig(tool: ToolKind): RunConfigState {
  return {
    ...defaultSharedRunFields(),
    timeoutSeconds: tool === 'K6' ? 600 : tool === 'DANGER' ? 1800 : ['BIOME', 'GITLEAKS', 'AUDIT', 'SEMGREP', 'SPECTRAL'].includes(tool) ? 300 : 900,
    toolOptions: { ...defaultToolOptions(tool) },
  };
}

export function loadRunConfig(tool: ToolKind): RunConfigState {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${tool}`);
    if (!raw) return defaultRunConfig(tool);
    const parsed = JSON.parse(raw) as Partial<RunConfigState>;
    return {
      ...defaultRunConfig(tool),
      ...parsed,
      toolOptions: { ...defaultToolOptions(tool), ...(parsed.toolOptions || {}) },
    };
  } catch {
    return defaultRunConfig(tool);
  }
}

export function saveRunConfig(tool: ToolKind, config: RunConfigState) {
  localStorage.setItem(`${STORAGE_PREFIX}${tool}`, JSON.stringify(config));
}

export function runConfigToPayload(config: RunConfigState) {
  const body: Record<string, unknown> = {
    timeoutSeconds: config.timeoutSeconds,
    toolOptions: config.toolOptions,
  };
  if (config.browserProjects.length) body.browserProjects = config.browserProjects;
  body.headed = config.headed;
  body.workers = config.workers;
  body.retries = config.retries;
  if (config.maxFailures != null) body.maxFailures = config.maxFailures;
  body.trace = config.trace;
  body.reporter = config.reporter;
  return body;
}

export function usesPlaywrightFields(tool: ToolKind) {
  return tool === 'PLAYWRIGHT' || tool === 'AXE';
}
