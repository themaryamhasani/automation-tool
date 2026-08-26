'use strict';

const TRACE_MODES = new Set(['off', 'on', 'retain-on-failure', 'on-first-retry']);
const REPORTERS = new Set(['html', 'json', 'junit']);
const BROWSERS = new Set(['chromium', 'firefox', 'webkit']);
const PW_CHANNELS = new Set(['chrome', 'msedge', 'chromium']);
const AUDIT_FAIL_ON = new Set(['low', 'moderate', 'high']);
const VITEST_POOLS = new Set(['threads', 'forks']);
const VITEST_REPORTERS = new Set(['default', 'verbose', 'json']);
const WCAG_TAGS = new Set(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']);

class ToolOptionsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function clampInt(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(num)));
}

function parseJsonObject(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  const text = String(raw).trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    throw new ToolOptionsError('INVALID_HEADERS', 'هدرهای HTTP باید JSON معتبر باشند.');
  }
  throw new ToolOptionsError('INVALID_HEADERS', 'هدرهای HTTP باید یک شیء JSON باشند.');
}

function defaultToolOptions(toolKind) {
  const kind = String(toolKind || '').toUpperCase();
  switch (kind) {
    case 'PLAYWRIGHT':
      return {
        channel: 'chrome',
        extraHeaders: '',
        testTimeoutMs: 60_000,
        actionTimeoutMs: 15_000,
        navigationTimeoutMs: 30_000,
      };
    case 'AXE':
      return {
        channel: 'chrome',
        wcagTags: ['wcag2a', 'wcag2aa'],
        disableRules: '',
        includeTags: '',
      };
    case 'K6':
      return {
        vus: 1,
        duration: '30s',
        iterations: null,
        httpDebug: false,
        insecureSkipTlsVerify: false,
      };
    case 'DANGER':
      return {
        requestTimeoutMs: 30_000,
        bailOnFirstFailure: false,
      };
    case 'VITEST':
      return {
        bail: false,
        coverage: false,
        pool: 'threads',
        reporter: 'default',
        passWithNoTests: false,
      };
    case 'BIOME':
      return {
        formatterEnabled: false,
        maxDepth: 5,
      };
    case 'GITLEAKS':
      return {
        verbose: false,
        redact: true,
      };
    case 'AUDIT':
      return {
        failOn: 'high',
        includeDev: false,
        runExtras: true,
      };
    case 'SEMGREP':
      return {
        configPath: '',
        severity: 'ERROR',
      };
    case 'SPECTRAL':
      return {
        rulesetPath: '',
        failSeverity: 'error',
      };
    default:
      return {};
  }
}

function normalizeBrowsers(value) {
  if (!Array.isArray(value) || !value.length) return ['chromium'];
  const projects = [...new Set(value.filter(item => BROWSERS.has(String(item))))];
  if (!projects.length) throw new ToolOptionsError('BROWSER_REQUIRED', 'حداقل یک مرورگر انتخاب کنید.');
  return projects;
}

