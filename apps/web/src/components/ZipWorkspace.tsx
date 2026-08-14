import { useCallback, useEffect, useRef, useState } from 'react';
import { FileArchive, Play, Save, Upload } from 'lucide-react';
import { api, uploadBinary } from '../api';
import { useAuth } from '../auth';
import type { Run, SourceStatus, ToolKind } from '../types';
import { FilePreview } from './PrettyDocument';
import {
  CreateFileDialog, CreateFolderDialog, FileTree, SplitPane, StudioReportDock, TOOLS,
  inferTool, runMismatch, selectedToolKind, type DirEntry, type OpenFile,
} from './studio';
import { Button, EmptyState, Loading, Select, cn, notify } from './ui';
import { normalizeRun, useRunPoll } from '../useRunPoll';

function joinPath(folder: string, fileName?: string) {
  return [folder, fileName].filter(Boolean).map(part => String(part).replace(/^\/+|\/+$/g, '')).join('/').replace(/\/+/g, '/');
}

function isUnder(parent: string, child: string) {
  return child === parent || child.startsWith(`${parent}/`);
}

export function ZipWorkspace({ projectId, onStatusChange }: { projectId?: string; onStatusChange?: (status: SourceStatus) => void }) {
  const { user } = useAuth();
  const canWrite = user?.role !== 'VIEWER';
  const fileRef = useRef<OpenFile | null>(null);
  const [ready, setReady] = useState(false);
  const [tree, setTree] = useState<DirEntry[]>([]);
  const [file, setFile] = useState<OpenFile | null>(null);
  const [query, setQuery] = useState('');
  const [boot, setBoot] = useState(Boolean(projectId));
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showFolder, setShowFolder] = useState(false);
  const [tool, setTool] = useState<ToolKind>('PLAYWRIGHT');
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const [treeEpoch, setTreeEpoch] = useState(0);
  fileRef.current = file;
  const dirty = Boolean(file && file.code !== file.original);
  const defaultFolder = file?.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';

  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const loadDir = useCallback(async (dirPath = '') => {
    if (!projectId) return [] as DirEntry[];
    const row = await api<{ entries: DirEntry[] }>(`/api/projects/${projectId}/zip/tree?path=${encodeURIComponent(dirPath)}`);
    return row.entries;
  }, [projectId]);

  const loadTree = useCallback(async (opts?: { boot?: boolean }) => {
    if (!projectId) {
      setTree([]);
      setReady(false);
      setBoot(false);
      return;
    }
    if (opts?.boot) setBoot(true);
    try {
      const entries = await loadDir('');
      setTree(entries);
      setReady(true);
      onStatusChangeRef.current?.({
        ready: true,
        approach: 'ZIP',
        message: entries.length ? 'آرشیو استخراج شد؛ می‌توانید فایل و پوشه اضافه، ذخیره یا حذف کنید.' : 'آرشیو خالی است. فایل یا پوشه جدید بسازید.',
      });
    } catch {
      setTree([]);
      setReady(false);
      onStatusChangeRef.current?.({ ready: false, approach: 'ZIP', message: 'هنوز زیپی آپلود نشده است.' });
    } finally {
      setBoot(false);
    }
  }, [projectId, loadDir]);

  useEffect(() => { void loadTree({ boot: true }); }, [loadTree]);

  async function onFile(upload?: File) {
    if (!projectId || !upload) return;
    setExtracting(true);
    try {
      await uploadBinary(`/api/projects/${projectId}/zip?fileName=${encodeURIComponent(upload.name)}`, upload, upload.name);
      setFile(null);
      notify('زیپ استخراج شد.', 'success');
      await loadTree();
    } catch (error) { notify(error instanceof Error ? error.message : 'آپلود زیپ ناموفق بود.', 'error'); }
    finally { setExtracting(false); }
  }

  async function openFile(filePath: string) {
    if (dirty && !window.confirm('تغییرات ذخیره نشده از بین می‌رود. ادامه؟')) return;
    try {
      const loaded = await api<{ path: string; name?: string; code: string }>(`/api/projects/${projectId}/zip/file?path=${encodeURIComponent(filePath)}`);
      setFile({ path: loaded.path, name: loaded.name || loaded.path.split('/').pop() || loaded.path, code: loaded.code, original: loaded.code });
      const inferred = inferTool(loaded.path);
      if (inferred) setTool(inferred);
    } catch (error) { notify(error instanceof Error ? error.message : 'خواندن فایل ناموفق بود.', 'error'); }
  }

  async function saveFile() {
    const current = fileRef.current;
    if (!current || !canWrite || !projectId) return;
    setSaving(true);
    try {
      await api(`/api/projects/${projectId}/zip/file`, { method: 'PUT', body: JSON.stringify({ path: current.path, sourceCode: current.code }) });
      setFile(item => item ? { ...item, original: item.code } : item);
      notify('فایل در آرشیو ذخیره شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'ذخیره ناموفق بود.', 'error'); }
    finally { setSaving(false); }
  }

  async function createFile(folder: string, fileName: string, sourceCode: string) {
    if (!canWrite || !projectId) return;
    const fullPath = joinPath(folder, fileName);
    setSaving(true);
    try {
      const saved = await api<{ path: string; name: string; code: string }>(`/api/projects/${projectId}/zip/file`, {
        method: 'PUT', body: JSON.stringify({ path: fullPath, sourceCode, create: true }),
      });
      setShowCreate(false);
      setFile({ path: saved.path, name: saved.name, code: saved.code, original: saved.code });
      const inferred = inferTool(saved.path);
      if (inferred) setTool(inferred);
      await loadTree();
      setTreeEpoch(value => value + 1);
      notify('فایل جدید ساخته شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'ایجاد فایل ناموفق بود.', 'error'); }
    finally { setSaving(false); }
  }

  async function createFolder(folder: string) {
    if (!canWrite || !projectId) return;
    setSaving(true);
    try {
      await api(`/api/projects/${projectId}/zip/dir`, { method: 'POST', body: JSON.stringify({ path: folder }) });
      setShowFolder(false);
      await loadTree();
      setTreeEpoch(value => value + 1);
      notify('پوشه ساخته شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'ایجاد پوشه ناموفق بود.', 'error'); }
    finally { setSaving(false); }
  }

  async function deleteEntry(entry: DirEntry) {
    if (!canWrite || !projectId) return;
    const label = entry.type === 'dir' ? `پوشه «${entry.path}» و تمام محتویاتش` : `فایل «${entry.path}»`;
    if (!window.confirm(`${label} حذف شود؟ این کار برگشت‌پذیر نیست.`)) return;
    try {
      await api(`/api/projects/${projectId}/zip/entry?path=${encodeURIComponent(entry.path)}`, { method: 'DELETE' });
      if (file && isUnder(entry.path, file.path)) setFile(null);
      await loadTree();
      setTreeEpoch(value => value + 1);
      notify('حذف شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'حذف ناموفق بود.', 'error'); }
  }

  async function runTool() {
    const mismatch = runMismatch(tool, file?.path);
    if (mismatch) { notify(mismatch, 'error'); return; }
    const toolKind = selectedToolKind(tool, file?.path);
    setRunning(true);
    try {
      const created = await api<Run>('/api/workspace/runs', {
        method: 'POST',
        body: JSON.stringify({ sourceApproach: 'ZIP', toolKind, testFilePath: file?.path }),
      });
      setLastRun(normalizeRun({ ...created, toolKind: created.toolKind || toolKind, status: created.status || 'QUEUED' }));
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
  }, [canWrite, projectId]);

  const editor = (
    <div className="min-h-0 flex-1 overflow-hidden">
      <FilePreview
        path={file?.path}
        code={file?.code}
        tone="dark"
        editable={canWrite && Boolean(file)}
        onChange={value => setFile(current => current ? { ...current, code: value } : current)}
        emptyText="یک فایل از آرشیو باز کنید یا فایل جدید بسازید."
      />
    </div>
  );

  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#071018]">
    <div className={cn('flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3', ready ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-amber-500/20 bg-amber-500/10')}>
      <div className="flex items-center gap-3">
        <FileArchive className="h-5 w-5 text-blue-300" />
        <div>
          <p className="text-sm font-semibold text-white">آپلود ZIP سورس</p>
          <p className="mt-0.5 text-[11px] text-slate-400">آرشیو روی سرور استخراج می‌شود؛ فایل و پوشه را اضافه، ذخیره یا حذف کنید.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={tool} onChange={event => setTool(event.target.value as ToolKind)} className="min-w-44 bg-slate-900 py-1.5 text-xs text-slate-100">
          {TOOLS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </Select>
        <Button size="sm" loading={running} disabled={!ready} icon={<Play className="h-3.5 w-3.5" />} onClick={() => void runTool()}>اجرا</Button>
        {canWrite && ready && <Button size="sm" variant="secondary" loading={saving} disabled={!dirty} icon={<Save className="h-3.5 w-3.5" />} onClick={() => void saveFile()}>ذخیره</Button>}
        <label className="inline-flex">
          <input type="file" accept=".zip,application/zip" className="hidden" onChange={event => void onFile(event.target.files?.[0])} />
          <Button size="sm" loading={extracting} icon={<Upload className="h-4 w-4" />} onClick={event => { event.preventDefault(); (event.currentTarget.previousSibling as HTMLInputElement | null)?.click(); }}>انتخاب ZIP</Button>
        </label>
      </div>
    </div>
    {extracting ? <Loading text="در حال استخراج…" /> : boot ? <Loading text="در حال خواندن آرشیو…" /> : !ready ? <EmptyState text="یک فایل zip انتخاب کنید." /> : (
      <SplitPane orientation="horizontal" initial={280} min={180} max={480} storageKey="zip-tree-width">
        <FileTree
          key={treeEpoch}
          entries={tree}
          selectedPath={file?.path}
          query={query}
          onQuery={setQuery}
          onOpenFile={path => void openFile(path)}
          onCreate={canWrite ? () => setShowCreate(true) : undefined}
          onCreateFolder={canWrite ? () => setShowFolder(true) : undefined}
          onDelete={canWrite ? entry => void deleteEntry(entry) : undefined}
          loadDir={loadDir}
          emptyText="فایلی در آرشیو نیست. از + فایل یا پوشه بسازید."
        />
        <StudioReportDock editor={editor} run={lastRun} storageKey="zip-report-height" />
      </SplitPane>
    )}
    <CreateFileDialog
      open={showCreate}
      onClose={() => setShowCreate(false)}
      saving={saving}
      section="scripts"
      defaultFolder={defaultFolder || 'scripts'}
      onCreate={(folder, fileName, source) => void createFile(folder, fileName, source)}
    />
    <CreateFolderDialog
      open={showFolder}
      onClose={() => setShowFolder(false)}
      saving={saving}
      defaultFolder={defaultFolder || 'scripts'}
      onCreate={folder => void createFolder(folder)}
    />
  </div>;
}
