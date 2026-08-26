import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, KeyRound, Link2, LogOut, Play, RefreshCw, Save } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import type { GitRemoteProject, Run, SourceApproach, ToolKind } from '../types';
import { FilePreview } from './PrettyDocument';
import {
  CreateFileDialog, CreateFolderDialog, EditorPane, FileTree, StudioChrome, StudioTabs, TOOLS,
  inferTool, isPathUnder, runMismatch, selectedToolKind, type DirEntry, type OpenFile, type SectionId,
} from './studio';
import { Button, EmptyState, Input, Loading, Modal, Select, cn, notify } from './ui';
import { normalizeRun, useRunPoll } from '../useRunPoll';
import { runConfigToPayload } from '../tool-options';
import { ToolRunOptionsPanel, useToolRunConfig } from './ToolRunOptions';

const SECTIONS: Array<{ id: SectionId; label: string; folder: string; create?: boolean }> = [
  { id: 'source', label: 'سورس ریپو', folder: '' },
  { id: 'scripts', label: 'اجرا', folder: 'scripts', create: true },
  { id: 'flows', label: 'فلوها', folder: 'flows', create: true },
  { id: 'reports', label: 'گزارش‌ها', folder: 'reports' },
];

const REMOTE_TEST_DIRS = new Set(['tests', 'test', 'e2e', 'playwright', 'cypress', '__tests__', 'spec', 'specs', 'k6', 'performance', 'qa']);

function isLocalPackPath(filePath: string) {
  const value = filePath.replace(/\\/g, '/');
  return value === 'scripts' || /^(scripts|flows|reports|cases|runbooks|checklists)\//.test(value);
}

function packKeyOf(fullName: string) {
  return fullName.replace(/[^\w.-]+/g, '_').slice(0, 120);
}

function flowName(entry: DirEntry) {
  return entry.name.replace(/\.[^.]+$/, '').toUpperCase();
}

