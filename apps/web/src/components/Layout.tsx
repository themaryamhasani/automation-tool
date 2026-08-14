import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Activity, Bell, Building2, LogOut, Menu, PanelRightClose, PanelRightOpen, PanelsTopLeft,
  RefreshCw, Settings, Terminal, TestTube2, UserRound, Users,
} from 'lucide-react';
import { useAuth } from '../auth';
import { cn } from './ui';

const SIDEBAR_KEY = 'automation-sidebar-open';
const roleLabels = { ADMIN: 'مدیر سیستم', OPERATOR: 'کارشناس اتوماسیون', VIEWER: 'مشاهده‌گر' };

const primary = [
  { to: '/workspace', label: 'اتوماسیون', icon: PanelsTopLeft },
  { to: '/runs', label: 'تاریخچه اجراها', icon: Terminal },
];
const admin = [
  { to: '/projects', label: 'پروژه‌ها و محیط‌ها', icon: Building2 },
  { to: '/users', label: 'کاربران و دسترسی‌ها', icon: Users },
  { to: '/settings', label: 'تنظیمات Runner', icon: Settings },
  { to: '/audit', label: 'تاریخچه عملیات', icon: Activity },
];

function Sidebar({ onClose, collapsed }: { onClose: () => void; collapsed?: boolean }) {
  const { user, logout } = useAuth();
  if (!user) return null;
  const itemClass = ({ isActive }: { isActive: boolean }) => cn(
    'flex w-full min-w-0 items-center rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
    collapsed ? 'justify-center gap-0 px-2' : 'gap-3',
    isActive ? 'border-blue-500/30 bg-blue-500/15 text-blue-300' : 'border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-900',
  );
  return <aside className={cn('flex h-dvh flex-col border-l border-gray-200 bg-gray-50', collapsed ? 'w-[4.25rem]' : 'w-[min(18rem,calc(100vw-2rem))] sm:w-64')}>
    <div className={cn('flex items-center border-b border-gray-200 p-3', collapsed ? 'justify-center' : 'justify-between gap-2 p-4')}>
      <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600"><TestTube2 className="h-5 w-5 text-white" /></div>
        {!collapsed && <div><h1 className="font-bold text-gray-900">Automation Tool</h1><p className="text-xs text-gray-500">مدیریت تست خودکار</p></div>}
      </div>
      {!collapsed && <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100" title="بستن منو"><PanelRightClose className="h-5 w-5" /></button>}
    </div>
    {!collapsed && <div className="border-b border-gray-200 p-3">
      <div className="flex items-center gap-3 rounded-xl bg-gray-100 p-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/15 text-blue-300"><UserRound className="h-4 w-4" /></div>
        <div className="min-w-0"><p className="truncate text-sm font-semibold text-gray-900">{user.fullName}</p><p className="text-xs text-gray-500">{roleLabels[user.role]}</p></div>
      </div>
    </div>}
    <nav className="flex-1 overflow-y-auto p-2">
      {!collapsed && <p className="mb-2 px-3 text-xs font-semibold text-gray-400">کارتابل‌ها</p>}
      <div className="space-y-0.5">{primary.map(item => <NavLink key={item.to} to={item.to} title={item.label} className={itemClass}><item.icon className="h-5 w-5 shrink-0" />{!collapsed && <span>{item.label}</span>}</NavLink>)}</div>
      {user.role === 'ADMIN' && <>
        {!collapsed && <div className="my-3 border-t border-gray-200" />}
        {!collapsed && <p className="mb-2 px-3 text-xs font-semibold text-gray-400">مدیریت سیستم</p>}
        <div className="space-y-0.5">{admin.map(item => <NavLink key={item.to} to={item.to} title={item.label} className={itemClass}><item.icon className="h-5 w-5 shrink-0" />{!collapsed && <span>{item.label}</span>}</NavLink>)}</div>
      </>}
    </nav>
    <div className="border-t border-gray-200 p-2">
      <button onClick={() => void logout()} title="خروج از سیستم" className={cn('flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-medium text-red-300 transition hover:bg-red-500/10', collapsed ? 'justify-center' : 'gap-2')}>
        <LogOut className="h-4 w-4" />{!collapsed && 'خروج از سیستم'}
      </button>
    </div>
  </aside>;
}

export function Layout() {
  const [open, setOpen] = useState(() => localStorage.getItem(SIDEBAR_KEY) !== '0');
  const [mobile, setMobile] = useState(false);
  const { user } = useAuth();

  useEffect(() => { localStorage.setItem(SIDEBAR_KEY, open ? '1' : '0'); }, [open]);

  return <div className="flex min-h-screen bg-gray-50">
    <div className={cn('fixed inset-y-0 right-0 z-40 hidden lg:block', !open && 'pointer-events-none')}>
      {open && <Sidebar onClose={() => setOpen(false)} />}
    </div>
    {mobile && <>
      <button aria-label="بستن منو" className="fixed inset-0 z-40 bg-black/55 lg:hidden" onClick={() => setMobile(false)} />
      <div className="fixed inset-y-0 right-0 z-50 lg:hidden"><Sidebar onClose={() => setMobile(false)} /></div>
    </>}
    <div className={cn('min-w-0 flex-1 transition-[margin] duration-200', open ? 'lg:mr-64' : 'lg:mr-0')}>
      <div className="flex h-12 items-center justify-between border-b border-gray-200 bg-gray-50 px-3 lg:h-10">
        <div className="flex items-center gap-1">
          <button aria-label={open ? 'بستن منو' : 'باز کردن منو'} onClick={() => { if (window.matchMedia('(min-width: 1024px)').matches) setOpen(current => !current); else setMobile(true); }} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900" title={open ? 'بستن سایدبار' : 'نمایش سایدبار'}>
            {open ? <PanelRightClose className="hidden h-5 w-5 lg:block" /> : <PanelRightOpen className="hidden h-5 w-5 lg:block" />}
            <Menu className="h-5 w-5 lg:hidden" />
          </button>
          <span className="text-sm font-semibold text-gray-800 lg:hidden">ابزار اتوماسیون تست</span>
        </div>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/15 text-sm text-blue-300 lg:hidden">{user?.fullName?.charAt(0)}</span>
      </div>
      <Outlet />
    </div>
  </div>;
}

export function PageHeader({ title, subtitle, refreshing, onRefresh, actions }: { title: string; subtitle?: string; refreshing?: boolean; onRefresh?: () => void; actions?: ReactNode }) {
  return <header className="border-b border-gray-200 bg-gray-50 px-4 py-4 sm:px-6">
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-lg font-bold text-gray-900 sm:text-xl">{title}</h1>{subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}</div>
      <div className="flex flex-wrap items-center gap-2">
        {onRefresh && <button onClick={onRefresh} disabled={refreshing} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50" title="به‌روزرسانی"><RefreshCw className={cn('h-5 w-5', refreshing && 'animate-spin')} /></button>}
        <button className="relative rounded-lg p-2 text-gray-400 hover:bg-gray-100" title="اعلان‌ها"><Bell className="h-5 w-5" /></button>
        {actions}
      </div>
    </div>
  </header>;
}
