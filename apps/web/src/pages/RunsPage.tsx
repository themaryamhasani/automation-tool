import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CheckCircle2, Download, Eye, FileCode2, LoaderCircle, Play, Search, Square, Terminal, XCircle,
} from 'lucide-react';
import { api, downloadArtifact, runEventsUrl } from '../api';
import { useAuth } from '../auth';
import { PageHeader } from '../components/Layout';
import { RunReportPanel } from '../components/RunReportPanel';
import { Badge, Button, Card, EmptyState, Input, Loading, Modal, Pagination, Select, StatCard, notify } from '../components/ui';
import type { BrowserProject, Paginated, Project, Run, RunStatus } from '../types';
import { useRunPoll } from '../useRunPoll';

const statusLabels: Record<RunStatus, string> = {
  PREPARING: 'ساخت Snapshot CDE', QUEUED: 'در صف', RUNNING: 'در حال اجرا', PASSED: 'موفق', FAILED: 'ناموفق', ERROR: 'خطا',
  CANCEL_REQUESTED: 'در حال لغو', CANCELLED: 'لغوشده',
};
const statusTones: Record<RunStatus, 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'purple'> = {
  PREPARING: 'purple', QUEUED: 'amber', RUNNING: 'blue', PASSED: 'green', FAILED: 'red', ERROR: 'red', CANCEL_REQUESTED: 'purple', CANCELLED: 'gray',
};
const browserLabels: Record<BrowserProject, string> = { chromium: 'Chromium', firefox: 'Firefox', webkit: 'WebKit' };

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString('fa-IR') : '—';
}
function formatDuration(value?: number | null) {
  if (value == null) return '—';
  if (value < 1000) return `${value.toLocaleString('fa-IR')} ms`;
  return `${(value / 1000).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} ثانیه`;
}

