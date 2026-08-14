import { useCallback, useEffect, useMemo, useState } from 'react';
import { Edit3, Mail, Phone, Plus, Search, ShieldCheck, UserCheck, UserRound, Users } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { PageHeader } from '../components/Layout';
import { Badge, Button, Card, EmptyState, Input, Loading, Modal, Select, StatCard, notify } from '../components/ui';
import type { Project, Role, User } from '../types';

const roleLabels: Record<Role, string> = { ADMIN: 'مدیر سیستم', OPERATOR: 'کارشناس اتوماسیون', VIEWER: 'مشاهده‌گر' };
interface UserForm { id?: string; fullName: string; email: string; phoneNumber: string; password: string; role: Role; isActive: boolean; projectIds: string[] }
const emptyForm = (): UserForm => ({ fullName: '', email: '', phoneNumber: '', password: '', role: 'OPERATOR', isActive: true, projectIds: [] });

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<UserForm>(emptyForm());

  const load = useCallback(async () => {
    setLoading(true);
    try { const [userRows, projectRows] = await Promise.all([api<User[]>('/api/users'), api<Project[]>('/api/projects')]); setUsers(userRows); setProjects(projectRows); }
    catch (error) { notify(error instanceof Error ? error.message : 'بارگذاری کاربران ناموفق بود.', 'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? users.filter(user => [user.fullName, user.email, user.phoneNumber, roleLabels[user.role]].some(value => value?.toLowerCase().includes(term))) : users;
  }, [users, search]);
  const stats = { total: users.length, active: users.filter(user => user.isActive).length, admins: users.filter(user => user.role === 'ADMIN').length, operators: users.filter(user => user.role === 'OPERATOR').length };

  function edit(user: User) { setForm({ id: user.id, fullName: user.fullName, email: user.email || '', phoneNumber: user.phoneNumber || '', password: '', role: user.role, isActive: user.isActive, projectIds: user.projectIds || [] }); setShowForm(true); }
  function toggleProject(projectId: string) { setForm(current => ({ ...current, projectIds: current.projectIds.includes(projectId) ? current.projectIds.filter(id => id !== projectId) : [...current.projectIds, projectId] })); }
  async function save() {
    if (!form.fullName.trim() || (!form.email.trim() && !form.phoneNumber.trim())) { notify('نام و حداقل ایمیل یا شماره همراه الزامی است.', 'error'); return; }
    if (!form.id && form.password.length < 10) { notify('برای کاربر جدید رمز حداقل ۱۰ کاراکتری وارد کنید.', 'error'); return; }
    setActionLoading(true);
    try {
      if (form.id) await api(`/api/users/${form.id}`, { method: 'PUT', body: JSON.stringify(form) });
      else await api('/api/users', { method: 'POST', body: JSON.stringify(form) });
      setShowForm(false); await load(); notify('اطلاعات کاربر ذخیره شد.', 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'ذخیره کاربر ناموفق بود.', 'error'); }
    finally { setActionLoading(false); }
  }

  return <div className="min-h-screen bg-gray-50">
    <PageHeader title="کاربران و دسترسی‌ها" subtitle="مدیریت مستقل هویت، نقش و دسترسی پروژه‌ها" refreshing={loading} onRefresh={() => void load()} actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => { setForm(emptyForm()); setShowForm(true); }}>کاربر جدید</Button>} />
    <main className="mx-auto max-w-[1800px] space-y-5 p-4 sm:p-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><StatCard title="کل کاربران" value={stats.total.toLocaleString('fa-IR')} icon={<Users className="h-5 w-5" />} /><StatCard title="کاربران فعال" value={stats.active.toLocaleString('fa-IR')} icon={<UserCheck className="h-5 w-5" />} tone="green" /><StatCard title="مدیران" value={stats.admins.toLocaleString('fa-IR')} icon={<ShieldCheck className="h-5 w-5" />} tone="amber" /><StatCard title="کارشناسان" value={stats.operators.toLocaleString('fa-IR')} icon={<UserRound className="h-5 w-5" />} /></div>
      <Card><div className="relative mb-4 max-w-xl"><Search className="absolute right-3 top-[2.65rem] h-4 w-4 text-gray-400" /><Input label="جستجوی کاربر" value={search} onChange={event => setSearch(event.target.value)} placeholder="نام، ایمیل، شماره همراه یا نقش..." className="pr-10" /></div>
        {loading ? <Loading /> : !filtered.length ? <EmptyState text="کاربری پیدا نشد." /> : <div className="responsive-table overflow-hidden rounded-xl border border-gray-200"><table className="w-full text-right text-sm"><thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="px-4 py-3">کاربر</th><th className="px-4 py-3">اطلاعات تماس</th><th className="px-4 py-3">نقش</th><th className="px-4 py-3">پروژه‌ها</th><th className="px-4 py-3">وضعیت</th><th className="px-4 py-3">عملیات</th></tr></thead><tbody className="divide-y divide-gray-100">{filtered.map(user => <tr key={user.id} className="hover:bg-gray-50"><td className="px-4 py-3"><div className="flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700">{user.fullName.charAt(0)}</div><div><p className="font-medium text-gray-900">{user.fullName}</p>{user.id === currentUser?.id && <p className="text-[11px] text-blue-600">حساب جاری</p>}</div></div></td><td className="px-4 py-3"><div className="space-y-1 text-xs text-gray-500">{user.email && <p className="flex items-center gap-1" dir="ltr"><Mail className="h-3 w-3" />{user.email}</p>}{user.phoneNumber && <p className="flex items-center gap-1" dir="ltr"><Phone className="h-3 w-3" />{user.phoneNumber}</p>}</div></td><td className="px-4 py-3"><Badge tone={user.role === 'ADMIN' ? 'purple' : user.role === 'OPERATOR' ? 'blue' : 'gray'}>{roleLabels[user.role]}</Badge></td><td className="px-4 py-3"><div className="flex max-w-sm flex-wrap gap-1">{user.role === 'ADMIN' ? <Badge tone="green">همه پروژه‌ها</Badge> : user.projectIds?.length ? user.projectIds.slice(0, 3).map(id => <Badge key={id}>{projects.find(project => project.id === id)?.name || 'نامشخص'}</Badge>) : <span className="text-xs text-gray-400">بدون پروژه</span>}{(user.projectIds?.length || 0) > 3 && <Badge>+{(user.projectIds!.length - 3).toLocaleString('fa-IR')}</Badge>}</div></td><td className="px-4 py-3"><Badge tone={user.isActive ? 'green' : 'red'}>{user.isActive ? 'فعال' : 'غیرفعال'}</Badge></td><td className="px-4 py-3"><Button size="sm" variant="ghost" icon={<Edit3 className="h-4 w-4" />} onClick={() => edit(user)}>ویرایش</Button></td></tr>)}</tbody></table></div>}
      </Card>
    </main>
    <Modal open={showForm} onClose={() => !actionLoading && setShowForm(false)} title={form.id ? 'ویرایش کاربر' : 'ایجاد کاربر'} footer={<><Button variant="secondary" onClick={() => setShowForm(false)}>انصراف</Button><Button loading={actionLoading} onClick={() => void save()}>ذخیره</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2"><Input label="نام و نام خانوادگی *" value={form.fullName} onChange={event => setForm({ ...form, fullName: event.target.value })} /><Select label="نقش *" value={form.role} onChange={event => setForm({ ...form, role: event.target.value as Role })}><option value="ADMIN">مدیر سیستم</option><option value="OPERATOR">کارشناس اتوماسیون</option><option value="VIEWER">مشاهده‌گر</option></Select><Input label="ایمیل" type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} dir="ltr" /><Input label="شماره همراه" value={form.phoneNumber} onChange={event => setForm({ ...form, phoneNumber: event.target.value })} dir="ltr" /><Input label={form.id ? 'رمز جدید (اختیاری)' : 'رمز عبور *'} type="password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} minLength={10} /></div>
      {form.role !== 'ADMIN' && <div className="mt-5"><p className="mb-2 text-sm font-medium text-gray-700">پروژه‌های مجاز</p><div className="grid max-h-52 gap-2 overflow-auto rounded-xl border border-gray-200 p-3 sm:grid-cols-2">{projects.filter(project => project.isActive).map(project => <label key={project.id} className={`flex items-center gap-2 rounded-lg border p-2.5 text-sm ${form.projectIds.includes(project.id) ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-100'}`}><input type="checkbox" checked={form.projectIds.includes(project.id)} onChange={() => toggleProject(project.id)} />{project.name}</label>)}</div></div>}
      {form.id && <label className="mt-4 flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.isActive} disabled={form.id === currentUser?.id} onChange={event => setForm({ ...form, isActive: event.target.checked })} />حساب فعال باشد</label>}
    </Modal>
  </div>;
}
