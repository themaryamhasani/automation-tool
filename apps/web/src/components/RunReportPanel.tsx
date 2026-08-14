import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, FileText, MinusCircle, Terminal, XCircle } from 'lucide-react';
import { fetchText } from '../api';
import type { Run, RunReportTest } from '../types';
import { Badge, cn } from './ui';

const STATUS_FA: Record<string, string> = {
  PREPARING: 'آماده‌سازی',
  QUEUED: 'در صف',
  RUNNING: 'در حال اجرا',
  CANCEL_REQUESTED: 'لغو',
  PASSED: 'موفق',
  FAILED: 'ناموفق',
  ERROR: 'خطا',
  CANCELLED: 'لغو شد',
};

function outcomeTone(outcome: string) {
  if (['unexpected', 'failed', 'timedOut'].includes(outcome)) return 'red' as const;
  if (outcome === 'skipped') return 'gray' as const;
  return 'green' as const;
}

function outcomeLabel(outcome: string) {
  if (['unexpected', 'failed', 'timedOut'].includes(outcome)) return 'FAIL';
  if (outcome === 'skipped') return 'SKIP';
  return 'PASS';
}

function logExcerpt(logs?: string | null) {
  if (!logs) return '';
  const lines = logs.trim().split('\n').filter(Boolean);
  return lines.slice(-14).join('\n');
}

function errorText(run: Run) {
  const snapshot = run.cdeSnapshot?.errorMessage;
  if (snapshot) return snapshot;
  const fromDetails = (run.report?.details || []).map(item => item.error).filter(Boolean)[0];
  if (fromDetails) return fromDetails;
  return logExcerpt(run.logs);
}

