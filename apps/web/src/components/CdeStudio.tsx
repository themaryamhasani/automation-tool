import { useEffect, useRef, useState } from 'react';
import { Play, Save } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import type { CdeConnectionStatus, Paginated, Run, ToolKind } from '../types';
import { CdeWorkspace } from './CdeWorkspace';
import { FilePreview } from './PrettyDocument';
import {
  CreateFileDialog, CreateFolderDialog, EditorPane, FileTree, StudioChrome, StudioTabs, TOOLS,
  inferTool, isPathUnder, needsLiveRuntime, runMismatch, selectedToolKind, type DirEntry, type OpenFile, type SectionId,
} from './studio';
import { Badge, Button, EmptyState, Loading, Select, cn, notify } from './ui';
import { normalizeRun, useRunPoll } from '../useRunPoll';
import { RunReportPanel } from './RunReportPanel';

const SECTIONS: Array<{ id: SectionId; label: string; folder: string; create?: boolean }> = [
  { id: 'source', label: 'سورس CDE', folder: '' },
  { id: 'scripts', label: 'اجرا', folder: 'scripts', create: true },
  { id: 'flows', label: 'فلوها', folder: 'flows', create: true },
  { id: 'cases', label: 'تست‌کیس', folder: 'cases', create: true },
  { id: 'runbooks', label: 'ران‌بوک', folder: 'runbooks', create: true },
  { id: 'checklists', label: 'چک‌لیست', folder: 'checklists', create: true },
  { id: 'reports', label: 'گزارش‌ها', folder: 'reports' },
  { id: 'docs', label: 'اسناد', folder: '' },
];

function flowName(entry: DirEntry) {
  return entry.name.replace(/\.[^.]+$/, '').toUpperCase();
}

function isRemoteCdePath(filePath: string) {
  return /^cde-(tests|db-tests|snapshot)(\/|$)/.test(filePath);
}

function CdeRunHistory({ packId, lastRun }: { packId: string; lastRun: Run | null }) {
  const [rows, setRows] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(lastRun);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!packId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    api<Paginated<Run>>(`/api/runs?sourceApproach=CDE&packId=${encodeURIComponent(packId)}&limit=40`)
      .then(page => {
        const list = page.data.map(row => normalizeRun(row as unknown as Run));
        setRows(list);
        setSelected(current => {
          if (lastRun) return normalizeRun(lastRun);
          return current && list.some(item => item.id === current.id) ? current : list[0] || null;
        });
      })
      .catch(error => notify(error instanceof Error ? error.message : 'خواندن گزارش‌های CDE ناموفق بود.', 'error'))
      .finally(() => setLoading(false));
  }, [packId, lastRun?.id, lastRun?.status]);

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full overflow-hidden">
      <aside className="flex h-full min-h-0 w-64 shrink-0 flex-col overflow-hidden border-l border-slate-800 bg-[#0b1220]">
        <p className="border-b border-slate-800 px-3 py-2 text-[11px] text-slate-400">گزارش‌ها در دیتابیس ابزار — نه IS</p>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading && <Loading text="خواندن اجراها…" />}
          {!loading && !rows.length && <EmptyState text="هنوز اجرایی برای این پروژه CDE در دیتابیس نیست." />}
          {rows.map(run => (
            <button
              key={run.id}
              type="button"
              onClick={() => setSelected(run)}
              className={cn('mb-1 w-full rounded-lg px-2 py-2 text-right text-xs', selected?.id === run.id ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-white/5')}
            >
              <p className="font-medium">{run.toolKind || 'RUN'} · {run.status}</p>
              <p className="mt-0.5 truncate text-[10px] opacity-70" dir="ltr">{run.testFilePath}</p>
            </button>
          ))}
        </div>
      </aside>
      <div className="min-h-0 min-w-0 w-full flex-1 overflow-auto">
        {selected ? <RunReportPanel run={selected} /> : loading ? <Loading text="خواندن گزارش‌ها…" /> : <EmptyState text="یک اجرا را از فهرست انتخاب کنید." />}
      </div>
    </div>
  );
}

