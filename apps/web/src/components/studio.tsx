import Editor from '@monaco-editor/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown, ChevronLeft, FileCode2, FilePlus2, FolderClosed, FolderOpen, FolderPlus, GitBranch, Search, Trash2,
} from 'lucide-react';
import type { Run, ToolKind } from '../types';
import { IdleReportDock, RunReportPanel } from './RunReportPanel';
import { Button, EmptyState, Input, Loading, Modal, cn } from './ui';

export interface DirEntry { name: string; path: string; type: 'dir' | 'file'; size?: number; children?: DirEntry[] }
export interface OpenFile { path: string; name: string; code: string; original: string }
export type SectionId = 'source' | 'scripts' | 'flows' | 'cases' | 'runbooks' | 'checklists' | 'reports' | 'docs';

export const STUDIO_SECTIONS: Array<{ id: SectionId; label: string; folder: string; create?: boolean }> = [
  { id: 'source', label: 'سورس', folder: '' },
  { id: 'scripts', label: 'اجرا', folder: 'scripts', create: true },
  { id: 'flows', label: 'فلوها', folder: 'flows', create: true },
  { id: 'cases', label: 'تست‌کیس', folder: 'cases', create: true },
  { id: 'runbooks', label: 'ران‌بوک', folder: 'runbooks', create: true },
  { id: 'checklists', label: 'چک‌لیست', folder: 'checklists', create: true },
  { id: 'reports', label: 'گزارش‌ها', folder: 'reports' },
  { id: 'docs', label: 'اسناد', folder: '' },
];

export const TOOLS: Array<{ id: ToolKind; label: string }> = [
  { id: 'DANGER', label: 'Node danger' },
  { id: 'K6', label: 'k6' },
  { id: 'PLAYWRIGHT', label: 'Playwright + Chrome' },
  { id: 'VITEST', label: 'Vitest' },
  { id: 'BIOME', label: 'Biome' },
  { id: 'GITLEAKS', label: 'gitleaks' },
  { id: 'AUDIT', label: 'SCA / npm audit' },
  { id: 'SEMGREP', label: 'Semgrep' },
  { id: 'SPECTRAL', label: 'Spectral' },
  { id: 'AXE', label: 'axe-core' },
];

export const STATIC_TOOL_IDS: ToolKind[] = ['BIOME', 'GITLEAKS', 'AUDIT', 'SEMGREP', 'SPECTRAL'];

export function needsLiveRuntime(tool: ToolKind) {
  return tool === 'DANGER' || tool === 'K6' || tool === 'PLAYWRIGHT' || tool === 'AXE';
}

export function ignoresOpenFile(tool: ToolKind) {
  return STATIC_TOOL_IDS.includes(tool) || tool === 'AXE';
}

