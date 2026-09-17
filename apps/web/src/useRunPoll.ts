import { useEffect, useRef } from 'react';
import { api, runEventsUrl } from './api';
import type { Run } from './types';

const LIVE = new Set(['PREPARING', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED']);

export function normalizeRun(row: Record<string, unknown> | Run): Run {
  const value = row as Record<string, any>;
  return {
    ...value,
    toolKind: value.toolKind || value.tool_kind || null,
    packId: value.packId || value.pack_id || null,
    flowId: value.flowId || value.flow_id || null,
    toolTarget: value.toolTarget || value.tool_target || null,
    testFilePath: value.testFilePath || value.test_file_path || '',
    sourceApproach: value.sourceApproach || value.source_approach || null,
    reportPaths: value.reportPaths || value.report_paths || null,
    passedTests: value.passedTests ?? value.passed_tests ?? null,
    failedTests: value.failedTests ?? value.failed_tests ?? null,
    skippedTests: value.skippedTests ?? value.skipped_tests ?? null,
    totalTests: value.totalTests ?? value.total_tests ?? null,
  } as Run;
}

/**
 * Keep one EventSource per live run id. Callback identity must not reopen the
 * stream — RunsPage passes an inline setter that would otherwise reconnect forever.
 */
export function useRunPoll(lastRun: Run | null, setLastRun: (run: Run) => void) {
  const setRef = useRef(setLastRun);
  setRef.current = setLastRun;

  useEffect(() => {
    if (!lastRun || !LIVE.has(lastRun.status)) return undefined;
    const runId = lastRun.id;
    let cancelled = false;
    let errorFallbackAt = 0;
    const apply = (row: Run) => {
      if (!cancelled) setRef.current(normalizeRun(row));
    };
    const source = new EventSource(runEventsUrl(runId), { withCredentials: true });
    source.onmessage = event => {
      try { apply(JSON.parse(event.data) as Run); } catch { /* ignore malformed frames */ }
    };
    source.onerror = () => {
      // EventSource auto-reconnects; only fall back to REST occasionally.
      const now = Date.now();
      if (now - errorFallbackAt < 5_000) return;
      errorFallbackAt = now;
      api<Run>(`/api/runs/${runId}`).then(apply).catch(() => undefined);
    };
    return () => {
      cancelled = true;
      source.close();
    };
  }, [lastRun?.id, lastRun?.status]);
}
