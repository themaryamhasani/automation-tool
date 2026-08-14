import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, Download, ExternalLink, FileCode2,
  FolderClosed, FolderOpen, GitBranch, KeyRound, Link2, LogOut, Monitor, RefreshCw, Search, Server, Boxes,
  ShieldCheck,
} from 'lucide-react';
import { api, ApiError } from '../api';
import type {
  CdeBranchSummary, CdeCatalog, CdeConnectionStatus, CdePackageContent, CdeProjectBundle,
  CdeProjectDescriptor, CdeRepositoryType,
} from '../types';
import { FilePreview } from './PrettyDocument';
import { FileTree, SplitPane, type DirEntry } from './studio';
import { Badge, Button, Input, Loading, Modal, cn, notify } from './ui';

const SOURCE_GROUPS: Array<{ id: 'front' | 'back' | 'api'; label: string; hint: string; types: CdeRepositoryType[] }> = [
  { id: 'front', label: 'فرانت', hint: 'Web UI', types: ['WEB_UI'] },
  { id: 'back', label: 'بک', hint: 'Data Service', types: ['DATA_SERVICE', 'MESSAGE_CONSUMER'] },
  { id: 'api', label: 'API', hint: 'API Module', types: ['API_MODULE'] },
];

const TYPE_LABEL: Record<CdeRepositoryType, string> = {
  WEB_UI: 'فرانت', DATA_SERVICE: 'دیتا سرویس', API_MODULE: 'API', MESSAGE_CONSUMER: 'Message Consumer',
};

const GROUP_ICON = { front: Monitor, back: Server, api: Boxes };

function latinDigits(value: string) {
  return value.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
}
function validPhone(value: string) { return /^(?:\+98|0098|98|0)?9\d{9}$/.test(latinDigits(value).replace(/[\s()-]/g, '')); }
function branchKey(branch: CdeBranchSummary) { return branch.selector.kind === 'PUBLIC' ? 'PUBLIC' : `PERSONAL:${branch.selector.randId || ''}:${branch.selector.index ?? ''}`; }
function branchLabel(branch: CdeBranchSummary) {
  const title = typeof branch.meta?.title === 'string' ? branch.meta.title.trim() : '';
  if (branch.selector.kind === 'PUBLIC') return `شاخه عمومی — ${branch.editable ? 'قابل ویرایش' : 'فقط‌خواندنی'}`;
  const number = Number.isInteger(branch.selector.index) ? Number(branch.selector.index) + 1 : null;
  return `${title || `شاخه شخصی${number ? ` ${number}` : ''}`} — ${branch.editable ? 'قابل ویرایش' : 'فقط‌خواندنی'}`;
}

type PackNode = { name: string; path: string; pack?: { id: string; branches: CdeBranchSummary[] }; children: PackNode[] };