export function IdleReportDock() {
  return (
    <div className="h-full border-t border-slate-800 bg-[#071018] px-3 py-2">
      <p className="mb-2 text-[11px] text-slate-500">خلاصه اجرا — فایل را انتخاب کنید و اجرا بزنید</p>
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'کل', tone: 'bg-slate-800 text-slate-100' },
          { label: 'PASS', tone: 'bg-emerald-500/15 text-emerald-300' },
          { label: 'FAIL', tone: 'bg-red-500/15 text-red-300' },
          { label: 'SKIP', tone: 'bg-amber-500/15 text-amber-200' },
        ].map(card => (
          <div key={card.label} className={cn('rounded-lg px-2 py-1.5', card.tone)}>
            <p className="text-[10px] opacity-80">{card.label}</p>
            <p className="mt-0.5 text-base font-bold">۰</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RunReportPanel({ run, tone = 'dark' }: { run: Run; tone?: 'dark' | 'light' }) {
  const failed = run.status === 'ERROR' || run.status === 'FAILED';
  const [showLog, setShowLog] = useState(failed);
  const [diskLog, setDiskLog] = useState('');
  const [logLoading, setLogLoading] = useState(true);
  const dark = tone === 'dark';
  const details: RunReportTest[] = run.report?.details || [];
  const passed = run.passedTests ?? run.report?.passed ?? 0;
  const failedCount = run.failedTests ?? run.report?.failed ?? 0;
  const skipped = run.skippedTests ?? run.report?.skipped ?? 0;
  const total = run.totalTests ?? run.report?.total ?? passed + failedCount + skipped;
  const running = ['PREPARING', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(run.status);
  const skipOnly = !running && failedCount === 0 && passed === 0 && skipped > 0;
  const boardPath = run.reportPaths?.board || run.reportPaths?.product;
  const message = failed ? errorText(run) : '';
  const badgeTone = running ? 'blue' : run.status === 'FAILED' || run.status === 'ERROR' ? 'red' : skipOnly ? 'amber' : run.status === 'PASSED' ? 'green' : 'amber';
  const badgeLabel = skipOnly ? 'اسکیپ‌شده' : (STATUS_FA[run.status] || run.status);

  useEffect(() => {
    if (failed && !details.length) setShowLog(true);
  }, [run.id, run.status, failed, details.length]);

  useEffect(() => {
    if (!showLog || !run.id) return;
    let cancelled = false;
    setLogLoading(true);
    fetchText(`/api/runs/${encodeURIComponent(run.id)}/logs`)
      .then(text => { if (!cancelled) setDiskLog(text); })
      .catch(() => { if (!cancelled) setDiskLog(''); })
      .finally(() => { if (!cancelled) setLogLoading(false); });
    return () => { cancelled = true; };
  }, [showLog, run.id, run.status, run.logs]);

  return <div className={cn('h-full border-t', dark ? 'border-slate-800 bg-[#071018] text-slate-200' : 'border-gray-200 bg-white text-gray-900')}>
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">{[run.toolKind || 'PLAYWRIGHT', run.packId, run.flowId].filter(Boolean).join(' · ')}</p>
        <p className={cn('mt-0.5 text-[11px]', dark ? 'text-slate-500' : 'text-gray-500')}>
          {run.status === 'QUEUED' ? 'در صف اجرا'
            : run.status === 'PREPARING' ? 'در حال ساخت Snapshot از سورس CDE — این خطا نیست'
              : run.status === 'RUNNING' ? 'در حال اجرا…'
                : 'نتیجه همین اجرا'}
          {boardPath ? <> · <code dir="ltr">{boardPath}</code></> : null}
        </p>
      </div>
      <Badge tone={badgeTone}>
        {badgeLabel}
      </Badge>
    </div>
    <div className="grid grid-cols-4 gap-2 px-3 pb-2">
      {[
        { label: 'کل', value: total, tone: dark ? 'bg-slate-800 text-slate-100' : 'bg-gray-50 text-gray-900' },
        { label: 'PASS', value: passed, tone: dark ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-50 text-emerald-700' },
        { label: 'FAIL', value: failedCount, tone: dark ? 'bg-red-500/15 text-red-300' : 'bg-red-50 text-red-700' },
        { label: 'SKIP', value: skipped, tone: dark ? 'bg-amber-500/15 text-amber-200' : 'bg-amber-50 text-amber-800' },
      ].map(card => <div key={card.label} className={cn('rounded-lg px-2 py-1.5', card.tone)}>
        <p className="text-[10px] opacity-80">{card.label}</p>
        <p className="mt-0.5 text-base font-bold">{card.value.toLocaleString('fa-IR')}</p>
      </div>)}
    </div>
    {running && run.status === 'PREPARING' && (
      <p className={cn('mx-3 mb-2 rounded-lg px-2 py-1.5 text-[11px] leading-5', dark ? 'bg-blue-500/10 text-blue-200' : 'bg-blue-50 text-blue-800')}>
        سورس پروژه از CDE دریافت می‌شود و بعد روی رانتایم Express همین ابزار اجرا می‌گردد. این مرحله معمولاً حدود یک دقیقه طول می‌کشد و خطا نیست؛ دوباره Run نزنید.
        {run.logs ? <span className="mt-1 block font-mono text-[10px] opacity-80" dir="ltr">{run.logs}</span> : null}
      </p>
    )}
    {skipOnly && <p className={cn('mx-3 mb-2 rounded-lg px-2 py-1.5 text-[11px] leading-5', dark ? 'bg-amber-500/10 text-amber-200' : 'bg-amber-50 text-amber-800')}>
      این اجرا تستی را پاس نکرد؛ همه اسکیپ شدند. معمولاً به‌خاطر نبودن شناسه instance یا فایل لاگین (storageState) در <code dir="ltr">.env</code> است.
    </p>}
    {message && <pre className="mx-3 mb-2 max-h-24 overflow-auto whitespace-pre-wrap rounded-lg bg-red-500/10 px-2 py-1.5 font-mono text-[10px] leading-4 text-red-300" dir="ltr">{message}</pre>}
    {details.length > 0 && <div className="max-h-32 space-y-1 overflow-auto px-3 pb-2">
      {details.map((item, index) => {
        const tone = outcomeTone(item.outcome);
        return (
          <div key={`${item.title}-${index}`} className={cn('flex items-start justify-between gap-2 rounded-lg px-2 py-1 text-xs', tone === 'red' ? (dark ? 'bg-red-500/10' : 'bg-red-50') : tone === 'gray' ? (dark ? 'bg-amber-500/10' : 'bg-amber-50') : dark ? 'bg-white/5' : 'bg-gray-50')}>
            <div className="min-w-0">
              <p className="truncate font-medium">{item.title}</p>
              {item.error && <pre className={cn('mt-1 whitespace-pre-wrap font-mono text-[10px]', tone === 'red' ? 'text-red-400' : 'text-amber-300')} dir="ltr">{item.error}</pre>}
            </div>
            <span className="inline-flex shrink-0 items-center gap-1">
              {tone === 'red' ? <XCircle className="h-3.5 w-3.5 text-red-400" /> : tone === 'gray' ? <MinusCircle className="h-3.5 w-3.5 text-amber-300" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
              {outcomeLabel(item.outcome)}
            </span>
          </div>
        );
      })}
    </div>}
    <button type="button" onClick={() => setShowLog(current => !current)} className={cn('flex w-full items-center gap-2 border-t px-3 py-1.5 text-xs', dark ? 'border-slate-800 text-slate-400 hover:bg-white/5' : 'border-gray-100 text-gray-500 hover:bg-gray-50')}>
      {showLog ? <ChevronDown className="h-3.5 w-3.5" /> : <Terminal className="h-3.5 w-3.5" />}
      {showLog ? 'بستن لاگ خام' : 'نمایش لاگ اجرا'}
      {run.reportPaths?.product && <span className="ms-auto inline-flex items-center gap-1"><FileText className="h-3 w-3" />گزارش</span>}
    </button>
    {showLog && <pre className={cn('max-h-40 overflow-auto px-3 py-2 font-mono text-[11px] leading-5', dark ? 'bg-slate-950 text-slate-400' : 'bg-slate-950 text-slate-200')} dir="ltr">{((logLoading && !(diskLog || run.logs)) ? 'در حال خواندن لاگ…' : (diskLog || run.logs || 'هنوز خروجی‌ای نیست.')).slice(-200_000)}</pre>}
  </div>;
}
