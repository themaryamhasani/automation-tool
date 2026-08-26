import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Save } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import type { IsHealthCheck, Run, ToolKind } from '../types';
import { FilePreview } from './PrettyDocument';
import {
  CreateFileDialog, CreateFolderDialog, EditorPane, FileTree, StudioChrome, StudioTabs, TOOLS,
  inferTool, isPathUnder, needsLiveRuntime, runMismatch, selectedToolKind, type DirEntry, type OpenFile, type SectionId,
} from './studio';
import { Badge, Button, EmptyState, Loading, Select, cn, notify } from './ui';
import { normalizeRun, useRunPoll } from '../useRunPoll';
import { runConfigToPayload } from '../tool-options';
import { ToolRunOptionsPanel, useToolRunConfig } from './ToolRunOptions';

interface Product {
  id: string; title: string; docPath: string; relativePath: string; flows: string[]; automatedFlows: string[];
  exists: boolean; hasScripts: boolean; hasReports: boolean; hasCases: boolean; summary: string;
  kind?: string; runnable?: boolean;
}

const SECTIONS: Array<{ id: SectionId; label: string; folder: string; create?: boolean }> = [
  { id: 'scripts', label: 'اجرا', folder: 'scripts', create: true },
  { id: 'flows', label: 'فلوها', folder: 'flows', create: true },
  { id: 'cases', label: 'تست‌کیس', folder: 'cases', create: true },
  { id: 'runbooks', label: 'ران‌بوک', folder: 'runbooks', create: true },
  { id: 'checklists', label: 'چک‌لیست', folder: 'checklists', create: true },
  { id: 'reports', label: 'گزارش‌ها', folder: 'reports' },
  { id: 'docs', label: 'اسناد', folder: '' },
];

