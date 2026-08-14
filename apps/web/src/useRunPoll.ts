import { useEffect } from 'react';
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

export function useRunPoll(lastRun: Run | null, setLastRun: (run: Run) => void) {
  useEffect(() => {
    if (!lastRun || !LIVE.has(lastRun.status)) return;
    let cancelled = false;
    const apply = (row: Run) => {
      if (!cancelled) setLastRun(normalizeRun(row));
    };
    const source = new EventSource(runEventsUrl(lastRun.id), { withCredentials: true });
    source.onmessage = event => {
      try { apply(JSON.parse(event.data) as Run); } catch { /* ignore malformed frames */ }
    };
    source.onerror = () => {
      api<Run>(`/api/runs/${lastRun.id}`).then(apply).catch(() => undefined);
    };
    return () => {
      cancelled = true;
      source.close();
    };
  }, [lastRun?.id, lastRun?.status, setLastRun]);
}
