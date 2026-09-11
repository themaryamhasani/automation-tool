import Editor from '@monaco-editor/react';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, FileCode2, Save, ShieldAlert } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { PageHeader } from '../components/Layout';
import { Badge, Button, Card, Loading, notify } from '../components/ui';
import type { TestFile } from '../types';

export function TestFilePage() {
  const { fileId = '' } = useParams();
  const { user } = useAuth();
  const canWrite = user?.role !== 'VIEWER';
  const [file, setFile] = useState<TestFile | null>(null);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const row = await api<TestFile>(`/api/files/${encodeURIComponent(fileId)}`); setFile(row); setSource(row.sourceCode); }
    catch (error) { notify(error instanceof Error ? error.message : 'فایل تست پیدا نشد.', 'error'); }
    finally { setLoading(false); }
  }, [fileId]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!file) return;
    setSaving(true);
    try {
      const updated = await api<TestFile>(`/api/files/${encodeURIComponent(file.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ folderPath: file.folderPath, fileName: file.fileName, description: file.description, sourceCode: source, revision: file.revision, origin: 'web-editor' }),
      });
      setFile({ ...file, ...updated }); setSource(updated.sourceCode); notify(`نسخه ${updated.revision.toLocaleString('fa-IR')} ذخیره شد.`, 'success');
    } catch (error) { notify(error instanceof Error ? error.message : 'ذخیره فایل ناموفق بود.', 'error'); }
    finally { setSaving(false); }
  }

  return <div className="flex min-h-[calc(100dvh-2.5rem)] flex-col bg-gray-50">
    <PageHeader title="فایل تست Playwright" subtitle={file?.fullPath || 'خواندن فایل ذخیره‌شده'} refreshing={loading} onRefresh={() => void load()} actions={<div className="flex gap-2"><Link to="/extension"><Button variant="ghost" icon={<ArrowRight className="h-4 w-4" />}>افزونه</Button></Link>{canWrite && <Button loading={saving} icon={<Save className="h-4 w-4" />} disabled={!file || source === file.sourceCode} onClick={() => void save()}>ذخیره</Button>}</div>} />
    {loading ? <Loading /> : !file ? <div className="p-6 text-center text-sm text-gray-500">فایل در دسترس نیست.</div> : <main className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-6">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-3"><div className="flex items-center gap-3"><FileCode2 className="h-5 w-5 text-blue-600" /><div><p className="font-mono text-xs text-gray-900" dir="ltr">{file.fullPath}</p><p className="mt-1 text-xs text-gray-500">{file.projectName} · ویرایش {file.revision.toLocaleString('fa-IR')}</p></div></div><div className="flex gap-2"><Badge tone="blue">@playwright/test</Badge>{file.description?.includes('Chrome Extension') && <Badge tone="purple">Chrome Recorder</Badge>}</div></Card>
      {file.description?.includes('Chrome Extension') && <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>مقادیر حساس ضبط‌شده با متغیرهای محیطی Runner جایگزین شده‌اند. Secret referenceهای محیط پروژه را پیش از اجرا تنظیم کنید.</span></div>}
      <div className="min-h-[520px] flex-1 overflow-hidden rounded-xl border border-gray-200 bg-slate-950"><Editor height="100%" language="typescript" theme="vs-dark" value={source} onChange={value => setSource(value || '')} options={{ readOnly: !canWrite, minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', automaticLayout: true, padding: { top: 14 } }} /></div>
    </main>}
  </div>;
}
