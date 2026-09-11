import type { BackgroundRequest, BackgroundResponse } from '../messaging/contracts';
import { serializeError } from '../shared/errors';
import { PlaywrightService } from './playwright-service';

const service = new PlaywrightService();

async function openPanel(windowId?: number): Promise<void> {
  const id = windowId ?? (await chrome.windows.getCurrent()).id;
  if (id != null) await chrome.sidePanel.open({ windowId: id });
}

async function handle(request: BackgroundRequest): Promise<BackgroundResponse> {
  try {
    let state;
    switch (request.type) {
      case 'GET_STATE': state = service.snapshot(); break;
      case 'ATTACH': state = await service.attach(request.tabId); break;
      case 'DETACH': state = await service.detach(); break;
      case 'START_RECORDING': state = await service.setRecorderMode('recording'); break;
      case 'PAUSE_RECORDING': state = await service.setRecorderMode('standby'); break;
      case 'RESUME_RECORDING': state = await service.setRecorderMode('recording'); break;
      case 'STOP_RECORDING': state = await service.setRecorderMode('none'); break;
      case 'START_INSPECTING': state = await service.setRecorderMode('inspecting'); break;
      case 'STOP_INSPECTING': state = await service.setRecorderMode('none'); break;
      case 'REPLAY': state = await service.replay(request.source, request.trace); break;
      case 'STOP_REPLAY': state = await service.stopReplay(); break;
      case 'RESET_SESSION': state = await service.detach(); break;
      case 'UPDATE_RECORDER_SETTINGS':
        state = service.snapshot();
        if (state.attachedTabId != null) {
          await service.detach();
          state = service.snapshot();
        }
        break;
    }
    return { ok: true, state };
  } catch (error) {
    return { ok: false, state: service.snapshot(), error: serializeError(error) };
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

chrome.action.onClicked.addListener((tab) => {
  void (async () => {
    await openPanel(tab.windowId);
    await service.attach(tab.id).catch(() => undefined);
  })();
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
    await service.attach(tab.id, info.menuItemId === 'automation-tool-record' ? 'recording' : 'inspecting');
  })().catch(() => undefined);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab.id || !['record', 'inspect'].includes(command)) return;
  void (async () => {
    await openPanel(tab.windowId);
    await service.attach(tab.id, command === 'record' ? 'recording' : 'inspecting');
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
