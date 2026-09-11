import type { SessionState } from '../messaging/contracts';
import { ExtensionError, serializeError } from '../shared/errors';

export function createInitialSessionState(now = new Date()): SessionState {
  return {
    mode: 'disconnected',
    attachedTabId: null,
    tabTitle: '',
    tabUrl: '',
    active: false,
    canReplay: false,
    traceAvailable: false,
    lastError: null,
    updatedAt: now.toISOString(),
  };
}

export function recoverSessionState(previous: SessionState | undefined, now = new Date()): SessionState {
  if (previous?.attachedTabId == null && previous?.mode !== 'recording' && previous?.mode !== 'playing') {
    return createInitialSessionState(now);
  }
  return {
    ...(previous || createInitialSessionState(now)),
    mode: 'reattach-required',
    active: false,
    canReplay: false,
    traceAvailable: false,
    lastError: serializeError(new ExtensionError('REATTACH_REQUIRED')),
    updatedAt: now.toISOString(),
  };
}
