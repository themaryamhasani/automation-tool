import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_SETTINGS, type ExtensionSettings } from '../shared/constants';
import { BUILD_CONFIG } from '../config';
import { loadSettings, saveSettings } from '../storage/settings';
import '../sidepanel/styles.css';

function Options() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => { void loadSettings().then(setSettings); }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next = { ...settings };
    await saveSettings(next);
    setSettings(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  return <div className="app-shell" style={{ maxWidth: 620, margin: '0 auto', padding: 20 }}>
    <section className="panel">
      <div className="section-heading"><div><span className="eyebrow">Automation Tool</span><h2>Chrome Recorder settings</h2></div></div>
      <form onSubmit={submit}>
        <p className="hint">This organization-managed build connects to <strong dir="ltr">{BUILD_CONFIG.webOrigin}</strong>. Connection settings cannot be changed by end users.</p>
        <div className="field-grid two">
          <label><span>Test ID attribute</span><input value={settings.testIdAttribute} onChange={event => setSettings({ ...settings, testIdAttribute: event.target.value })} dir="ltr" /></label>
          <label><span>Replay slowMo (ms)</span><input type="number" min="0" max="2000" value={settings.slowMo} onChange={event => setSettings({ ...settings, slowMo: Math.max(0, Math.min(2000, Number(event.target.value) || 0)) })} /></label>
        </div>
        <p className="hint">Recorder engine settings are advanced options. Reconnect the current page after changing them.</p>
        <div className="row actions"><button className="primary" type="submit">Save settings</button>{saved && <span style={{ color: '#047857', fontSize: 11 }}>Saved</span>}</div>
      </form>
    </section>
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Options /></StrictMode>);
