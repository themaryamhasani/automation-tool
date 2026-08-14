import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Briefcase, ClipboardList, Cpu, Download, Search, Shield, ShieldAlert, Users,
} from 'lucide-react';
import { api, downloadReportExcel } from '../api';
import { PageHeader } from '../components/Layout';
import { Badge, Button, Card, EmptyState, Input, Loading, Pagination, Select, StatCard, cn, notify } from '../components/ui';
import type { ReportCatalog, ReportColumn, ReportPayload, RunStatus, ToolKind } from '../types';

const statusLabels: Record<RunStatus, string> = {
  PREPARING: 'ساخت Snapshot', QUEUED: 'در صف', RUNNING: 'در حال اجرا', PASSED: 'موفق', FAILED: 'ناموفق',
  ERROR: 'خطا', CANCEL_REQUESTED: 'در حال لغو', CANCELLED: 'لغوشده',
};
const toolLabels: Record<ToolKind, string> = {
  PLAYWRIGHT: 'Playwright', DANGER: 'Node danger', K6: 'k6', VITEST: 'Vitest', BIOME: 'Biome',
  GITLEAKS: 'gitleaks', AUDIT: 'SCA / audit', SEMGREP: 'Semgrep', SPECTRAL: 'Spectral', AXE: 'axe-core',
};
const reportIcons = { executive: Briefcase, engineering: Cpu, quality: ShieldAlert, team: Users, security: Shield, runs: ClipboardList };

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: isoDate(from), to: isoDate(to) };
}
function faNum(value: unknown, digits = 0) {
  if (value == null || value === '') return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return num.toLocaleString('fa-IR', { maximumFractionDigits: digits });
}
function formatDuration(value?: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  if (num < 1000) return `${faNum(num)} ms`;
  return `${faNum(num / 1000, 1)} ثانیه`;
}
function formatCell(column: ReportColumn, value: unknown) {
  if (value == null || value === '') return '—';
  if (column.format === 'percent') return `${faNum(value, 1)}٪`;
  if (column.format === 'number') return faNum(value);
  if (column.format === 'duration') return formatDuration(value);
  if (column.format === 'datetime') return new Date(String(value)).toLocaleString('fa-IR');
  if (column.format === 'status') return statusLabels[value as RunStatus] || String(value);
  if (column.key === 'toolKind') return toolLabels[value as ToolKind] || String(value);
  return String(value);
}
function kpiDisplay(unit: string | undefined, value: ReportPayload['kpis'][number]['value']) {
  if (unit === 'percent') return `${faNum(value, 1)}٪`;
  if (unit === 'duration') return formatDuration(value);
  if (unit === 'text') return value == null || value === '' ? '—' : String(value);
  return faNum(value);
}

type Filters = {
  from: string; to: string; projectId: string; environmentId: string; sourceApproach: string;
  toolKind: string; status: string; requestedBy: string; search: string;
};

