export const EXTENSION_PROTOCOL_VERSION = 1;

export interface RecorderExtensionStatus {
  installed: boolean;
  compatible: boolean;
  connected: boolean;
  sessionId: string | null;
  version: string | null;
  error?: string;
}

interface ExternalResponse {
  ok?: boolean;
  code?: string;
  connected?: boolean;
  sessionId?: string | null;
  version?: string;
  protocolVersion?: number;
}

interface ChromeRuntimeBridge {
  lastError?: { message?: string };
  sendMessage(extensionId: string, message: unknown, callback: (response?: ExternalResponse) => void): void;
}

function runtimeBridge(): ChromeRuntimeBridge | null {
  const value = (globalThis as typeof globalThis & { chrome?: { runtime?: ChromeRuntimeBridge } }).chrome?.runtime;
  return value && typeof value.sendMessage === 'function' ? value : null;
}

export function configuredExtensionId(): string {
  const value = String(import.meta.env.VITE_CHROME_EXTENSION_ID || '').trim();
  return /^[a-p]{32}$/.test(value) ? value : '';
}

export function configuredWebStoreUrl(): string {
  const value = String(import.meta.env.VITE_CHROME_WEBSTORE_ITEM_URL || '').trim();
  try {
    const parsed = new URL(value);
    const trustedHost = parsed.hostname === 'chromewebstore.google.com'
      || parsed.hostname === 'chrome.google.com';
    return parsed.protocol === 'https:' && trustedHost ? parsed.href : '';
  } catch {
    return '';
  }
}

export function classifyExtensionResponse(response?: ExternalResponse): RecorderExtensionStatus {
  if (!response) return { installed: false, compatible: false, connected: false, sessionId: null, version: null };
  const compatible = response.ok === true && response.protocolVersion === EXTENSION_PROTOCOL_VERSION;
  return {
    installed: true,
    compatible,
    connected: compatible && response.connected === true,
    sessionId: compatible ? response.sessionId || null : null,
    version: response.version || null,
    error: compatible ? undefined : response.code || 'EXTENSION_OUTDATED',
  };
}

export function sendRecorderMessage(message: Record<string, unknown>, timeoutMs = 2500): Promise<ExternalResponse> {
  const extensionId = configuredExtensionId();
  const runtime = runtimeBridge();
  if (!extensionId || !runtime) return Promise.reject(new Error('Chrome Recorder is not available.'));
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error('Chrome Recorder did not respond.')), timeoutMs);
    try {
      runtime.sendMessage(extensionId, { ...message, protocolVersion: EXTENSION_PROTOCOL_VERSION }, response => {
        globalThis.clearTimeout(timer);
        if (runtime.lastError || !response) return reject(new Error(runtime.lastError?.message || 'Chrome Recorder is not installed.'));
        resolve(response);
      });
    } catch (error) {
      globalThis.clearTimeout(timer);
      reject(error);
    }
  });
}

export async function detectRecorder(): Promise<RecorderExtensionStatus> {
  try { return classifyExtensionResponse(await sendRecorderMessage({ type: 'AUTOMATION_TOOL_STATUS' })); }
  catch { return classifyExtensionResponse(); }
}

export async function pairRecorder(pairingCode: string): Promise<RecorderExtensionStatus> {
  const response = await sendRecorderMessage({ type: 'AUTOMATION_TOOL_PAIR', pairingCode }, 5000);
  const status = classifyExtensionResponse({ ...response, protocolVersion: response.protocolVersion ?? EXTENSION_PROTOCOL_VERSION });
  if (!status.connected) throw new Error(response.code === 'EXTENSION_OUTDATED' ? 'Chrome Recorder must be updated.' : 'Recorder pairing failed. Try again.');
  return status;
}

export async function openRecorder(): Promise<void> {
  const response = await sendRecorderMessage({ type: 'AUTOMATION_TOOL_OPEN' });
  if (!response.ok) throw new Error('Chrome Recorder could not be opened. Use its toolbar icon instead.');
}

export async function disconnectRecorder(): Promise<void> {
  await sendRecorderMessage({ type: 'AUTOMATION_TOOL_DISCONNECT' }).catch(() => undefined);
}
