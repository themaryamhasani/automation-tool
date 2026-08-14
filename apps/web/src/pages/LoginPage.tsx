import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, LockKeyhole, TestTube2, UserRound } from 'lucide-react';
import { useAuth } from '../auth';
import { Button, ErrorBanner, Input } from '../components/ui';

export function LoginPage() {
  const { login } = useAuth();
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!identity.trim() || !password) { setError('نام کاربری و رمز عبور را وارد کنید.'); return; }
    setLoading(true); setError('');
    try { await login(identity.trim(), password); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'ورود ناموفق بود.'); }
    finally { setLoading(false); }
  }

  return <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-4">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,#1d4ed8_0,transparent_34%),radial-gradient(circle_at_bottom_left,#0e7490_0,transparent_30%)] opacity-60" />
    <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl lg:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden flex-col justify-between bg-gradient-to-br from-blue-700 to-slate-900 p-10 text-white lg:flex">
        <div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15"><TestTube2 className="h-6 w-6" /></div><div><h1 className="text-xl font-bold">Automation Tool</h1><p className="text-sm text-blue-100">سامانه مستقل اتوماسیون تست</p></div></div>
        <div><h2 className="text-3xl font-bold leading-relaxed">اتوماسیون تست<br />از سورس تا گزارش، در یک پنل</h2><p className="mt-4 max-w-md text-sm leading-7 text-blue-100">IS، CDE، GitHub و git.edus.ir را وصل کنید، اسکریپت بنویسید و اجرا را از همان‌جا ببینید.</p></div>
        <p className="text-xs text-blue-200">Standalone Playwright Automation Platform</p>
      </section>
      <section className="p-6 sm:p-10 lg:p-12">
        <div className="mb-8 lg:hidden"><div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white"><TestTube2 className="h-6 w-6" /></div><h1 className="text-xl font-bold">ابزار اتوماسیون تست</h1></div>
        <div className="mb-7"><h2 className="text-2xl font-bold text-gray-900">ورود به سامانه</h2><p className="mt-2 text-sm text-gray-500">ایمیل یا شماره همراه و رمز عبور خود را وارد کنید.</p></div>
        <form onSubmit={submit} className="space-y-4">
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <div className="relative"><UserRound className="absolute right-3 top-[2.65rem] h-4 w-4 text-gray-400" /><Input label="نام کاربری" value={identity} onChange={e => setIdentity(e.target.value)} placeholder="email@example.com یا 09..." className="pr-10" autoComplete="username" /></div>
          <div className="relative"><LockKeyhole className="absolute right-3 top-[2.65rem] h-4 w-4 text-gray-400" /><Input label="رمز عبور" type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="رمز عبور" className="px-10" autoComplete="current-password" /><button type="button" onClick={() => setShow(value => !value)} className="absolute left-3 top-[2.55rem] rounded p-1 text-gray-400 hover:text-gray-700">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
          <Button type="submit" loading={loading} className="mt-2 w-full py-3">ورود</Button>
        </form>
      </section>
    </div>
  </main>;
}
