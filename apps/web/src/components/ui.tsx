import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';

export function cn(...values: Array<string | false | null | undefined>) { return values.filter(Boolean).join(' '); }

export function Button({ variant = 'primary', size = 'md', loading, icon, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode;
}) {
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-500 border-blue-500',
    secondary: 'bg-gray-100 text-gray-800 hover:bg-gray-200 border-gray-200',
    danger: 'bg-red-500/15 text-red-300 hover:bg-red-500/25 border-red-500/30',
    ghost: 'bg-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900 border-transparent',
  };
  return <button {...props} disabled={props.disabled || loading} className={cn(
    'inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2 text-sm', variants[variant], className,
  )}>
    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}{children}
  </button>;
}

export function Input({ label, error, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }) {
  return <label className="block min-w-0">
    {label && <span className="mb-1.5 block text-sm font-medium text-gray-700">{label}</span>}
    <input {...props} className={cn('w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 transition placeholder:text-gray-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60', error && 'border-red-400', className)} />
    {error && <span className="mt-1 block text-xs text-red-400">{error}</span>}
  </label>;
}

export function Select({ label, error, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; error?: string }) {
  return <label className="block min-w-0">
    {label && <span className="mb-1.5 block text-sm font-medium text-gray-700">{label}</span>}
    <select {...props} className={cn('w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60', error && 'border-red-400', className)}>{children}</select>
    {error && <span className="mt-1 block text-xs text-red-400">{error}</span>}
  </label>;
}

export function Textarea({ label, error, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string }) {
  return <label className="block min-w-0">
    {label && <span className="mb-1.5 block text-sm font-medium text-gray-700">{label}</span>}
    <textarea {...props} className={cn('w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60', error && 'border-red-400', className)} />
    {error && <span className="mt-1 block text-xs text-red-400">{error}</span>}
  </label>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-xl border border-gray-200 bg-gray-50 p-4 sm:p-5', className)}>{children}</div>;
}

export function StatCard({ title, value, icon, tone = 'blue' }: { title: string; value: ReactNode; icon: ReactNode; tone?: 'blue' | 'green' | 'amber' | 'red' }) {
  const tones = { blue: 'bg-blue-50 text-blue-400', green: 'bg-emerald-50 text-emerald-400', amber: 'bg-amber-50 text-amber-400', red: 'bg-red-50 text-red-400' };
  return <Card className="flex items-center gap-3 p-4 sm:p-4">
    <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', tones[tone])}>{icon}</div>
    <div><p className="text-xs text-gray-500">{title}</p><p className="mt-1 text-xl font-bold text-gray-900">{value}</p></div>
  </Card>;
}

export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'purple' }) {
  const tones = {
    gray: 'bg-gray-100 text-gray-700', blue: 'bg-blue-500/15 text-blue-300', green: 'bg-emerald-500/15 text-emerald-300',
    amber: 'bg-amber-500/15 text-amber-200', red: 'bg-red-500/15 text-red-300', purple: 'bg-purple-500/15 text-purple-300',
  };
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium', tones[tone])}>{children}</span>;
}

export function Modal({ open, title, children, onClose, footer, size = 'lg' }: { open: boolean; title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; size?: 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);
  if (!open) return null;
  const widths = { md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-6xl' };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div role="dialog" aria-modal="true" className={cn('flex max-h-[94vh] w-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-gray-50', widths[size])}>
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-800"><X className="h-5 w-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 bg-gray-100 px-5 py-3">{footer}</div>}
    </div>
  </div>;
}

export function EmptyState({ text = 'داده‌ای برای نمایش وجود ندارد.' }: { text?: string }) {
  return <div className="flex min-h-40 items-center justify-center px-4 text-center text-sm text-gray-500">{text}</div>;
}

export function Loading({ text = 'در حال بارگذاری…' }: { text?: string }) {
  return <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-gray-500"><Loader2 className="h-5 w-5 animate-spin text-blue-400" />{text}</div>;
}

export function Pagination({ page, totalPages, total, onChange }: { page: number; totalPages: number; total: number; onChange: (page: number) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-1 pt-4 text-xs text-gray-500">
    <span>{total.toLocaleString('fa-IR')} رکورد</span>
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>قبلی</Button>
      <span>صفحه {page.toLocaleString('fa-IR')} از {totalPages.toLocaleString('fa-IR')}</span>
      <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>بعدی</Button>
    </div>
  </div>;
}

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem { id: number; message: string; tone: ToastTone }
let toastId = 0;
export function notify(message: string, tone: ToastTone = 'info') {
  window.dispatchEvent(new CustomEvent('automation-toast', { detail: { id: ++toastId, message, tone } }));
}
export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const handler = (event: Event) => {
      const item = (event as CustomEvent<ToastItem>).detail;
      setItems(current => [...current.slice(-3), item]);
      window.setTimeout(() => setItems(current => current.filter(entry => entry.id !== item.id)), 4500);
    };
    window.addEventListener('automation-toast', handler);
    return () => window.removeEventListener('automation-toast', handler);
  }, []);
  const icons = { success: CheckCircle2, error: XCircle, info: Info };
  const colors = { success: 'border-emerald-200 text-emerald-300', error: 'border-red-200 text-red-300', info: 'border-blue-200 text-blue-300' };
  return <div className="fixed bottom-4 left-4 z-[80] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
    {items.map(item => { const Icon = icons[item.tone]; return <div key={item.id} className={cn('flex items-start gap-2 rounded-xl border bg-gray-50 p-3 text-sm', colors[item.tone])}><Icon className="mt-0.5 h-4 w-4 shrink-0" /><span className="flex-1">{item.message}</span><button onClick={() => setItems(current => current.filter(entry => entry.id !== item.id))}><X className="h-4 w-4" /></button></div>; })}
  </div>;
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-300"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{children}</div>;
}
