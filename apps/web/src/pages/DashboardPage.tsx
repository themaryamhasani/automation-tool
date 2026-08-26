import { useEffect, useState } from 'react';
import { Activity, Cpu, GitBranch, Radio, Server } from 'lucide-react';
import { opsEventsUrl } from '../api';
import { PageHeader } from '../components/Layout';
import { Badge, Card, EmptyState, Loading, notify } from '../components/ui';

interface OpsSnapshot {
  time: string;
  queue: { preparing: number; queued: number; running: number; cancelRequested: number };
  snapshots: { pending: number; materializing: number; ready: number };
  runner: { enabled: boolean; staleRunning: number };
  fleet: {
    online: number;
    runners: Array<{
      runnerId: string;
      hostname?: string;
      tags: string[];
      concurrency: number;
      activeRuns: number;
      lastSeenAt: string;
    }>;
  };
  cdeConnectivity: { activeSessions: number; expiredSessions: number };
  sourceConnections: Record<string, number>;
  recentRuns: Array<{
    id: string;
    status: string;
    toolKind?: string;
    priority?: number;
    runnerId?: string | null;
    commitSha?: string | null;
    gateStatus?: string | null;
    projectName: string;
    requestedAt: string;
  }>;
}

export function DashboardPage() {
  const [snapshot, setSnapshot] = useState<OpsSnapshot | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const source = new EventSource(opsEventsUrl(), { withCredentials: true });
    source.addEventListener('ops', (event) => {
      try {
        setSnapshot(JSON.parse((event as MessageEvent).data));
        setLive(true);
        setError('');
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'خواندن snapshot ناموفق بود.');
      }
    });
    source.addEventListener('error', () => {
      setLive(false);
      setError('اتصال زنده قطع شد؛ در حال تلاش مجدد…');
    });
    source.onerror = () => setLive(false);
    return () => source.close();
  }, []);

  useEffect(() => {
    if (error) notify(error, 'error');
  }, [error]);

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        title="داشبورد عملیات"
        subtitle="صف اجرا، ناوگان Runner و اتصال CDE به‌صورت زنده"
        actions={<Badge tone={live ? 'green' : 'amber'}>{live ? 'SSE زنده' : 'قطع'}</Badge>}
      />
      <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        {!snapshot ? <Loading text="در حال دریافت وضعیت عملیات…" /> : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Activity className="h-5 w-5" /></div>
                  <div>
                    <p className="text-xs text-gray-500">صف / در حال اجرا</p>
                    <p className="text-xl font-bold text-gray-900">{snapshot.queue.queued} / {snapshot.queue.running}</p>
                  </div>
                </div>
              </Card>
              <Card>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><Cpu className="h-5 w-5" /></div>
                  <div>
                    <p className="text-xs text-gray-500">Runner آنلاین</p>
                    <p className="text-xl font-bold text-gray-900">{snapshot.fleet.online}</p>
                  </div>
                </div>
              </Card>
              <Card>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600"><Radio className="h-5 w-5" /></div>
                  <div>
                    <p className="text-xs text-gray-500">نشست CDE فعال</p>
                    <p className="text-xl font-bold text-gray-900">{snapshot.cdeConnectivity.activeSessions}</p>
                  </div>
                </div>
              </Card>
              <Card>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><GitBranch className="h-5 w-5" /></div>
                  <div>
                    <p className="text-xs text-gray-500">Snapshot آماده</p>
                    <p className="text-xl font-bold text-gray-900">{snapshot.snapshots.ready}</p>
                  </div>
                </div>
              </Card>
            </div>

            <Card>
              <div className="mb-4 flex items-center gap-3">
                <Server className="h-5 w-5 text-gray-500" />
                <h2 className="font-semibold text-gray-900">ناوگان Runner</h2>
                <Badge tone={snapshot.runner.enabled ? 'green' : 'red'}>{snapshot.runner.enabled ? 'فعال' : 'غیرفعال'}</Badge>
              </div>
              {snapshot.fleet.runners.length === 0 ? <EmptyState text="هنوز Runner زنده‌ای دیده نشده است." /> : (
                <div className="space-y-2">
                  {snapshot.fleet.runners.map(runner => (
                    <div key={runner.runnerId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm">
                      <div>
                        <div className="font-medium text-gray-900" dir="ltr">{runner.runnerId}</div>
                        <div className="mt-1 text-xs text-gray-500" dir="ltr">{runner.hostname || '—'} · tags: {(runner.tags || []).join(',') || 'none'}</div>
                      </div>
                      <div className="text-xs text-gray-600">active {runner.activeRuns}/{runner.concurrency}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <h2 className="mb-4 font-semibold text-gray-900">اجراهای اخیر صف/اتمام</h2>
              {snapshot.recentRuns.length === 0 ? <EmptyState text="اجرایی در بازه اخیر نیست." /> : (
                <div className="space-y-2">
                  {snapshot.recentRuns.map(run => (
                    <div key={run.id} className="rounded-xl border border-gray-200 px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium text-gray-900">{run.projectName} · {run.toolKind || '—'}</div>
                        <div className="flex gap-2">
                          <Badge tone={run.status === 'PASSED' ? 'green' : run.status === 'RUNNING' || run.status === 'QUEUED' ? 'amber' : 'red'}>{run.status}</Badge>
                          {run.gateStatus ? <Badge tone={run.gateStatus === 'PASSED' ? 'green' : 'red'}>gate {run.gateStatus}</Badge> : null}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-gray-500" dir="ltr">
                        {run.id.slice(0, 8)} · priority {run.priority ?? 0} · sha {run.commitSha?.slice(0, 8) || '—'} · runner {run.runnerId || '—'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <h2 className="mb-3 font-semibold text-gray-900">اتصالات منبع</h2>
              <div className="flex flex-wrap gap-2 text-sm">
                {Object.keys(snapshot.sourceConnections).length === 0
                  ? <span className="text-gray-500">اتصال فعالی ثبت نشده است.</span>
                  : Object.entries(snapshot.sourceConnections).map(([provider, total]) => (
                    <Badge key={provider} tone="amber">{provider}: {total}</Badge>
                  ))}
              </div>
              <p className="mt-3 text-xs text-gray-400" dir="ltr">updated {snapshot.time}</p>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
