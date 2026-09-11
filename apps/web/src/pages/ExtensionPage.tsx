import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Chrome, ExternalLink, Link2, RefreshCw, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { PageHeader } from '../components/Layout';
import { Badge, Button, Card, EmptyState, Loading, notify } from '../components/ui';
import {
  configuredExtensionId, configuredWebStoreUrl, detectRecorder, disconnectRecorder, openRecorder, pairRecorder, type RecorderExtensionStatus,
} from '../extension-bridge';

interface ExtensionSession {
  id: string;
  tokenPrefix: string;
  projectIds: string[];
  accessExpiresAt: string;
  refreshExpiresAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

const missingStatus: RecorderExtensionStatus = { installed: false, compatible: false, connected: false, sessionId: null, version: null };

export function ExtensionPage() {
  const { user } = useAuth();
  const canConnect = user?.role === 'ADMIN' || user?.role === 'OPERATOR';
  const [status, setStatus] = useState<RecorderExtensionStatus>(missingStatus);
  const [sessions, setSessions] = useState<ExtensionSession[]>([]);
  const [detecting, setDetecting] = useState(true);
  const [busy, setBusy] = useState('');
  const extensionId = configuredExtensionId();
  const webStoreUrl = configuredWebStoreUrl();
  const configurationMissing = import.meta.env.PROD && (!extensionId || !webStoreUrl);

  const refresh = useCallback(async () => {
    setDetecting(true);
    const detected = await detectRecorder();
    setStatus(detected);
    if (canConnect) {
      try { setSessions(await api<ExtensionSession[]>('/api/extension/sessions')); }
      catch { setSessions([]); }
    }
    setDetecting(false);
  }, [canConnect]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function connect() {
    setBusy('connect');
    try {
      const pairing = await api<{ pairingCode: string; expiresAt: string }>('/api/extension/pairings', { method: 'POST', body: '{}' });
      setStatus(await pairRecorder(pairing.pairingCode));
      await refresh();
      notify('Chrome Recorder با موفقیت متصل شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'اتصال ضبط‌کننده ناموفق بود.', 'error'); }
    finally { setBusy(''); }
  }

  async function open() {
    setBusy('open');
    try { await openRecorder(); }
    catch (error) { notify(error instanceof Error ? error.message : 'باز کردن ضبط‌کننده ناموفق بود.', 'error'); }
    finally { setBusy(''); }
  }

  async function revoke(id: string) {
    setBusy(id);
    try {
      await api(`/api/extension/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (status.sessionId === id) await disconnectRecorder();
      await refresh();
      notify('دسترسی این ضبط‌کننده لغو شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'لغو اتصال ناموفق بود.', 'error'); }
    finally { setBusy(''); }
  }

  return <div className="min-h-screen bg-gray-50">
    <PageHeader title="Chrome Recorder" subtitle="رفتارهای مرورگر را به تست‌های قابل استفاده Playwright تبدیل کنید" refreshing={detecting} onRefresh={() => void refresh()} />
    <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      {configurationMissing && user?.role === 'ADMIN' && <Card><div className="flex gap-3 text-amber-700"><TriangleAlert className="mt-1 h-5 w-5 shrink-0" /><div><h2 className="font-semibold">پیکربندی انتشار ناقص است</h2><p className="mt-1 text-sm leading-7">متغیرهای VITE_CHROME_EXTENSION_ID و VITE_CHROME_WEBSTORE_ITEM_URL را برای محیط Production تنظیم کنید.</p></div></div></Card>}

      <Card>
        <div className="flex flex-col items-center py-6 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-400"><Chrome className="h-8 w-8" /></div>
          <h2 className="text-xl font-semibold text-gray-900">Chrome Recorder</h2>
          <p className="mt-2 max-w-lg text-sm leading-7 text-gray-600">اقدام‌های شما در یک وب‌سایت را ضبط می‌کند و یک تست قابل ذخیره و اجرا در Automation Tool می‌سازد.</p>

          {detecting ? <div className="mt-7"><Loading text="در حال شناسایی افزونه…" /></div> : !status.installed ? <div className="mt-7 space-y-3">
            {webStoreUrl ? <a href={webStoreUrl} target="_blank" rel="noreferrer"><Button icon={<ExternalLink className="h-4 w-4" />}>نصب افزونه Chrome</Button></a> : <Button disabled icon={<ExternalLink className="h-4 w-4" />}>لینک نصب تنظیم نشده است</Button>}
            <p className="text-xs text-gray-500">پس از نصب به این صفحه برگردید و «بررسی دوباره» را بزنید.</p>
            <Button size="sm" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void refresh()}>بررسی دوباره</Button>
          </div> : !status.compatible ? <div className="mt-7 space-y-3"><Badge tone="amber">نسخه افزونه ناسازگار است</Badge>{webStoreUrl && <a href={webStoreUrl} target="_blank" rel="noreferrer"><Button icon={<ExternalLink className="h-4 w-4" />}>به‌روزرسانی از Chrome Web Store</Button></a>}</div>
            : !status.connected ? <div className="mt-7 space-y-4"><div className="flex items-center justify-center gap-2 text-emerald-600"><CheckCircle2 className="h-5 w-5" /><span>افزونه نصب است</span></div>{canConnect ? <Button loading={busy === 'connect'} icon={<Link2 className="h-4 w-4" />} onClick={() => void connect()}>اتصال ضبط‌کننده</Button> : <p className="text-sm text-amber-600">نقش مشاهده‌گر اجازه ذخیره تست ندارد.</p>}</div>
              : <div className="mt-7 space-y-5"><div className="grid gap-2 text-right text-sm text-gray-700"><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />افزونه نصب است</span><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />اتصال امن برقرار است</span><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />آماده ضبط</span></div><Button loading={busy === 'open'} icon={<Chrome className="h-4 w-4" />} onClick={() => void open()}>باز کردن ضبط‌کننده</Button></div>}
        </div>
      </Card>

      {canConnect && <details className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-gray-700">امنیت و اتصال‌های دستگاه</summary>
        <div className="mt-4"><div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-500" /><p className="text-xs leading-6 text-gray-500">اعتبار کوتاه‌مدت افزونه خودکار تمدید و در هر تمدید چرخانده می‌شود. لغو، دسترسی دستگاه را قطع می‌کند.</p></div>
          {!sessions.filter(item => !item.revokedAt).length ? <EmptyState text="اتصال فعالی وجود ندارد." /> : <div className="space-y-2">{sessions.filter(item => !item.revokedAt).map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-3"><div><p className="font-mono text-xs text-gray-700" dir="ltr">{item.tokenPrefix}…</p><p className="mt-1 text-xs text-gray-500">{item.projectIds.length} پروژه · اعتبار دستگاه تا {new Date(item.refreshExpiresAt).toLocaleDateString('fa-IR')}</p></div><Button size="sm" variant="danger" loading={busy === item.id} icon={<Trash2 className="h-4 w-4" />} onClick={() => void revoke(item.id)}>لغو</Button></div>)}</div>}
        </div>
      </details>}
    </main>
  </div>;
}
