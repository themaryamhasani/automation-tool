import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AutomationApiClient } from '../api/client';
import type { EnvironmentSummary, FolderSummary, ProjectSummary, RunSummary, TestFileSummary } from '../api/types';
import { sendBackground } from '../messaging/client';
import type { RecorderBackendMessage, RecorderConnectMessage, SessionMode, SessionState, StateChangedMessage } from '../messaging/contracts';
import { prepareRecording, sanitizeFileName } from '../recorder/normalizer';
import { sanitizeSource } from '../recorder/sanitizer';
import type { RecorderElementInfo, RecorderSource } from '../recorder/types';
import { DEFAULT_SETTINGS, normalizeBaseUrl, type ExtensionSettings } from '../shared/constants';
import { ExtensionError } from '../shared/errors';
import { clearCredential, loadCredential, loadSettings, saveCredential, saveSettings } from '../storage/settings';
import { RecorderPortClient } from './recorder-port';
import './styles.css';

const emptySession: SessionState = {
  mode: 'disconnected', attachedTabId: null, tabTitle: '', tabUrl: '', active: false,
  canReplay: false, traceAvailable: false, lastError: null, updatedAt: new Date(0).toISOString(),
};

const modeLabels: Record<SessionMode, string> = {
  disconnected: 'No tab attached',
  'reattach-required': 'Reattach required',
  attaching: 'Attaching…',
  attached: 'Attached',
  recording: 'Recording',
  paused: 'Recording paused',
  inspecting: 'Inspecting locator',
  playing: 'Replaying locally',
  error: 'Needs attention',
};

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The operation failed.';
}

