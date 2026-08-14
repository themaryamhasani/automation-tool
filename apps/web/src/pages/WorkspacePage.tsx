import { useCallback, useEffect, useState } from 'react';
import { FileArchive, Github, Gitlab, PanelsTopLeft, Server } from 'lucide-react';
import { api } from '../api';
import { CdeStudio } from '../components/CdeStudio';
import { GitStudio } from '../components/GitStudio';
import { IsStudio } from '../components/IsStudio';
import { ZipWorkspace } from '../components/ZipWorkspace';
import { cn, Loading, notify } from '../components/ui';
import type { Project, SourceApproach, WorkspaceConnections } from '../types';

const APPROACHES: Array<{
  id: SourceApproach;
  label: string;
  hint: string;
  icon: typeof Server;
}> = [
  { id: 'IS', label: 'IS', hint: 'پروژه‌های test/doc', icon: PanelsTopLeft },
  { id: 'CDE', label: 'CDE', hint: 'سورس CDE و بسته تست محلی', icon: Server },
  { id: 'GITHUB', label: 'GitHub', hint: 'فایل‌ها و تست ریپوهای شما', icon: Github },
  { id: 'GIT_EDUS', label: 'git.edus', hint: 'فایل‌ها و تست git.edus.ir', icon: Gitlab },
  { id: 'ZIP', label: 'ZIP', hint: 'آپلود آرشیو', icon: FileArchive },
];

const emptyConnections = (): WorkspaceConnections => ({
  IS: { connected: false, ready: false },
  CDE: { connected: false, ready: false },
  GITHUB: { connected: false, ready: false },
  GIT_EDUS: { connected: false, ready: false },
  ZIP: { connected: true, ready: true, detail: 'آپلود آرشیو' },
});

export function WorkspacePage() {
  const [active, setActive] = useState<SourceApproach>('IS');
  const [connections, setConnections] = useState<WorkspaceConnections>(emptyConnections);
  const [workspaceIds, setWorkspaceIds] = useState<Partial<Record<SourceApproach, string>>>({});
  const [workspaceIdsReady, setWorkspaceIdsReady] = useState(false);

  const refreshConnections = useCallback(async () => {
    try {
      const rows = await api<WorkspaceConnections>('/api/workspace/connections');
      setConnections(current => ({ ...current, ...rows }));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'خواندن وضعیت منابع ناموفق بود.', 'error');
    }
  }, []);

  useEffect(() => { void refreshConnections(); }, [refreshConnections]);

  useEffect(() => {
    let cancelled = false;
    Promise.all((['GITHUB', 'GIT_EDUS', 'ZIP'] as SourceApproach[]).map(approach => (
      api<Project>(`/api/workspace/project/${approach}`).then(project => {
        if (!cancelled) setWorkspaceIds(current => current[approach] ? current : { ...current, [approach]: project.id });
      }).catch(() => undefined)
    ))).finally(() => { if (!cancelled) setWorkspaceIdsReady(true); });
    return () => { cancelled = true; };
  }, []);

  const activeMeta = APPROACHES.find(item => item.id === active);
  const activeConn = connections[active];

  return <div className="flex h-[calc(100dvh-3rem)] min-h-0 overflow-hidden bg-slate-950 lg:h-[calc(100dvh-2.5rem)]">
    <nav className="flex w-[4.75rem] shrink-0 flex-col items-center gap-1 border-l border-slate-800 bg-[#071018] py-3">
      {APPROACHES.map(item => {
        const conn = connections[item.id];
        const selected = active === item.id;
        return <button
          key={item.id}
          type="button"
          title={`${item.label} — ${item.hint}`}
          onClick={() => { setActive(item.id); void refreshConnections(); }}
          className={cn(
            'relative flex w-[3.75rem] flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[10px] font-medium transition',
            selected ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white',
          )}
        >
          <item.icon className="h-5 w-5" />
          <span>{item.label}</span>
          <span className={cn(
            'absolute left-1.5 top-1.5 h-2 w-2 rounded-full border border-slate-950',
            conn?.connected ? (conn.ready ? 'bg-emerald-400' : 'bg-amber-400') : 'bg-slate-600',
          )} />
        </button>;
      })}
    </nav>

    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-slate-800 bg-[#0b1220] px-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{activeMeta?.hint}</p>
          <p className="truncate text-[11px] text-slate-400">{activeConn?.detail || 'منبع را انتخاب کنید؛ اتصال بقیه قطع نمی‌شود.'}</p>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          {APPROACHES.map(item => <span key={item.id} className={cn('rounded-full px-2 py-0.5 text-[10px]', connections[item.id]?.connected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-500')}>{item.label}</span>)}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className={cn('flex min-h-0 min-w-0 flex-1', active === 'IS' ? '' : 'hidden')}><IsStudio /></div>
        <div className={cn('flex min-h-0 min-w-0 flex-1', active === 'CDE' ? '' : 'hidden')}><CdeStudio onStatusChange={() => void refreshConnections()} /></div>
        {(['GITHUB', 'GIT_EDUS', 'ZIP'] as const).map(approach => {
          const id = workspaceIds[approach];
          const visible = active === approach;
          if (!id) {
            return visible ? (
              <div key={approach} className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
                {workspaceIdsReady
                  ? <p className="px-6 text-center text-sm text-slate-500">پروژه این منبع آماده نشد. صفحه را تازه کنید.</p>
                  : <Loading text="در حال آماده‌سازی پروژه…" />}
              </div>
            ) : null;
          }
          return (
            <div key={approach} className={cn('flex min-h-0 min-w-0 flex-1', visible ? '' : 'hidden')}>
              {approach === 'ZIP'
                ? <ZipWorkspace projectId={id} onStatusChange={() => void refreshConnections()} />
                : <GitStudio projectId={id} provider={approach} onStatusChange={() => void refreshConnections()} />}
            </div>
          );
        })}
      </div>
    </div>
  </div>;
}
