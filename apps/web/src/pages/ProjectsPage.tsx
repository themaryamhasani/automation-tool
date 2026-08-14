import { useCallback, useEffect, useState } from 'react';
import { Building2, CheckCircle2, Edit3, ExternalLink, Globe2, Link2, Plus, Save, Trash2 } from 'lucide-react';
import { api, ApiError } from '../api';
import { PageHeader } from '../components/Layout';
import { Badge, Button, Card, EmptyState, Input, Loading, Modal, Textarea, notify } from '../components/ui';
import type { CdeConnectionStatus, CdeProjectMapping, Environment, Project } from '../types';

interface ProjectForm { id?: string; name: string; code: string; description: string; isActive: boolean }
interface EnvironmentForm { id?: string; name: string; baseUrl: string; apiBaseUrl: string; gatewayBaseUrl: string; availableFrom: string; availableUntil: string; secretReferencesText: string; enabled: boolean }
const emptyProject = (): ProjectForm => ({ name: '', code: '', description: '', isActive: true });
const emptyEnvironment = (): EnvironmentForm => ({ name: 'develop', baseUrl: '', apiBaseUrl: '', gatewayBaseUrl: '', availableFrom: '', availableUntil: '', secretReferencesText: '{}', enabled: true });
const emptyMapping = (project?: Project): CdeProjectMapping => ({ projectId: project?.id || '', projectKey: project?.code?.toLowerCase() || '', webUiRepoName: '', dataServiceRepoName: '', apiModuleRepoName: '', messageConsumerRepoName: '', enabled: true });

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [envLoading, setEnvLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [projectForm, setProjectForm] = useState<ProjectForm>(emptyProject());
  const [environmentForm, setEnvironmentForm] = useState<EnvironmentForm>(emptyEnvironment());
  const [showProject, setShowProject] = useState(false);
  const [showEnvironment, setShowEnvironment] = useState(false);
  const [cdeStatus, setCdeStatus] = useState<CdeConnectionStatus>({ connected: false });
  const [mapping, setMapping] = useState<CdeProjectMapping>(emptyMapping());
  const [mappingExists, setMappingExists] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api<Project[]>('/api/projects');
      setProjects(rows);
      setSelectedId(current => rows.some(row => row.id === current) ? current : rows[0]?.id || '');
    } catch (error) { notify(error instanceof Error ? error.message : 'بارگذاری پروژه‌ها ناموفق بود.', 'error'); }
    finally { setLoading(false); }
  }, []);
  const loadEnvironments = useCallback(async () => {
    if (!selectedId) { setEnvironments([]); setEnvLoading(false); return; }
    setEnvLoading(true);
    try { setEnvironments(await api<Environment[]>(`/api/projects/${selectedId}/environments`)); }
    catch (error) { notify(error instanceof Error ? error.message : 'بارگذاری محیط‌ها ناموفق بود.', 'error'); }
    finally { setEnvLoading(false); }
  }, [selectedId]);
  useEffect(() => { void loadProjects(); }, [loadProjects]);
  useEffect(() => { void loadEnvironments(); }, [loadEnvironments]);
  useEffect(() => {
    api<CdeConnectionStatus>('/api/cde/session').then(setCdeStatus).catch(() => setCdeStatus({ connected: false }));
  }, []);

  const selected = projects.find(project => project.id === selectedId);
  useEffect(() => {
    if (!selected) { setMapping(emptyMapping()); setMappingExists(false); return; }
    api<CdeProjectMapping>(`/api/projects/${selected.id}/cde-mapping`).then(row => { setMapping(row); setMappingExists(true); }).catch(error => {
      if (error instanceof ApiError && error.status === 404) { setMapping(emptyMapping(selected)); setMappingExists(false); return; }
      notify(error instanceof Error ? error.message : 'خواندن Mapping CDE ناموفق بود.', 'error');
    });
  }, [selected?.id]);
  function editProject(project: Project) { setProjectForm({ id: project.id, name: project.name, code: project.code, description: project.description || '', isActive: project.isActive }); setShowProject(true); }
  async function saveProject() {
    if (!projectForm.name.trim() || !/^[a-z0-9][a-z0-9_-]*$/.test(projectForm.code)) { notify('نام و کد انگلیسی معتبر وارد کنید.', 'error'); return; }
    setActionLoading(true);
    try {
      const saved = projectForm.id
        ? await api<Project>(`/api/projects/${projectForm.id}`, { method: 'PUT', body: JSON.stringify(projectForm) })
        : await api<Project>('/api/projects', { method: 'POST', body: JSON.stringify(projectForm) });
      setShowProject(false); await loadProjects(); setSelectedId(saved.id); notify('اطلاعات پروژه ذخیره شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'ذخیره پروژه ناموفق بود.', 'error'); }
    finally { setActionLoading(false); }
  }
  function editEnvironment(environment: Environment) { setEnvironmentForm({ id: environment.id, name: environment.name, baseUrl: environment.baseUrl, apiBaseUrl: environment.apiBaseUrl || '', gatewayBaseUrl: environment.gatewayBaseUrl || '', availableFrom: environment.availableFrom ? new Date(environment.availableFrom).toISOString().slice(0, 16) : '', availableUntil: environment.availableUntil ? new Date(environment.availableUntil).toISOString().slice(0, 16) : '', secretReferencesText: JSON.stringify(environment.secretReferences || {}, null, 2), enabled: environment.enabled }); setShowEnvironment(true); }
  async function saveEnvironment() {
    if (!selectedId || !environmentForm.name.trim() || !environmentForm.baseUrl.trim()) { notify('نام و آدرس محیط الزامی است.', 'error'); return; }
    let secretReferences: Record<string, string>;
    try { secretReferences = JSON.parse(environmentForm.secretReferencesText || '{}'); }
    catch { notify('JSON مربوط به Secret reference معتبر نیست.', 'error'); return; }
    setActionLoading(true);
    try {
      const payload = { ...environmentForm, secretReferences, availableFrom: environmentForm.availableFrom || null, availableUntil: environmentForm.availableUntil || null };
      if (environmentForm.id) await api(`/api/environments/${environmentForm.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api(`/api/projects/${selectedId}/environments`, { method: 'POST', body: JSON.stringify(payload) });
      setShowEnvironment(false); await loadEnvironments(); await loadProjects(); notify('محیط ذخیره شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'ذخیره محیط ناموفق بود.', 'error'); }
    finally { setActionLoading(false); }
  }
  async function removeEnvironment(environment: Environment) {
    if (!window.confirm(`محیط ${environment.name} حذف شود؟`)) return;
    setActionLoading(true);
    try { await api(`/api/environments/${environment.id}`, { method: 'DELETE' }); await loadEnvironments(); notify('محیط حذف شد.', 'success'); }
    catch (error) { notify(error instanceof Error ? error.message : 'این محیط به اجراها متصل است و قابل حذف نیست.', 'error'); }
    finally { setActionLoading(false); }
  }
  async function saveMapping() {
    if (!selected || !mapping.projectKey.trim()) { notify('کلید پروژه CDE الزامی است.', 'error'); return; }
    setActionLoading(true);
    try {
      const saved = await api<CdeProjectMapping>(`/api/projects/${selected.id}/cde-mapping`, { method: 'PUT', body: JSON.stringify(mapping) });
      setMapping(saved); setMappingExists(true); notify('Mapping کامل CDE ذخیره شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'ذخیره Mapping ناموفق بود.', 'error'); }
    finally { setActionLoading(false); }
  }
  async function validateMapping() {
    if (!selected || !mappingExists) { notify('ابتدا Mapping را ذخیره کنید.', 'error'); return; }
    if (!cdeStatus.connected) { notify('ابتدا حساب CDE را متصل کنید.', 'error'); return; }
    setActionLoading(true);
    try {
      const result = await api<{ valid: boolean; status: string }>(`/api/projects/${selected.id}/cde-mapping/validate`, { method: 'POST' });
      setMapping(current => ({ ...current, lastValidationStatus: result.status, lastValidatedAt: new Date().toISOString() })); notify('دسترسی CDE و Repository اصلی تأیید شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'اعتبارسنجی Mapping ناموفق بود.', 'error'); }
    finally { setActionLoading(false); }
  }

  return <div className="min-h-screen bg-gray-50">
    <PageHeader title="پروژه‌ها و محیط‌ها" subtitle="پروژه‌های محلی، محیط اجرا و Mapping اختیاری CDE. اتصال منابع در پنل اتوماسیون است." refreshing={loading} onRefresh={() => void loadProjects()} actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => { setProjectForm(emptyProject()); setShowProject(true); }}>پروژه جدید</Button>} />
    <main className="mx-auto max-w-[1800px] space-y-5 p-4 sm:p-6">
      {loading ? <Loading /> : <div className="grid items-start gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="p-3 sm:p-3"><div className="mb-3 flex items-center justify-between px-2"><h2 className="font-semibold">پروژه‌ها</h2><Badge tone="blue">{projects.length.toLocaleString('fa-IR')}</Badge></div>{!projects.length ? <EmptyState text="پروژه‌ای تعریف نشده است." /> : <div className="space-y-1">{projects.map(project => <button key={project.id} onClick={() => setSelectedId(project.id)} className={`w-full rounded-xl border p-3 text-right transition ${selectedId === project.id ? 'border-blue-200 bg-blue-50' : 'border-transparent hover:bg-gray-50'}`}><div className="flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><Building2 className={`h-4 w-4 ${selectedId === project.id ? 'text-blue-600' : 'text-gray-400'}`} /><span className="truncate text-sm font-semibold text-gray-900">{project.name}</span></div><Badge tone={project.isActive ? 'green' : 'gray'}>{project.isActive ? 'فعال' : 'بایگانی'}</Badge></div><div className="mt-2 flex items-center justify-between text-[11px] text-gray-400"><code>{project.code}</code><span>{(project.environmentCount || 0).toLocaleString('fa-IR')} محیط · {(project.fileCount || 0).toLocaleString('fa-IR')} فایل</span></div></button>)}</div>}</Card>
        <div className="space-y-5">{selected ? <>
          <Card><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="text-lg font-bold text-gray-900">{selected.name}</h2><Badge tone={selected.isActive ? 'green' : 'gray'}>{selected.isActive ? 'فعال' : 'بایگانی'}</Badge></div><p className="mt-1 font-mono text-xs text-gray-400" dir="ltr">{selected.code}</p></div><Button variant="secondary" icon={<Edit3 className="h-4 w-4" />} onClick={() => editProject(selected)}>ویرایش پروژه</Button></div><p className="mt-4 text-sm leading-7 text-gray-600">{selected.description || 'توضیحی برای این پروژه ثبت نشده است.'}</p></Card>
          <Card><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Link2 className="h-5 w-5 text-blue-600" /><h2 className="font-semibold text-gray-900">Mapping اختیاری به CDE</h2>{mapping.lastValidationStatus === 'HEALTHY' && <Badge tone="green"><CheckCircle2 className="ml-1 h-3.5 w-3.5" />تأییدشده</Badge>}</div><p className="mt-1 text-xs text-gray-500">برای Snapshot چهار Repository. اتصال حساب CDE از پنل اتوماسیون انجام می‌شود.</p></div><div className="flex gap-2"><Button size="sm" variant="secondary" loading={actionLoading} disabled={!mappingExists || !cdeStatus.connected} onClick={() => void validateMapping()}>اعتبارسنجی</Button><Button size="sm" loading={actionLoading} icon={<Save className="h-4 w-4" />} onClick={() => void saveMapping()}>ذخیره Mapping</Button></div></div>
            <div className="grid gap-4 sm:grid-cols-2"><Input label="Project Key CDE *" value={mapping.projectKey} onChange={event => setMapping({ ...mapping, projectKey: event.target.value.trim(), webUiRepoName: '', dataServiceRepoName: '', apiModuleRepoName: '', messageConsumerRepoName: '', testPackId: '' })} dir="ltr" placeholder="medu-community" /><Input label="Web UI Repository" value={mapping.webUiRepoName || ''} onChange={event => setMapping({ ...mapping, webUiRepoName: event.target.value })} dir="ltr" placeholder={`${mapping.projectKey || 'project'}/web-ui`} /><Input label="Data Service Repository" value={mapping.dataServiceRepoName || ''} onChange={event => setMapping({ ...mapping, dataServiceRepoName: event.target.value })} dir="ltr" placeholder={`${mapping.projectKey || 'project'}/data-service`} /><Input label="API Module Repository" value={mapping.apiModuleRepoName || ''} onChange={event => setMapping({ ...mapping, apiModuleRepoName: event.target.value })} dir="ltr" placeholder={`${mapping.projectKey || 'project'}/api-module`} /><Input label="Message Consumer Repository" value={mapping.messageConsumerRepoName || ''} onChange={event => setMapping({ ...mapping, messageConsumerRepoName: event.target.value })} dir="ltr" placeholder={`${mapping.projectKey || 'project'}/message-consumer (اختیاری)`} /></div>
            <label className="mt-4 flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={mapping.enabled} onChange={event => setMapping({ ...mapping, enabled: event.target.checked })} />Mapping فعال باشد</label>
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-100 p-3 text-xs leading-6 text-gray-600">اسکریپت‌ها در پنل اتوماسیون، داخل بسته محلی هر منبع (IS / CDE / Git) نوشته و اجرا می‌شوند.</div>
          </Card>
          <Card><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold text-gray-900">محیط‌های اجرا</h2><p className="mt-1 text-xs text-gray-500">Base URL هنگام اجرای تست در اختیار Playwright قرار می‌گیرد.</p></div><Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setEnvironmentForm(emptyEnvironment()); setShowEnvironment(true); }}>افزودن محیط</Button></div>
            {envLoading ? <Loading text="خواندن محیط‌ها…" /> : !environments.length ? <EmptyState text="برای این پروژه محیطی تعریف نشده است." /> : <div className="grid gap-3 lg:grid-cols-2">{environments.map(environment => <div key={environment.id} className="rounded-xl border border-gray-200 p-4"><div className="flex items-start justify-between gap-2"><div className="flex items-center gap-2"><Globe2 className="h-5 w-5 text-blue-500" /><div><p className="font-semibold text-gray-900">{environment.name}</p><Badge tone={environment.enabled && environment.availableNow !== false ? 'green' : environment.enabled ? 'amber' : 'gray'}>{!environment.enabled ? 'غیرفعال' : environment.availableNow === false ? 'خارج از بازه اجرا' : 'قابل اجرا'}</Badge></div></div><div className="flex"><button className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-blue-600" onClick={() => editEnvironment(environment)}><Edit3 className="h-4 w-4" /></button><button className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600" onClick={() => void removeEnvironment(environment)}><Trash2 className="h-4 w-4" /></button></div></div><a href={environment.baseUrl} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-1 break-all font-mono text-xs text-blue-600" dir="ltr">{environment.baseUrl}<ExternalLink className="h-3 w-3 shrink-0" /></a>{environment.apiBaseUrl && <p className="mt-2 break-all font-mono text-[11px] text-gray-400" dir="ltr">API: {environment.apiBaseUrl}</p>}{environment.gatewayBaseUrl && <p className="mt-1 break-all font-mono text-[11px] text-gray-400" dir="ltr">Gateway: {environment.gatewayBaseUrl}</p>}{(environment.availableFrom || environment.availableUntil) && <p className="mt-2 text-[11px] text-gray-500">بازه: {environment.availableFrom ? new Date(environment.availableFrom).toLocaleString('fa-IR') : 'همیشه'} تا {environment.availableUntil ? new Date(environment.availableUntil).toLocaleString('fa-IR') : 'بدون پایان'}</p>}</div>)}</div>}
          </Card>
        </> : <Card><EmptyState text="یک پروژه را انتخاب کنید." /></Card>}</div>
      </div>}
    </main>

    <Modal open={showProject} onClose={() => !actionLoading && setShowProject(false)} title={projectForm.id ? 'ویرایش پروژه' : 'ایجاد پروژه'} footer={<><Button variant="secondary" onClick={() => setShowProject(false)}>انصراف</Button><Button loading={actionLoading} onClick={() => void saveProject()}>ذخیره</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2"><Input label="نام پروژه *" value={projectForm.name} onChange={event => setProjectForm({ ...projectForm, name: event.target.value })} /><Input label="کد انگلیسی *" value={projectForm.code} onChange={event => setProjectForm({ ...projectForm, code: event.target.value.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() })} dir="ltr" placeholder="my-project" /></div>
      <div className="mt-4"><Textarea label="توضیحات" rows={4} value={projectForm.description} onChange={event => setProjectForm({ ...projectForm, description: event.target.value })} /></div>{projectForm.id && <label className="mt-4 flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={projectForm.isActive} onChange={event => setProjectForm({ ...projectForm, isActive: event.target.checked })} />پروژه فعال باشد</label>}
    </Modal>

    <Modal open={showEnvironment} onClose={() => !actionLoading && setShowEnvironment(false)} title={environmentForm.id ? 'ویرایش محیط' : 'افزودن محیط'} footer={<><Button variant="secondary" onClick={() => setShowEnvironment(false)}>انصراف</Button><Button loading={actionLoading} onClick={() => void saveEnvironment()}>ذخیره</Button></>}>
      <div className="space-y-4"><Input label="نام محیط *" value={environmentForm.name} onChange={event => setEnvironmentForm({ ...environmentForm, name: event.target.value })} placeholder="develop / staging / production" /><Input label="Web Base URL *" value={environmentForm.baseUrl} onChange={event => setEnvironmentForm({ ...environmentForm, baseUrl: event.target.value })} dir="ltr" placeholder="https://app.example.com" /><Input label="API Base URL" value={environmentForm.apiBaseUrl} onChange={event => setEnvironmentForm({ ...environmentForm, apiBaseUrl: event.target.value })} dir="ltr" placeholder="https://api.example.com" /><Input label="Gateway Base URL" value={environmentForm.gatewayBaseUrl} onChange={event => setEnvironmentForm({ ...environmentForm, gatewayBaseUrl: event.target.value })} dir="ltr" placeholder="https://gateway.example.com" /><div className="grid gap-4 sm:grid-cols-2"><Input label="قابل اجرا از" type="datetime-local" value={environmentForm.availableFrom} onChange={event => setEnvironmentForm({ ...environmentForm, availableFrom: event.target.value })} /><Input label="قابل اجرا تا" type="datetime-local" value={environmentForm.availableUntil} onChange={event => setEnvironmentForm({ ...environmentForm, availableUntil: event.target.value })} /></div><Textarea label="Secret references (JSON: TARGET_ENV → RUNNER_ENV)" rows={4} value={environmentForm.secretReferencesText} onChange={event => setEnvironmentForm({ ...environmentForm, secretReferencesText: event.target.value })} dir="ltr" /><p className="text-xs text-gray-500">فقط نام متغیرها ثبت می‌شود؛ مقدار Secret باید در Environment خود Runner تعریف شود.</p><label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={environmentForm.enabled} onChange={event => setEnvironmentForm({ ...environmentForm, enabled: event.target.checked })} />محیط فعال باشد</label></div>
    </Modal>
  </div>;
}