export function inferTool(filePath?: string | null): ToolKind | null {
  if (!filePath) return null;
  const path = filePath.replace(/\\/g, '/');
  const name = path.split('/').pop() || '';
  if (/biome\.json$/i.test(name)) return 'BIOME';
  if (/gitleaks/i.test(name)) return 'GITLEAKS';
  if (/openapi|swagger/i.test(name) && /\.(ya?ml|json)$/i.test(name)) return 'SPECTRAL';
  if (/a11y|axe/i.test(name)) return 'AXE';
  if (/\.(spec|test)\.(ts|js)$/i.test(name)) return 'PLAYWRIGHT';
  if (/k6/i.test(name) && /\.js$/i.test(name)) return 'K6';
  if (/\.test\.(cjs|mjs|ts|js)$/i.test(name) || /\/vitest\//i.test(path)) return 'VITEST';
  if (/\.mjs$/i.test(name) || /run-by-flow/i.test(name) || /danger/i.test(path)) return 'DANGER';
  return null;
}

export function selectedToolKind(tool: ToolKind, filePath?: string | null): ToolKind {
  if (ignoresOpenFile(tool)) return tool;
  return inferTool(filePath) || tool;
}

export function toolLabel(kind: ToolKind) {
  return TOOLS.find(item => item.id === kind)?.label || kind;
}

export function isPathUnder(parent: string, child: string) {
  const left = parent.replace(/\\/g, '/').replace(/\/+$/, '');
  const right = child.replace(/\\/g, '/');
  if (!left) return false;
  return right === left || right.startsWith(`${left}/`);
}

export function runMismatch(tool: ToolKind, filePath?: string | null): string | null {
  if (ignoresOpenFile(tool)) return null;
  const inferred = inferTool(filePath);
  if (!inferred || inferred === tool) return null;
  return `این فایل با «${toolLabel(inferred)}» اجرا می‌شود، نه «${toolLabel(tool)}». ابزار را عوض کنید یا فایل مناسب انتخاب کنید.`;
}

export type ArtifactKind = 'playwright' | 'k6' | 'danger' | 'unit' | 'openapi' | 'custom' | 'flow' | 'case' | 'doc';

const ARTIFACTS: Array<{ id: ArtifactKind; label: string; hint: string; ext: string; folder: string; name: string }> = [
  { id: 'playwright', label: 'Playwright', hint: 'تست مرورگر', ext: '.spec.ts', folder: 'scripts/e2e', name: 'scenario' },
  { id: 'k6', label: 'k6', hint: 'بار و HTTP', ext: '.js', folder: 'scripts', name: 'k6' },
  { id: 'danger', label: 'Danger', hint: 'سوئیت API', ext: '.mjs', folder: 'scripts/api', name: 'run' },
  { id: 'unit', label: 'Unit', hint: 'تست واحد Vitest', ext: '.test.cjs', folder: 'scripts/vitest', name: 'runtime' },
  { id: 'openapi', label: 'OpenAPI', hint: 'قرارداد Spectral', ext: '.yaml', folder: 'scripts', name: 'openapi' },
  { id: 'custom', label: 'سفارشی', hint: 'نام و پسوند دلخواه', ext: '.mjs', folder: 'scripts', name: 'script' },
  { id: 'flow', label: 'فلو', hint: 'جریان کسب‌وکار', ext: '.md', folder: 'flows', name: 'FLOW-NEW' },
  { id: 'case', label: 'کیس', hint: 'سناریوی دستی', ext: '.md', folder: 'cases', name: 'TC-001' },
  { id: 'doc', label: 'سند', hint: 'Markdown', ext: '.md', folder: '', name: 'note' },
];

function artifactFileName(kind: ArtifactKind, name: string, ext: string) {
  const raw = String(name || '').trim() || 'script';
  if (kind === 'custom') return raw.includes('.') ? raw : `${raw}${ext}`;
  return raw.endsWith(ext) ? raw : `${raw.replace(/\.[^.]+$/, '')}${ext}`;
}

export function scriptTemplate(fileName: string) {
  if (fileName.endsWith('.spec.ts') || fileName.endsWith('.spec.js') || fileName.endsWith('.test.ts')) {
    return `import { test, expect } from '@playwright/test';

test('scenario', async ({ page, request }) => {
  const base = process.env.AUTOMATION_RUNTIME_URL || process.env.BASE_URL || 'http://127.0.0.1:4012';
  await page.goto(base);
  await expect(page).toHaveTitle(/./);
});
`;
  }
  if (fileName.includes('k6') && fileName.endsWith('.js')) {
    return `import http from 'k6/http';
import { check } from 'k6';

export const options = { vus: 1, duration: '10s' };

export default function () {
  const base = __ENV.AUTOMATION_RUNTIME_URL || __ENV.BASE_URL || 'http://127.0.0.1:4012';
  const res = http.get(\`\${String(base).replace(/\\/$/, '')}/health\`);
  check(res, { 'status is 200': (r) => r.status === 200 });
}
`;
  }
  if (fileName.endsWith('.mjs')) {
    return `const base = process.env.AUTOMATION_RUNTIME_URL || process.env.BASE_URL || 'http://127.0.0.1:4012';
const res = await fetch(\`\${base.replace(/\\/$/, '')}/health\`);
const ok = res.ok;
console.log('--- ALL ---');
console.log(ok ? '  ✓ PASS  TC-001 — health' : '  ✗ FAIL  TC-001 — health');
console.log('=== SUMMARY ===');
console.log(ok ? 'PASS=1  FAIL=0  SKIP=0  TOTAL=1' : 'PASS=0  FAIL=1  SKIP=0  TOTAL=1');
if (!ok) process.exit(1);
`;
  }
  if (fileName.endsWith('.test.cjs') || fileName.endsWith('.test.js')) {
    return `const test = require('node:test');
const assert = require('node:assert/strict');

test('runtime is reachable', () => {
  assert.ok(true);
});
`;
  }
  if (/openapi|swagger/i.test(fileName) && /\.(ya?ml|json)$/i.test(fileName)) {
    return `openapi: 3.0.3
info:
  title: API
  version: 1.0.0
paths:
  /health:
    get:
      summary: Health
      responses:
        '200':
          description: ok
`;
  }
  if (/^FLOW[-_]/i.test(fileName) || fileName.includes('flow')) {
    return `# ${fileName.replace(/\.[^.]+$/, '')}

## هدف
یک جریان کسب‌وکار که با danger / Playwright قابل اجرا است.

## پیش‌شرط
- محیط هدف در دسترس باشد.

## گام‌ها
1. ورود به سامانه
2. انجام سناریو
3. بررسی نتیجه

## نتیجه مورد انتظار
PASS
`;
  }
  return `# ${fileName.replace(/\.[^.]+$/, '')}\n\n`;
}

function folderFor(defaultFolder: string, artifactFolder: string) {
  if (!defaultFolder) return artifactFolder;
  const rest = artifactFolder.split('/').slice(1).join('/');
  return rest ? `${defaultFolder.replace(/\/+$/, '')}/${rest}` : defaultFolder;
}

function languageOf(path?: string) {
  const name = String(path || '').toLowerCase();
  if (name.endsWith('.tsx')) return 'typescript';
  if (name.endsWith('.ts')) return 'typescript';
  if (name.endsWith('.jsx') || name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.cjs')) return 'javascript';
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown';
  if (name.endsWith('.css')) return 'css';
  if (name.endsWith('.html') || name.endsWith('.htm')) return 'html';
  if (name.endsWith('.yml') || name.endsWith('.yaml')) return 'yaml';
  if (name.endsWith('.xml')) return 'xml';
  return 'plaintext';
}

export function CodeEditor({
  value, onChange, readOnly, path,
}: {
  value: string; onChange?: (value: string) => void; readOnly?: boolean; path?: string;
}) {
  return (
    <div className="h-full min-h-0 w-full overflow-hidden" dir="ltr">
      <Editor
        value={value}
        language={languageOf(path)}
        theme="vs-dark"
        path={path || 'untitled'}
        onChange={next => onChange?.(next || '')}
        options={{
          readOnly: Boolean(readOnly),
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontLigatures: false,
          lineHeight: 24,
          wordWrap: 'off',
          automaticLayout: true,
          scrollBeyondLastLine: false,
          renderLineHighlight: 'line',
          tabSize: 2,
          padding: { top: 12, bottom: 12 },
          contextmenu: true,
          folding: true,
          smoothScrolling: true,
        }}
      />
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function SplitPane({
  children, orientation = 'vertical', initial, min = 140, max = 720, storageKey,
}: {
  children: [ReactNode, ReactNode];
  orientation?: 'vertical' | 'horizontal';
  initial: number;
  min?: number;
  max?: number;
  storageKey?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const start = useRef({ pos: 0, size: 0 });
  const vertical = orientation === 'vertical';
  const [limit, setLimit] = useState(max);
  const [size, setSize] = useState(() => {
    if (!storageKey) return initial;
    const stored = Number(localStorage.getItem(storageKey));
    return clamp(Number.isFinite(stored) && stored > 0 ? stored : initial, min, max);
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const room = (vertical ? el.clientHeight : el.clientWidth) - min - 16;
      setLimit(Math.max(min, Math.min(max, room)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [max, min, vertical]);

  const effective = clamp(size, min, limit);

  const onMove = useCallback((event: PointerEvent | React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = vertical ? start.current.pos - event.clientY : start.current.pos - event.clientX;
    setSize(clamp(start.current.size + delta, min, limit));
  }, [limit, min, vertical]);

  const onUp = useCallback((event?: PointerEvent | React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    handleRef.current?.removeAttribute('data-active');
    if (event && 'pointerId' in event) {
      try { handleRef.current?.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    }
  }, []);

  useEffect(() => {
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [onMove, onUp]);

  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, String(effective));
  }, [effective, storageKey]);

  function begin(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragging.current = true;
    start.current = { pos: vertical ? event.clientY : event.clientX, size: effective };
    document.body.style.cursor = vertical ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.setAttribute('data-active', 'true');
  }

  const sizedStyle = vertical
    ? { height: effective, minHeight: effective, flexShrink: 0 }
    : { width: effective, minWidth: effective, flexShrink: 0 };
  return (
    <div ref={containerRef} className={cn('flex h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden', vertical ? 'flex-col' : 'flex-row')}>
      <div className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden', vertical ? 'min-h-0 flex-1' : 'h-full')} style={vertical ? undefined : sizedStyle}>{children[0]}</div>
      <div
        ref={handleRef}
        role="separator"
        aria-orientation={vertical ? 'horizontal' : 'vertical'}
        className={cn('split-handle', vertical ? 'split-handle-row' : 'split-handle-col')}
        onPointerDown={begin}
        onPointerMove={event => onMove(event)}
        onPointerUp={event => onUp(event)}
        title={vertical ? 'برای بزرگ‌کردن گزارش، این نوار را بکشید' : 'کشیدن برای تغییر عرض درخت فایل'}
      />
      <div className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden', vertical ? '' : 'h-full min-w-0 w-full flex-1')} style={vertical ? sizedStyle : undefined}>{children[1]}</div>
    </div>
  );
}

export function StudioReportDock({
  editor, run, storageKey,
}: {
  editor: ReactNode;
  run: Run | null;
  storageKey: string;
}) {
  return (
    <SplitPane orientation="vertical" initial={220} min={140} max={900} storageKey={storageKey}>
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{editor}</div>
      <div className="h-full min-h-0 overflow-auto">
        {run ? <RunReportPanel key={run.id} run={run} /> : <IdleReportDock />}
      </div>
    </SplitPane>
  );
}

export function StudioChrome({
  sidebar, header, tabs, toolbar, hint, tree, body, run, showReport, treeStorageKey, reportStorageKey, children, override,
}: {
  sidebar?: ReactNode;
  header?: ReactNode;
  tabs?: ReactNode;
  toolbar?: ReactNode;
  hint?: ReactNode;
  tree?: ReactNode;
  body?: ReactNode;
  run?: Run | null;
  showReport?: boolean;
  treeStorageKey?: string;
  reportStorageKey?: string;
  children?: ReactNode;
  override?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {sidebar}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#071018]">
        {header}
        {tabs}
        {toolbar}
        {hint}
        {override ?? (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <SplitPane orientation="horizontal" initial={280} min={180} max={480} storageKey={treeStorageKey}>
              {tree}
              {showReport
                ? <StudioReportDock editor={body} run={run || null} storageKey={reportStorageKey || 'studio-report-height'} />
                : <div className="flex min-h-0 flex-1 flex-col">{body}</div>}
            </SplitPane>
          </div>
        )}
        {children}
      </section>
    </div>
  );
}

export function StudioTabs({
  sections, active, onChange, extra,
}: {
  sections: Array<{ id: string; label: string }>;
  active: string;
  onChange: (id: string) => void;
  extra?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 bg-slate-950 px-3 py-2">
      {sections.map(item => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn('rounded-lg px-3 py-1.5 text-xs font-medium', active === item.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white')}
        >{item.label}</button>
      ))}
      {extra && <div className="ms-auto flex items-center gap-2">{extra}</div>}
    </div>
  );
}

export function FileTree({
  entries, selectedPath, query, onQuery, onOpenFile, onCreate, onCreateFolder, onDelete, canDelete, loadDir, emptyText, loading,
}: {
  entries: DirEntry[];
  selectedPath?: string;
  query: string;
  onQuery: (value: string) => void;
  onOpenFile: (path: string) => void;
  onCreate?: () => void;
  onCreateFolder?: () => void;
  onDelete?: (entry: DirEntry) => void;
  canDelete?: (entry: DirEntry) => boolean;
  loadDir: (path: string) => Promise<DirEntry[]>;
  emptyText: string;
  loading?: boolean;
}) {
  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () => entries.filter(entry => !needle || entryMatches(entry, needle)),
    [entries, needle],
  );
  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-slate-800 bg-[#0b1220]">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <Search className="h-3.5 w-3.5 text-slate-500" />
        <input value={query} onChange={event => onQuery(event.target.value)} placeholder="جستجو…" className="w-full bg-transparent text-xs text-slate-200 outline-none" />
        {onCreateFolder && <button type="button" title="پوشه جدید" onClick={onCreateFolder} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"><FolderPlus className="h-4 w-4" /></button>}
        {onCreate && <button type="button" title="فایل جدید" onClick={onCreate} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"><FilePlus2 className="h-4 w-4" /></button>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {loading
          ? <Loading text="در حال خواندن فایل‌ها…" />
          : !visible.length
          ? <EmptyState text={emptyText} />
          : visible.map(entry => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              selectedPath={selectedPath}
              query={needle}
              loadDir={loadDir}
              onOpenFile={onOpenFile}
              onDelete={onDelete}
              canDelete={canDelete}
            />
          ))}
      </div>
    </aside>
  );
}

function entryMatches(entry: DirEntry, needle: string): boolean {
  if (entry.name.toLowerCase().includes(needle) || entry.path.toLowerCase().includes(needle)) return true;
  return (entry.children || []).some(child => entryMatches(child, needle));
}

function TreeNode({
  entry, depth, selectedPath, query, loadDir, onOpenFile, onDelete, canDelete,
}: {
  entry: DirEntry; depth: number; selectedPath?: string; query?: string;
  loadDir: (path: string) => Promise<DirEntry[]>;
  onOpenFile: (path: string) => void;
  onDelete?: (entry: DirEntry) => void;
  canDelete?: (entry: DirEntry) => boolean;
}) {
  const seeded = entry.children;
  const [open, setOpen] = useState(Boolean(seeded?.length && (depth < 2 || query)));
  const [children, setChildren] = useState<DirEntry[] | null>(seeded || null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (seeded) setChildren(seeded);
  }, [seeded]);

  useEffect(() => {
    if (query && entry.type === 'dir' && entryMatches(entry, query)) setOpen(true);
  }, [query, entry]);

  async function toggle() {
    if (entry.type === 'file') { onOpenFile(entry.path); return; }
    if (!open && !children) {
      setLoading(true);
      try { setChildren(await loadDir(entry.path)); }
      finally { setLoading(false); }
    }
    setOpen(current => !current);
  }
  const visibleChildren = (children || []).filter(child => !query || entryMatches(child, query));
  const active = selectedPath === entry.path;
  const Icon = entry.type === 'dir' ? (open ? FolderOpen : FolderClosed) : FileCode2;
  const showDelete = Boolean(onDelete && (!canDelete || canDelete(entry)));
  return <div>
    <div className="group flex w-full items-center">
      <button type="button" onClick={() => void toggle()} style={{ paddingInlineStart: 8 + depth * 12 }} className={cn('flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pe-2 text-left text-[12px] leading-5', active ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-white/5')} dir="ltr">
        {entry.type === 'dir' ? (open ? <ChevronDown className="h-3 w-3 shrink-0 opacity-70" /> : <ChevronLeft className="h-3 w-3 shrink-0 opacity-70" />) : <span className="w-3" />}
        <Icon className={cn('h-3.5 w-3.5 shrink-0', entry.type === 'dir' ? 'text-sky-300' : 'text-indigo-300')} />
        <span className="truncate">{entry.name}</span>
      </button>
      {showDelete && (
        <button
          type="button"
          title="حذف"
          onClick={event => { event.preventDefault(); event.stopPropagation(); onDelete?.(entry); }}
          className={cn('me-1 shrink-0 rounded-md p-1 opacity-0 group-hover:opacity-100 focus:opacity-100', active ? 'text-white hover:bg-white/20' : 'text-rose-300 hover:bg-rose-500/15')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
    {open && <div>{loading && <p className="px-4 py-1 text-[11px] text-slate-500">…</p>}{visibleChildren.map(child => (
      <TreeNode key={child.path} entry={child} depth={depth + 1} selectedPath={selectedPath} query={query} loadDir={loadDir} onOpenFile={onOpenFile} onDelete={onDelete} canDelete={canDelete} />
    ))}</div>}
  </div>;
}

export function CreateFileDialog({
  open, onClose, saving, section, defaultFolder, onCreate,
}: {
  open: boolean;
  onClose: () => void;
  saving?: boolean;
  section: SectionId;
  defaultFolder: string;
  onCreate: (folder: string, fileName: string, source: string) => void;
}) {
  const allowed = ARTIFACTS.filter(item => {
    if (section === 'scripts') return ['playwright', 'k6', 'danger', 'unit', 'openapi', 'custom'].includes(item.id);
    if (section === 'flows') return item.id === 'flow';
    if (section === 'cases') return item.id === 'case';
    return ['doc', 'flow', 'case'].includes(item.id);
  });
  const [kind, setKind] = useState<ArtifactKind>(allowed[0]?.id || 'playwright');
  const [folder, setFolder] = useState(defaultFolder);
  const [name, setName] = useState(allowed[0]?.name || 'scenario');
  const [source, setSource] = useState('');
  const artifact = ARTIFACTS.find(item => item.id === kind) || ARTIFACTS[0];
  const fileName = artifactFileName(kind, name, artifact.ext);

  function applyArtifact(item: (typeof ARTIFACTS)[number]) {
    const nextName = item.name;
    const nextFile = artifactFileName(item.id, nextName, item.ext);
    setKind(item.id);
    setName(nextName);
    setFolder(folderFor(defaultFolder, item.folder));
    setSource(scriptTemplate(nextFile));
  }

  useEffect(() => {
    if (!open) return;
    applyArtifact(allowed[0] || ARTIFACTS[0]);
  }, [open, section, defaultFolder]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ایجاد فایل"
      size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>انصراف</Button><Button loading={saving} disabled={!name.trim() || !source.trim()} onClick={() => onCreate(folder, fileName, source)}>ایجاد</Button></>}
    >
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">نوع فایل</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {allowed.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => applyArtifact(item)}
                className={cn('rounded-xl border px-3 py-2.5 text-right transition', kind === item.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-100')}
              >
                <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                <p className="mt-0.5 text-[11px] text-gray-500">{item.hint}</p>
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="پوشه" value={folder} onChange={event => setFolder(event.target.value)} dir="ltr" />
          <Input label="نام فایل" value={name} onChange={event => setName(event.target.value)} dir="ltr" />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between text-[11px] text-gray-500">
            <span>متن فایل — قابل ویرایش</span>
            <code dir="ltr" className="text-slate-400">{folder}/{fileName}</code>
          </div>
          <div className="h-56 overflow-hidden rounded-xl border border-gray-200">
            <CodeEditor value={source} onChange={setSource} path={fileName} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function CreateFolderDialog({
  open, onClose, saving, defaultFolder, onCreate,
}: {
  open: boolean;
  onClose: () => void;
  saving?: boolean;
  defaultFolder: string;
  onCreate: (folder: string) => void;
}) {
  const [folder, setFolder] = useState(defaultFolder);

  useEffect(() => {
    if (!open) return;
    setFolder(defaultFolder);
  }, [open, defaultFolder]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ایجاد پوشه"
      footer={<><Button variant="secondary" onClick={onClose}>انصراف</Button><Button loading={saving} disabled={!folder.trim()} onClick={() => onCreate(folder.trim())}>ایجاد</Button></>}
    >
      <Input label="مسیر پوشه" value={folder} onChange={event => setFolder(event.target.value)} dir="ltr" placeholder="scripts/e2e" />
      <p className="mt-3 text-[11px] leading-5 text-gray-500">پوشه داخل همین پروژه ساخته می‌شود. بعد می‌توانید فایل تست را داخل آن اضافه کنید.</p>
    </Modal>
  );
}

export function EditorPane({
  file, canWrite, onChange, emptyText, documentPreview,
}: {
  file: OpenFile | null;
  canWrite: boolean;
  onChange: (value: string) => void;
  emptyText: string;
  documentPreview?: ReactNode;
}) {
  if (!file) return <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">{emptyText}</div>;
  if (documentPreview) return <>{documentPreview}</>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-1.5 text-[11px] text-slate-500">
        <code dir="ltr" className="truncate text-slate-400">{file.path}{file.code !== file.original ? ' •' : ''}</code>
        <span className="shrink-0 font-mono text-[10px] text-slate-600">JetBrains Mono · Ctrl+S ذخیره</span>
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor value={file.code} onChange={canWrite ? onChange : undefined} readOnly={!canWrite} path={file.path} />
      </div>
    </div>
  );
}

export function RepoHint({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 border-b border-slate-800 px-4 py-2 text-[11px] text-slate-400">
      <GitBranch className="h-3.5 w-3.5" />{text}
    </p>
  );
}