function locatorFromElement(info: RecorderElementInfo): string {
  const candidate = info.locator || info.selector || '';
  if (!candidate) return '';
  if (/^page\./.test(candidate)) return candidate;
  if (/^getBy(?:Role|Label|Text|Placeholder|TestId)\(/.test(candidate)) return `page.${candidate}`;
  return `page.locator(${JSON.stringify(candidate)})`;
}

function insertLocatorAction(source: string, locator: string): string {
  const line = `  await ${locator}.click();`;
  const closing = source.lastIndexOf('\n});');
  if (closing < 0) return `${source.trimEnd()}\n${line}\n`;
  return `${source.slice(0, closing)}\n${line}${source.slice(closing)}`;
}

export function App() {
  const [settings, setSettingsState] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [session, setSession] = useState<SessionState>(emptySession);
  const [apiToken, setApiToken] = useState('');
  const [connected, setConnected] = useState(false);
  const [connectionName, setConnectionName] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [source, setSource] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [envVars, setEnvVars] = useState<string[]>([]);
  const [locator, setLocator] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [savedFile, setSavedFile] = useState<TestFileSummary | null>(null);
  const [savedRun, setSavedRun] = useState<RunSummary | null>(null);
  const [recorderConnected, setRecorderConnected] = useState(false);
  const recorderRef = useRef<RecorderPortClient | null>(null);

  const updateSettings = useCallback((patch: Partial<ExtensionSettings>) => {
    setSettingsState(current => {
      const next = { ...current, ...patch };
      void saveSettings(next);
      return next;
    });
  }, []);

  const acceptSource = useCallback((raw: string) => {
    try {
      const prepared = prepareRecording(raw, settings.testName, settings.fileName);
      setSource(prepared.source);
      setWarnings(prepared.warnings);
      setEnvVars(prepared.environmentVariables);
      if (prepared.fileName !== settings.fileName) updateSettings({ fileName: prepared.fileName });
    } catch {
      const sanitized = sanitizeSource(raw);
      setSource(sanitized.source);
      setWarnings(sanitized.warnings);
      setEnvVars(sanitized.environmentVariables);
    }
  }, [settings.fileName, settings.testName, updateSettings]);

  const onRecorderMessage = useCallback((message: RecorderBackendMessage) => {
    if (message.method === 'setSources' && Array.isArray(message.sources)) {
      const sources = message.sources as RecorderSource[];
      const preferred = sources.find(item => item.id === 'playwright-test')
        || sources.find(item => /playwright test/i.test(item.label || ''))
        || sources[0];
      if (preferred?.text != null) acceptSource(preferred.text);
    }
    if (message.method === 'elementPicked' && message.elementInfo) {
      setLocator(locatorFromElement(message.elementInfo as RecorderElementInfo));
      setNotice({ kind: 'success', text: 'Playwright selected a locator.' });
    }
  }, [acceptSource]);

  useEffect(() => {
    const recorder = new RecorderPortClient({ onMessage: onRecorderMessage, onConnectionChange: setRecorderConnected });
    recorderRef.current = recorder;
    recorder.connect();
    const stateListener = (message: unknown) => {
      if (message && typeof message === 'object' && (message as StateChangedMessage).type === 'STATE_CHANGED') {
        setSession((message as StateChangedMessage).state);
      }
      if (message && typeof message === 'object' && (message as RecorderConnectMessage).type === 'RECORDER_CONNECT_REQUIRED') {
        recorder.reconnect();
      }
    };
    chrome.runtime.onMessage.addListener(stateListener);
    return () => {
      chrome.runtime.onMessage.removeListener(stateListener);
      recorder.stop();
      recorderRef.current = null;
    };
  }, [onRecorderMessage]);

  const refreshProjects = useCallback(async (token: string, nextSettings: ExtensionSettings) => {
    const client = new AutomationApiClient(nextSettings.apiBaseUrl, token);
    const [profile, rows] = await Promise.all([client.profile(), client.projects()]);
    const active = rows.filter(project => project.isActive);
    setConnected(true);
    setConnectionName(`${profile.user.fullName} · ${profile.user.role}`);
    setProjects(active);
    const selectedProjectId = active.some(project => project.id === nextSettings.selectedProjectId)
      ? nextSettings.selectedProjectId : active[0]?.id || '';
    if (selectedProjectId !== nextSettings.selectedProjectId) updateSettings({ selectedProjectId });
    if (selectedProjectId) {
      const [folderRows, environmentRows] = await Promise.all([
        client.folders(selectedProjectId),
        client.environments(selectedProjectId),
      ]);
      setFolders(folderRows);
      setEnvironments(environmentRows.filter(environment => environment.enabled && environment.availableNow !== false));
    }
  }, [updateSettings]);

  useEffect(() => {
    void (async () => {
      const [storedSettings, credential, stateResponse] = await Promise.all([
        loadSettings(), loadCredential(), sendBackground({ type: 'GET_STATE' }),
      ]);
      setSettingsState(storedSettings);
      setSession(stateResponse.state);
      if (credential) {
        setApiToken(credential.apiToken);
        await refreshProjects(credential.apiToken, storedSettings).catch(async (error) => {
          if (error instanceof ExtensionError && error.code === 'AUTH_EXPIRED') await clearCredential();
          setApiToken(''); setConnected(false); setNotice({ kind: 'error', text: asMessage(error) });
        });
      }
    })();
  }, [refreshProjects]);

  const api = useMemo(() => apiToken ? new AutomationApiClient(settings.apiBaseUrl, apiToken) : null, [apiToken, settings.apiBaseUrl]);

  async function runAction(name: string, action: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(name); setNotice(null);
    try { await action(); }
    catch (error) { setNotice({ kind: 'error', text: asMessage(error) }); }
    finally { setBusy(''); }
  }

  async function connect(): Promise<void> {
    const token = apiToken.trim();
    if (!token) throw new ExtensionError('AUTH_EXPIRED', 'Paste an Automation Tool extension token first.');
    const apiBaseUrl = normalizeBaseUrl(settings.apiBaseUrl, DEFAULT_SETTINGS.apiBaseUrl);
    const webBaseUrl = normalizeBaseUrl(settings.webBaseUrl, DEFAULT_SETTINGS.webBaseUrl);
    const originPattern = `${new URL(apiBaseUrl).origin}/*`;
    if (!originPattern.startsWith('http://localhost/') && !originPattern.startsWith('http://127.0.0.1/')) {
      const granted = await chrome.permissions.request({ origins: [originPattern] });
      if (!granted) throw new ExtensionError('ACCESS_DENIED', 'Chrome host access is required for the configured API URL.');
    }
    const next = { ...settings, apiBaseUrl, webBaseUrl };
    await refreshProjects(token, next);
    await Promise.all([saveCredential(token), saveSettings(next)]);
    setSettingsState(next);
    setApiToken(token);
    setNotice({ kind: 'success', text: 'Connected securely with a scoped API token.' });
  }

  async function disconnectApi(): Promise<void> {
    await clearCredential();
    setApiToken(''); setConnected(false); setConnectionName(''); setProjects([]); setFolders([]); setEnvironments([]);
    setNotice({ kind: 'info', text: 'Local API credential removed. Revoke the token in the web app if it is no longer needed.' });
  }

  async function selectProject(projectId: string): Promise<void> {
    updateSettings({ selectedProjectId: projectId, selectedEnvironmentId: '' });
    setSavedFile(null); setSavedRun(null);
    if (!api || !projectId) { setFolders([]); setEnvironments([]); return; }
    const [folderRows, environmentRows] = await Promise.all([api.folders(projectId), api.environments(projectId)]);
    setFolders(folderRows);
    const usable = environmentRows.filter(environment => environment.enabled && environment.availableNow !== false);
    setEnvironments(usable);
    updateSettings({ selectedEnvironmentId: usable[0]?.id || '' });
  }

  async function background(type: 'ATTACH' | 'DETACH' | 'START_RECORDING' | 'PAUSE_RECORDING' | 'RESUME_RECORDING' | 'STOP_RECORDING' | 'START_INSPECTING' | 'STOP_INSPECTING' | 'STOP_REPLAY' | 'RESET_SESSION'): Promise<void> {
    const response = await sendBackground({ type });
    setSession(response.state);
    if (!response.ok) throw new Error(response.error.message);
    if (type === 'ATTACH' || type === 'START_RECORDING' || type === 'START_INSPECTING') {
      window.setTimeout(() => recorderRef.current?.reconnect(), 150);
    }
  }

  function prepared() {
    return prepareRecording(source, settings.testName, settings.fileName);
  }

  async function replay(trace: boolean): Promise<void> {
    const recording = prepared();
    acceptSource(recording.source);
    const response = await sendBackground({ type: 'REPLAY', source: recording.source, trace });
    setSession(response.state);
    if (!response.ok) throw new Error(response.error.message);
    setNotice({ kind: 'success', text: trace ? 'Replay finished and the trace download was prepared.' : 'Local replay finished.' });
  }

  async function save(andRun: boolean): Promise<void> {
    if (!api || !connected) throw new ExtensionError('AUTH_EXPIRED');
    if (!settings.selectedProjectId) throw new ExtensionError('PROJECT_REMOVED', 'Select a project before saving.');
    const recording = prepared();
    acceptSource(recording.source);
    const file = await api.saveTest({
      projectId: settings.selectedProjectId,
      folderPath: settings.folderPath,
      fileName: recording.fileName,
      sourceCode: recording.source,
      description: 'Recorded with the Automation Tool Chrome Extension.',
    });
    setSavedFile(file);
    if (!andRun) {
      setNotice({ kind: 'success', text: `Saved ${file.fullPath} at revision ${file.revision}.` });
      return;
    }
    try {
      const run = await api.createRun({
        projectId: settings.selectedProjectId,
        testFileId: file.id,
        environmentId: settings.selectedEnvironmentId || undefined,
      });
      setSavedRun(run);
      setNotice({ kind: 'success', text: `Saved and queued remote run ${run.id.slice(0, 8)}.` });
    } catch (error) {
      throw new ExtensionError('RUN_FAILED', `Saved ${file.fullPath}, but run creation failed: ${asMessage(error)}`);
    }
  }

  function openWeb(path: string): void {
    void chrome.tabs.create({ url: `${settings.webBaseUrl.replace(/\/$/, '')}${path}` });
  }

  const isAttached = session.attachedTabId != null && !['disconnected', 'reattach-required', 'attaching'].includes(session.mode);
  const selectedProject = projects.find(project => project.id === settings.selectedProjectId);

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-mark">AT</div>
      <div className="brand-copy"><strong>Automation Tool</strong><span>Playwright Recorder</span></div>
      <span className={`status-pill status-${session.mode}`}>{modeLabels[session.mode]}</span>
    </header>

    <main>
      {notice && <div className={`notice ${notice.kind}`}><span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div>}
      {session.lastError && <div className="notice error"><span>{session.lastError.message}</span><button onClick={() => void runAction('reset', () => background('RESET_SESSION'))}>Reset</button></div>}

      <section className="panel connection-panel">
        <div className="section-heading"><div><span className="eyebrow">Connection</span><h2>Automation Tool API</h2></div><span className={`dot ${connected ? 'online' : ''}`} /></div>
        <div className="field-grid two">
          <label><span>API URL</span><input value={settings.apiBaseUrl} onChange={event => updateSettings({ apiBaseUrl: event.target.value })} disabled={connected} dir="ltr" /></label>
          <label><span>Web URL</span><input value={settings.webBaseUrl} onChange={event => updateSettings({ webBaseUrl: event.target.value })} disabled={connected} dir="ltr" /></label>
        </div>
        {!connected ? <>
          <label><span>Scoped extension token</span><input type="password" value={apiToken} onChange={event => setApiToken(event.target.value)} placeholder="atk_…" autoComplete="off" dir="ltr" /></label>
          <div className="row actions"><button className="primary" disabled={Boolean(busy)} onClick={() => void runAction('connect', connect)}>{busy === 'connect' ? 'Connecting…' : 'Connect'}</button><button className="ghost" onClick={() => openWeb('/extension')}>Create token in web app</button></div>
        </> : <div className="connected-row"><div><strong>{connectionName}</strong><span>Token stored only in chrome.storage.local</span></div><button className="ghost danger-text" onClick={() => void runAction('disconnect-api', disconnectApi)}>Disconnect</button></div>}
      </section>

      <section className="panel tab-panel">
        <div className="section-heading"><div><span className="eyebrow">Browser</span><h2>Current tab</h2></div><span className={`recorder-link ${recorderConnected ? 'online' : ''}`}>{recorderConnected ? 'Recorder linked' : 'Recorder waiting'}</span></div>
        <div className="tab-card"><div className="tab-favicon">◉</div><div><strong>{session.tabTitle || 'No attached tab'}</strong><span dir="ltr">{session.tabUrl || 'Open an HTTP or HTTPS page to begin.'}</span></div></div>
        {!session.active && isAttached && <p className="hint warning-text">The attached tab is not active. Recording continues on the attached tab only.</p>}
        <div className="toolbar">
          {!isAttached ? <button className="primary wide" disabled={Boolean(busy) || session.mode === 'attaching'} onClick={() => void runAction('attach', () => background('ATTACH'))}>{session.mode === 'attaching' ? 'Attaching…' : 'Attach current tab'}</button> : <>
            <button className={session.mode === 'recording' ? 'danger' : 'primary'} disabled={Boolean(busy) || session.mode === 'playing'} onClick={() => void runAction('record', () => background(session.mode === 'recording' ? 'STOP_RECORDING' : session.mode === 'paused' ? 'RESUME_RECORDING' : 'START_RECORDING'))}>{session.mode === 'recording' ? 'Stop' : session.mode === 'paused' ? 'Resume' : 'Record'}</button>
            {session.mode === 'recording' && <button className="secondary" onClick={() => void runAction('pause', () => background('PAUSE_RECORDING'))}>Pause</button>}
            <button className={session.mode === 'inspecting' ? 'secondary active' : 'secondary'} disabled={Boolean(busy) || session.mode === 'playing'} onClick={() => void runAction('inspect', () => background(session.mode === 'inspecting' ? 'STOP_INSPECTING' : 'START_INSPECTING'))}>{session.mode === 'inspecting' ? 'Done inspecting' : 'Inspect'}</button>
            <button className="ghost danger-text" disabled={Boolean(busy)} onClick={() => void runAction('detach', () => background('DETACH'))}>Detach</button>
          </>}
        </div>
      </section>

      {locator && <section className="panel locator-panel">
        <div className="section-heading"><div><span className="eyebrow">Inspector</span><h2>Recommended locator</h2></div></div>
        <code>{locator}</code>
        <div className="row actions"><button className="secondary" onClick={() => void navigator.clipboard.writeText(locator)}>Copy locator</button><button className="secondary" onClick={() => setSource(current => insertLocatorAction(current, locator))}>Insert click</button></div>
      </section>}

      <section className="panel source-panel">
        <div className="section-heading"><div><span className="eyebrow">Source</span><h2>Playwright Test · TypeScript</h2></div><span className="line-count">{source.split('\n').length} lines</span></div>
        {warnings.length > 0 && <div className="security-warning"><strong>Secrets sanitized</strong><span>{warnings.join(' ')} {envVars.length ? `Configure: ${envVars.join(', ')}` : ''}</span></div>}
        <textarea
          aria-label="Generated Playwright Test source"
          spellCheck={false}
          value={source}
          onChange={event => setSource(event.target.value)}
          onBlur={() => acceptSource(source)}
          placeholder="Attach a tab and start recording. Playwright-generated TypeScript appears here."
        />
        <div className="source-actions">
          <button className="ghost" onClick={() => void navigator.clipboard.writeText(source)} disabled={!source}>Copy</button>
          <button className="ghost danger-text" onClick={() => { recorderRef.current?.dispatch('clear'); setSource(''); setWarnings([]); setEnvVars([]); }}>Clear</button>
          <span />
          {session.mode === 'playing' ? <button className="danger" onClick={() => void runAction('stop-replay', () => background('STOP_REPLAY'))}>Stop replay</button> : <>
            <button className="secondary" disabled={!isAttached || !source || session.mode === 'recording' || Boolean(busy)} onClick={() => void runAction('replay', () => replay(false))}>Replay</button>
            <button className="secondary" disabled={!isAttached || !source || session.mode === 'recording' || Boolean(busy)} onClick={() => void runAction('trace', () => replay(true))}>Replay + Trace</button>
          </>}
        </div>
      </section>

      <section className="panel destination-panel">
        <div className="section-heading"><div><span className="eyebrow">Destination</span><h2>Save to Automation Tool</h2></div></div>
        <label><span>Project</span><select value={settings.selectedProjectId} disabled={!connected} onChange={event => void runAction('project', () => selectProject(event.target.value))}><option value="">Select project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name} · {project.code}</option>)}</select></label>
        <div className="field-grid two">
          <label><span>Folder</span><input list="automation-folders" value={settings.folderPath} onChange={event => updateSettings({ folderPath: event.target.value })} dir="ltr" /><datalist id="automation-folders">{folders.map(folder => <option key={folder.folderPath} value={folder.folderPath} />)}</datalist></label>
          <label><span>File</span><input value={settings.fileName} onChange={event => updateSettings({ fileName: event.target.value })} onBlur={() => updateSettings({ fileName: sanitizeFileName(settings.fileName) })} dir="ltr" /></label>
        </div>
        <label><span>Test name</span><input value={settings.testName} onChange={event => updateSettings({ testName: event.target.value })} /></label>
        <label><span>Remote environment</span><select value={settings.selectedEnvironmentId} disabled={!settings.selectedProjectId} onChange={event => updateSettings({ selectedEnvironmentId: event.target.value })}><option value="">Runner default</option>{environments.map(environment => <option key={environment.id} value={environment.id}>{environment.name} · {environment.baseUrl}</option>)}</select></label>
        {selectedProject && <p className="hint">Source approach: {selectedProject.sourceApproach || 'CDE'}. Save & Run uses the platform’s single Runner queue.</p>}
        <div className="save-actions"><button className="secondary" disabled={!connected || !source || Boolean(busy)} onClick={() => void runAction('save', () => save(false))}>{busy === 'save' ? 'Saving…' : 'Save'}</button><button className="primary" disabled={!connected || !source || Boolean(busy)} onClick={() => void runAction('save-run', () => save(true))}>{busy === 'save-run' ? 'Saving & queuing…' : 'Save & Run'}</button></div>
        {(savedFile || savedRun) && <div className="deep-links">{savedFile && <button className="ghost" onClick={() => openWeb(`/files/${encodeURIComponent(savedFile.id)}`)}>Open saved test ↗</button>}{savedRun && <button className="ghost" onClick={() => openWeb(`/runs?runId=${encodeURIComponent(savedRun.id)}`)}>Open run ↗</button>}</div>}
      </section>

      <details className="panel settings-panel">
        <summary>Recorder settings</summary>
        <div className="field-grid two settings-fields"><label><span>Test ID attribute</span><input value={settings.testIdAttribute} onChange={event => updateSettings({ testIdAttribute: event.target.value })} dir="ltr" /></label><label><span>Replay slowMo (ms)</span><input type="number" min="0" max="2000" value={settings.slowMo} onChange={event => updateSettings({ slowMo: Math.max(0, Math.min(2000, Number(event.target.value) || 0)) })} /></label></div>
        <p className="hint">Changing recorder engine settings takes effect after detach and reattach.</p>
        <button className="ghost" onClick={() => void chrome.runtime.openOptionsPage()}>Open settings page</button>
      </details>
    </main>
    <footer>Passwords, cookies, authorization headers and storage state are never saved to Automation Tool.</footer>
  </div>;
}
