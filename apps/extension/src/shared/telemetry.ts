export type TelemetryEvent =
  | 'recording_started'
  | 'recording_finished'
  | 'local_test_started'
  | 'local_test_finished'
  | 'validation_failed'
  | 'test_saved'
  | 'save_and_run_started'
  | 'extension_error';

type SafeTelemetry = {
  durationSeconds?: number;
  errorCode?: string;
  issueCount?: number;
  passed?: boolean;
  stepCount?: number;
};

const allowedErrorCode = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Emits local, content-free lifecycle diagnostics. These events deliberately omit
 * URLs, titles, source, locators, user/project identifiers, and credential data.
 */
export function recordTelemetry(event: TelemetryEvent, metadata: SafeTelemetry = {}): void {
  const safe: SafeTelemetry = {};
  if (Number.isFinite(metadata.durationSeconds)) safe.durationSeconds = Math.max(0, Math.round(metadata.durationSeconds || 0));
  if (Number.isFinite(metadata.issueCount)) safe.issueCount = Math.max(0, Math.round(metadata.issueCount || 0));
  if (Number.isFinite(metadata.stepCount)) safe.stepCount = Math.max(0, Math.round(metadata.stepCount || 0));
  if (typeof metadata.passed === 'boolean') safe.passed = metadata.passed;
  if (metadata.errorCode && allowedErrorCode.test(metadata.errorCode)) safe.errorCode = metadata.errorCode;

  console.info('[automation-recorder]', { event, ...safe });
}
