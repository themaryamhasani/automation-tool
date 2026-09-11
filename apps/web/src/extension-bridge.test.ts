import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyExtensionResponse, configuredExtensionId, configuredWebStoreUrl, pairRecorder } from './extension-bridge';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Chrome Recorder bridge states', () => {
  it('recognizes missing, connected, disconnected, and incompatible installations', () => {
    expect(classifyExtensionResponse().installed).toBe(false);
    expect(classifyExtensionResponse({ ok: true, protocolVersion: 1, connected: false, version: '1.0.0' })).toMatchObject({ installed: true, compatible: true, connected: false });
    expect(classifyExtensionResponse({ ok: true, protocolVersion: 1, connected: true, sessionId: 's1' })).toMatchObject({ installed: true, compatible: true, connected: true, sessionId: 's1' });
    expect(classifyExtensionResponse({ ok: false, code: 'EXTENSION_OUTDATED', version: '0.9.0' })).toMatchObject({ installed: true, compatible: false, connected: false });
  });

  it('accepts only a valid extension ID and an official HTTPS Store URL', () => {
    vi.stubEnv('VITE_CHROME_EXTENSION_ID', 'abcdefghijklmnopabcdefghijklmnop');
    vi.stubEnv('VITE_CHROME_WEBSTORE_ITEM_URL', 'https://chromewebstore.google.com/detail/recorder/abcdefghijklmnopabcdefghijklmnop');
    expect(configuredExtensionId()).toBe('abcdefghijklmnopabcdefghijklmnop');
    expect(configuredWebStoreUrl()).toMatch(/^https:\/\/chromewebstore\.google\.com\//);
    vi.stubEnv('VITE_CHROME_WEBSTORE_ITEM_URL', 'javascript:alert(1)');
    expect(configuredWebStoreUrl()).toBe('');
  });

  it('delivers a one-time pairing code through the configured extension bridge', async () => {
    vi.stubEnv('VITE_CHROME_EXTENSION_ID', 'abcdefghijklmnopabcdefghijklmnop');
    const sendMessage = vi.fn((_extensionId: string, message: unknown, callback: (response: unknown) => void) => {
      expect(message).toMatchObject({ type: 'AUTOMATION_TOOL_PAIR', pairingCode: 'pair_single_use', protocolVersion: 1 });
      callback({ ok: true, connected: true, sessionId: 'session-1', version: '1.0.0', protocolVersion: 1 });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    await expect(pairRecorder('pair_single_use')).resolves.toMatchObject({ installed: true, compatible: true, connected: true });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
