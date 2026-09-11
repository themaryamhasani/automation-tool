export const STORAGE_KEYS = {
  settings: 'automationTool.settings.v1',
  credential: 'automationTool.credential.v1',
  deviceId: 'automationTool.device.v1',
  session: 'automationTool.session.v1',
} as const;

export interface ExtensionSettings {
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
  selectedProjectId: '',
  selectedEnvironmentId: '',
  folderPath: 'recorded',
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
