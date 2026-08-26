import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Link2, LogOut, MapPin } from 'lucide-react';
import { api, ApiError } from '../api';
import type { Environment, RuntimeSessionStatus } from '../types';
import { Badge, Button, Input, Modal, Select, cn, notify } from './ui';

function latinDigits(value: string) {
  return value.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
}

function validPhone(value: string) {
  return /^(?:\+98|0098|98|0)?9\d{9}$/.test(latinDigits(value).replace(/[\s()-]/g, ''));
}

const AUTH_DEVLOGIN = 'devlogin';
const AUTH_HANDOFF = 'soha-gov-sso-handoff';

/** Workspace CDE uses projectKey; project cartable uses environmentId. */
export function RuntimeLoginPanel({
  environmentId,
  projectKey,
  environment,
  className,
  compact = false,
}: {
  environmentId?: string;
  projectKey?: string;
  environment?: Environment | null;
  className?: string;
  compact?: boolean;
}) {
  const [status, setStatus] = useState<RuntimeSessionStatus>({ connected: false });
  const [origins, setOrigins] = useState<string[]>(['https://adib.m.edus.ir', 'https://soha.m.edus.ir']);
  const [origin, setOrigin] = useState('https://adib.m.edus.ir');
  const [appPath, setAppPath] = useState('/');
  const [loginPath, setLoginPath] = useState('/devlogin');
  const [projectServiceId, setProjectServiceId] = useState('');
  const [authMode, setAuthMode] = useState(AUTH_DEVLOGIN);
  const [authModes, setAuthModes] = useState<string[]>([AUTH_DEVLOGIN]);
  const [authOrigin, setAuthOrigin] = useState('');
  const [appOrigin, setAppOrigin] = useState('');
  const [prostage, setProstage] = useState('develop');
  const [storageStateJson, setStorageStateJson] = useState('');
  const [handoffUrl, setHandoffUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState('');
  const [loginStep, setLoginStep] = useState<'phone' | 'password'>('phone');
  const [loginError, setLoginError] = useState('');

  const sessionBase = environmentId
    ? `/api/environments/${encodeURIComponent(environmentId)}/runtime-session`
    : projectKey
      ? `/api/cde/projects/${encodeURIComponent(projectKey)}/runtime-session`
      : '';

  const applyTargetMeta = useCallback((next: Partial<RuntimeSessionStatus> & { defaultOrigin?: string }) => {
    if (next.appPath) setAppPath(next.appPath);
    if (next.loginPath !== undefined) setLoginPath(next.loginPath || '');
    if (next.projectServiceId !== undefined) setProjectServiceId(next.projectServiceId || '');
    if (next.authMode) setAuthMode(next.authMode);
    if (next.authModes?.length) setAuthModes(next.authModes);
    if (next.authOrigin) setAuthOrigin(next.authOrigin);
    if (next.appOrigin) setAppOrigin(next.appOrigin);
    if (next.prostage !== undefined && next.prostage !== null) setProstage(String(next.prostage));
    const list = next.origins?.length ? next.origins : ['https://adib.m.edus.ir', 'https://soha.m.edus.ir'];
    setOrigins(list);
    setOrigin(current => {
      if (next.connected && (next.appOrigin || next.origin)) return next.appOrigin || next.origin || current;
      if (next.defaultOrigin && list.includes(next.defaultOrigin)) return next.defaultOrigin;
      if (next.appOrigin && list.includes(next.appOrigin)) return next.appOrigin;
      if (list.includes(current)) return current;
      return list[0];
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!sessionBase) {
      setStatus({ connected: false });
      return;
    }
    setChecking(true);
    try {
      const query = authMode ? `?authMode=${encodeURIComponent(authMode)}` : '';
      const next = await api<RuntimeSessionStatus>(`${sessionBase}${query}`);
      setStatus(next);
      applyTargetMeta(next);
    } catch {
      setStatus({ connected: false });
      try {
        const params = new URLSearchParams();
        if (projectKey) params.set('projectKey', projectKey);
        if (authMode) params.set('authMode', authMode);
        const defaults = await api<RuntimeSessionStatus & { defaultOrigin?: string }>(
          `/api/runtime/origins?${params.toString()}`,
        );
        applyTargetMeta(defaults);
      } catch { /* keep defaults */ }
    } finally {
      setChecking(false);
    }
  }, [sessionBase, projectKey, applyTargetMeta, authMode]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!sessionBase) return null;

  const isHandoff = authMode === AUTH_HANDOFF;

  async function login() {
    if (!sessionBase) return;
    if (loginStep === 'phone' && !validPhone(phone)) {
      setLoginError('شماره همراه معتبر وارد کنید؛ مانند ۰۹۱۲۱۲۳۴۵۶۷.');
      return;
    }
    if (loginStep === 'password' && !password) {
      setLoginError('رمز عبور رانتایم (m.edus) را وارد کنید.');
      return;
    }
    setLoading(true);
    setLoginError('');
    try {
      if (loginStep === 'phone') {
        const response = await api<RuntimeSessionStatus>(`${sessionBase}/start`, {
          method: 'POST',
          body: JSON.stringify({ userLoginName: phone, origin, authMode }),
        });
        if (response.connected) {
          setStatus(response);
          applyTargetMeta(response);
          setShowLogin(false);
          notify(`نشست رانتایم روی ${response.appOrigin || response.origin || origin} برقرار شد.`, 'success');
        } else {
          setChallenge(response.challenge || '');
          setLoginStep('password');
        }
      } else {
        const response = await api<RuntimeSessionStatus>(`${sessionBase}/password`, {
          method: 'POST',
          body: JSON.stringify({ challenge, password, origin, authMode }),
        });
        setStatus(response);
        applyTargetMeta(response);
        setPassword('');
        setShowLogin(false);
        notify(`نشست رانتایم روی ${response.appOrigin || response.origin || origin} برقرار شد.`, 'success');
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'RUNTIME_LOGIN_CHALLENGE_EXPIRED') {
        setLoginStep('phone');
        setChallenge('');
        setPassword('');
      }
      setLoginError(error instanceof Error ? error.message : 'ورود رانتایم ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }

  async function importSession() {
    if (!sessionBase) return;
    let storageState: unknown;
    try {
      storageState = storageStateJson.trim() ? JSON.parse(storageStateJson) : undefined;
    } catch {
      setLoginError('JSON مربوط به storageState معتبر نیست.');
      return;
    }
    if (!storageState && !handoffUrl.trim()) {
      setLoginError('storageState (کوکی‌ها) یا handoffUrl را وارد کنید.');
      return;
    }
    setLoading(true);
    setLoginError('');
    try {
      const response = await api<RuntimeSessionStatus>(`${sessionBase}/import`, {
        method: 'POST',
        body: JSON.stringify({
          authMode: AUTH_HANDOFF,
          storageState,
          handoffUrl: handoffUrl.trim() || undefined,
          prostage: prostage || 'develop',
          appOrigin: appOrigin || undefined,
          authOrigin: authOrigin || undefined,
        }),
      });
      setStatus(response);
      applyTargetMeta(response);
      setShowLogin(false);
      notify(`نشست چنددامنه‌ای روی ${response.appOrigin || response.origin} برقرار شد.`, 'success');
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'وارد کردن نشست رانتایم ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    if (!sessionBase) return;
    setLoading(true);
    try {
      await api(sessionBase, { method: 'DELETE' });
      setStatus({ connected: false });
      notify('نشست رانتایم قطع شد.', 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'قطع نشست رانتایم ناموفق بود.', 'error');
    } finally {
      setLoading(false);
    }
  }

  const displayOrigin = status.appOrigin || status.origin || origin;
  const displayApp = status.appPath || appPath;
  const shellClass = compact
    ? 'flex flex-wrap items-center gap-2'
    : 'rounded-xl border border-amber-500/40 bg-amber-500/10 p-3';

  return (
    <>
      <div className={cn(shellClass, className)}>
        {!compact && (
          <div className="mb-2">
            <p className="text-sm font-semibold text-amber-100">ورود رانتایم — همین پروژه</p>
            <p className="mt-1 text-[11px] leading-5 text-amber-100/70">
              مدل API-CONSOLE. برای CI از devlogin روی m.edus استفاده کنید؛ برای استیج مدیو از import چنددامنه‌ای (سها → اپ).
              {projectKey ? <> · <code dir="ltr">{projectKey}</code></> : null}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.connected ? 'green' : checking ? 'gray' : 'amber'}>
            {status.connected ? 'رانتایم متصل' : checking ? 'رانتایم…' : 'ورود رانتایم'}
          </Badge>
          {!status.connected ? (
            <Button size="sm" variant="secondary" loading={loading} icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => { setLoginError(''); setLoginStep('phone'); setShowLogin(true); }}>
              ورود رانتایم
            </Button>
          ) : (
            <Button size="sm" variant="secondary" loading={loading} icon={<LogOut className="h-3.5 w-3.5" />} onClick={() => void disconnect()}>
              قطع
            </Button>
          )}
          {displayOrigin ? (
            <code dir="ltr" className={cn('max-w-[16rem] truncate text-[10px]', compact ? 'text-slate-400' : 'text-amber-100/80')}>
              {displayOrigin.replace(/^https:\/\//, '')}{isHandoff ? '' : loginPath}
            </code>
          ) : null}
          {displayApp && displayApp !== '/' ? (
            <code dir="ltr" className={cn('max-w-[12rem] truncate text-[10px]', compact ? 'text-slate-500' : 'text-amber-100/60')}>
              → {displayApp}
            </code>
          ) : null}
          {status.authMode ? (
            <code dir="ltr" className={cn('text-[10px]', compact ? 'text-slate-500' : 'text-amber-100/50')}>{status.authMode}</code>
          ) : null}
          {status.runtimeUser?.displayName ? (
            <span className={cn('text-[11px]', compact ? 'text-slate-400' : 'text-amber-100/80')}>{status.runtimeUser.displayName}</span>
          ) : null}
        </div>
      </div>

      <Modal
        open={showLogin}
        onClose={() => !loading && setShowLogin(false)}
        title={isHandoff ? 'ورود رانتایم چنددامنه‌ای (سها → اپ)' : 'ورود رانتایم (m.edus) — مدل API-CONSOLE'}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setShowLogin(false)} disabled={loading}>انصراف</Button>
            <Button loading={loading} onClick={() => void (isHandoff ? importSession() : login())}>
              {isHandoff ? 'وارد کردن نشست' : (loginStep === 'phone' ? 'ادامه' : 'ورود')}
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <p className="text-sm leading-7 text-gray-600">
            {isHandoff
              ? 'SSO دولت (کپچا/OTP) بیرون از ابزار است. بعد از لاگین دستی، storageState مرورگر یا handoff سها→اپ را وارد کنید؛ readyCheck روی دامنه اپ انجام می‌شود.'
              : <>این ورود برای سرویس زنده است (<code dir="ltr">*.m.edus.ir</code>)، نه CDE.</>}
            {projectKey ? <> پروژه: <b dir="ltr">{projectKey}</b>.</> : null}
            {environment?.name ? <> محیط: <b>{environment.name}</b>.</> : null}
          </p>
          {authModes.length > 1 ? (
            <Select
              label="حالت احراز هویت"
              value={authMode}
              onChange={event => {
                const next = event.target.value;
                setAuthMode(next);
                setLoginError('');
              }}
              dir="ltr"
            >
              {authModes.map(mode => (
                <option key={mode} value={mode}>{mode}</option>
              ))}
            </Select>
          ) : null}
          {!isHandoff ? (
            <>
              <Select label="Origin رانتایم" value={origin} onChange={event => setOrigin(event.target.value)} dir="ltr">
                {origins.map(item => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </Select>
              <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 shrink-0" />
                  <span>ورود: <code dir="ltr">{origin}{loginPath}</code></span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0" />
                  <span>مسیر تست بعد از ورود: <code dir="ltr">{origin}{appPath}</code></span>
                </div>
                {(status.projectServiceId || projectServiceId) ? (
                  <div className="leading-5">
                    serviceId اپ:{' '}
                    <code dir="ltr">{status.projectServiceId || projectServiceId}</code>
                  </div>
                ) : null}
                {projectKey === 'tavan' ? (
                  <p className="leading-5 text-blue-700/90">
                    توان (CI): <code dir="ltr">soha.m.edus.ir</code> · <code dir="ltr">/tavan</code> · serviceId <code dir="ltr">tavan.medu.ir</code>.
                    برای استیج مدیو حالت <code dir="ltr">soha-gov-sso-handoff</code> را انتخاب کنید.
                  </p>
                ) : null}
              </div>
              {loginStep === 'phone' ? (
                <Input label="شماره همراه" value={phone} onChange={event => setPhone(event.target.value)} dir="ltr" placeholder="09121234567" />
              ) : (
                <Input label="رمز عبور رانتایم" type="password" value={password} onChange={event => setPassword(event.target.value)} dir="ltr" />
              )}
            </>
          ) : (
            <>
              <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                <div>auth hub: <code dir="ltr">{authOrigin || 'https://soha.medu.ir'}</code></div>
                <div>app: <code dir="ltr">{appOrigin || origin || 'https://tavan.medu.ir'}{appPath || '/landing'}</code></div>
                <div>prostage: <code dir="ltr">{prostage || 'develop'}</code></div>
                <div>readyCheck: <code dir="ltr">pages-app/who-am-i → IsUserLogin=true</code></div>
              </div>
              <Input label="prostage" value={prostage} onChange={event => setProstage(event.target.value)} dir="ltr" placeholder="develop" />
              <Input
                label="handoffUrl (اختیاری اگر کوکی دامنه اپ را دارید)"
                value={handoffUrl}
                onChange={event => setHandoffUrl(event.target.value)}
                dir="ltr"
                placeholder="https://soha.medu.ir/core-api/v1/data-provider/g/pwsp--medu--sso--get-token/…?clientAccessId=tavan_soha"
              />
              <label className="block text-sm font-medium text-gray-700">
                Playwright storageState JSON
                <textarea
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs"
                  dir="ltr"
                  rows={8}
                  value={storageStateJson}
                  onChange={event => setStorageStateJson(event.target.value)}
                  placeholder={'{\n  "cookies": [{ "name": "...", "value": "...", "domain": ".medu.ir", "path": "/" }]\n}'}
                />
              </label>
            </>
          )}
          {loginError ? <p className="text-sm text-red-600">{loginError}</p> : null}
        </div>
      </Modal>
    </>
  );
}