export function IsStudio() {
  const { user } = useAuth();
  const canWrite = user?.role !== 'VIEWER';
  const fileRef = useRef<OpenFile | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [packId, setPackId] = useState('INT');
  const [section, setSection] = useState<SectionId>('scripts');
  const [health, setHealth] = useState<{ ready: boolean; message?: string; checks: IsHealthCheck[] } | null>(null);
  const [root, setRoot] = useState<DirEntry[]>([]);
  const [file, setFile] = useState<OpenFile | null>(null);
  const [query, setQuery] = useState('');
  const [tool, setTool] = useState<ToolKind>('DANGER');
  const { config: runConfig, setConfig: setRunConfig } = useToolRunConfig(tool);
  const [flowId, setFlowId] = useState('ALL');
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showFolder, setShowFolder] = useState(false);
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedTreeQuery, setLoadedTreeQuery] = useState('');
  const [treeEpoch, setTreeEpoch] = useState(0);
  fileRef.current = file;

  const product = products.find(item => item.id === packId);
  const currentSection = SECTIONS.find(item => item.id === section) || SECTIONS[0];
  const dirty = Boolean(file && file.code !== file.original);
  const runnable = Boolean(product && product.runnable !== false);
  const folderPath = product ? (currentSection.folder ? `${product.relativePath}/${currentSection.folder}` : product.relativePath) : '';
  const treeQuery = product ? `${product.id}:${folderPath}:${section}` : '';
  const treeLoading = loading || (Boolean(treeQuery) && loadedTreeQuery !== treeQuery);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api<Product[]>('/api/approaches/is/products');
      const live = rows.filter(row => row.exists);
      setProducts(live);
      setPackId(current => live.some(row => row.id === current) ? current : live[0]?.id || 'INT');
    } catch (error) { notify(error instanceof Error ? error.message : 'خواندن پروژه‌های test/doc ناموفق بود.', 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadProducts(); }, [loadProducts]);

  useEffect(() => {
    if (!product) {
      setRoot([]);
      if (!loading) setLoadedTreeQuery('');
      return;
    }
    let cancelled = false;
    setFile(null);
    api<{ entries: DirEntry[] }>(`/api/approaches/is/dir?path=${encodeURIComponent(folderPath)}`)
      .then(async dir => {
        if (cancelled) return;
        setRoot(dir.entries);
        if (section !== 'reports') return;
        const board = dir.entries.find(entry => entry.name === '01-status-board.md');
        if (!board) return;
        const loaded = await api<{ path: string; name: string; code: string }>(`/api/approaches/is/test-file?path=${encodeURIComponent(board.path)}`);
        if (!cancelled) setFile({ path: loaded.path, name: loaded.name, code: loaded.code, original: loaded.code });
      })
      .catch(() => { if (!cancelled) setRoot([]); })
      .finally(() => { if (!cancelled) setLoadedTreeQuery(treeQuery); });
    return () => { cancelled = true; };
  }, [product?.id, folderPath, section, loading, treeQuery]);

  useEffect(() => {
    if (!product || !runnable || section !== 'scripts') { setHealth(null); return; }
    let cancelled = false;
    api<{ ready: boolean; message: string; checks: IsHealthCheck[] }>(`/api/approaches/is/packs/${product.id}/health`)
      .then(row => { if (!cancelled) setHealth(row); })
      .catch(() => { if (!cancelled) setHealth(null); });
    return () => { cancelled = true; };
  }, [product?.id, runnable, section]);

  async function openFile(filePath: string) {
    if (dirty && !window.confirm('تغییرات ذخیره نشده از بین می‌رود. ادامه؟')) return;
    try {
      const loaded = await api<{ path: string; name: string; code: string }>(`/api/approaches/is/test-file?path=${encodeURIComponent(filePath)}`);
      setFile({ path: loaded.path, name: loaded.name, code: loaded.code, original: loaded.code });
      const inferred = inferTool(loaded.path);
      if (inferred) setTool(inferred);
    } catch (error) { notify(error instanceof Error ? error.message : 'خواندن فایل ناموفق بود.', 'error'); }
  }

  async function saveFile() {
    const current = fileRef.current;
    if (!current || !canWrite) return;
    setSaving(true);
    try {
      await api('/api/approaches/is/test-file', { method: 'PUT', body: JSON.stringify({ path: current.path, sourceCode: current.code }) });
      setFile(item => item ? { ...item, original: item.code } : item);
      notify('فایل در test/ ذخیره شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'ذخیره ناموفق بود.', 'error'); }
    finally { setSaving(false); }
  }

  async function createFile(folder: string, fileName: string, sourceCode: string) {
    if (!canWrite) return;
    const fullPath = `${folder.replace(/^\/+|\/+$/g, '')}/${fileName}`.replace(/\/+/g, '/');
    setSaving(true);
    try {
      const saved = await api<{ path: string; name: string; code: string }>('/api/approaches/is/test-file', {
        method: 'PUT', body: JSON.stringify({ path: fullPath, sourceCode, create: true }),
      });
      setShowCreate(false);
      setFile({ path: saved.path, name: saved.name, code: saved.code, original: saved.code });
      const inferred = inferTool(saved.path);
      if (inferred) setTool(inferred);
      const dir = await api<{ entries: DirEntry[] }>(`/api/approaches/is/dir?path=${encodeURIComponent(folderPath)}`);
      setRoot(dir.entries);
      setLoadedTreeQuery(treeQuery);
      setTreeEpoch(value => value + 1);
      notify('فایل جدید ساخته شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'ایجاد فایل ناموفق بود.', 'error'); }
    finally { setSaving(false); }
  }

  async function createFolder(folder: string) {
    if (!canWrite) return;
    setSaving(true);
    try {
      await api('/api/approaches/is/dir', { method: 'POST', body: JSON.stringify({ path: folder }) });
      setShowFolder(false);
      const dir = await api<{ entries: DirEntry[] }>(`/api/approaches/is/dir?path=${encodeURIComponent(folderPath)}`);
      setRoot(dir.entries);
      setLoadedTreeQuery(treeQuery);
      setTreeEpoch(value => value + 1);
      notify('پوشه ساخته شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'ایجاد پوشه ناموفق بود.', 'error'); }
    finally { setSaving(false); }
  }

  async function deleteEntry(entry: DirEntry) {
    if (!canWrite) return;
    const label = entry.type === 'dir' ? `پوشه «${entry.path}» و تمام محتویاتش` : `فایل «${entry.path}»`;
    if (!window.confirm(`${label} حذف شود؟ این کار برگشت‌پذیر نیست.`)) return;
    try {
      await api(`/api/approaches/is/entry?path=${encodeURIComponent(entry.path)}`, { method: 'DELETE' });
      if (file && isPathUnder(entry.path, file.path)) setFile(null);
      const dir = await api<{ entries: DirEntry[] }>(`/api/approaches/is/dir?path=${encodeURIComponent(folderPath)}`);
      setRoot(dir.entries);
      setLoadedTreeQuery(treeQuery);
      setTreeEpoch(value => value + 1);
      notify('حذف شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'حذف ناموفق بود.', 'error'); }
  }

  async function runTool() {
    if (!product || !runnable) return;
    const mismatch = runMismatch(tool, file?.path);
    if (mismatch) { notify(mismatch, 'error'); return; }
    const toolKind = selectedToolKind(tool, file?.path);
    setRunning(true);
    try {
      const created = await api<Run>('/api/workspace/runs', {
        method: 'POST',
        body: JSON.stringify({
          sourceApproach: 'IS',
          packId: product.id,
          toolKind,
          flowId: toolKind === 'DANGER' ? flowId : undefined,
          testFilePath: file?.path,
          ...runConfigToPayload(runConfig),
        }),
      });
      setLastRun(normalizeRun({
        ...created,
        toolKind: created.toolKind || toolKind,
        packId: created.packId || product.id,
        status: created.status || 'QUEUED',
      }));
      notify('اجرا وارد صف شد.', 'success');
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
  }, [canWrite]);

  const editor = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {file
        ? <FilePreview className="h-full" path={file.path} code={file.code} tone="dark" editable={canWrite} onChange={value => setFile(current => current ? { ...current, code: value } : current)} />
        : <EditorPane file={null} canWrite={canWrite} onChange={() => undefined} emptyText={section === 'scripts' ? 'یک اسکریپت را از درخت انتخاب کنید یا فایل جدید بسازید.' : `از درخت ${currentSection.label} یک فایل باز کنید.`} />}
    </div>
  );

  return <StudioChrome
    sidebar={<aside className="flex w-56 shrink-0 flex-col border-l border-slate-800 bg-slate-950">
      <div className="border-b border-slate-800 px-3 py-3">
        <p className="text-[11px] font-semibold tracking-wide text-slate-400">پروژه‌های test/doc</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? <Loading text="خواندن test/doc…" /> : !products.length ? <EmptyState text="پروژه‌ای در test/doc پیدا نشد." /> : products.map(item => <button key={item.id} onClick={() => { setPackId(item.id); setSection('scripts'); }} className={cn('mb-1 w-full rounded-xl border px-3 py-2.5 text-right transition', packId === item.id ? 'border-blue-400/40 bg-blue-500/15' : 'border-transparent hover:bg-white/5')}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-white">{item.title}</span>
            <Badge tone={item.id === packId ? 'blue' : 'gray'}>{item.id}</Badge>
          </div>
          <p className="mt-1 font-mono text-[10px] text-slate-500" dir="ltr">{item.relativePath}</p>
        </button>)}
      </div>
    </aside>}
    tabs={<StudioTabs sections={SECTIONS} active={section} onChange={id => setSection(id as SectionId)} />}
    toolbar={section === 'scripts' ? <div className="space-y-2 border-b border-slate-800 bg-slate-950/80 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
      <Select value={tool} onChange={event => setTool(event.target.value as ToolKind)} className="min-w-48 bg-slate-900 text-slate-100">
        {TOOLS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </Select>
      {tool === 'DANGER' && <Select value={flowId} onChange={event => setFlowId(event.target.value)} className="min-w-28 bg-slate-900 text-slate-100">
        <option value="ALL">ALL</option>
        {(product?.automatedFlows || product?.flows || []).map(flow => <option key={flow} value={flow}>{flow}</option>)}
      </Select>}
      <Button size="sm" loading={running} icon={<Play className="h-3.5 w-3.5" />} disabled={!runnable || (needsLiveRuntime(tool) && health?.ready === false)} onClick={() => void runTool()}>اجرا</Button>
      {canWrite && <Button size="sm" variant="secondary" loading={saving} disabled={!dirty} icon={<Save className="h-3.5 w-3.5" />} onClick={() => void saveFile()}>ذخیره</Button>}
      <div className="ms-auto flex items-center gap-2 text-[11px] text-slate-400">
        {file?.path && <code className="max-w-56 truncate text-slate-500" dir="ltr">{file.name}</code>}
        {health && <Badge tone={health.ready ? 'green' : 'amber'}>{health.ready ? 'runtime آماده' : 'IS را بالا بیاورید'}</Badge>}
      </div>
      </div>
      <ToolRunOptionsPanel tool={tool} config={runConfig} onChange={setRunConfig} />
    </div> : (canWrite ? <div className="flex items-center justify-end gap-2 border-b border-slate-800 bg-slate-950/80 px-3 py-2">
      <Button size="sm" variant="secondary" loading={saving} disabled={!dirty} icon={<Save className="h-3.5 w-3.5" />} onClick={() => void saveFile()}>ذخیره</Button>
    </div> : undefined)}
    hint={<>
      {section === 'scripts' && <p className="border-b border-slate-800 px-3 py-1 text-[11px] text-slate-500">
        <span dir="ltr">.mjs</span> danger · <span dir="ltr">k6-*.js</span> k6 · <span dir="ltr">.spec.ts</span> Playwright · <span dir="ltr">openapi.yaml</span> Spectral · Biome / gitleaks / audit / Semgrep روی کل بسته · axe روی UI زنده
      </p>}
      {section === 'scripts' && health?.checks?.length ? <div className="flex flex-wrap gap-2 border-b border-slate-800 px-3 py-2">{health.checks.map(check => <span key={check.name} className={cn('rounded-full px-2 py-0.5 text-[10px]', check.ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-200')}>{check.name} {check.ok ? `HTTP ${check.status}` : 'down'}</span>)}</div> : null}
    </>}
    tree={<FileTree
      key={`${treeQuery}:${treeEpoch}`}
      entries={section === 'docs' ? root.filter(entry => entry.type === 'file' && /\.md$/i.test(entry.name)) : root}
      selectedPath={file?.path}
      query={query}
      onQuery={setQuery}
      onOpenFile={path => void openFile(path)}
      onCreate={canWrite && currentSection.create ? () => setShowCreate(true) : undefined}
      onCreateFolder={canWrite && currentSection.create ? () => setShowFolder(true) : undefined}
      onDelete={canWrite && currentSection.create ? entry => void deleteEntry(entry) : undefined}
      loadDir={async path => (await api<{ entries: DirEntry[] }>(`/api/approaches/is/dir?path=${encodeURIComponent(path)}`)).entries}
      loading={treeLoading}
      emptyText={`فایلی در ${currentSection.label} نیست.`}
    />}
    body={editor}
    run={lastRun}
    showReport={section === 'scripts' || section === 'reports'}
    treeStorageKey="is-tree-width"
    reportStorageKey="is-report-height"
  >
    <CreateFileDialog open={showCreate} onClose={() => setShowCreate(false)} saving={saving} section={section} defaultFolder={folderPath} onCreate={(folder, fileName, source) => void createFile(folder, fileName, source)} />
    <CreateFolderDialog open={showFolder} onClose={() => setShowFolder(false)} saving={saving} defaultFolder={folderPath} onCreate={folder => void createFolder(folder)} />
  </StudioChrome>;
}