export function ReportsPage() {
  const range = defaultRange();
  const [meta, setMeta] = useState<ReportCatalog | null>(null);
  const [reportId, setReportId] = useState('executive');
  const [filters, setFilters] = useState<Filters>({ ...range, projectId: '', environmentId: '', sourceApproach: '', toolKind: '', status: '', requestedBy: '', search: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const selected = meta?.reports.find(item => item.id === reportId);
  const environments = useMemo(
    () => (meta?.environments || []).filter(item => !filters.projectId || item.projectId === filters.projectId),
    [meta, filters.projectId],
  );

  const query = useCallback(() => {
    const params = new URLSearchParams();
    if (selected?.paginated) { params.set('page', String(page)); params.set('limit', '20'); }
    for (const [key, value] of Object.entries(filters)) {
      if (value && (key !== 'search' || selected?.searchable)) params.set(key, value);
    }
    return params;
  }, [filters, page, selected?.paginated, selected?.searchable]);

  const loadMeta = useCallback(async () => {
    setMeta(await api<ReportCatalog>('/api/reports'));
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try { setData(await api<ReportPayload>(`/api/reports/${reportId}?${query()}`)); }
    catch (error) { notify(error instanceof Error ? error.message : 'بارگذاری گزارش ناموفق بود.', 'error'); }
    finally { setLoading(false); }
  }, [reportId, query]);

  useEffect(() => { void loadMeta().catch(error => notify(error instanceof Error ? error.message : 'بارگذاری فهرست گزارش‌ها ناموفق بود.', 'error')); }, [loadMeta]);
  useEffect(() => { void loadReport(); }, [loadReport]);

  function patch(next: Partial<Filters>) {
    setPage(1);
    setFilters(current => ({ ...current, ...next, environmentId: next.projectId !== undefined ? '' : (next.environmentId ?? current.environmentId) }));
  }

  async function exportExcel() {
    setExporting(true);
    try {
      const params = query();
      params.delete('page');
      await downloadReportExcel(reportId, params, `gozaresh-${reportId}.xlsx`);
      notify('فایل اکسل آماده شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'خروجی اکسل ناموفق بود.', 'error'); }
    finally { setExporting(false); }
  }

  return <div className="min-h-screen bg-gray-50">
    <PageHeader
      title="گزارشات مدیریتی"
      subtitle="گزارش‌های مدیرعامل، CTO، سرپرست تست و کارشناس تست با فیلتر و خروجی اکسل"
      refreshing={loading}
      onRefresh={() => void loadReport()}
      actions={<Button loading={exporting} icon={<Download className="h-4 w-4" />} onClick={() => void exportExcel()}>خروجی اکسل</Button>}
    />
    <main className="mx-auto max-w-[1800px] space-y-5 p-4 sm:p-6">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {(meta?.reports || []).map(item => {
          const Icon = reportIcons[item.id as keyof typeof reportIcons] || BarChart3;
          const active = item.id === reportId;
          return <button key={item.id} type="button" onClick={() => { setReportId(item.id); setPage(1); }} className={cn('flex items-start gap-3 rounded-xl border p-4 text-right transition', active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300')}>
            <div className={cn('mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500')}><Icon className="h-5 w-5" /></div>
            <div className="min-w-0"><p className="font-semibold text-gray-900">{item.title}</p><p className="mt-1 text-xs text-gray-500">{item.audienceLabel}</p></div>
          </button>;
        })}
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Input label="از تاریخ" type="date" value={filters.from} onChange={event => patch({ from: event.target.value })} className="min-w-40" />
          <Input label="تا تاریخ" type="date" value={filters.to} onChange={event => patch({ to: event.target.value })} className="min-w-40" />
          <Select label="پروژه" value={filters.projectId} onChange={event => patch({ projectId: event.target.value })} className="min-w-48">
            <option value="">همه پروژه‌ها</option>
            {(meta?.projects || []).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </Select>
          <Select label="محیط" value={filters.environmentId} onChange={event => patch({ environmentId: event.target.value })} className="min-w-40">
            <option value="">همه محیط‌ها</option>
            {environments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
          <Select label="اپروچ" value={filters.sourceApproach} onChange={event => patch({ sourceApproach: event.target.value })} className="min-w-36">
            <option value="">همه اپروچ‌ها</option>
            {(meta?.approaches || []).map(item => <option key={item} value={item}>{item}</option>)}
          </Select>
          <Select label="ابزار" value={filters.toolKind} onChange={event => patch({ toolKind: event.target.value })} className="min-w-40">
            <option value="">همه ابزارها</option>
            {(meta?.tools || []).map(item => <option key={item} value={item}>{toolLabels[item] || item}</option>)}
          </Select>
          <Select label="وضعیت" value={filters.status} onChange={event => patch({ status: event.target.value })} className="min-w-36">
            <option value="">همه وضعیت‌ها</option>
            {(meta?.statuses || []).map(item => <option key={item} value={item}>{statusLabels[item]}</option>)}
          </Select>
          <Select label="درخواست‌دهنده" value={filters.requestedBy} onChange={event => patch({ requestedBy: event.target.value })} className="min-w-44">
            <option value="">همه افراد</option>
            {(meta?.requesters || []).map(item => <option key={item.id} value={item.id}>{item.fullName}</option>)}
          </Select>
          {selected?.searchable && <div className="relative min-w-64 flex-1"><Search className="absolute right-3 top-[2.65rem] h-4 w-4 text-gray-400" /><Input label="جستجو در هدف" value={filters.search} onChange={event => patch({ search: event.target.value })} placeholder="مسیر، پک یا پروژه..." className="pr-10" /></div>}
        </div>
        {data && <p className="text-sm text-gray-600">{data.subtitle}</p>}
      </Card>

      {loading && !data ? <Loading text="در حال تهیه گزارش…" /> : !data ? <EmptyState text="گزارشی برای نمایش نیست." /> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {data.kpis.map(item => <StatCard key={item.key} title={item.label} value={kpiDisplay(item.unit, item.value)} icon={<BarChart3 className="h-5 w-5" />} tone={item.key.toLowerCase().includes('fail') || item.key.toLowerCase().includes('error') ? 'red' : item.unit === 'percent' ? 'green' : 'blue'} />)}
        </div>
        {data.charts.some(chart => chart.items.length > 0) && <div className="grid gap-4 lg:grid-cols-2">
          {data.charts.filter(chart => chart.items.length).map(chart => {
            const max = Math.max(...chart.items.map(item => item.value), 1);
            return <Card key={chart.id}>
              <h2 className="mb-4 font-semibold text-gray-900">{chart.title}</h2>
              <div className="space-y-3">{chart.items.slice(0, 8).map(item => <div key={`${chart.id}-${item.label}`}>
                <div className="mb-1 flex items-center justify-between gap-3 text-xs text-gray-600"><span className="truncate">{item.label}</span><span>{faNum(item.value, 1)}</span></div>
                <div className="h-2 overflow-hidden rounded bg-gray-100"><div className="h-2 bg-blue-500" style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }} /></div>
              </div>)}</div>
            </Card>;
          })}
        </div>}
        {data.tables.map(table => <Card key={table.id}>
          <div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-semibold text-gray-900">{table.title}</h2><Badge tone="gray">{faNum(table.rows.length)} ردیف</Badge></div>
          {!table.rows.length ? <EmptyState text="ردیفی با فیلترهای فعلی نیست." /> : <div className="responsive-table overflow-hidden rounded-xl border border-gray-200">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500"><tr>{table.columns.map(column => <th key={column.key} className="px-4 py-3 font-semibold">{column.label}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">{table.rows.map((row, index) => <tr key={String(row.id || `${table.id}-${index}`)} className="hover:bg-gray-50">
                {table.columns.map(column => <td key={column.key} className={cn('px-4 py-3 text-gray-800', column.key === 'testFilePath' && 'max-w-72 truncate font-mono text-xs')} dir={column.key === 'testFilePath' ? 'ltr' : undefined}>{formatCell(column, row[column.key])}</td>)}
              </tr>)}</tbody>
            </table>
          </div>}
          {table.id === 'rows' && data.pagination && <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} onChange={setPage} />}
        </Card>)}
      </>}
    </main>
  </div>;
}
