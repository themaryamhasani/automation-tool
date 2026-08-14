import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth';
import { ToastHost } from './components/ui';
import { App } from './App';
import './index.css';
import './monaco';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider><App /><ToastHost /></AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