export function GitStudio({
  projectId, provider, onStatusChange,
}: {
  projectId?: string;
  provider: 'GITHUB' | 'GIT_EDUS';
  onStatusChange?: () => void;
}) {
  const { user } = useAuth();
  const canWrite = user?.role !== 'VIEWER';
  const approach: SourceApproach = provider;
  const title = provider === 'GITHUB' ? 'GitHub' : 'git.edus.ir';
  const packApproach = provider;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const fileRef = useRef<OpenFile | null>(null);

  const [session, setSession] = useState<{ connected: boolean; username?: string; displayName?: string }>({ connected: false });
  const [projects, setProjects] = useState<GitRemoteProject[]>([]);
  const [selected, setSelected] = useState<GitRemoteProject | null>(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [section, setSection] = useState<SectionId>('source');
  const [root, setRoot] = useState<DirEntry[]>([]);
  const [file, setFile] = useState<OpenFile | null>(null);
  const [query, setQuery] = useState('');
  const [tool, setTool] = useState<ToolKind>('DANGER');
  const { config: runConfig, setConfig: setRunConfig } = useToolRunConfig(tool);
  const [flowId, setFlowId] = useState('ALL');
  const [flows, setFlows] = useState<string[]>(['ALL']);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showFolder, setShowFolder] = useState(false);
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const [loadedTreeQuery, setLoadedTreeQuery] = useState('');
  const [treeEpoch, setTreeEpoch] = useState(0);
  fileRef.current = file;

  const currentSection = SECTIONS.find(item => item.id === section) || SECTIONS[0];
  const dirty = Boolean(file && file.code !== file.original);
  const packKey = selected ? packKeyOf(selected.fullName) : '';
  const packBase = packKey ? `/api/runtime/packs/${packApproach}/${encodeURIComponent(packKey)}` : '';
  const remoteQuery = selected
    ? `remoteId=${encodeURIComponent(selected.id)}&fullName=${encodeURIComponent(selected.fullName)}&ref=${encodeURIComponent(selected.defaultBranch)}`
    : '';
  const treeQuery = selected ? `${selected.id}:${section}:${currentSection.folder}` : '';
  const treeLoading = Boolean(treeQuery) && loadedTreeQuery !== treeQuery;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api<{ connected: boolean; username?: string; displayName?: string }>(`/api/sources/${provider}/session`);
      setSession(next);
      if (next.connected) {
        const payload = await api<{ projects: GitRemoteProject[] }>(`/api/sources/${provider}/projects`);
        setProjects(payload.projects);
      } else {
        setProjects([]);
        setSelected(null);
      }
      onStatusChangeRef.current?.();
    } catch (error) {
      setSession({ connected: false });
      notify(error instanceof Error ? error.message : `اتصال ${title} ناموفق بود.`, 'error');
    } finally { setLoading(false); }
  }, [provider, title]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function login() {
    if (!secret) { notify(provider === 'GITHUB' ? 'Personal Access Token را وارد کنید.' : 'رمز یا Token را وارد کنید.', 'error'); return; }
    setLoading(true);
    try {
      await api(`/api/sources/${provider}/session`, { method: 'POST', body: JSON.stringify({ username, password: secret, token: secret }) });
      setSecret(''); setShowLogin(false); notify(`پروژه‌های ${title} بارگذاری شد.`, 'success');
      await refresh();
    } catch (error) { notify(error instanceof Error ? error.message : 'ورود ناموفق بود.', 'error'); }
    finally { setLoading(false); }
  }

  async function bind(remote: GitRemoteProject) {
    setSelected(remote);
    setSection('source');
    setFile(null);
    if (projectId) {
      await api(`/api/projects/${projectId}/source-binding/remote`, {
        method: 'POST',
        body: JSON.stringify({
          provider, remoteId: remote.id, fullName: remote.fullName, defaultBranch: remote.defaultBranch,
          htmlUrl: remote.htmlUrl, cloneUrl: remote.cloneUrl,
        }),
      }).catch(error => notify(error instanceof Error ? error.message : 'اتصال ریپو ناموفق بود.', 'error'));
    }
  }

  const loadLocalDir = useCallback(async (dirPath: string, recursive = false) => {
    const extra = recursive ? '&recursive=1' : '';
    const dir = await api<{ entries: DirEntry[] }>(`${packBase}/dir?path=${encodeURIComponent(dirPath)}${extra}`);
    return dir.entries;
  }, [packBase]);

  const loadRemoteDir = useCallback(async (dirPath: string, recursive = false) => {
    const extra = recursive ? '&recursive=1' : '';
    const dir = await api<{ entries: DirEntry[] }>(`/api/sources/${provider}/dir?${remoteQuery}&path=${encodeURIComponent(dirPath)}${extra}`);
    return dir.entries;
  }, [provider, remoteQuery]);

  const loadScriptEntries = useCallback(async () => {
    const local = packBase ? await loadLocalDir('scripts', true).catch(() => [] as DirEntry[]) : [];
    let remoteFolders: DirEntry[] = [];
    if (remoteQuery) {
      try {
        const remoteRoot = await loadRemoteDir('');
        const wanted = remoteRoot.filter(entry => entry.type === 'dir' && REMOTE_TEST_DIRS.has(entry.name.toLowerCase()));
        remoteFolders = await Promise.all(wanted.map(async entry => {
          try {
            const children = await loadRemoteDir(entry.path, true);
            return { ...entry, name: `${entry.name} · ریپو`, children };
          } catch {
            return { ...entry, name: `${entry.name} · ریپو` };
          }
        }));
      } catch {
        remoteFolders = [];
      }
    }
    const localGroup: DirEntry[] = local.length
      ? [{ name: 'scripts · محلی', path: 'scripts', type: 'dir' as const, children: local }]
      : [];
    return [...remoteFolders, ...localGroup];
  }, [packBase, remoteQuery, loadLocalDir, loadRemoteDir]);

  async function refreshFlows() {
    if (!packBase) { setFlows(['ALL']); return; }
    try {
      const dir = await loadLocalDir('flows');
      setFlows(['ALL', ...dir.filter(entry => entry.type === 'file').map(flowName)]);
    } catch { setFlows(['ALL']); }
  }

  useEffect(() => {
    setFile(null);
  }, [selected?.id, section]);

  useEffect(() => {
    if (!selected) { setRoot([]); setLoadedTreeQuery(''); return; }
    let cancelled = false;
    const loader = section === 'source'
      ? loadRemoteDir('')
      : section === 'scripts'
        ? loadScriptEntries()
        : loadLocalDir(currentSection.folder);
    loader.then(entries => { if (!cancelled) setRoot(entries); }).catch(error => {
      if (cancelled) return;
      setRoot([]);
      notify(error instanceof Error ? error.message : 'خواندن فایل‌ها ناموفق بود.', 'error');
    }).finally(() => { if (!cancelled) setLoadedTreeQuery(treeQuery); });
    if (section !== 'source') void refreshFlows();
    return () => { cancelled = true; };
  }, [selected?.id, section, currentSection.folder, loadLocalDir, loadRemoteDir, loadScriptEntries, treeQuery]);

  async function openFile(filePath: string) {
    if (dirty && !window.confirm('تغییرات ذخیره نشده از بین می‌رود. ادامه؟')) return;
    const useRemote = section === 'source' || !isLocalPackPath(filePath);
    try {
      const loaded = useRemote
        ? await api<{ path: string; name?: string; code: string }>(`/api/sources/${provider}/file?${remoteQuery}&path=${encodeURIComponent(filePath)}`)
        : await api<{ path: string; name: string; code: string }>(`${packBase}/file?path=${encodeURIComponent(filePath)}`);
      setFile({ path: loaded.path, name: loaded.name || filePath.split('/').pop() || filePath, code: loaded.code, original: loaded.code });
      const inferred = inferTool(loaded.path);
      if (inferred && section !== 'source') setTool(inferred);
    } catch (error) { notify(error instanceof Error ? error.message : 'خواندن فایل ناموفق بود.', 'error'); }
  }

  async function saveFile() {
    const current = fileRef.current;
    if (!current || !canWrite || section === 'source' || !packBase || !isLocalPackPath(current.path)) return;
    setSaving(true);
    try {
      await api(`${packBase}/file`, { method: 'PUT', body: JSON.stringify({ path: current.path, sourceCode: current.code }) });
      setFile(item => item ? { ...item, original: item.code } : item);
      notify('اسکریپت در بسته محلی ذخیره شد؛ ریپو تغییر نکرد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'ذخیره ناموفق بود.', 'error'); }
    finally { setSaving(false); }
  }

  async function createFile(folder: string, fileName: string, sourceCode: string) {
    if (!canWrite || !packBase) return;
    const fullPath = `${folder.replace(/^\/+|\/+$/g, '')}/${fileName}`.replace(/\/+/g, '/');
    setSaving(true);
    try {
      const saved = await api<{ path: string; name: string; code: string }>(`${packBase}/file`, {
        method: 'PUT', body: JSON.stringify({ path: fullPath, sourceCode, create: true }),
      });
      setShowCreate(false);
      setFile({ path: saved.path, name: saved.name, code: saved.code, original: saved.code });
      const inferred = inferTool(saved.path);
      if (inferred) setTool(inferred);
      setRoot(section === 'scripts' ? await loadScriptEntries() : await loadLocalDir(currentSection.folder));
      setLoadedTreeQuery(treeQuery);
      setTreeEpoch(value => value + 1);
      if (section === 'flows') await refreshFlows();
      notify('فایل تست در بسته محلی ساخته شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'ایجاد فایل ناموفق بود.', 'error'); }
    finally { setSaving(false); }
  }

  async function createFolder(folder: string) {
    if (!canWrite || !packBase) return;
    setSaving(true);
    try {
      await api(`${packBase}/dir`, { method: 'POST', body: JSON.stringify({ path: folder }) });
      setShowFolder(false);
      setRoot(section === 'scripts' ? await loadScriptEntries() : await loadLocalDir(currentSection.folder));
      setLoadedTreeQuery(treeQuery);
      setTreeEpoch(value => value + 1);
      notify('پوشه در بسته محلی ساخته شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'ایجاد پوشه ناموفق بود.', 'error'); }
    finally { setSaving(false); }
  }

  async function deleteEntry(entry: DirEntry) {
    if (!canWrite || !packBase || !isLocalPackPath(entry.path)) return;
    const label = entry.type === 'dir' ? `پوشه «${entry.path}» و تمام محتویاتش` : `فایل «${entry.path}»`;
    if (!window.confirm(`${label} حذف شود؟ ریپو تغییر نمی‌کند.`)) return;
    try {
      await api(`${packBase}/entry?path=${encodeURIComponent(entry.path)}`, { method: 'DELETE' });
      if (file && isPathUnder(entry.path, file.path)) setFile(null);
      setRoot(section === 'scripts' ? await loadScriptEntries() : await loadLocalDir(currentSection.folder));
      setLoadedTreeQuery(treeQuery);
      setTreeEpoch(value => value + 1);
      if (section === 'flows') await refreshFlows();
      notify('از بسته محلی حذف شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'حذف ناموفق بود.', 'error'); }
  }

  async function runTool() {
    if (!selected) return;
    const mismatch = runMismatch(tool, file?.path);
    if (mismatch) { notify(mismatch, 'error'); return; }
    const toolKind = selectedToolKind(tool, file?.path);
    setRunning(true);
    try {
      const created = await api<Run>('/api/workspace/runs', {
        method: 'POST',
        body: JSON.stringify({
          sourceApproach: approach,
          packId: packKey,
          toolKind,
          flowId: flowId || 'ALL',
          testFilePath: file?.path,
          ...runConfigToPayload(runConfig),
        }),
      });
      setLastRun(normalizeRun({ ...created, toolKind: created.toolKind || toolKind, packId: created.packId || packKey, status: created.status || 'QUEUED' }));
      notify('اجرا وارد صف شد. سورس ریپو دانلود و اسکریپت‌های محلی روی آن اجرا می‌شوند.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'شروع اجرا ناموفق بود.', 'error'); }
    finally { setRunning(false); }
  }

  useRunPoll(lastRun, setLastRun);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveFile();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canWrite, section, packBase]);

  const visibleProjects = projects.filter(project => !filter.trim() || project.fullName.toLowerCase().includes(filter.trim().toLowerCase()));
  const editor = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {file
        ? <FilePreview className="h-full" path={file.path} code={file.code} tone="dark" editable={canWrite && section !== 'source'} onChange={value => setFile(current => current ? { ...current, code: value } : current)} />
        : <EditorPane file={null} canWrite={canWrite} onChange={() => undefined} emptyText={selected ? (section === 'source' ? 'یک فایل از ریپو باز کنید.' : 'یک فایل تست را از درخت انتخاب کنید. تست‌های ریپو و اسکریپت‌های محلی اینجاست.') : `ابتدا یک پروژه ${title} انتخاب کنید.`} />}
    </div>
  );

  return <StudioChrome
    header={<div className={cn('flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3', session.connected ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-amber-500/20 bg-amber-500/10')}>
      <div className="flex items-center gap-3">
        {session.connected ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <AlertTriangle className="h-5 w-5 text-amber-300" />}
        <div>
          <p className="text-sm font-semibold text-white">{session.connected ? `${title} · ${session.displayName || session.username}` : `اتصال به ${title}`}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">فایل‌های ریپو را ببینید؛ تست‌های همان ریپو در تب اجرا لود می‌شوند.</p>
        </div>
      </div>
      <div className="flex gap-2">
        {session.connected && <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void refresh()}>بازخوانی</Button>}
        {session.connected
          ? <Button size="sm" variant="secondary" icon={<LogOut className="h-4 w-4" />} onClick={() => void api(`/api/sources/${provider}/session`, { method: 'DELETE' }).then(refresh)}>قطع اتصال</Button>
          : <Button size="sm" icon={<Link2 className="h-4 w-4" />} onClick={() => setShowLogin(true)}>ورود {title}</Button>}
      </div>
    </div>}
    sidebar={session.connected ? <aside className="flex w-64 shrink-0 flex-col border-l border-slate-800 bg-slate-950">
      <div className="border-b border-slate-800 px-3 py-2">
        <Input value={filter} onChange={event => setFilter(event.target.value)} placeholder="جستجوی ریپو…" dir="ltr" className="bg-slate-900 py-1.5 text-xs" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {loading ? <Loading text="خواندن ریپوها…" /> : !visibleProjects.length ? <EmptyState text="ریپویی پیدا نشد." /> : visibleProjects.map(project => (
          <button key={project.id} type="button" onClick={() => void bind(project)} className={cn('mb-1 w-full rounded-xl border px-3 py-2 text-right transition', selected?.id === project.id ? 'border-blue-400/40 bg-blue-500/15' : 'border-transparent hover:bg-white/5')}>
            <p className="truncate text-xs font-semibold text-white" dir="ltr">{project.fullName}</p>
            <p className="mt-1 text-[10px] text-slate-500">{project.defaultBranch}{project.private ? ' · private' : ''}</p>
          </button>
        ))}
      </div>
    </aside> : undefined}
    tabs={session.connected ? <StudioTabs
      sections={SECTIONS}
      active={section}
      onChange={id => setSection(id as SectionId)}
      extra={selected && <a href={selected.htmlUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-blue-300"><ExternalLink className="h-3.5 w-3.5" /><span dir="ltr">{selected.fullName}</span></a>}
    /> : undefined}
    toolbar={session.connected && selected && section === 'scripts' ? <div className="space-y-2 border-b border-slate-800 bg-slate-950/80 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
      <Select value={tool} onChange={event => setTool(event.target.value as ToolKind)} className="min-w-48 bg-slate-900 text-slate-100">
        {TOOLS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </Select>
      {tool === 'DANGER' && <Select value={flowId} onChange={event => setFlowId(event.target.value)} className="min-w-28 bg-slate-900 text-slate-100">
        {flows.map(flow => <option key={flow} value={flow}>{flow}</option>)}
      </Select>}
      <Button size="sm" loading={running} icon={<Play className="h-3.5 w-3.5" />} onClick={() => void runTool()}>اجرا روی این ریپو</Button>
      {canWrite && <Button size="sm" variant="secondary" loading={saving} disabled={!dirty} icon={<Save className="h-3.5 w-3.5" />} onClick={() => void saveFile()}>ذخیره</Button>}
      </div>
      <ToolRunOptionsPanel tool={tool} config={runConfig} onChange={setRunConfig} />
    </div> : (session.connected && selected && section !== 'source' && section !== 'scripts' && canWrite ? <div className="flex justify-end border-b border-slate-800 bg-slate-950/80 px-3 py-2">
      <Button size="sm" variant="secondary" loading={saving} disabled={!dirty} icon={<Save className="h-3.5 w-3.5" />} onClick={() => void saveFile()}>ذخیره</Button>
    </div> : undefined)}
    tree={<FileTree
      key={`${treeQuery}:${treeEpoch}`}
      entries={root}
      selectedPath={file?.path}
      query={query}
      onQuery={setQuery}
      onOpenFile={path => void openFile(path)}
      onCreate={canWrite && currentSection.create ? () => setShowCreate(true) : undefined}
      onCreateFolder={canWrite && currentSection.create ? () => setShowFolder(true) : undefined}
      onDelete={canWrite && currentSection.create ? entry => void deleteEntry(entry) : undefined}
      canDelete={entry => isLocalPackPath(entry.path)}
      loadDir={path => (section === 'source' || !isLocalPackPath(path) ? loadRemoteDir(path) : loadLocalDir(path))}
      loading={treeLoading}
      emptyText={section === 'source' ? 'ریپو خالی است یا در دسترس نیست.' : 'تست ریپو یا اسکریپت محلی پیدا نشد.'}
    />}
    body={editor}
    run={lastRun}
    showReport={section === 'scripts' || section === 'reports'}
    treeStorageKey="git-tree-width"
    reportStorageKey="git-report-height"
    override={!session.connected
      ? (loading ? <Loading text="در حال بررسی اتصال…" /> : <EmptyState text={`وارد ${title} شوید تا پروژه‌های حساب شما لود شوند.`} />)
      : (!selected ? (loading ? <Loading text="خواندن ریپوها…" /> : <EmptyState text="یک ریپو را از فهرست انتخاب کنید تا فایل‌ها لود شوند." />) : undefined)}
  >
    <CreateFileDialog
      open={showCreate}
      onClose={() => setShowCreate(false)}
      saving={saving}
      section={section}
      defaultFolder={currentSection.folder || 'scripts'}
      onCreate={(folder, fileName, source) => void createFile(folder, fileName, source)}
    />
    <CreateFolderDialog
      open={showFolder}
      onClose={() => setShowFolder(false)}
      saving={saving}
      defaultFolder={currentSection.folder || 'scripts'}
      onCreate={folder => void createFolder(folder)}
    />
    <Modal open={showLogin} onClose={() => !loading && setShowLogin(false)} title={`ورود ${title}`} footer={<><Button variant="secondary" onClick={() => setShowLogin(false)}>انصراف</Button><Button loading={loading} icon={<KeyRound className="h-4 w-4" />} onClick={() => void login()}>اتصال</Button></>}>
      <p className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-6">
        {provider === 'GITHUB'
          ? 'Personal Access Token با دسترسی repo. فقط ریپوهای همین حساب خوانده می‌شوند.'
          : 'نام کاربری git.edus.ir و رمز، یا Personal Access Token با scope api.'}
      </p>
      <div className="space-y-4">
        <Input label={provider === 'GITHUB' ? 'نام کاربری (اختیاری)' : 'نام کاربری *'} value={username} onChange={event => setUsername(event.target.value)} dir="ltr" />
        <Input label={provider === 'GITHUB' ? 'Personal Access Token *' : 'رمز عبور یا Token *'} type="password" value={secret} onChange={event => setSecret(event.target.value)} dir="ltr" autoComplete="current-password" />
      </div>
    </Modal>
  </StudioChrome>;
}
