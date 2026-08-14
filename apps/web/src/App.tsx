import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { RunsPage } from './pages/RunsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { UsersPage } from './pages/UsersPage';
import { SettingsPage } from './pages/SettingsPage';
import { AuditPage } from './pages/AuditPage';

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return user?.role === 'ADMIN' ? children : <Navigate to="/workspace" replace />;
}

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-gray-50"><Loading text="در حال بررسی نشست کاربری…" /></div>;
  if (!user) return <LoginPage />;
  return <Routes>
    <Route element={<Layout />}>
      <Route index element={<Navigate to="/workspace" replace />} />
      <Route path="/workspace" element={<WorkspacePage />} />
      <Route path="/runs" element={<RunsPage />} />
      <Route path="/projects" element={<AdminOnly><ProjectsPage /></AdminOnly>} />
      <Route path="/users" element={<AdminOnly><UsersPage /></AdminOnly>} />
      <Route path="/settings" element={<AdminOnly><SettingsPage /></AdminOnly>} />
      <Route path="/audit" element={<AdminOnly><AuditPage /></AdminOnly>} />
      <Route path="*" element={<Navigate to="/workspace" replace />} />
    </Route>
  </Routes>;
}
