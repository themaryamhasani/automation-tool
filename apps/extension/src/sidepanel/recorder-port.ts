import type { RecorderBackendMessage } from '../messaging/contracts';

export interface RecorderPortCallbacks {
  onMessage: (message: RecorderBackendMessage) => void;
  onConnectionChange: (connected: boolean) => void;
}

export class RecorderPortClient {
  private port: chrome.runtime.Port | null = null;
  private retry: number | null = null;
  private stopped = false;

  constructor(private readonly callbacks: RecorderPortCallbacks) {}

  connect(): void {
    if (this.stopped) return;
    if (this.retry != null) {
      window.clearTimeout(this.retry);
      this.retry = null;
    }
    this.disconnect(false);
    try {
      const port = chrome.runtime.connect({ name: 'recorder' });
      this.port = port;
      port.onMessage.addListener((message: unknown) => {
        if (message && typeof message === 'object' && (message as { type?: string }).type === 'recorder') {
          this.callbacks.onConnectionChange(true);
          this.callbacks.onMessage(message as RecorderBackendMessage);
        }
      });
      port.onDisconnect.addListener(() => {
        if (this.port !== port) return;
        this.port = null;
        this.callbacks.onConnectionChange(false);
        this.scheduleRetry();
      });
    } catch {
      this.callbacks.onConnectionChange(false);
      this.scheduleRetry();
    }
  }

  reconnect(): void {
    this.connect();
  }

  dispatch(event: string, params: Record<string, unknown> = {}): void {
    this.port?.postMessage({ type: 'recorderEvent', event, params });
  }

  stop(): void {
    this.stopped = true;
    this.disconnect(true);
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retry != null) return;
    this.retry = window.setTimeout(() => {
      this.retry = null;
      this.connect();
    }, 800);
  }

  private disconnect(cancelRetry: boolean): void {
    if (cancelRetry && this.retry != null) window.clearTimeout(this.retry);
    if (cancelRetry) this.retry = null;
    const port = this.port;
    this.port = null;
    if (port) {
      try { port.disconnect(); } catch { /* already disconnected */ }
    }
  }
}
