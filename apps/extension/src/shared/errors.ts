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
  | 'SENSITIVE_INPUT_REPLACED'
  | 'NETWORK_TIMEOUT'
  | 'UNKNOWN';

export interface SerializedExtensionError {
  code: ExtensionErrorCode;
  message: string;
  recoverable: boolean;
}

const FRIENDLY_MESSAGES: Record<ExtensionErrorCode, string> = {
  UNSUPPORTED_PAGE: 'Chrome does not allow extensions to attach to this page. Open a normal HTTP or HTTPS tab.',
  DEBUGGER_BUSY: 'This tab is already being debugged. Close DevTools or detach the other debugger, then retry.',
  TAB_CLOSED: 'The attached tab was closed. Choose another tab and attach again.',
  ATTACH_FAILED: 'Automation Tool could not attach Playwright to this tab.',
  REATTACH_REQUIRED: 'The extension service worker restarted. Reattach the tab to continue safely.',
  RECORDER_FAILED: 'The Playwright recorder could not complete this action.',
  REPLAY_FAILED: 'Local replay failed. Review the highlighted source and attached page.',
  AUTH_EXPIRED: 'The Automation Tool token is missing, expired, or revoked. Connect again.',
  API_UNAVAILABLE: 'Automation Tool API is unavailable. Check the API URL and server.',
  ACCESS_DENIED: 'This account or token does not have permission for that project or action.',
  PROJECT_REMOVED: 'The selected project is no longer available. Select another project.',
  REVISION_CONFLICT: 'The saved file changed on the server. Reload its latest revision and save again.',
  RUN_FAILED: 'The test was saved, but the remote run could not be created.',
  INVALID_SOURCE: 'The generated Playwright Test source is empty or invalid.',
  SENSITIVE_INPUT_REPLACED: 'Sensitive values were replaced with environment-variable placeholders.',
  NETWORK_TIMEOUT: 'The API request timed out. Retry when the server is reachable.',
  UNKNOWN: 'An unexpected extension error occurred.',
};

export class ExtensionError extends Error {
  constructor(
    public readonly code: ExtensionErrorCode,
    message = FRIENDLY_MESSAGES[code],
    public readonly recoverable = true,
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
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[REDACTED_KEY]');
}
