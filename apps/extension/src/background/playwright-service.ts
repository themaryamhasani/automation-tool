import { crx, type CrxApplication, type Page } from 'playwright-crx';
import type { SessionMode, SessionState } from '../messaging/contracts';
import { RECORDER_LANGUAGE, isAttachableUrl } from '../shared/constants';
import { ExtensionError, redactLogText, serializeError, toExtensionError } from '../shared/errors';
import { loadSettings } from '../storage/settings';
import { createInitialSessionState, recoverSessionState } from './session-state';

const TRACE_PATH = '/tmp/automation-tool-trace.zip';
const TRACE_DOWNLOAD_DOCUMENT = 'trace-download.html';
const TRACE_CHUNK_BYTES = 64 * 1024;

interface TraceDownloadResponse {
  ok: boolean;
  downloadId?: number;
  objectUrl?: string;
  message?: string;
}

async function ensureTraceDownloadDocument(): Promise<void> {
  if (!await chrome.offscreen.hasDocument()) {
    await chrome.offscreen.createDocument({
      url: TRACE_DOWNLOAD_DOCUMENT,
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: 'Create a local Blob URL for a Playwright trace download.',
    });
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await chrome.runtime.sendMessage({ type: 'TRACE_DOWNLOAD_PING' }).catch(() => undefined) as TraceDownloadResponse | undefined;
    if (response?.ok) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new ExtensionError('REPLAY_FAILED', 'The trace download worker did not become ready.');
}

function base64Chunk(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

export class PlaywrightService {
  private appPromise: Promise<CrxApplication> | null = null;
  private app: CrxApplication | null = null;
  private page: Page | null = null;
  private state: SessionState = createInitialSessionState();
  private operation = 0;
  private closing = false;
  private initialized: Promise<void>;

  constructor() {
    this.initialized = this.restoreState();
  }

  private async restoreState(): Promise<void> {
    const stored = await chrome.storage.session.get('automationTool.session.v1');
    const previous = stored['automationTool.session.v1'] as SessionState | undefined;
    if (previous?.attachedTabId != null || previous?.mode === 'recording' || previous?.mode === 'playing') {
      this.state = recoverSessionState(previous);
      await this.persistAndBroadcast();
    }
  }

  snapshot(): SessionState {
    return { ...this.state, lastError: this.state.lastError ? { ...this.state.lastError } : null };
  }

  private async update(patch: Partial<SessionState>): Promise<SessionState> {
    this.state = { ...this.state, ...patch, updatedAt: new Date().toISOString() };
    await this.persistAndBroadcast();
    return this.snapshot();
  }

  private async persistAndBroadcast(): Promise<void> {
    await chrome.storage.session.set({ 'automationTool.session.v1': this.state });
    await chrome.runtime.sendMessage({ type: 'STATE_CHANGED', state: this.snapshot() }).catch(() => undefined);
    await this.updateBadge();
  }

  private async updateBadge(): Promise<void> {
    const tabId = this.state.attachedTabId ?? undefined;
    const mode = this.state.mode;
    const badge = mode === 'recording' ? 'REC' : mode === 'inspecting' ? 'INS' : mode === 'playing' ? 'RUN' : '';
    const color = mode === 'recording' ? '#dc2626' : mode === 'inspecting' ? '#2563eb' : '#7c3aed';
    await Promise.all([
      chrome.action.setBadgeText({ text: badge, tabId }),
      badge ? chrome.action.setBadgeBackgroundColor({ color, tabId }) : Promise.resolve(),
      chrome.action.setTitle({ title: badge ? `Automation Tool · ${mode}` : 'Open Automation Tool Recorder', tabId }),
    ]).catch(() => undefined);
  }

  private async getApp(): Promise<CrxApplication> {
    if (this.app) return this.app;
    if (!this.appPromise) {
      const settings = await loadSettings();
      this.appPromise = crx.start({ slowMo: settings.slowMo }).then((app) => {
        this.app = app;
        app.on('detached', (tabId) => {
          console.warn(JSON.stringify({ event: 'playwright-crx-detached', tabId, closing: this.closing }));
          if (!this.closing && tabId === this.state.attachedTabId) {
            this.page = null;
            void this.update({
              mode: 'reattach-required',
              active: false,
              canReplay: false,
              lastError: serializeError(new ExtensionError('REATTACH_REQUIRED', 'Playwright released the tab debugger. Reattach the tab to continue.')),
            });
          }
        });
        app.recorder.on('modechanged', ({ mode }) => {
          const next = this.sessionMode(mode);
          if (!['playing', 'error', 'disconnected', 'reattach-required'].includes(this.state.mode)) {
            void this.update({ mode: next, lastError: null });
          }
        });
        app.recorder.on('hide', () => {
          if (!this.closing) void this.detach();
        });
        return app;
      }).catch((error) => {
        this.appPromise = null;
        throw error;
      });
    }
    return this.appPromise;
  }

  private sessionMode(mode: string): SessionMode {
    if (mode === 'recording' || mode.startsWith('asserting')) return 'recording';
    if (mode === 'inspecting' || mode === 'recording-inspecting') return 'inspecting';
    if (mode === 'standby') return 'paused';
    return this.page ? 'attached' : 'disconnected';
  }

  private async attachedPage(): Promise<{ app: CrxApplication; page: Page }> {
    await this.initialized;
    if (!this.page || !this.app || this.state.attachedTabId == null) throw new ExtensionError('REATTACH_REQUIRED');
    return { app: this.app, page: this.page };
  }

  async attach(tabId?: number, mode: 'none' | 'recording' | 'inspecting' = 'none'): Promise<SessionState> {
    await this.initialized;
    const tab = tabId == null
      ? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
      : await chrome.tabs.get(tabId);
    if (!tab?.id || !isAttachableUrl(tab.url)) throw new ExtensionError('UNSUPPORTED_PAGE');
    if (this.page && this.state.attachedTabId === tab.id) {
      if (mode !== 'none') await this.setRecorderMode(mode);
      return this.update({ tabTitle: tab.title || '', tabUrl: tab.url || '', active: tab.active, lastError: null });
    }
    if (this.page || this.app) await this.detach();

    await this.update({
      mode: 'attaching',
      attachedTabId: tab.id,
      tabTitle: tab.title || '',
      tabUrl: tab.url || '',
      active: tab.active,
      canReplay: false,
      traceAvailable: false,
      lastError: null,
    });
    try {
      const settings = await loadSettings();
      const app = await this.getApp();
      if (app.recorder.isHidden()) {
        const showing = app.recorder.show({
          language: RECORDER_LANGUAGE,
          mode,
          testIdAttributeName: settings.testIdAttribute,
          window: { type: 'sidepanel', url: 'sidepanel.html' },
        });
        await chrome.runtime.sendMessage({ type: 'RECORDER_CONNECT_REQUIRED' }).catch(() => undefined);
        await showing;
      }
      this.page = await app.attach(tab.id);
      this.page.on('close', () => {
        if (!this.closing && this.state.attachedTabId === tab.id) void this.tabClosed(tab.id!);
      });
      return this.update({ mode: this.sessionMode(app.recorder.mode()), canReplay: true, lastError: null });
    } catch (error) {
      this.page = null;
      await this.closeApplication();
      const normalized = toExtensionError(error, 'ATTACH_FAILED');
      await this.update({ mode: 'error', active: false, canReplay: false, lastError: serializeError(normalized) });
      throw normalized;
    }
  }

  async setRecorderMode(mode: 'none' | 'recording' | 'inspecting' | 'standby'): Promise<SessionState> {
    const { app } = await this.attachedPage();
    try {
      await app.recorder.setMode(mode);
      return this.update({ mode: this.sessionMode(mode), lastError: null });
    } catch (error) {
      const normalized = toExtensionError(error, 'RECORDER_FAILED');
      await this.update({ mode: 'error', lastError: serializeError(normalized) });
      throw normalized;
    }
  }

  async replay(source: string, withTrace: boolean): Promise<SessionState> {
    const { app, page } = await this.attachedPage();
    if (this.state.mode === 'recording') throw new ExtensionError('REPLAY_FAILED', 'Stop recording before local replay.');
    const currentOperation = ++this.operation;
    await this.update({ mode: 'playing', traceAvailable: false, lastError: null });
    let traceStarted = false;
    let failure: ExtensionError | null = null;
    try {
      if (withTrace) {
        await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
        traceStarted = true;
      }
      await app.recorder.load(source);
      // playwright-crx 0.15.0's optional Page argument crosses its bundled client/server
      // type realms. With one attached tab, letting the native player select context.pages()[0]
      // avoids that incompatibility and remains deterministic.
      await app.recorder.run(source);
    } catch (error) {
      if (currentOperation === this.operation) {
        console.error(JSON.stringify({
          event: 'extension-replay-failed',
          message: redactLogText(error instanceof Error ? error.message : String(error)),
        }));
        const detail = redactLogText(error instanceof Error ? error.message : String(error));
        failure = new ExtensionError('REPLAY_FAILED', detail ? `Local replay failed: ${detail}` : undefined);
        await this.update({ mode: 'error', lastError: serializeError(failure) });
      }
    }
    if (traceStarted) {
      try {
        await page.context().tracing.stop({ path: TRACE_PATH });
        await this.downloadTrace();
        if (currentOperation === this.operation) await this.update({ traceAvailable: true });
      } catch (traceError) {
        if (currentOperation === this.operation && !failure) {
          failure = toExtensionError(traceError, 'REPLAY_FAILED');
          await this.update({ mode: 'error', lastError: serializeError(failure) });
        }
      }
    }
    if (currentOperation !== this.operation) return this.snapshot();
    if (failure) throw failure;
    return this.update({ mode: 'attached', traceAvailable: withTrace, lastError: null });
  }

  private async downloadTrace(): Promise<void> {
    const raw = crx.fs.readFileSync(TRACE_PATH);
    const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : new Uint8Array(raw as ArrayBufferLike);
    if (!bytes.length) throw new ExtensionError('REPLAY_FAILED', 'Playwright produced an empty trace.');
    await ensureTraceDownloadDocument();
    const filename = `automation-tool/trace-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    const started = await chrome.runtime.sendMessage({ type: 'TRACE_DOWNLOAD_START', filename }) as TraceDownloadResponse | undefined;
    if (!started?.ok) throw new ExtensionError('REPLAY_FAILED', started?.message || 'The trace download could not start.');
    for (let index = 0; index < bytes.length; index += TRACE_CHUNK_BYTES) {
      const received = await chrome.runtime.sendMessage({
        type: 'TRACE_DOWNLOAD_CHUNK',
        base64: base64Chunk(bytes.subarray(index, Math.min(index + TRACE_CHUNK_BYTES, bytes.length))),
      }) as TraceDownloadResponse | undefined;
      if (!received?.ok) throw new ExtensionError('REPLAY_FAILED', received?.message || 'A trace chunk could not be transferred.');
    }
    const response = await chrome.runtime.sendMessage({ type: 'TRACE_DOWNLOAD_FINISH' }) as TraceDownloadResponse | undefined;
    if (!response?.ok || !response.objectUrl) throw new ExtensionError('REPLAY_FAILED', response?.message || 'Chrome could not prepare the trace download.');
    const downloadId = await chrome.downloads.download({ url: response.objectUrl, filename, saveAs: false });
    await chrome.runtime.sendMessage({ type: 'TRACE_DOWNLOAD_TRACK', downloadId });
    const [download] = await chrome.downloads.search({ id: downloadId });
    if (download && ['complete', 'interrupted'].includes(download.state)) {
      await chrome.runtime.sendMessage({ type: 'TRACE_DOWNLOAD_CLEANUP', downloadId }).catch(() => undefined);
      if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
    }
  }

  async stopReplay(): Promise<SessionState> {
    this.operation += 1;
    await this.closeApplication();
    return this.update({
      mode: 'reattach-required',
      active: false,
      canReplay: false,
      lastError: serializeError(new ExtensionError('REATTACH_REQUIRED', 'Replay stopped. Reattach the tab before continuing.')),
    });
  }

  async detach(): Promise<SessionState> {
    await this.initialized;
    this.operation += 1;
    await this.closeApplication();
    return this.update(createInitialSessionState());
  }

  private async closeApplication(): Promise<void> {
    const app = this.app || (this.appPromise ? await this.appPromise.catch(() => null) : null);
    this.closing = true;
    try {
      if (app) await app.close().catch(() => undefined);
    } finally {
      this.page = null;
      this.app = null;
      this.appPromise = null;
      this.closing = false;
    }
  }

  async tabClosed(tabId: number): Promise<void> {
    if (this.closing || this.state.attachedTabId !== tabId) return;
    this.operation += 1;
    await this.closeApplication();
    await this.update({
      mode: 'error',
      active: false,
      canReplay: false,
      lastError: serializeError(new ExtensionError('TAB_CLOSED')),
    });
  }

  async tabUpdated(tabId: number, tab: chrome.tabs.Tab): Promise<void> {
    if (this.state.attachedTabId !== tabId) return;
    if (tab.url && !isAttachableUrl(tab.url)) {
      await this.closeApplication();
      await this.update({ mode: 'error', active: false, canReplay: false, tabUrl: tab.url, lastError: serializeError(new ExtensionError('UNSUPPORTED_PAGE')) });
      return;
    }
    await this.update({ tabTitle: tab.title ?? this.state.tabTitle, tabUrl: tab.url ?? this.state.tabUrl, active: tab.active });
  }

  async activeTabChanged(tabId: number): Promise<void> {
    if (this.state.attachedTabId == null) return;
    await this.update({ active: tabId === this.state.attachedTabId });
  }

  async debuggerDetached(tabId: number, reason?: string): Promise<void> {
    console.warn(JSON.stringify({ event: 'chrome-debugger-detached', tabId, reason: reason || 'unknown', closing: this.closing }));
    if (this.closing || this.state.attachedTabId !== tabId) return;
    this.page = null;
    this.app = null;
    this.appPromise = null;
    const detail = reason && reason !== 'unknown' ? ` (${reason.replace(/_/g, ' ')})` : '';
    await this.update({
      mode: 'reattach-required',
      active: false,
      canReplay: false,
      lastError: serializeError(new ExtensionError('REATTACH_REQUIRED', `Chrome detached the tab debugger${detail}. Reattach to continue.`)),
    });
  }
}
