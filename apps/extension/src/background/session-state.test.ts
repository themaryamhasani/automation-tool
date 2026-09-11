import { describe, expect, it } from 'vitest';
import type { SessionState } from '../messaging/contracts';
import { createInitialSessionState, recoverSessionState } from './session-state';

const instant = new Date('2026-09-11T10:00:00.000Z');

describe('service-worker session recovery', () => {
  it('starts disconnected without claiming a browser attachment', () => {
    expect(createInitialSessionState(instant)).toMatchObject({
      mode: 'disconnected',
      attachedTabId: null,
      active: false,
      canReplay: false,
      updatedAt: instant.toISOString(),
    });
  });

  it('requires an explicit reattach after a worker restart', () => {
    const previous: SessionState = {
      ...createInitialSessionState(),
      mode: 'recording',
      attachedTabId: 42,
      active: true,
      canReplay: true,
      traceAvailable: true,
    };
    expect(recoverSessionState(previous, instant)).toMatchObject({
      mode: 'reattach-required',
      attachedTabId: 42,
      active: false,
      canReplay: false,
      traceAvailable: false,
      lastError: { code: 'REATTACH_REQUIRED' },
    });
  });
});
