export type ExtensionErrorCode =
  | 'UNSUPPORTED_PAGE'
  | 'DEBUGGER_BUSY'
  | 'TAB_CLOSED'
  | 'ATTACH_FAILED'
  | 'REATTACH_REQUIRED'
  | 'RECORDER_FAILED'
  | 'REPLAY_FAILED'
  | 'AUTH_EXPIRED'
  | 'API_UNAVAILABLE'
  | 'ACCESS_DENIED'
  | 'PROJECT_REMOVED'
  | 'REVISION_CONFLICT'
  | 'RUN_FAILED'
  | 'INVALID_SOURCE'
  | 'SECRET_VALIDATION_FAILED'
  | 'POLICY_BLOCKED'
  | 'EXTENSION_OUTDATED'
  | 'SENSITIVE_INPUT_REPLACED'
  | 'NETWORK_TIMEOUT'
  | 'UNKNOWN';

export interface SerializedExtensionError {
  code: ExtensionErrorCode;
  message: string;
  recoverable: boolean;
}

const FRIENDLY_MESSAGES: Record<ExtensionErrorCode, string> = {
  UNSUPPORTED_PAGE: 'This Chrome page cannot be recorded. Open a normal website and try again.',
  DEBUGGER_BUSY: 'Another tool is controlling this page. Close DevTools or the other browser automation tool, then try again.',
  TAB_CLOSED: 'The recorded page was closed. Open the page again and reconnect.',
  ATTACH_FAILED: 'Recorder could not connect to this page. Try reloading the page.',
  REATTACH_REQUIRED: 'Recorder restarted and needs to reconnect to this page.',
  RECORDER_FAILED: 'Recorder could not complete this action. Try again.',
  REPLAY_FAILED: 'The local test failed. Review the recording and try again.',
  AUTH_EXPIRED: 'Your recorder session expired. Reconnect from Automation Tool.',
  API_UNAVAILABLE: 'Automation Tool is unavailable. Check your connection and try again.',
  ACCESS_DENIED: 'Your account does not have permission for that project or action.',
  PROJECT_REMOVED: 'The selected project is no longer available. Select another project.',
  REVISION_CONFLICT: 'The saved file changed on the server. Reload its latest revision and save again.',
  RUN_FAILED: 'The test was saved, but the remote run could not be created.',
  INVALID_SOURCE: 'The generated Playwright Test source is empty or invalid.',
  SECRET_VALIDATION_FAILED: 'This test contains sensitive data that must be replaced before saving.',
  POLICY_BLOCKED: 'Browser automation is disabled by your organization. Contact your administrator.',
  EXTENSION_OUTDATED: 'This recorder version is not compatible with Automation Tool. Update it from the Chrome Web Store.',
  SENSITIVE_INPUT_REPLACED: 'Sensitive values were replaced with environment-variable placeholders.',
  NETWORK_TIMEOUT: 'The API request timed out. Retry when the server is reachable.',
  UNKNOWN: 'An unexpected extension error occurred.',
};

export class ExtensionError extends Error {
  constructor(
    public readonly code: ExtensionErrorCode,
    message = FRIENDLY_MESSAGES[code],
    public readonly recoverable = true,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function toExtensionError(error: unknown, fallback: ExtensionErrorCode = 'UNKNOWN'): ExtensionError {
  if (error instanceof ExtensionError) return error;
  const message = error instanceof Error ? error.message : String(error || '');
  if (/Cannot access a chrome|chrome:\/\/|Cannot attach to this target|not allowed/i.test(message)) {
    return new ExtensionError('UNSUPPORTED_PAGE');
  }
  if (/Another debugger|already attached|debugger is already attached|target is already attached/i.test(message)) {
    return new ExtensionError('DEBUGGER_BUSY');
  }
  if (/policy|not permitted|permission denied|blocked by.*administrator/i.test(message)) {
    return new ExtensionError('POLICY_BLOCKED');
  }
  if (/No tab with id|tab.*closed|target closed|has been closed/i.test(message)) {
    return new ExtensionError('TAB_CLOSED');
  }
  return new ExtensionError(fallback, FRIENDLY_MESSAGES[fallback]);
}

export function serializeError(error: unknown, fallback?: ExtensionErrorCode): SerializedExtensionError {
  const normalized = toExtensionError(error, fallback);
  return { code: normalized.code, message: normalized.message, recoverable: normalized.recoverable };
}

export function redactLogText(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,'"}]+/gi, '$1[REDACTED]')
    .replace(/\b(atk_[A-Za-z0-9_-]{12,})\b/g, '[REDACTED_TOKEN]')
    .replace(/\b(?:eat_|ert_|pair_)[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[REDACTED_KEY]');
}