function normalizeToolOptions(toolKind, input = {}) {
  const kind = String(toolKind || '').toUpperCase();
  const defaults = defaultToolOptions(kind);
  const raw = input?.toolOptions && typeof input.toolOptions === 'object' ? input.toolOptions : input;
  switch (kind) {
    case 'PLAYWRIGHT':
      return {
        channel: PW_CHANNELS.has(String(raw.channel || defaults.channel)) ? String(raw.channel) : defaults.channel,
        extraHeaders: raw.extraHeaders == null ? defaults.extraHeaders : String(raw.extraHeaders),
        testTimeoutMs: clampInt(raw.testTimeoutMs, defaults.testTimeoutMs, 1_000, 3_600_000),
        actionTimeoutMs: clampInt(raw.actionTimeoutMs, defaults.actionTimeoutMs, 500, 600_000),
        navigationTimeoutMs: clampInt(raw.navigationTimeoutMs, defaults.navigationTimeoutMs, 1_000, 600_000),
      };
    case 'AXE': {
      const tags = Array.isArray(raw.wcagTags)
        ? raw.wcagTags.map(item => String(item).trim()).filter(item => WCAG_TAGS.has(item))
        : String(raw.wcagTags || defaults.wcagTags.join(',')).split(',').map(item => item.trim()).filter(item => WCAG_TAGS.has(item));
      return {
        channel: PW_CHANNELS.has(String(raw.channel || defaults.channel)) ? String(raw.channel) : defaults.channel,
        wcagTags: tags.length ? tags : defaults.wcagTags,
        disableRules: String(raw.disableRules || defaults.disableRules).trim(),
        includeTags: String(raw.includeTags || defaults.includeTags).trim(),
      };
    }
    case 'K6':
      return {
        vus: clampInt(raw.vus, defaults.vus, 1, 500),
        duration: String(raw.duration || defaults.duration).trim() || defaults.duration,
        iterations: raw.iterations == null || raw.iterations === '' ? null : clampInt(raw.iterations, null, 1, 1_000_000),
        httpDebug: Boolean(raw.httpDebug),
        insecureSkipTlsVerify: Boolean(raw.insecureSkipTlsVerify),
      };
    case 'DANGER':
      return {
        requestTimeoutMs: clampInt(raw.requestTimeoutMs, defaults.requestTimeoutMs, 1_000, 600_000),
        bailOnFirstFailure: Boolean(raw.bailOnFirstFailure),
      };
    case 'VITEST':
      return {
        bail: Boolean(raw.bail),
        coverage: Boolean(raw.coverage),
        pool: VITEST_POOLS.has(String(raw.pool)) ? String(raw.pool) : defaults.pool,
        reporter: VITEST_REPORTERS.has(String(raw.reporter)) ? String(raw.reporter) : defaults.reporter,
        passWithNoTests: Boolean(raw.passWithNoTests),
      };
    case 'BIOME':
      return {
        formatterEnabled: Boolean(raw.formatterEnabled),
        maxDepth: clampInt(raw.maxDepth, defaults.maxDepth, 1, 12),
      };
    case 'GITLEAKS':
      return {
        verbose: Boolean(raw.verbose),
        redact: raw.redact == null ? defaults.redact : Boolean(raw.redact),
      };
    case 'AUDIT':
      return {
        failOn: AUDIT_FAIL_ON.has(String(raw.failOn)) ? String(raw.failOn) : defaults.failOn,
        includeDev: Boolean(raw.includeDev),
        runExtras: raw.runExtras == null ? defaults.runExtras : Boolean(raw.runExtras),
      };
    case 'SEMGREP':
      return {
        configPath: String(raw.configPath || defaults.configPath).trim(),
        severity: String(raw.severity || defaults.severity).toUpperCase() === 'WARNING' ? 'WARNING' : 'ERROR',
      };
    case 'SPECTRAL':
      return {
        rulesetPath: String(raw.rulesetPath || defaults.rulesetPath).trim(),
        failSeverity: ['error', 'warn', 'hint', 'info'].includes(String(raw.failSeverity))
          ? String(raw.failSeverity)
          : defaults.failSeverity,
      };
    default:
      return {};
  }
}

function normalizeRunToolConfig(toolKind, body = {}, runnerDefaults = {}) {
  const kind = String(toolKind || '').toUpperCase();
  const toolOptions = normalizeToolOptions(kind, body);
  if (kind === 'PLAYWRIGHT' && toolOptions.extraHeaders) parseExtraHeaders(toolOptions.extraHeaders);
  const usesPlaywrightColumns = kind === 'PLAYWRIGHT' || kind === 'AXE';
  const browsers = usesPlaywrightColumns
    ? normalizeBrowsers(body?.browserProjects)
    : (Array.isArray(body?.browserProjects) && body.browserProjects.length ? body.browserProjects : ['chromium']);
  const trace = TRACE_MODES.has(body?.trace) ? body.trace : (runnerDefaults.default_trace || 'retain-on-failure');
  const reporter = REPORTERS.has(body?.reporter) ? body.reporter : (runnerDefaults.default_reporter || 'json');
  const workers = clampInt(body?.workers, runnerDefaults.default_workers ?? 1, 1, 32);
  const retries = clampInt(body?.retries, runnerDefaults.default_retries ?? 0, 0, 10);
  const timeoutSeconds = clampInt(
    body?.timeoutSeconds,
    runnerDefaults.default_timeout_seconds ?? 900,
    5,
    3600,
  );
  const maxFailures = body?.maxFailures === null || body?.maxFailures === 'unlimited'
    ? null
    : clampInt(body?.maxFailures, null, 1, 1000);
  return {
    browsers,
    headed: Boolean(body?.headed),
    workers,
    retries,
    maxFailures,
    trace,
    reporter,
    timeoutSeconds,
    toolOptions,
  };
}