export function CdeStudio({ onStatusChange }: { onStatusChange?: (status: CdeConnectionStatus) => void }) {
  const { user } = useAuth();
  const canWrite = user?.role !== 'VIEWER';
  const fileRef = useRef<OpenFile | null>(null);
  const [projectKey, setProjectKey] = useState('');
  const [connected, setConnected] = useState(false);
  const [section, setSection] = useState<SectionId>('source');
  const [root, setRoot] = useState<DirEntry[]>([]);
  const [flows, setFlows] = useState<string[]>(['ALL']);
  const [file, setFile] = useState<OpenFile | null>(null);
  const [query, setQuery] = useState('');
  const [tool, setTool] = useState<ToolKind>('DANGER');
  const [flowId, setFlowId] = useState('ALL');
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
  const packBase = `/api/runtime/packs/CDE/${encodeURIComponent(projectKey)}`;
  const treeQuery = projectKey && section !== 'source' ? `${projectKey}:${section}:${currentSection.folder}` : '';
  const treeLoading = Boolean(treeQuery) && loadedTreeQuery !== treeQuery;

  async function loadDir(pathName: string, recursive = false) {
    if (/^cde-(tests|db-tests|snapshot)(\/|$)/.test(pathName)) return [];
    const extra = recursive ? '&recursive=1' : '';
    const dir = await api<{ entries: DirEntry[] }>(`${packBase}/dir?path=${encodeURIComponent(pathName)}${extra}`);
    return dir.entries;
  }

  async function loadScriptEntries() {
    const scripts = await loadDir('scripts', true).catch(() => [] as DirEntry[]);
    let remote: DirEntry[] = [];
    try {
      const listed = await api<{ entries: DirEntry[] }>(`/api/cde/projects/${encodeURIComponent(projectKey)}/test-files`);
      remote = listed.entries || [];
    } catch { remote = []; }
    const extras: DirEntry[] = [];
    for (const name of ['vitest', 'tests', 'test', 'e2e', 'k6']) {
      if (scripts.some(entry => entry.name === name)) continue;
      try {
        const listed = await loadDir(name, true);
        if (listed.length) extras.push({ name, path: name, type: 'dir', children: listed });
      } catch { /* optional extra test folders */ }
    }
    const localGroup: DirEntry[] = scripts.length || extras.length
      ? [{ name: 'scripts · محلی', path: 'scripts', type: 'dir' as const, children: [...scripts, ...extras] }]
      : [];
    return [...remote, ...localGroup];
  }

  async function refreshFlows() {
    if (!projectKey) { setFlows(['ALL']); return; }
    try {
      const dir = await api<{ entries: DirEntry[] }>(`${packBase}/dir?path=${encodeURIComponent('flows')}`);
      const names = dir.entries.filter(entry => entry.type === 'file').map(flowName);
      setFlows(['ALL', ...names.filter(name => name && name !== 'ALL')]);
    } catch { setFlows(['ALL']); }
  }

  useEffect(() => {
    if (section === 'source' || !projectKey) { setRoot([]); setLoadedTreeQuery(''); return; }
    let cancelled = false;
    setFile(null);
    const loader = section === 'scripts' ? loadScriptEntries() : loadDir(currentSection.folder);
    loader
      .then(async entries => {
        if (cancelled) return;
        setRoot(section === 'docs' ? entries.filter(entry => entry.type === 'file' && /\.(md|txt)$/i.test(entry.name)) : entries);
        if (section !== 'reports') return;
        const board = entries.find(entry => entry.name === '01-status-board.md');
        if (!board) return;
        const loaded = await api<{ path: string; name: string; code: string }>(`${packBase}/file?path=${encodeURIComponent(board.path)}`);
        if (!cancelled) setFile({ path: loaded.path, name: loaded.name, code: loaded.code, original: loaded.code });
      })
      .catch(error => { if (!cancelled) notify(error instanceof Error ? error.message : 'خواندن بسته محلی ناموفق بود.', 'error'); })
      .finally(() => { if (!cancelled) setLoadedTreeQuery(treeQuery); });
    return () => { cancelled = true; };
  }, [projectKey, section, currentSection.folder, treeQuery]);

  useEffect(() => { void refreshFlows(); }, [projectKey]);

  async function openFile(filePath: string) {
    if (dirty && !window.confirm('تغییرات ذخیره نشده از بین می‌رود. ادامه؟')) return;
    try {
      const remote = /^cde-(tests|db-tests|snapshot)\//.test(filePath);
      const loaded = remote
        ? await api<{ path: string; name: string; code: string }>(`/api/cde/projects/${encodeURIComponent(projectKey)}/test-file?path=${encodeURIComponent(filePath)}`)
        : await api<{ path: string; name: string; code: string }>(`${packBase}/file?path=${encodeURIComponent(filePath)}`);
      setFile({ path: loaded.path, name: loaded.name, code: loaded.code, original: loaded.code });
      const inferred = inferTool(loaded.path);
      if (inferred) setTool(inferred);
    } catch (error) { notify(error instanceof Error ? error.message : 'خواندن فایل ناموفق بود.', 'error'); }
  }

  async function saveFile() {
    const current = fileRef.current;
    if (!current || !canWrite || !projectKey) return;
    if (/^cde-(tests|db-tests|snapshot)\//.test(current.path)) {
      notify('فایل‌های تست CDE فقط خواندنی هستند؛ برای ویرایش یک کپی محلی بسازید.', 'error');
      return;
    }
    setSaving(true);
    try {
      await api(`${packBase}/file`, { method: 'PUT', body: JSON.stringify({ path: current.path, sourceCode: current.code }) });
      setFile(item => item ? { ...item, original: item.code } : item);
      notify('در بسته محلی ذخیره شد؛ سورس CDE تغییر نکرد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'ذخیره ناموفق بود.', 'error'); }
    finally { setSaving(false); }
  }

  async function createFile(folder: string, fileName: string, sourceCode: string) {
    if (!canWrite || !projectKey) return;
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
      setRoot(section === 'scripts' ? await loadScriptEntries() : await loadDir(currentSection.folder));
      setLoadedTreeQuery(treeQuery);
      setTreeEpoch(value => value + 1);
      if (section === 'flows') await refreshFlows();
      notify('فایل در automation-tool ساخته شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'ایجاد فایل ناموفق بود.', 'error'); }
    finally { setSaving(false); }
  }

  async function createFolder(folder: string) {
    if (!canWrite || !projectKey) return;
    setSaving(true);
    try {
      await api(`${packBase}/dir`, { method: 'POST', body: JSON.stringify({ path: folder }) });
      setShowFolder(false);
      setRoot(section === 'scripts' ? await loadScriptEntries() : await loadDir(currentSection.folder));
      setLoadedTreeQuery(treeQuery);
      setTreeEpoch(value => value + 1);
      notify('پوشه در بسته محلی ساخته شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'ایجاد پوشه ناموفق بود.', 'error'); }
    finally { setSaving(false); }
  }

  async function deleteEntry(entry: DirEntry) {
    if (!canWrite || !projectKey || isRemoteCdePath(entry.path)) return;
    const label = entry.type === 'dir' ? `پوشه «${entry.path}» و تمام محتویاتش` : `فایل «${entry.path}»`;
    if (!window.confirm(`${label} حذف شود؟ سورس CDE تغییر نمی‌کند.`)) return;
    try {
      await api(`${packBase}/entry?path=${encodeURIComponent(entry.path)}`, { method: 'DELETE' });
      if (file && isPathUnder(entry.path, file.path)) setFile(null);
      setRoot(section === 'scripts' ? await loadScriptEntries() : await loadDir(currentSection.folder));
      setLoadedTreeQuery(treeQuery);
      setTreeEpoch(value => value + 1);
      if (section === 'flows') await refreshFlows();
      notify('از بسته محلی حذف شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'حذف ناموفق بود.', 'error'); }
  }

  async function runTool() {
    if (!projectKey) return;
    const mismatch = runMismatch(tool, file?.path);
    if (mismatch) { notify(mismatch, 'error'); return; }
    const toolKind = selectedToolKind(tool, file?.path);
    setRunning(true);
    try {
      const created = await api<Run>('/api/workspace/runs', {
        method: 'POST',
        body: JSON.stringify({
          sourceApproach: 'CDE',
          packId: projectKey,
          projectKey,
          toolKind,
          flowId: flowId || 'ALL',
          testFilePath: file?.path,
        }),
      });
      setLastRun(normalizeRun({ ...created, toolKind: created.toolKind || toolKind, packId: created.packId || projectKey, status: created.status || 'QUEUED' }));
      notify(created.status === 'PREPARING'
        ? 'اجرا ثبت شد. ابتدا Snapshot سورس CDE ساخته می‌شود (حدود یک دقیقه). این مرحله خطا نیست.'
        : 'اجرا وارد صف شد. گزارش در بسته محلی همین پروژه ذخیره می‌شود.', 'success');
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
  }, [canWrite, projectKey]);

  const editor = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {file
        ? <FilePreview className="h-full" path={file.path} code={file.code} tone="dark" editable={canWrite && !/^cde-(tests|db-tests|snapshot)\//.test(file.path)} onChange={value => setFile(current => current ? { ...current, code: value } : current)} />
        : <EditorPane file={null} canWrite={canWrite} onChange={() => undefined} emptyText="اسکریپت و فلو اینجا نوشته می‌شوند. تست‌های خود CDE از تب اجرا خوانده می‌شوند." />}
    </div>
  );

  return <StudioChrome
    tabs={<StudioTabs
      sections={SECTIONS}
      active={section}
      onChange={id => setSection(id as SectionId)}
      extra={<div className="flex items-center gap-2 text-[11px] text-slate-400">
        <Badge tone={connected ? 'green' : 'amber'}>{connected ? 'CDE متصل' : 'ورود CDE'}</Badge>
        {projectKey && <code dir="ltr" className="max-w-xs truncate text-slate-500">{projectKey}</code>}
      </div>}
    />}
    toolbar={section !== 'source' && section !== 'reports' && projectKey ? (
      section === 'scripts'
        ? <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950/80 px-3 py-2">
          <Select value={tool} onChange={event => setTool(event.target.value as ToolKind)} className="min-w-48 bg-slate-900 text-slate-100">
            {TOOLS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </Select>
          {tool === 'DANGER' && <Select value={flowId} onChange={event => setFlowId(event.target.value)} className="min-w-28 bg-slate-900 text-slate-100">
            {flows.map(flow => <option key={flow} value={flow}>{flow}</option>)}
          </Select>}
          <Button size="sm" loading={running} icon={<Play className="h-3.5 w-3.5" />} onClick={() => void runTool()}>{needsLiveRuntime(tool) ? 'اجرا روی رانتایم Express' : 'اسکن استاتیک'}</Button>
          {canWrite && <Button size="sm" variant="secondary" loading={saving} disabled={!dirty || /^cde-(tests|db-tests|snapshot)\//.test(file?.path || '')} icon={<Save className="h-3.5 w-3.5" />} onClick={() => void saveFile()}>ذخیره</Button>}
        </div>
        : (canWrite ? <div className="flex justify-end border-b border-slate-800 bg-slate-950/80 px-3 py-2">
          <Button size="sm" variant="secondary" loading={saving} disabled={!dirty} icon={<Save className="h-3.5 w-3.5" />} onClick={() => void saveFile()}>ذخیره</Button>
        </div> : undefined)
    ) : undefined}
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
      canDelete={entry => !isRemoteCdePath(entry.path)}
      loadDir={loadDir}
      loading={treeLoading}
      emptyText={section === 'scripts' ? 'فایل تست از CDE پیدا نشد. بعد از اتصال، تست‌های خود CDE اینجاست.' : `فایلی در ${currentSection.label} نیست. از + یک ${section === 'flows' ? 'فلو' : 'فایل'} بسازید.`}
    />}
    body={editor}
    run={lastRun}
    showReport={section === 'scripts'}
    treeStorageKey="cde-tree-width"
    reportStorageKey="cde-report-height"
    override={section === 'source'
      ? <div className="flex min-h-0 flex-1 overflow-hidden">
        <CdeWorkspace onStatusChange={status => { setConnected(Boolean(status.connected)); onStatusChange?.(status); }} onProjectChange={setProjectKey} />
      </div>
      : (!projectKey
        ? (connected ? <Loading text="در حال انتخاب پروژه…" /> : <EmptyState text="ابتدا از تب «سورس CDE» وارد شوید و یک پروژه انتخاب کنید." />)
        : (section === 'reports' ? <CdeRunHistory packId={projectKey} lastRun={lastRun} /> : undefined))}
  >
    <CreateFileDialog
      open={showCreate}
      onClose={() => setShowCreate(false)}
      saving={saving}
      section={section}
      defaultFolder={section === 'scripts' ? 'scripts' : currentSection.folder}
      onCreate={(folder, fileName, source) => void createFile(folder, fileName, source)}
    />
    <CreateFolderDialog
      open={showFolder}
      onClose={() => setShowFolder(false)}
      saving={saving}
      defaultFolder={section === 'scripts' ? 'scripts' : currentSection.folder}
      onCreate={folder => void createFolder(folder)}
    />
  </StudioChrome>;
}
