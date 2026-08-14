import { useCallback, useEffect, useState } from 'react';
import { Activity, UserRound } from 'lucide-react';
import { api } from '../api';
import { PageHeader } from '../components/Layout';
import { Badge, Card, EmptyState, Loading, Pagination } from '../components/ui';
import type { AuditLog, Paginated } from '../types';

const actionLabels: Record<string, string> = {
  AUTH_LOGIN: 'ورود به سامانه', AUTH_LOGOUT: 'خروج از سامانه', AUTH_PASSWORD_CHANGED: 'تغییر رمز عبور',
  USER_CREATED: 'ایجاد کاربر', USER_UPDATED: 'ویرایش کاربر', PROJECT_CREATED: 'ایجاد پروژه', PROJECT_UPDATED: 'ویرایش پروژه',
  ENVIRONMENT_CREATED: 'ایجاد محیط', ENVIRONMENT_UPDATED: 'ویرایش محیط', ENVIRONMENT_DELETED: 'حذف محیط',
  TEST_FILE_CREATED: 'ایجاد فایل تست', TEST_FILE_UPDATED: 'ویرایش فایل تست', TEST_FILE_DELETED: 'حذف فایل تست',
  RUN_QUEUED: 'ثبت اجرای جدید', RUN_CANCEL_REQUESTED: 'درخواست لغو اجرا', RUN_COMPLETED: 'پایان اجرا', RUN_IMPORTED: 'انتقال اجرای قبلی',
};

export function AuditPage() {
  const [data, setData] = useState<Paginated<AuditLog> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api<Paginated<AuditLog>>(`/api/audit?page=${page}&limit=20`)); }
    finally { setLoading(false); }
  }, [page]);
  useEffect(() => { void load(); }, [load]);
  return <div className="min-h-screen bg-gray-50"><PageHeader title="تاریخچه عملیات" subtitle="ردپای تغییرات و اجرای سرویس مستقل" refreshing={loading} onRefresh={() => void load()} />
    <main className="mx-auto max-w-[1600px] p-4 sm:p-6"><Card>{loading ? <Loading /> : !data?.data.length ? <EmptyState text="رویدادی ثبت نشده است." /> : <><div className="responsive-table overflow-hidden rounded-xl border border-gray-200"><table className="w-full text-right text-sm"><thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="px-4 py-3">عملیات</th><th className="px-4 py-3">عامل</th><th className="px-4 py-3">موجودیت</th><th className="px-4 py-3">جزئیات</th><th className="px-4 py-3">زمان</th></tr></thead><tbody className="divide-y divide-gray-100">{data.data.map(log => <tr key={log.id} className="hover:bg-gray-50"><td className="px-4 py-3"><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-blue-500" /><span className="font-medium text-gray-900">{actionLabels[log.action] || log.action}</span></div></td><td className="px-4 py-3"><div className="flex items-center gap-1 text-gray-600"><UserRound className="h-3.5 w-3.5" />{log.actorName || 'سرویس Runner'}</div></td><td className="px-4 py-3"><Badge tone="gray">{log.entityType || 'SYSTEM'}</Badge>{log.entityId && <p className="mt-1 max-w-44 truncate font-mono text-[10px] text-gray-400" dir="ltr">{log.entityId}</p>}</td><td className="max-w-md px-4 py-3"><pre className="max-h-20 overflow-auto whitespace-pre-wrap text-[10px] text-gray-500" dir="ltr">{Object.keys(log.metadata || {}).length ? JSON.stringify(log.metadata, null, 2) : '—'}</pre></td><td className="px-4 py-3 text-xs text-gray-500">{new Date(log.createdAt).toLocaleString('fa-IR')}</td></tr>)}</tbody></table></div><Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={setPage} /></>}</Card></main>
  </div>;
}
