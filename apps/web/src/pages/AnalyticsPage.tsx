import { useCallback, useEffect, useState } from 'react';
import { GitCompareArrows, RefreshCw, Activity } from 'lucide-react';
import { api } from '../api';
import { PageHeader } from '../components/Layout';
import { Badge, Button, Card, EmptyState, Input, Loading, notify } from '../components/ui';
import type { Paginated } from '../types';

interface FlakyRow {
  id: string;
  projectName: string;
  testFilePath: string;
  toolKind?: string | null;
  packId?: string | null;
  flowId?: string | null;
  passCount: number;
  failCount: number;
  totalRuns: number;
  failRate: number;
  lastStatus?: string | null;
}

interface CompareResult {
  left: { id: string; status: string; durationMs?: number | null; passedTests?: number | null; failedTests?: number | null; projectName: string; testFilePath: string };
  right: { id: string; status: string; durationMs?: number | null; passedTests?: number | null; failedTests?: number | null; projectName: string; testFilePath: string };
  summary: {
    durationDeltaMs: number;
    failedDelta: number;
    passedDelta: number;
    changedTests: number;
    newFail?: number;
    stillFail?: number;
    fixed?: number;
  };
  diffs: Array<{ title: string; change?: string; leftOutcome: string | null; rightOutcome: string | null; path?: string | null }>;
}

export function AnalyticsPage() {
  const [rows, setRows] = useState<FlakyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [compare, setCompare] = useState<CompareResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await api<Paginated<FlakyRow>>('/api/analytics/flaky?limit=50');
      setRows(page.data);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'بارگذاری flaky ناموفق بود.', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function refreshStats() {
    setBusy(true);
    try {
      await api('/api/analytics/flaky/refresh', { method: 'POST', body: '{}' });
      notify('آمار flaky بازمحاسبه شد.', 'success');
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'بازمحاسبه ناموفق بود.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function runCompare() {
    if (!leftId.trim() || !rightId.trim()) { notify('دو شناسه اجرا لازم است.', 'error'); return; }
    setBusy(true);
    try {
      setCompare(await api<CompareResult>(`/api/analytics/runs/compare?leftId=${encodeURIComponent(leftId.trim())}&rightId=${encodeURIComponent(rightId.trim())}`));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'مقایسه ناموفق بود.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return <div className="min-h-screen bg-gray-50">
    <PageHeader
      title="تحلیل کیفیت"
      subtitle="تست‌های flaky و مقایسه دو اجرا"
      refreshing={loading}
      onRefresh={() => void load()}
      actions={<Button loading={busy} icon={<RefreshCw className="h-4 w-4" />} onClick={() => void refreshStats()}>بازمحاسبه flaky</Button>}
    />
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <Card>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-rose-600"><Activity className="h-5 w-5" /></div>
          <div>
            <h2 className="font-semibold text-gray-900">اهداف مشکوک به flaky</h2>
            <p className="mt-1 text-xs text-gray-500">هم پاس و هم فیل در بازه اجراهای ثبت‌شده</p>
          </div>
        </div>
        {loading ? <Loading /> : rows.length === 0 ? <EmptyState text="هنوز هدف flakyی ثبت نشده است. پس از چند اجرا، بازمحاسبه کنید." /> : (
          <div className="space-y-2">
            {rows.map(row => (
              <div key={row.id} className="rounded-xl border border-gray-200 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-gray-900" dir="ltr">{row.testFilePath}</div>
                    <div className="mt-1 text-xs text-gray-500">{row.projectName} · {row.toolKind || '—'} · {row.packId || '—'}/{row.flowId || '—'}</div>
                  </div>
                  <Badge tone={row.failRate >= 0.5 ? 'red' : 'amber'}>{(row.failRate * 100).toFixed(0)}% fail</Badge>
                </div>
                <div className="mt-2 text-xs text-gray-500">pass {row.passCount} / fail {row.failCount} از {row.totalRuns} · آخرین: {row.lastStatus || '—'}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><GitCompareArrows className="h-5 w-5" /></div>
          <div>
            <h2 className="font-semibold text-gray-900">مقایسه دو اجرا</h2>
            <p className="mt-1 text-xs text-gray-500">اختلاف مدت، پاس/فیل و تست‌های تغییرکرده</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Run چپ (پایه)" value={leftId} onChange={event => setLeftId(event.target.value)} dir="ltr" placeholder="uuid" />
          <Input label="Run راست (جدید)" value={rightId} onChange={event => setRightId(event.target.value)} dir="ltr" placeholder="uuid" />
        </div>
        <div className="mt-4 flex justify-end"><Button loading={busy} onClick={() => void runCompare()}>مقایسه</Button></div>
        {compare ? (
          <div className="mt-5 space-y-3">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 text-sm">
              <div className="rounded-xl bg-gray-100 p-3">Δ مدت: {compare.summary.durationDeltaMs} ms</div>
              <div className="rounded-xl bg-gray-100 p-3">Δ فیل: {compare.summary.failedDelta}</div>
              <div className="rounded-xl bg-gray-100 p-3">تست تغییرکرده: {compare.summary.changedTests}</div>
              <div className="rounded-xl bg-red-50 p-3 text-red-700">رگرسیون: {compare.summary.newFail ?? 0}</div>
              <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700">رفع: {compare.summary.fixed ?? 0}</div>
              <div className="rounded-xl bg-amber-50 p-3 text-amber-800">هنوز باز: {compare.summary.stillFail ?? 0}</div>
            </div>
            <div className="text-xs text-gray-500" dir="ltr">{compare.left.id} ({compare.left.status}) vs {compare.right.id} ({compare.right.status})</div>
            {compare.diffs.length === 0 ? <EmptyState text="اختلاف تستی بین دو گزارش نیست." /> : compare.diffs.slice(0, 40).map(diff => (
              <div key={diff.title} className="rounded-xl border border-gray-200 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-gray-900">{diff.title}</div>
                  {'change' in diff && diff.change ? <Badge tone={diff.change === 'new_fail' ? 'red' : diff.change === 'fixed' ? 'green' : 'amber'}>{String(diff.change)}</Badge> : null}
                </div>
                <div className="mt-1 text-xs text-gray-500" dir="ltr">{diff.leftOutcome || '—'} → {diff.rightOutcome || '—'}</div>
              </div>
            ))}
          </div>
        ) : null}
      </Card>
    </main>
  </div>;
}