function packagesToTree(packages: Array<{ id: string; branches: CdeBranchSummary[] }>): PackNode[] {
  const root: PackNode[] = [];
  for (const pkg of packages) {
    const parts = String(pkg.id || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (!parts.length) continue;
    let level = root;
    let acc = '';
    parts.forEach((part, index) => {
      acc = acc ? `${acc}/${part}` : part;
      let node = level.find(item => item.name === part);
      if (!node) {
        node = { name: part, path: acc, children: [] };
        level.push(node);
      }
      if (index === parts.length - 1) node.pack = pkg;
      level = node.children;
    });
  }
  const sort = (rows: PackNode[]) => {
    rows.sort((left, right) => Number(!left.pack) - Number(!right.pack) || left.name.localeCompare(right.name));
    rows.forEach(row => sort(row.children));
  };
  sort(root);
  return root;
}

function filesToEntries(files: Array<{ path: string }>): DirEntry[] {
  const root: DirEntry[] = [];
  const ensure = (level: DirEntry[], name: string, full: string, type: 'dir' | 'file') => {
    let node = level.find(item => item.name === name && item.type === type);
    if (!node) {
      node = { name, path: full, type, children: type === 'dir' ? [] : undefined };
      level.push(node);
    }
    if (type === 'dir' && !node.children) node.children = [];
    return node;
  };
  for (const file of files) {
    const parts = file.path.replace(/\\/g, '/').split('/').filter(Boolean);
    let level = root;
    parts.forEach((part, index) => {
      const full = parts.slice(0, index + 1).join('/');
      const isFile = index === parts.length - 1;
      const node = ensure(level, part, full, isFile ? 'file' : 'dir');
      level = node.children || [];
    });
  }
  const sort = (rows: DirEntry[]) => {
    rows.sort((left, right) => Number(right.type === 'dir') - Number(left.type === 'dir') || left.name.localeCompare(right.name));
    rows.forEach(row => { if (row.children) sort(row.children); });
  };
  sort(root);
  return root;
}

function PackTreeNode({
  node, depth, selectedId, onSelect,
}: {
  node: PackNode; depth: number; selectedId?: string; onSelect: (pack: { id: string; branches: CdeBranchSummary[] }) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const active = selectedId === node.pack?.id;
  const hasKids = node.children.length > 0;
  return (
    <div>
      <button
        type="button"
        onClick={() => { if (node.pack) onSelect(node.pack); if (hasKids) setOpen(current => !current); }}
        style={{ paddingInlineStart: 8 + depth * 12 }}
        className={cn('flex w-full items-center gap-1.5 rounded-md py-1 pe-2 text-left text-[12px] leading-5', active ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-white/5')}
        dir="ltr"
      >
        {hasKids ? (open ? <ChevronDown className="h-3 w-3 shrink-0 opacity-70" /> : <ChevronLeft className="h-3 w-3 shrink-0 opacity-70" />) : <span className="w-3" />}
        {hasKids && !node.pack
          ? (open ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-sky-300" /> : <FolderClosed className="h-3.5 w-3.5 shrink-0 text-sky-300" />)
          : <FileCode2 className="h-3.5 w-3.5 shrink-0 text-indigo-300" />}
        <span className="truncate">{node.name}</span>
      </button>
      {open && hasKids && node.children.map(child => (
        <PackTreeNode key={child.path} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}

export function CdeWorkspace({ projectId, onStatusChange, onProjectChange }: { projectId?: string; onStatusChange?: (status: CdeConnectionStatus) => void; onProjectChange?: (projectKey: string) => void }) {
  const [status, setStatus] = useState<CdeConnectionStatus>({ connected: false });
  const [projects, setProjects] = useState<CdeProjectDescriptor[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [catalog, setCatalog] = useState<CdeCatalog | null>(null);
  const [groupId, setGroupId] = useState<(typeof SOURCE_GROUPS)[number]['id']>('front');
  const [packageContent, setPackageContent] = useState<CdePackageContent | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ path: string; code: string } | null>(null);
  const [pending, setPending] = useState<{ type: CdeRepositoryType; repoName: string; packId: string; branches: CdeBranchSummary[] } | null>(null);
  const [projectQuery, setProjectQuery] = useState('');
  const [projectMenu, setProjectMenu] = useState(false);
  const [fileQuery, setFileQuery] = useState('');
  const [packQuery, setPackQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [packageLoading, setPackageLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loginStep, setLoginStep] = useState<'phone' | 'password'>('phone');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState('');
  const [loginError, setLoginError] = useState('');

  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const onProjectChangeRef = useRef(onProjectChange);
  onProjectChangeRef.current = onProjectChange;
  const publishStatus = useCallback((next: CdeConnectionStatus) => { setStatus(next); onStatusChangeRef.current?.(next); }, []);
  const loadProjects = useCallback(async () => {
    const rows = await api<CdeProjectDescriptor[]>('/api/cde/projects');
    setProjects(rows); setSelectedProject(current => rows.some(row => row.projectKey === current) ? current : rows[0]?.projectKey || '');
  }, []);
  const refreshSession = useCallback(async (verify = false) => {
    setLoading(true);
    try {
      const next = await api<CdeConnectionStatus>(verify ? '/api/cde/session?verify=true' : '/api/cde/session');
      publishStatus(next);
      if (next.connected) await loadProjects(); else { setProjects([]); setSelectedProject(''); setCatalog(null); }
      if (next.unavailable && next.message) notify(next.message, 'error');
    } catch (error) {
      publishStatus({ connected: false, unavailable: true, message: error instanceof Error ? error.message : 'اتصال CDE ناموفق بود.' });
      notify(error instanceof Error ? error.message : 'اتصال CDE ناموفق بود.', 'error');
    }
    finally { setLoading(false); }
  }, [loadProjects, publishStatus]);
  useEffect(() => { void refreshSession(); }, [refreshSession]);
  useEffect(() => { onProjectChangeRef.current?.(selectedProject); }, [selectedProject]);

  async function loadCatalog(projectKey: string) {
    setCatalogLoading(true); setCatalog(null); setPackageContent(null); setSelectedFile(null); setPending(null);
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    try {
      const next = await api<CdeCatalog>(`/api/cde/projects/${encodeURIComponent(projectKey)}/catalog${query}`);
      setCatalog(next);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'خواندن Catalog از CDE ناموفق بود.', 'error');
      if (error instanceof ApiError && ['CDE_RECONNECT_REQUIRED', 'CDE_NOT_CONNECTED'].includes(error.code)) publishStatus({ connected: false, reconnectRequired: true });
    } finally { setCatalogLoading(false); }
  }

  useEffect(() => {
    if (!selectedProject || !status.connected) return;
    void loadCatalog(selectedProject);
  }, [selectedProject, status.connected]);

  useEffect(() => {
    if (!projectId || !status.connected || !projects.length) return;
    api<{ projectKey: string }>(`/api/projects/${encodeURIComponent(projectId)}/cde-mapping`).then(mapping => {
      if (projects.some(project => project.projectKey === mapping.projectKey)) setSelectedProject(mapping.projectKey);
    }).catch(() => undefined);
  }, [projectId, status.connected, projects]);

  async function login() {
    if (loginStep === 'phone' && !validPhone(phone)) { setLoginError('شماره همراه معتبر وارد کنید؛ مانند ۰۹۱۲۱۲۳۴۵۶۷.'); return; }
    if (loginStep === 'password' && !password) { setLoginError('رمز عبور CDE را وارد کنید.'); return; }
    setLoading(true); setLoginError('');
    try {
      if (loginStep === 'phone') {
        const response = await api<CdeConnectionStatus>('/api/cde/session/start', { method: 'POST', body: JSON.stringify({ userLoginName: phone }) });
        if (response.connected) { publishStatus(response); setShowLogin(false); await loadProjects(); }
        else { setChallenge(response.challenge || ''); setLoginStep('password'); }
      } else {
        const response = await api<CdeConnectionStatus>('/api/cde/session/password', { method: 'POST', body: JSON.stringify({ challenge, password }) });
        publishStatus(response); setPassword(''); setShowLogin(false); await loadProjects(); notify('اتصال CDE برقرار شد.', 'success');
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CDE_LOGIN_CHALLENGE_EXPIRED') { setLoginStep('phone'); setChallenge(''); setPassword(''); }
      setLoginError(error instanceof Error ? error.message : 'ورود به CDE ناموفق بود.');
    } finally { setLoading(false); }
  }
  async function disconnect() {
    await api('/api/cde/session', { method: 'DELETE' }); publishStatus({ connected: false }); setProjects([]); setCatalog(null); setPackageContent(null); setPending(null); notify('اتصال CDE قطع شد.', 'success');
  }
  async function openPackage(type: CdeRepositoryType, repoName: string, packId: string, branch?: CdeBranchSummary, selectBranch = false) {
    if (!selectedProject) return;
    setPackageLoading(true);
    if (!selectBranch) { setPackageContent(null); setSelectedFile(null); }
    try {
      const content = await api<CdePackageContent>(`/api/cde/projects/${encodeURIComponent(selectedProject)}/package`, {
        method: 'POST',
        body: JSON.stringify({
          repositoryType: type,
          packId,
          ...(projectId ? { projectId } : {}),
          ...(branch ? { branch: branch.selector } : {}),
          ...(selectBranch && !branch ? { selectBranch: true } : {}),
        }),
      });
      setPackageContent(content); setSelectedFile(content.files[0] || null); setPending(null); setFileQuery('');
      if (branch && projectId) await api(`/api/projects/${projectId}/cde-branch-selection`, { method: 'POST', body: JSON.stringify({ repositoryType: type, repoName, packId, branch: branch.selector }) }).catch(() => undefined);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'BRANCH_SELECTION_REQUIRED') {
        const branches = (error.details as { branches?: CdeBranchSummary[] } | undefined)?.branches || [];
        setPending({ type, repoName, packId, branches });
        setPackageContent(null);
        setSelectedFile(null);
      } else notify(error instanceof Error ? error.message : 'خواندن پکیج ناموفق بود.', 'error');
    } finally { setPackageLoading(false); }
  }

  function choosePack(type: CdeRepositoryType, repoName: string, pkg: { id: string; branches: CdeBranchSummary[] }) {
    setPackageContent(null);
    setSelectedFile(null);
    if (pkg.branches?.length) {
      setPending({ type, repoName, packId: pkg.id, branches: pkg.branches });
      return;
    }
    void openPackage(type, repoName, pkg.id, undefined, true);
  }
  async function downloadBundle() {
    if (!selectedProject) return;
    setDownloading(true);
    try {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
      const bundle = await api<CdeProjectBundle>(`/api/cde/projects/${encodeURIComponent(selectedProject)}/bundle${query}`);
      const { default: JSZip } = await import('jszip'); const zip = new JSZip();
      for (const file of bundle.files) zip.file(file.path, file.code);
      zip.file('automation-cde-source-manifest.json', JSON.stringify({ format: bundle.format, projectKey: bundle.projectKey, approach: bundle.approach, generatedAt: bundle.generatedAt, repositoryTypes: bundle.repositoryTypes, packages: bundle.packages, warnings: bundle.warnings }, null, 2));
      const archive = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const url = URL.createObjectURL(archive); const anchor = document.createElement('a'); anchor.href = url; anchor.download = bundle.fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
      notify(bundle.warnings.length ? `دانلود انجام شد؛ ${bundle.warnings.length.toLocaleString('fa-IR')} هشدار در manifest ثبت شد.` : 'سورس کامل پروژه دانلود شد.', bundle.warnings.length ? 'info' : 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'دانلود سورس کامل پروژه ناموفق بود.', 'error'); }
    finally { setDownloading(false); }
  }

  const currentDescriptor = projects.find(row => row.projectKey === selectedProject);
  const group = SOURCE_GROUPS.find(item => item.id === groupId) || SOURCE_GROUPS[0];
  const groupRepos = catalog?.repositories.filter(row => group.types.includes(row.type)) || [];
  const packCount = (type: CdeRepositoryType) => catalog?.repositories.find(row => row.type === type)?.packages.length || 0;
  const groupCount = (id: typeof groupId) => {
    const types = SOURCE_GROUPS.find(item => item.id === id)?.types || [];
    return types.reduce((sum, type) => sum + packCount(type), 0);
  };
  const fileEntries = useMemo(() => filesToEntries(packageContent?.files || []), [packageContent]);
  const currentBranches = packageContent?.branches || pending?.branches || [];
  const filteredProjects = useMemo(() => {
    const needle = projectQuery.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter(project => project.projectKey.toLowerCase().includes(needle));
  }, [projects, projectQuery]);

  return <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
    <div className={cn('flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2', status.connected ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10')}>
      <div className="flex min-w-0 items-center gap-2">
        {status.connected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{status.connected ? `CDE متصل${status.user?.displayName ? ` · ${status.user.displayName}` : ''}` : loading ? 'در حال بررسی اتصال CDE' : status.unavailable ? 'سرویس CDE در دسترس نیست' : status.reconnectRequired ? 'نشست CDE منقضی شده' : 'ورود به CDE'}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">{status.connected ? 'فرانت، بک یا API را از سایدبار انتخاب کنید.' : loading ? 'صبر کنید تا وضعیت نشست مشخص شود.' : status.message || 'رمز فقط برای ورود ارسال می‌شود و ذخیره نمی‌شود.'}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {status.connected && (
          <div className="relative min-w-52">
            <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              <input
                value={projectMenu ? projectQuery : (selectedProject || projectQuery)}
                onChange={event => { setProjectQuery(event.target.value); setProjectMenu(true); }}
                onFocus={() => { setProjectMenu(true); setProjectQuery(selectedProject); }}
                onBlur={() => window.setTimeout(() => setProjectMenu(false), 180)}
                placeholder="جستجوی پروژه CDE…"
                className="w-full bg-transparent py-1.5 text-xs text-slate-100 outline-none"
                dir="ltr"
              />
            </div>
            {projectMenu && (
              <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 py-1 shadow-xl">
                {filteredProjects.length ? filteredProjects.map(project => (
                  <button
                    key={project.projectKey}
                    type="button"
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => {
                      setSelectedProject(project.projectKey);
                      setProjectQuery(project.projectKey);
                      setProjectMenu(false);
                      setCatalog(null);
                      setPackageContent(null);
                      setPending(null);
                    }}
                    className={cn('block w-full px-3 py-1.5 text-left text-xs hover:bg-white/5', selectedProject === project.projectKey ? 'bg-blue-500/15 text-blue-200' : 'text-slate-200')}
                    dir="ltr"
                  >{project.projectKey}</button>
                )) : <p className="px-3 py-2 text-[11px] text-slate-500">{loading ? 'در حال خواندن پروژه‌ها…' : 'پروژه‌ای پیدا نشد.'}</p>}
              </div>
            )}
          </div>
        )}
        {status.connected && <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => selectedProject ? void loadCatalog(selectedProject) : void refreshSession(true)}>بازخوانی</Button>}
        {status.connected && <Button size="sm" variant="secondary" loading={downloading} icon={<Download className="h-4 w-4" />} disabled={!selectedProject} onClick={() => void downloadBundle()}>دانلود</Button>}
        {status.connected ? <Button size="sm" variant="secondary" icon={<LogOut className="h-4 w-4" />} onClick={() => void disconnect()}>قطع</Button> : <Button size="sm" icon={<Link2 className="h-4 w-4" />} onClick={() => { setLoginStep('phone'); setLoginError(''); setShowLogin(true); }}>اتصال</Button>}
        {currentDescriptor && Object.entries(currentDescriptor.editorUrls).map(([key, url]) => <a key={key} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1.5 text-[11px] text-blue-300 hover:bg-white/5"><ExternalLink className="h-3.5 w-3.5" />{key === 'webUi' ? 'فرانت' : key === 'dataService' ? 'Data' : 'Gateway'}</a>)}
      </div>
    </div>

    {status.connected ? (
      <div className="flex min-h-0 min-w-0 w-full flex-1 overflow-hidden">
        <aside className="flex h-full min-h-0 w-56 shrink-0 flex-col overflow-hidden border-l border-slate-800 bg-slate-950">
          <div className="shrink-0 border-b border-slate-800 px-3 py-2">
            <p className="text-[11px] font-semibold tracking-wide text-slate-400">منبع CDE</p>
          </div>
          <div className="shrink-0 space-y-1 p-2">
            {SOURCE_GROUPS.map(item => {
              const Icon = GROUP_ICON[item.id];
              const active = groupId === item.id;
              return (
                <button key={item.id} type="button" onClick={() => { setGroupId(item.id); setPending(null); setPackageContent(null); setSelectedFile(null); setPackQuery(''); }} className={cn('flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-right transition', active ? 'border-blue-400/40 bg-blue-500/15' : 'border-transparent hover:bg-white/5')}>
                  <span className="flex items-center gap-2">
                    <Icon className={cn('h-4 w-4', active ? 'text-blue-300' : 'text-slate-500')} />
                    <span>
                      <span className="block text-sm font-semibold text-white">{item.label}</span>
                      <span className="block text-[10px] text-slate-500">{item.hint}</span>
                    </span>
                  </span>
                  <Badge tone={active ? 'blue' : 'gray'}>{groupCount(item.id).toLocaleString('fa-IR')}</Badge>
                </button>
              );
            })}
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t border-slate-800">
            <div className="shrink-0 px-3 py-2">
              <input value={packQuery} onChange={event => setPackQuery(event.target.value)} placeholder="جستجوی پکیج…" className="w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 outline-none" dir="ltr" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
              {catalogLoading ? <Loading text="خواندن پکیج‌ها…" /> : groupRepos.map(repository => {
                const q = packQuery.trim().toLowerCase();
                const packages = q ? repository.packages.filter(pkg => pkg.id.toLowerCase().includes(q)) : repository.packages;
                const tree = packagesToTree(packages);
                return (
                  <div key={repository.type} className="mb-3">
                    <p className="px-2 pb-1 text-[10px] font-semibold text-slate-500" dir="ltr">{TYPE_LABEL[repository.type]} · {repository.repoName}</p>
                    {repository.error && <p className="mx-2 rounded-lg bg-red-500/10 p-2 text-[11px] text-red-300">{repository.error.message}</p>}
                    {!repository.error && !packages.length && <p className="px-2 text-[11px] text-slate-500">پکیجی یافت نشد.</p>}
                    {tree.map(node => (
                      <PackTreeNode
                        key={node.path}
                        node={node}
                        depth={0}
                        selectedId={packageContent?.packId || pending?.packId}
                        onSelect={pkg => choosePack(repository.type, repository.repoName, pkg)}
                      />
                    ))}
                  </div>
                );
              })}
              {!catalogLoading && !groupRepos.length && <p className="px-3 text-[11px] text-slate-500">برای این بخش پکیجی برنگشت.</p>}
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-[#071018]">
          {packageLoading && <div className="p-4"><Loading text="دریافت پکیج…" /></div>}
          {!packageLoading && pending && (
            <div className="flex min-h-0 flex-1 flex-col overflow-auto p-6">
              <div className="mb-4 flex items-center gap-2 text-slate-200">
                <GitBranch className="h-4 w-4 text-blue-300" />
                <div>
                  <p className="text-sm font-semibold">انتخاب برنچ</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-500" dir="ltr">{pending.packId}</p>
                </div>
              </div>
              <div className="mx-auto grid w-full max-w-xl gap-2">
                {pending.branches.length ? pending.branches.map(branch => (
                  <button key={branchKey(branch)} type="button" onClick={() => void openPackage(pending.type, pending.repoName, pending.packId, branch)} className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-right hover:border-blue-400/40 hover:bg-blue-500/10">
                    <span className="text-sm text-slate-100">{branchLabel(branch)}</span>
                    <Badge tone={branch.selector.kind === 'PUBLIC' ? 'green' : 'purple'}>{branch.versionId || 'بدون نسخه'}</Badge>
                  </button>
                )) : <p className="rounded-xl border border-slate-800 p-4 text-sm text-slate-400">برنچی برای این پکیج برنگشت.</p>}
              </div>
            </div>
          )}
          {!packageLoading && !pending && packageContent && (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-2">
                <GitBranch className="h-3.5 w-3.5 text-slate-500" />
                <code className="max-w-md truncate text-[11px] text-slate-400" dir="ltr">{packageContent.packId}</code>
                <select
                  value={branchKey(packageContent.branch)}
                  onChange={event => {
                    const branch = currentBranches.find(item => branchKey(item) === event.target.value);
                    if (branch) void openPackage(packageContent.repositoryType, packageContent.repoName, packageContent.packId, branch);
                  }}
                  className="ms-auto max-w-xs rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
                >
                  {(currentBranches.length ? currentBranches : [packageContent.branch]).map(branch => <option key={branchKey(branch)} value={branchKey(branch)}>{branchLabel(branch)}</option>)}
                </select>
              </div>
              <div className="flex min-h-0 min-w-0 w-full flex-1 overflow-hidden">
              <SplitPane orientation="horizontal" initial={260} min={160} max={420} storageKey="cde-source-tree-width">
                <FileTree
                  entries={fileEntries}
                  selectedPath={selectedFile?.path}
                  query={fileQuery}
                  onQuery={setFileQuery}
                  onOpenFile={path => setSelectedFile(packageContent.files.find(file => file.path === path) || null)}
                  loadDir={async path => fileEntries.flatMap(function walk(entry): DirEntry[] {
                    if (entry.path === path) return entry.children || [];
                    return (entry.children || []).flatMap(walk);
                  })}
                  emptyText="فایلی در این پکیج نیست."
                />
                <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
                  <code className="shrink-0 truncate border-b border-slate-800 px-3 py-1.5 text-[11px] text-slate-500" dir="ltr">{selectedFile?.path}</code>
                  <div className="min-h-0 min-w-0 w-full flex-1 overflow-hidden">
                    <FilePreview className="h-full w-full" path={selectedFile?.path} code={selectedFile?.code} tone="dark" emptyText="یک فایل از درخت انتخاب کنید." />
                  </div>
                </div>
              </SplitPane>
              </div>
            </>
          )}
          {!packageLoading && !pending && !packageContent && (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
              یک پکیج را از درخت {group.label} انتخاب کنید تا برنچ و فایل‌ها در این بخش باز شوند.
            </div>
          )}
        </section>
      </div>
    ) : (
      <div className="flex flex-1 items-center justify-center p-8">
        {loading
          ? <Loading text="در حال بررسی نشست CDE…" />
          : <p className="text-center text-sm text-slate-500">برای مرور فرانت، بک یا API ابتدا به CDE وصل شوید.</p>}
      </div>
    )}

    <Modal open={showLogin} onClose={() => !loading && setShowLogin(false)} title="اتصال امن به CDE" footer={<><Button variant="secondary" onClick={() => setShowLogin(false)}>انصراف</Button><Button loading={loading} icon={loginStep === 'phone' ? <KeyRound className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />} onClick={() => void login()}>{loginStep === 'phone' ? 'ادامه' : 'اتصال'}</Button></>}>
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-6 text-blue-800">Session و Cookieهای CDE فقط به‌شکل رمزگذاری‌شده در سرور مستقل نگه‌داری می‌شوند. رمز عبور ذخیره نمی‌شود.</div>{loginStep === 'phone' ? <div className="mt-4"><Input label="شماره همراه حساب CDE" value={phone} onChange={event => setPhone(event.target.value)} placeholder="۰۹۱۲۱۲۳۴۵۶۷" dir="ltr" autoFocus /></div> : <div className="mt-4"><Input label="رمز عبور CDE" type="password" value={password} onChange={event => setPassword(event.target.value)} autoFocus autoComplete="current-password" /></div>}{loginError && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{loginError}</p>}
    </Modal>
  </div>;
}
