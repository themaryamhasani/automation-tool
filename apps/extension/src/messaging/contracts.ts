import type { SerializedExtensionError } from '../shared/errors';

export type SessionMode =
  | 'disconnected'
  | 'reattach-required'
  | 'attaching'
  | 'attached'
  | 'recording'
  | 'paused'
  | 'inspecting'
  | 'playing'
  | 'error';

export interface SessionState {
  mode: SessionMode;
  attachedTabId: number | null;
  tabTitle: string;
  tabUrl: string;
  active: boolean;
  canReplay: boolean;
  traceAvailable: boolean;
  lastError: SerializedExtensionError | null;
  updatedAt: string;
}

export type BackgroundRequest =
  | { type: 'GET_STATE' }
  | { type: 'ATTACH'; tabId?: number }
  | { type: 'DETACH' }
  | { type: 'START_RECORDING' }
  | { type: 'PAUSE_RECORDING' }
  | { type: 'RESUME_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'START_INSPECTING' }
  | { type: 'STOP_INSPECTING' }
  | { type: 'REPLAY'; source: string; trace: boolean }
  | { type: 'STOP_REPLAY' }
  | { type: 'RESET_SESSION' }
  | { type: 'UPDATE_RECORDER_SETTINGS'; testIdAttribute: string; slowMo: number };

export type BackgroundResponse =
  | { ok: true; state: SessionState }
  | { ok: false; state: SessionState; error: SerializedExtensionError };

export interface StateChangedMessage {
  type: 'STATE_CHANGED';
  state: SessionState;
}

export interface RecorderConnectMessage {
  type: 'RECORDER_CONNECT_REQUIRED';
}

export interface RecorderBackendMessage {
  type: 'recorder';
  method: 'setPaused' | 'setMode' | 'setSources' | 'resetCallLogs' | 'updateCallLogs' | 'setRunningFile' | 'elementPicked';
  paused?: boolean;
  mode?: string;
  sources?: unknown[];
  file?: string;
  elementInfo?: unknown;
  userGesture?: boolean;
}