function snapshotWithToolOptions(snapshot, toolOptions) {
  const base = snapshot && typeof snapshot === 'object' ? { ...snapshot } : {};
  if (toolOptions && Object.keys(toolOptions).length) base.toolOptions = toolOptions;
  else delete base.toolOptions;
  return base;
}

function parseSnapshot(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function toolOptionsFromRun(run) {
  if (run?.tool_options && typeof run.tool_options === 'object') return run.tool_options;
  const snapshot = parseSnapshot(run?.source_snapshot);
  return snapshot.toolOptions && typeof snapshot.toolOptions === 'object' ? snapshot.toolOptions : {};
}

function playwrightConfigFromRun(run) {
  return {
    browserProjects: Array.isArray(run?.browser_projects) && run.browser_projects.length
      ? run.browser_projects
      : ['chromium'],
    headed: Boolean(run?.headed),
    workers: clampInt(run?.workers, 1, 1, 32),
    retries: clampInt(run?.retries, 0, 0, 10),
    maxFailures: run?.max_failures == null ? null : clampInt(run.max_failures, null, 1, 1000),
    trace: TRACE_MODES.has(run?.trace) ? run.trace : 'retain-on-failure',
    reporter: REPORTERS.has(run?.reporter) ? run.reporter : 'json',
    timeoutSeconds: clampInt(run?.timeout_seconds, 900, 5, 3600),
    toolOptions: toolOptionsFromRun(run),
  };
}

function parseExtraHeaders(raw) {
  const parsed = parseJsonObject(raw);
  const headers = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key) continue;
    headers[String(key)] = String(value);
  }
  return Object.keys(headers).length ? headers : undefined;
}

function k6CliArgs(scriptName, options = {}) {
  const args = ['run'];
  if (options.vus) args.push('--vus', String(options.vus));
  if (options.duration && !options.iterations) args.push('--duration', String(options.duration));
  if (options.iterations) args.push('--iterations', String(options.iterations));
  if (options.httpDebug) args.push('--http-debug');
  if (options.insecureSkipTlsVerify) args.push('--insecure-skip-tls-verify');
  args.push(scriptName);
  return args;
}

function vitestCliArgs(baseArgs, options = {}) {
  const args = [...baseArgs];
  if (options.bail) args.push('--bail', '1');
  if (options.coverage) args.push('--coverage');
  if (options.pool) args.push('--pool', options.pool);
  if (options.reporter === 'verbose') args.push('--reporter', 'verbose');
  if (options.reporter === 'json') args.push('--reporter', 'json');
  if (options.passWithNoTests) args.push('--passWithNoTests');
  return args;
}

function auditSeriousCount(stats, failOn = 'high') {
  const critical = Number(stats?.critical || 0);
  const high = Number(stats?.high || 0);
  const moderate = Number(stats?.moderate || 0);
  const low = Number(stats?.low || 0);
  if (failOn === 'low') return critical + high + moderate + low;
  if (failOn === 'moderate') return critical + high + moderate;
  return critical + high;
}

module.exports = {
  ToolOptionsError,
  defaultToolOptions,
  normalizeToolOptions,
  normalizeRunToolConfig,
  snapshotWithToolOptions,
  toolOptionsFromRun,
  playwrightConfigFromRun,
  parseExtraHeaders,
  k6CliArgs,
  vitestCliArgs,
  auditSeriousCount,
  TRACE_MODES,
  REPORTERS,
  BROWSERS,
  PW_CHANNELS,
  WCAG_TAGS,
};
