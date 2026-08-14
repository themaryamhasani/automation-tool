import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, KeyRound, Save, ServerCog, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { PageHeader } from '../components/Layout';
import { Badge, Button, Card, Input, Loading, Select, notify } from '../components/ui';
import type { RunnerSettings } from '../types';

export function SettingsPage() {
  const [settings, setSettings] = useState<RunnerSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [health, setHealth] = useState<'ok' | 'error' | 'loading'>('loading');
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  async function load() {
    setLoading(true); setHealth('loading');
    try {
      const [runner] = await Promise.all([api<RunnerSettings>('/api/settings/runner'), api('/api/health')]);
      setSettings(runner); setHealth('ok');
    } catch (error) { setHealth('error'); notify(error instanceof Error ? error.message : 'بارگذاری تنظیمات ناموفق بود.', 'error'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function saveSettings() {
    if (!settings) return;
    setActionLoading(true);
    try { setSettings(await api<RunnerSettings>('/api/settings/runner', { method: 'PUT', body: JSON.stringify(settings) })); notify('تنظیمات Runner ذخیره شد.', 'success'); }
    catch (error) { notify(error instanceof Error ? error.message : 'ذخیره تنظیمات ناموفق بود.', 'error'); }
    finally { setActionLoading(false); }
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (passwords.newPassword.length < 10) { notify('رمز جدید باید حداقل ۱۰ کاراکتر باشد.', 'error'); return; }
    if (passwords.newPassword !== passwords.confirmPassword) { notify('تکرار رمز جدید یکسان نیست.', 'error'); return; }
    setActionLoading(true);
    try { await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify(passwords) }); setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' }); notify('رمز عبور تغییر کرد و نشست‌های دیگر بسته شدند.', 'success'); }
    catch (error) { notify(error instanceof Error ? error.message : 'تغییر رمز ناموفق بود.', 'error'); }
    finally { setActionLoading(false); }
  }

  return <div className="min-h-screen bg-gray-50">
    <PageHeader title="تنظیمات" subtitle="پیکربندی Runner و امنیت حساب" refreshing={loading} onRefresh={() => void load()} />
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <Card><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><ServerCog className="h-5 w-5" /></div><div><h2 className="font-semibold text-gray-900">وضعیت سرویس</h2><p className="mt-1 text-xs text-gray-500">اتصال API به دیتابیس مستقل</p></div></div><Badge tone={health === 'ok' ? 'green' : health === 'loading' ? 'amber' : 'red'}>{health === 'ok' ? 'سالم و متصل' : health === 'loading' ? 'در حال بررسی' : 'خطا در اتصال'}</Badge></div></Card>
      {loading || !settings ? <Loading /> : <Card><div className="mb-5 flex items-center justify-between gap-3"><div><h2 className="font-semibold text-gray-900">Playwright Runner</h2><p className="mt-1 text-xs text-gray-500">مقادیر پیش‌فرض فرم اجرای جدید</p></div><label className="flex items-center gap-2 text-sm font-medium text-gray-700"><input type="checkbox" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} />Runner فعال باشد</label></div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Input label="Timeout پیش‌فرض (ثانیه)" type="number" min={5} max={3600} value={settings.defaultTimeoutSeconds} onChange={event => setSettings({ ...settings, defaultTimeoutSeconds: Number(event.target.value) })} /><Input label="Worker پیش‌فرض" type="number" min={1} max={32} value={settings.defaultWorkers} onChange={event => setSettings({ ...settings, defaultWorkers: Number(event.target.value) })} /><Input label="Retry پیش‌فرض" type="number" min={0} max={10} value={settings.defaultRetries} onChange={event => setSettings({ ...settings, defaultRetries: Number(event.target.value) })} /><Select label="Trace پیش‌فرض" value={settings.defaultTrace} onChange={event => setSettings({ ...settings, defaultTrace: event.target.value })}><option value="off">خاموش</option><option value="on">همیشه</option><option value="retain-on-failure">نگه‌داری در خطا</option><option value="on-first-retry">اولین Retry</option></Select><Select label="Reporter پیش‌فرض" value={settings.defaultReporter} onChange={event => setSettings({ ...settings, defaultReporter: event.target.value })}><option value="json">JSON</option><option value="html">HTML</option><option value="junit">JUnit</option></Select></div>
        <div className="mt-5 flex justify-end"><Button loading={actionLoading} icon={<Save className="h-4 w-4" />} onClick={() => void saveSettings()}>ذخیره تنظیمات</Button></div>
      </Card>}
      <Card><div className="mb-5 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><KeyRound className="h-5 w-5" /></div><div><h2 className="font-semibold text-gray-900">تغییر رمز عبور</h2><p className="mt-1 text-xs text-gray-500">پس از تغییر، همه نشست‌های دیگر بسته می‌شوند.</p></div></div><form onSubmit={changePassword}><div className="grid gap-4 sm:grid-cols-3"><Input label="رمز فعلی" type="password" value={passwords.currentPassword} onChange={event => setPasswords({ ...passwords, currentPassword: event.target.value })} autoComplete="current-password" /><Input label="رمز جدید" type="password" value={passwords.newPassword} onChange={event => setPasswords({ ...passwords, newPassword: event.target.value })} autoComplete="new-password" /><Input label="تکرار رمز جدید" type="password" value={passwords.confirmPassword} onChange={event => setPasswords({ ...passwords, confirmPassword: event.target.value })} autoComplete="new-password" /></div><div className="mt-5 flex justify-end"><Button type="submit" loading={actionLoading} icon={<ShieldCheck className="h-4 w-4" />}>تغییر رمز</Button></div></form></Card>
      <Card><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /><div><h3 className="font-semibold text-gray-900">مرز داده مستقل</h3><p className="mt-1 text-sm leading-7 text-gray-600">کاربران، sessionها، پروژه‌ها، محیط‌ها، اجراها، گزارش‌ها و تاریخچه عملیات فقط از دیتابیس و فضای Artifact همین اپ خوانده می‌شوند. اسکریپت‌ها در پنل اتوماسیون نوشته می‌شوند.</p></div></div></Card>
    </main>
  </div>;
}
