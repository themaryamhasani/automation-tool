import type { BackgroundRequest, BackgroundResponse } from '../messaging/contracts';
import { serializeError } from '../shared/errors';
import { PlaywrightCrxAdapter } from './playwright-service';
import { BUILD_CONFIG } from '../config';
import { clearCredential, credentialStatus, pairExtension } from '../auth/credentials';

const service = new PlaywrightCrxAdapter();

async function openPanel(windowId?: number): Promise<void> {
  const id = windowId ?? (await chrome.windows.getCurrent()).id;
  if (id != null) await chrome.sidePanel.open({ windowId: id });
}

async function handle(request: BackgroundRequest): Promise<BackgroundResponse> {
  try {
    let state;
    switch (request.type) {
      case 'GET_STATE': state = service.getStatus(); break;
      case 'ATTACH': state = await service.connect(request.tabId); break;
      case 'DETACH': state = await service.disconnect(); break;
      case 'START_RECORDING': state = await service.startRecording(); break;
      case 'PAUSE_RECORDING': state = await service.pauseRecording(); break;
      case 'RESUME_RECORDING': state = await service.resumeRecording(); break;
      case 'STOP_RECORDING': state = await service.stopRecording(); break;
      case 'START_INSPECTING': state = await service.startElementSelection(); break;
      case 'STOP_INSPECTING': state = await service.cancelElementSelection(); break;
      case 'REPLAY': state = await service.runLocally(request.source, request.trace); break;
      case 'STOP_REPLAY': state = await service.stopLocalRun(); break;
      case 'RESET_SESSION': state = await service.disconnect(); break;
      case 'UPDATE_RECORDER_SETTINGS':
        state = service.getStatus();
        if (state.attachedTabId != null) {
          await service.disconnect();
          state = service.getStatus();
        }
        break;
    }
    return { ok: true, state };
  } catch (error) {
    return { ok: false, state: service.getStatus(), error: serializeError(error) };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== 'object' || !('type' in message)
    || message.type === 'STATE_CHANGED'
    || message.type === 'RECORDER_CONNECT_REQUIRED'
    || String(message.type).startsWith('TRACE_DOWNLOAD_')) return false;
  void handle(message as BackgroundRequest).then(sendResponse);
  return true;
});

chrome.runtime.onMessageExternal.addListener((message: unknown, sender, sendResponse) => {
  let senderOrigin = sender.origin || '';
  if (!senderOrigin && sender.url) { try { senderOrigin = new URL(sender.url).origin; } catch { senderOrigin = ''; } }
  if (senderOrigin !== BUILD_CONFIG.webOrigin || !message || typeof message !== 'object') return false;
  const request = message as { type?: string; pairingCode?: string; protocolVersion?: number };
  void (async () => {
    if (request.protocolVersion !== BUILD_CONFIG.pairingProtocol) {
      return { ok: false, code: 'EXTENSION_OUTDATED', version: chrome.runtime.getManifest().version };
    }
    if (request.type === 'AUTOMATION_TOOL_STATUS') {
      return { ok: true, ...(await credentialStatus()), version: chrome.runtime.getManifest().version, protocolVersion: BUILD_CONFIG.pairingProtocol };
    }
    if (request.type === 'AUTOMATION_TOOL_PAIR' && request.pairingCode) {
      const credential = await pairExtension(request.pairingCode);
      await chrome.runtime.sendMessage({ type: 'AUTH_CHANGED' }).catch(() => undefined);
      return { ok: true, connected: true, sessionId: credential.sessionId, version: chrome.runtime.getManifest().version, protocolVersion: BUILD_CONFIG.pairingProtocol };
    }
    if (request.type === 'AUTOMATION_TOOL_OPEN') {
      await openPanel(sender.tab?.windowId);
      return { ok: true };
    }
    if (request.type === 'AUTOMATION_TOOL_DISCONNECT') {
      await clearCredential();
      await chrome.runtime.sendMessage({ type: 'AUTH_CHANGED' }).catch(() => undefined);
      return { ok: true, connected: false };
    }
    return { ok: false, code: 'UNSUPPORTED_MESSAGE' };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, ...serializeError(error) }));
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  void openPanel(tab.windowId);
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.contextMenus.removeAll().then(() => Promise.all([
    chrome.contextMenus.create({ id: 'automation-tool-record', title: 'Automation Tool · Record this tab', contexts: ['page'] }),
    chrome.contextMenus.create({ id: 'automation-tool-inspect', title: 'Automation Tool · Inspect locator', contexts: ['page'] }),
  ])).catch(() => undefined);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || !['automation-tool-record', 'automation-tool-inspect'].includes(String(info.menuItemId))) return;
  void (async () => {
    await openPanel(tab.windowId);
    if (info.menuItemId === 'automation-tool-record') await service.startRecording();
    else { await service.connect(tab.id); await service.startElementSelection(); }
  })().catch(() => undefined);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab.id || !['record', 'inspect'].includes(command)) return;
  void (async () => {
    await openPanel(tab.windowId);
    if (command === 'record') await service.startRecording();
    else { await service.connect(tab.id); await service.startElementSelection(); }
  })().catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => { void service.tabClosed(tabId); });
chrome.tabs.onUpdated.addListener((tabId, _change, tab) => { void service.tabUpdated(tabId, tab); });
chrome.tabs.onActivated.addListener(({ tabId }) => { void service.activeTabChanged(tabId); });
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId != null) void service.debuggerDetached(source.tabId, reason);
});
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state && ['complete', 'interrupted'].includes(delta.state.current || '')) {
    void (async () => {
      await chrome.runtime.sendMessage({ type: 'TRACE_DOWNLOAD_CLEANUP', downloadId: delta.id }).catch(() => undefined);
      if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
    })();
  }
});
