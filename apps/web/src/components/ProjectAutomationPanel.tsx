import { useCallback, useEffect, useState } from 'react';
import { Bell, Clock3, Play, Plus, Trash2, Webhook } from 'lucide-react';
import { api } from '../api';
import { Badge, Button, Card, EmptyState, Input, Loading, notify } from './ui';
import type { NotificationChannel, TestSuite, WebhookEndpoint } from '../types';

export function ProjectAutomationPanel({ projectId, environmentId }: { projectId: string; environmentId?: string }) {
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [gates, setGates] = useState<Array<{ id: string; name: string; enabled: boolean; maxFailedTests?: number | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [suiteName, setSuiteName] = useState('شبانه');
  const [suiteCron, setSuiteCron] = useState('0 2 * * *');
  const [suitePack, setSuitePack] = useState('');
  const [webhookName, setWebhookName] = useState('CI');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [slackUrl, setSlackUrl] = useState('');
  const [gateMaxFail, setGateMaxFail] = useState('0');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [suiteRows, webhookRows, channelRows, gateRows] = await Promise.all([
        api<TestSuite[]>(`/api/projects/${projectId}/suites`),
        api<WebhookEndpoint[]>(`/api/projects/${projectId}/webhooks`),
        api<NotificationChannel[]>(`/api/projects/${projectId}/notifications`),
        api<Array<{ id: string; name: string; enabled: boolean; maxFailedTests?: number | null }>>(`/api/projects/${projectId}/gates`).catch(() => []),
      ]);
      setSuites(suiteRows);
      setWebhooks(webhookRows);
      setChannels(channelRows);
      setGates(gateRows);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'بارگذاری اتوماسیون ناموفق بود.', 'error');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  async function createSuite() {
    if (!suiteName.trim()) { notify('نام مجموعه الزامی است.', 'error'); return; }
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/suites`, {
        method: 'POST',
        body: JSON.stringify({
          name: suiteName.trim(),
          environmentId: environmentId || undefined,
          scheduleCron: suiteCron.trim() || null,
          scheduleTimezone: 'Asia/Tehran',
          priority: 10,
          items: [{
            toolKind: 'DANGER',
            flowId: 'ALL',
            packId: suitePack.trim() || undefined,
            sourceApproach: 'IS',
          }],
        }),
      });
      notify('مجموعه تست ذخیره شد.', 'success');
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'ایجاد مجموعه ناموفق بود.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function runSuite(suiteId: string) {
    setBusy(true);
    try {
      const result = await api<{ runs: unknown[] }>(`/api/projects/${projectId}/suites/${suiteId}/run`, { method: 'POST' });
      notify(`${result.runs.length} اجرا در صف قرار گرفت.`, 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'اجرای مجموعه ناموفق بود.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteSuite(suiteId: string) {
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/suites/${suiteId}`, { method: 'DELETE' });
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'حذف مجموعه ناموفق بود.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function createWebhook() {
    if (!webhookName.trim() || !webhookUrl.trim()) { notify('نام و آدرس وب‌هوک الزامی است.', 'error'); return; }
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/webhooks`, {
        method: 'POST',
        body: JSON.stringify({ name: webhookName.trim(), url: webhookUrl.trim(), events: ['run.completed', 'run.failed', 'run.error'] }),
      });
      setWebhookUrl('');
      notify('وب‌هوک ذخیره شد.', 'success');
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'ایجاد وب‌هوک ناموفق بود.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function createSlack() {
    if (!slackUrl.trim()) { notify('آدرس Slack webhook الزامی است.', 'error'); return; }
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/notifications`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'Slack',
          kind: 'SLACK',
          config: { webhookUrl: slackUrl.trim() },
          events: ['run.failed', 'run.error', 'run.passed'],
        }),
      });
      setSlackUrl('');
      notify('کانال اعلان Slack ذخیره شد.', 'success');
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'ایجاد اعلان ناموفق بود.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function createGate() {
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/gates`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'default',
          maxFailedTests: Number(gateMaxFail),
          requireStatus: 'PASSED',
          postScmStatus: true,
        }),
      });
      notify('Quality gate ذخیره شد.', 'success');
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'ایجاد gate ناموفق بود.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Card><Loading /></Card>;

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Clock3 className="h-5 w-5" /></div>
          <div>
            <h2 className="font-semibold text-gray-900">مجموعه‌های تست و زمان‌بندی</h2>
            <p className="mt-1 text-xs text-gray-500">اجرای batch چند تست و cron خودکار (فاز ۲)</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="نام مجموعه" value={suiteName} onChange={event => setSuiteName(event.target.value)} />
          <Input label="Cron" value={suiteCron} onChange={event => setSuiteCron(event.target.value)} dir="ltr" placeholder="0 2 * * *" />
          <Input label="Pack IS (اختیاری)" value={suitePack} onChange={event => setSuitePack(event.target.value)} dir="ltr" placeholder="PR" />
        </div>
        <div className="mt-4 flex justify-end">
          <Button loading={busy} icon={<Plus className="h-4 w-4" />} onClick={() => void createSuite()}>افزودن مجموعه</Button>
        </div>
        <div className="mt-5 space-y-2">
          {suites.length === 0 ? <EmptyState text="هنوز مجموعه تستی تعریف نشده است." /> : suites.map(suite => (
            <div key={suite.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 px-3 py-3">
              <div>
                <div className="flex items-center gap-2"><span className="font-medium text-gray-900">{suite.name}</span><Badge tone={suite.enabled ? 'green' : 'amber'}>{suite.enabled ? 'فعال' : 'غیرفعال'}</Badge></div>
                <p className="mt-1 text-xs text-gray-500" dir="ltr">{suite.scheduleCron || 'بدون زمان‌بندی'} · priority {suite.priority}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" loading={busy} icon={<Play className="h-4 w-4" />} onClick={() => void runSuite(suite.id)}>اجرا</Button>
                <Button size="sm" variant="danger" loading={busy} icon={<Trash2 className="h-4 w-4" />} onClick={() => void deleteSuite(suite.id)}>حذف</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-600"><Webhook className="h-5 w-5" /></div>
          <div>
            <h2 className="font-semibold text-gray-900">وب‌هوک اتمام اجرا</h2>
            <p className="mt-1 text-xs text-gray-500">پس از PASSED / FAILED / ERROR به URL شما POST می‌شود</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="نام" value={webhookName} onChange={event => setWebhookName(event.target.value)} />
          <Input label="URL" value={webhookUrl} onChange={event => setWebhookUrl(event.target.value)} dir="ltr" placeholder="https://example.com/hooks/runs" />
        </div>
        <div className="mt-4 flex justify-end"><Button loading={busy} onClick={() => void createWebhook()}>افزودن وب‌هوک</Button></div>
        <div className="mt-4 space-y-2">
          {webhooks.length === 0 ? <EmptyState text="وب‌هوکی ثبت نشده است." /> : webhooks.map(item => (
            <div key={item.id} className="rounded-xl border border-gray-200 px-3 py-2 text-sm">
              <div className="font-medium text-gray-900">{item.name}</div>
              <div className="mt-1 truncate text-xs text-gray-500" dir="ltr">{item.url}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Bell className="h-5 w-5" /></div>
          <div>
            <h2 className="font-semibold text-gray-900">اعلان Slack</h2>
            <p className="mt-1 text-xs text-gray-500">کانال اعلان برای شکست/موفقیت اجرا</p>
          </div>
        </div>
        <Input label="Slack Incoming Webhook" value={slackUrl} onChange={event => setSlackUrl(event.target.value)} dir="ltr" placeholder="https://hooks.slack.com/services/..." />
        <div className="mt-4 flex justify-end"><Button loading={busy} onClick={() => void createSlack()}>افزودن اعلان</Button></div>
        <div className="mt-4 space-y-2">
          {channels.length === 0 ? <EmptyState text="کانال اعلانی ثبت نشده است." /> : channels.map(item => (
            <div key={item.id} className="rounded-xl border border-gray-200 px-3 py-2 text-sm">
              <div className="font-medium text-gray-900">{item.name} · {item.kind}</div>
              <div className="mt-1 text-xs text-gray-500">{item.events.join(', ')}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><Clock3 className="h-5 w-5" /></div>
          <div>
            <h2 className="font-semibold text-gray-900">Quality Gate پایپلاین</h2>
            <p className="mt-1 text-xs text-gray-500">معیار پاس برای merge/CI و ارسال status به GitHub/GitLab</p>
          </div>
        </div>
        <Input label="حداکثر failed tests" type="number" value={gateMaxFail} onChange={event => setGateMaxFail(event.target.value)} dir="ltr" />
        <div className="mt-4 flex justify-end"><Button loading={busy} onClick={() => void createGate()}>ذخیره Gate</Button></div>
        <div className="mt-4 space-y-2">
          {gates.length === 0 ? <EmptyState text="Gateی تعریف نشده؛ پیش‌فرض = فقط PASSED." /> : gates.map(gate => (
            <div key={gate.id} className="rounded-xl border border-gray-200 px-3 py-2 text-sm">
              <div className="font-medium text-gray-900">{gate.name}</div>
              <div className="mt-1 text-xs text-gray-500">max fail {gate.maxFailedTests ?? '—'} · {gate.enabled ? 'فعال' : 'غیرفعال'}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