export function RunsPage() {
  const { user } = useAuth();
  const canWrite = user?.role !== 'VIEWER';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(localStorage.getItem('automation-active-project') || '');
  const [data, setData] = useState<Paginated<Run> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState<Run | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [previousRun, setPreviousRun] = useState<{
    id: string;
    status: string;
    failedTests?: number | null;
  } | null>(null);
  const [deltaWorse, setDeltaWorse] = useState(false);

  const loadProjects = useCallback(async () => {
    const rows = await api<Project[]>('/api/projects');
    const active = rows.filter(row => row.isActive);
    setProjects(active);
    setProjectId(current => {
      const next = active.some(row => row.id === current) ? current : active[0]?.id || '';
      if (next) localStorage.setItem('automation-active-project', next);
      return next;
    });
  }, []);

  const loadRuns = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(page), limit: '10' });
      if (projectId) query.set('projectId', projectId);
      if (search.trim()) query.set('search', search.trim());
      if (status) query.set('status', status);
      const response = await api<Paginated<Run>>(`/api/runs?${query}`);
      setData(response);
      if (detail) {
        const fresh = response.data.find(run => run.id === detail.id);
        if (fresh) setDetail(fresh);
      }
    } catch (error) { if (!quiet) notify(error instanceof Error ? error.message : 'بارگذاری اجراها ناموفق بود.', 'error'); }
    finally { if (!quiet) setLoading(false); }
  }, [page, projectId, search, status, detail?.id]);

  useEffect(() => { void loadProjects().catch(error => notify(error.message, 'error')); }, [loadProjects]);
  useEffect(() => { void loadRuns(); }, [page, projectId, status]);
  useEffect(() => {
    const runId = searchParams.get('runId');
    if (!runId) return;
    void api<Run>(`/api/runs/${encodeURIComponent(runId)}`)
      .then(run => { setDetail(run); setProjectId(run.projectId); localStorage.setItem('automation-active-project', run.projectId); })
      .catch(error => notify(error instanceof Error ? error.message : 'اجرای لینک‌شده پیدا نشد.', 'error'));
  }, [searchParams]);
  useEffect(() => {
    const timer = window.setTimeout(() => { setPage(1); void loadRuns(); }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);
  useRunPoll(detail && ['PREPARING', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(detail.status) ? detail : null, run => setDetail(run));
  useEffect(() => {
    if (!detail?.id || ['PREPARING', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(detail.status)) {
      setPreviousRun(null);
      setDeltaWorse(false);
      return;
    }
    let cancelled = false;
    api<{ previousRun: typeof previousRun; delta: { summary: { regressionCount: number } } }>(
      `/api/runs/${encodeURIComponent(detail.id)}/delta`,
    )
      .then(payload => {
        if (cancelled) return;
        setPreviousRun(payload.previousRun);
        setDeltaWorse((payload.delta?.summary?.regressionCount || 0) > 0);
      })
      .catch(() => {
        if (cancelled) return;
        setPreviousRun(null);
        setDeltaWorse(false);
      });
    return () => { cancelled = true; };
  }, [detail?.id, detail?.status, detail?.completedAt]);
  useEffect(() => {
    const live = data?.data.find(run => ['PREPARING', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(run.status));
    if (!live) return undefined;
    const source = new EventSource(runEventsUrl(live.id), { withCredentials: true });
    source.onmessage = () => { void loadRuns(true); };
    const onVis = () => { if (document.visibilityState === 'visible') void loadRuns(true); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      source.close();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [data?.data.map(run => `${run.id}:${run.status}`).join(','), loadRuns]);

  const stats = useMemo(() => ({
    total: data?.total || 0,
    running: data?.data.filter(run => ['PREPARING', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(run.status)).length || 0,
    passed: data?.data.filter(run => run.status === 'PASSED').length || 0,
    failed: data?.data.filter(run => ['FAILED', 'ERROR'].includes(run.status)).length || 0,
  }), [data]);

  async function cancel(run: Run) {
    setActionLoading(true);
    try { await api(`/api/runs/${run.id}/cancel`, { method: 'POST' }); await loadRuns(); notify('درخواست لغو ثبت شد.', 'success'); }
    catch (error) { notify(error instanceof Error ? error.message : 'لغو اجرا ناموفق بود.', 'error'); }
    finally { setActionLoading(false); }
  }

  return <div className="min-h-screen bg-gray-50">
    <PageHeader title="تاریخچه اجراها" subtitle="نتیجه اجراها از پنل اتوماسیون. اجرای جدید از همان پنل IS / CDE / Git انجام می‌شود." refreshing={loading} onRefresh={() => void loadRuns()} actions={canWrite && <Button icon={<Play className="h-4 w-4" />} onClick={() => navigate('/workspace')}>رفتن به اتوماسیون</Button>} />
    <main className="mx-auto max-w-[1800px] space-y-5 p-4 sm:p-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="کل اجراها" value={stats.total.toLocaleString('fa-IR')} icon={<Terminal className="h-5 w-5" />} />
        <StatCard title="فعال و در صف" value={stats.running.toLocaleString('fa-IR')} icon={<LoaderCircle className="h-5 w-5" />} tone="amber" />
        <StatCard title="موفق در این صفحه" value={stats.passed.toLocaleString('fa-IR')} icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
        <StatCard title="ناموفق در این صفحه" value={stats.failed.toLocaleString('fa-IR')} icon={<XCircle className="h-5 w-5" />} tone="red" />
      </div>
      <Card>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Select label="پروژه" value={projectId} onChange={event => { setProjectId(event.target.value); localStorage.setItem('automation-active-project', event.target.value); setPage(1); }} className="min-w-52">
            {!projects.length && <option value="">پروژه‌ای وجود ندارد</option>}
            {projects.map(project => <option key={project.id} value={project.id}>{project.name} ({project.code})</option>)}
          </Select>
          <Select label="وضعیت" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }} className="min-w-40">
            <option value="">همه وضعیت‌ها</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </Select>
          <div className="relative min-w-64 flex-1"><Search className="absolute right-3 top-[2.65rem] h-4 w-4 text-gray-400" /><Input label="جستجو" value={search} onChange={event => setSearch(event.target.value)} placeholder="فایل تست یا پروژه..." className="pr-10" /></div>
        </div>
        {loading ? <Loading /> : !data?.data.length ? <EmptyState text="اجرایی با فیلترهای فعلی پیدا نشد." /> : <>
          <div className="responsive-table overflow-hidden rounded-xl border border-gray-200">
            <table className="w-full text-right text-sm"><thead className="bg-gray-50 text-xs text-gray-500"><tr>
              <th className="px-4 py-3 font-semibold">هدف اجرا</th><th className="px-4 py-3 font-semibold">پروژه / ابزار</th><th className="px-4 py-3 font-semibold">مرورگر</th><th className="px-4 py-3 font-semibold">وضعیت</th><th className="px-4 py-3 font-semibold">نتیجه</th><th className="px-4 py-3 font-semibold">زمان</th><th className="px-4 py-3 font-semibold">عملیات</th>
            </tr></thead><tbody className="divide-y divide-gray-100">{data.data.map(run => <tr key={run.id} className="hover:bg-gray-50">
              <td className="px-4 py-3"><div className="flex items-center gap-2"><FileCode2 className="h-4 w-4 shrink-0 text-blue-500" /><div><p className="max-w-72 truncate font-mono text-xs font-medium text-gray-900" dir="ltr">{run.testFilePath}</p><p className="mt-1 text-xs text-gray-400">{run.requestedByName}</p></div></div></td>
              <td className="px-4 py-3"><p className="font-medium text-gray-800">{run.projectName}</p><p className="mt-1 text-xs text-gray-500">{run.toolKind || 'PLAYWRIGHT'} · {run.environmentName}{run.packId ? ` · ${run.packId}` : ''}{run.flowId ? `/${run.flowId}` : ''}</p></td>
              <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{run.browserProjects.map(browser => <Badge key={browser} tone="blue">{browserLabels[browser]}</Badge>)}</div></td>
              <td className="px-4 py-3"><Badge tone={statusTones[run.status]}>{statusLabels[run.status]}</Badge></td>
              <td className="px-4 py-3"><span className="text-emerald-600">{(run.passedTests ?? 0).toLocaleString('fa-IR')}</span><span className="mx-1 text-gray-300">/</span><span className="text-red-600">{(run.failedTests ?? 0).toLocaleString('fa-IR')}</span><p className="mt-1 text-[11px] text-gray-400">از {(run.totalTests ?? 0).toLocaleString('fa-IR')} تست</p></td>
              <td className="px-4 py-3"><p className="text-xs text-gray-600">{formatDate(run.requestedAt)}</p><p className="mt-1 text-xs text-gray-400">{formatDuration(run.durationMs)}</p></td>
              <td className="px-4 py-3"><div className="flex gap-1"><Button size="sm" variant="ghost" icon={<Eye className="h-4 w-4" />} onClick={() => setDetail(run)}>جزئیات</Button>{canWrite && ['PREPARING', 'QUEUED', 'RUNNING'].includes(run.status) && <Button size="sm" variant="danger" loading={actionLoading} icon={<Square className="h-3.5 w-3.5" />} onClick={() => void cancel(run)}>لغو</Button>}</div></td>
            </tr>)}</tbody></table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={setPage} />
        </>}
      </Card>
    </main>

    <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title="جزئیات اجرا" size="xl">
      {detail && <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-3 sm:p-3"><p className="text-xs text-gray-500">وضعیت</p><div className="mt-2"><Badge tone={statusTones[detail.status]}>{statusLabels[detail.status]}</Badge></div></Card>
          <Card className="p-3 sm:p-3"><p className="text-xs text-gray-500">مدت اجرا</p><p className="mt-2 font-semibold">{formatDuration(detail.durationMs)}</p></Card>
          <Card className="p-3 sm:p-3"><p className="text-xs text-gray-500">موفق</p><p className="mt-2 font-semibold text-emerald-600">{(detail.passedTests ?? 0).toLocaleString('fa-IR')}</p></Card>
          <Card className="p-3 sm:p-3"><p className="text-xs text-gray-500">ناموفق</p><p className="mt-2 font-semibold text-red-600">{(detail.failedTests ?? 0).toLocaleString('fa-IR')}</p></Card>
        </div>
        {(previousRun || deltaWorse) && (
          <Card className="p-3 sm:p-3">
            <p className="text-xs text-gray-500">Δ نسبت به قبلی</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {previousRun ? (
                <p className="text-sm text-gray-700">
                  اجرا قبلی: <code dir="ltr" className="text-xs">{previousRun.id.slice(0, 8)}</code>
                  {' · '}
                  {(previousRun.failedTests ?? 0).toLocaleString('fa-IR')} ناموفق
                </p>
              ) : (
                <p className="text-sm text-gray-400">اجرای قبلی هم‌هدف پیدا نشد.</p>
              )}
              {deltaWorse && <Badge tone="red">بدتر از قبلی</Badge>}
            </div>
          </Card>
        )}
        <Card><div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3"><div><span className="text-gray-500">فایل: </span><code dir="ltr">{detail.testFilePath}</code></div><div><span className="text-gray-500">محیط: </span>{detail.environmentName}</div><div><span className="text-gray-500">Runner: </span>{detail.runnerId || '—'}</div><div><span className="text-gray-500">شروع: </span>{formatDate(detail.startedAt)}</div><div><span className="text-gray-500">پایان: </span>{formatDate(detail.completedAt)}</div><div><span className="text-gray-500">Reporter: </span>{detail.reporter}</div></div></Card>
        {detail.cdeSnapshot && <Card><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-gray-900">Snapshot کامل CDE</h3><p className="mt-1 text-xs text-gray-500">{detail.cdeSnapshot.fileCount.toLocaleString('fa-IR')} فایل · Project: <code dir="ltr">{detail.cdeProjectKey}</code></p></div><Badge tone={detail.cdeSnapshot.status === 'READY' ? 'green' : detail.cdeSnapshot.status === 'FAILED' ? 'red' : 'purple'}>{detail.cdeSnapshot.status}</Badge></div>{detail.cdeSnapshot.contentHash && <p className="mt-3 break-all font-mono text-[10px] text-gray-400" dir="ltr">SHA-256: {detail.cdeSnapshot.contentHash}</p>}{detail.cdeSnapshot.errorMessage && <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{detail.cdeSnapshot.errorCode}: {detail.cdeSnapshot.errorMessage}</p>}</Card>}
        <div className="overflow-hidden rounded-xl border border-gray-200"><RunReportPanel run={detail} /></div>
        <Card><div className="mb-3 flex items-center gap-2"><Download className="h-4 w-4 text-blue-600" /><h3 className="font-semibold">فایل‌های خروجی</h3></div>{detail.artifacts?.length ? <div className="flex flex-wrap gap-2">{detail.artifacts.map(artifact => <Button key={artifact.id} variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={() => void downloadArtifact(artifact.id, artifact.fileName).catch(error => notify(error.message, 'error'))}>{artifact.fileName}</Button>)}</div> : <p className="text-sm text-gray-400">هنوز خروجی‌ای ثبت نشده است.</p>}</Card>
      </div>}
    </Modal>
  </div>;
}
