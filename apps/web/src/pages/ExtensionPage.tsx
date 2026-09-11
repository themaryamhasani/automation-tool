import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Chrome, Copy, KeyRound, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { PageHeader } from '../components/Layout';
import { Badge, Button, Card, EmptyState, Input, Loading, notify } from '../components/ui';
import type { Project } from '../types';

interface ApiTokenRow {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  projectIds?: string[] | null;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

const EXTENSION_SCOPES = ['profile:read', 'projects:read', 'files:read', 'files:write', 'runs:create', 'runs:read'];

export function ExtensionPage() {
  const { user } = useAuth();
  const canCreate = user?.role === 'ADMIN' || user?.role === 'OPERATOR';
  const [tokens, setTokens] = useState<ApiTokenRow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState(`Chrome Recorder · ${new Date().toLocaleDateString('fa-IR')}`);
  const [issuedToken, setIssuedToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const projectRows = await api<Project[]>('/api/projects');
      setProjects(projectRows.filter(project => project.isActive));
      setSelected(current => current.length ? current : projectRows.filter(project => project.isActive).map(project => project.id));
      if (canCreate) setTokens(await api<ApiTokenRow[]>('/api/tokens'));
    } catch (error) { notify(error instanceof Error ? error.message : 'بارگذاری اتصال افزونه ناموفق بود.', 'error'); }
    finally { setLoading(false); }
  }, [canCreate]);

  useEffect(() => { void load(); }, [load]);

  const activeTokens = useMemo(() => tokens.filter(token => !token.revokedAt), [tokens]);

  async function createToken() {
    if (!name.trim() || !selected.length) { notify('نام توکن و حداقل یک پروژه الزامی است.', 'error'); return; }
    setBusy(true); setIssuedToken('');
    try {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 90);
      const result = await api<ApiTokenRow & { token: string }>('/api/tokens', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), scopes: EXTENSION_SCOPES, projectIds: selected, expiresAt: expiry.toISOString() }),
      });
      setIssuedToken(result.token);
      await load();
      notify('توکن افزونه ساخته شد؛ مقدار آن فقط همین یک‌بار نمایش داده می‌شود.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'ساخت توکن ناموفق بود.', 'error'); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    setBusy(true);
    try { await api(`/api/tokens/${id}`, { method: 'DELETE' }); await load(); notify('توکن لغو شد.', 'success'); }
    catch (error) { notify(error instanceof Error ? error.message : 'لغو توکن ناموفق بود.', 'error'); }
    finally { setBusy(false); }
  }

  return <div className="min-h-screen bg-gray-50">
    <PageHeader title="افزونه Chrome Recorder" subtitle="اتصال امن ضبط‌کننده Playwright به پروژه‌ها و Runner" refreshing={loading} onRefresh={() => void load()} />
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <Card>
        <div className="flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Chrome className="h-5 w-5" /></div><div><h2 className="font-semibold text-gray-900">اتصال افزونه</h2><p className="mt-1 text-sm leading-7 text-gray-600">برای افزونه یک توکن محدود، قابل لغو و دارای تاریخ انقضا بسازید. توکن فقط به پروژه‌های انتخابی و عملیات فایل تست/اجرا دسترسی دارد.</p></div></div>
      </Card>

      {!canCreate ? <Card><EmptyState text="نقش مشاهده‌گر اجازه ساخت توکن افزونه یا ذخیره تست را ندارد." /></Card> : loading ? <Loading /> : <Card>
        <div className="mb-5 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><ShieldCheck className="h-5 w-5" /></div><div><h2 className="font-semibold text-gray-900">توکن محدود جدید</h2><p className="mt-1 text-xs text-gray-500">اعتبار ۹۰ روز · مقدار خام در سرور ذخیره نمی‌شود</p></div></div>
        <Input label="نام اتصال" value={name} maxLength={120} onChange={event => setName(event.target.value)} />
        <div className="mt-4"><p className="mb-2 text-sm font-medium text-gray-700">پروژه‌های مجاز</p><div className="grid gap-2 sm:grid-cols-2">{projects.map(project => {
          const checked = selected.includes(project.id);
          return <label key={project.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${checked ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'}`}><input type="checkbox" checked={checked} onChange={() => setSelected(current => checked ? current.filter(id => id !== project.id) : [...current, project.id])} /><span className="flex-1"><strong className="block text-gray-900">{project.name}</strong><span className="text-xs text-gray-500" dir="ltr">{project.code} · {project.sourceApproach}</span></span>{checked && <Check className="h-4 w-4 text-blue-600" />}</label>;
        })}</div></div>
        <div className="mt-4 flex justify-end"><Button loading={busy} icon={<KeyRound className="h-4 w-4" />} onClick={() => void createToken()}>ساخت توکن افزونه</Button></div>
        {issuedToken && <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4"><p className="font-semibold text-amber-900">این مقدار فقط یک‌بار نمایش داده می‌شود</p><code className="mt-3 block overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-emerald-300" dir="ltr">{issuedToken}</code><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => void navigator.clipboard.writeText(issuedToken)}>کپی برای افزونه</Button><Button size="sm" variant="ghost" onClick={() => setIssuedToken('')}>پنهان‌کردن</Button></div></div>}
      </Card>}

      {canCreate && <Card>
        <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-semibold text-gray-900">اتصال‌های فعال</h2><p className="mt-1 text-xs text-gray-500">لغو توکن، دسترسی افزونه را بلافاصله قطع می‌کند.</p></div><Button size="sm" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()}>به‌روزرسانی</Button></div>
        {!activeTokens.length ? <EmptyState text="توکن فعالی وجود ندارد." /> : <div className="space-y-2">{activeTokens.map(token => <div key={token.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3"><div><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-gray-900">{token.name}</strong><Badge tone="green">فعال</Badge></div><p className="mt-1 font-mono text-xs text-gray-500" dir="ltr">{token.tokenPrefix}… · {token.projectIds?.length || 'all'} projects</p><p className="mt-1 text-xs text-gray-400">انقضا: {token.expiresAt ? new Date(token.expiresAt).toLocaleString('fa-IR') : 'بدون انقضا'} · آخرین استفاده: {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString('fa-IR') : 'هنوز استفاده نشده'}</p></div><Button size="sm" variant="danger" loading={busy} icon={<Trash2 className="h-4 w-4" />} onClick={() => void revoke(token.id)}>لغو</Button></div>)}</div>}
      </Card>}
    </main>
  </div>;
}
