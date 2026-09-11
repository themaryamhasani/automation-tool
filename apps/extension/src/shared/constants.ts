export const STORAGE_KEYS = {
  settings: 'automationTool.settings.v1',
  credential: 'automationTool.credential.v1',
  session: 'automationTool.session.v1',
} as const;

export interface ExtensionSettings {
  apiBaseUrl: string;
  webBaseUrl: string;
  selectedProjectId: string;
  selectedEnvironmentId: string;
  folderPath: string;
  fileName: string;
  testName: string;
  testIdAttribute: string;
  slowMo: number;
  replayWithTrace: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiBaseUrl: 'http://localhost:4280',
  webBaseUrl: 'http://localhost:5180',
  selectedProjectId: '',
  selectedEnvironmentId: '',
  folderPath: 'tests',
  fileName: 'recorded-test.spec.ts',
  testName: 'Recorded test',
  testIdAttribute: 'data-testid',
  slowMo: 100,
  replayWithTrace: false,
};

export const RECORDER_LANGUAGE = 'playwright-test';

export function isAttachableUrl(value?: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.hostname === 'chromewebstore.google.com') return false;
    if (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore')) return false;
    if (url.hostname === 'microsoftedge.microsoft.com' && url.pathname.startsWith('/addons')) return false;
    return true;
  } catch {
    return false;
  }
}

export function normalizeBaseUrl(value: string, fallback: string): string {
  const raw = value.trim() || fallback;
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
  return parsed.toString().replace(/\/$/, '');
}
