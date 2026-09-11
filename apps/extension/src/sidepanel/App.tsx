import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AutomationApiClient } from '../api/client';
import type { EnvironmentSummary, FolderSummary, ProjectSummary, RunSummary, SourceValidationIssue, TestFileSummary } from '../api/types';
import { BUILD_CONFIG } from '../config';
import { clearCredential, loadCredential, revokeCredential } from '../auth/credentials';
import { sendBackground } from '../messaging/client';
import type { RecorderBackendMessage, RecorderConnectMessage, SessionMode, SessionState, StateChangedMessage } from '../messaging/contracts';
import { prepareRecording, sanitizeFileName } from '../recorder/normalizer';
import { sanitizeSource } from '../recorder/sanitizer';
import type { RecorderElementInfo, RecorderSource } from '../recorder/types';
import { DEFAULT_SETTINGS, isAttachableUrl, type ExtensionSettings } from '../shared/constants';
import { ExtensionError } from '../shared/errors';
import { recordTelemetry } from '../shared/telemetry';
import { loadSettings, saveSettings } from '../storage/settings';
import { RecorderPortClient } from './recorder-port';
import {
  activityFromSource, assertionSource, mayDependOnBrowserLogin, withAssertions, workflowState, type AssertionKind,
} from './workflow';
import './styles.css';

const emptySession: SessionState = {
  mode: 'disconnected', attachedTabId: null, tabTitle: '', tabUrl: '', active: false,
  canReplay: false, traceAvailable: false, lastError: null, updatedAt: new Date(0).toISOString(),
};

const modeLabels: Record<SessionMode, string> = {
  disconnected: 'Ready', 'reattach-required': 'Needs attention', attaching: 'Getting ready…', attached: 'Ready',
  recording: 'Recording', paused: 'Paused', inspecting: 'Choose an element', playing: 'Testing', error: 'Needs attention',
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

function elapsedLabel(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function App() {
  const [settings, setSettingsState] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [session, setSession] = useState<SessionState>(emptySession);
  const [connected, setConnected] = useState(false);
  const [connectionName, setConnectionName] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [source, setSource] = useState('');
  const [assertions, setAssertions] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [envVars, setEnvVars] = useState<string[]>([]);
  const [locator, setLocator] = useState('');
  const [assertionKind, setAssertionKind] = useState<AssertionKind>('visible');
  const [assertionText, setAssertionText] = useState('');
  const [showAssertion, setShowAssertion] = useState(false);
  const [resumeAfterAssertion, setResumeAfterAssertion] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [validationIssues, setValidationIssues] = useState<SourceValidationIssue[]>([]);
  const [savedFile, setSavedFile] = useState<TestFileSummary | null>(null);
  const [savedRun, setSavedRun] = useState<RunSummary | null>(null);
  const [recorderConnected, setRecorderConnected] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [currentTab, setCurrentTab] = useState<{ title: string; url: string }>({ title: '', url: '' });
  const recorderRef = useRef<RecorderPortClient | null>(null);
  const settingsRef = useRef<ExtensionSettings>(DEFAULT_SETTINGS);
  const api = useMemo(() => new AutomationApiClient(), []);

  const updateSettings = useCallback((patch: Partial<ExtensionSettings>) => {
    setSettingsState(current => {
      const next = { ...current, ...patch };
      settingsRef.current = next;
      void saveSettings(next);
      return next;
    });
  }, []);

  const acceptSource = useCallback((raw: string) => {
    const currentSettings = settingsRef.current;
    try {
      const prepared = prepareRecording(raw, currentSettings.testName, currentSettings.fileName);
      setSource(prepared.source);
      setWarnings(prepared.warnings);
      setEnvVars(prepared.environmentVariables);
    } catch {
      const sanitized = sanitizeSource(raw);
      setSource(sanitized.source);
      setWarnings(sanitized.warnings);
      setEnvVars(sanitized.environmentVariables);
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    const [profile, rows] = await Promise.all([api.profile(), api.projects()]);
    const active = rows.filter(project => project.isActive);
    setConnected(true);
    setConnectionName(profile.user.fullName);
    setProjects(active);
    const preferredProjectId = settingsRef.current.selectedProjectId;
    const selectedProjectId = active.some(project => project.id === preferredProjectId)
      ? preferredProjectId : active[0]?.id || '';
    if (selectedProjectId !== preferredProjectId) updateSettings({ selectedProjectId });
    if (selectedProjectId) {
      const [folderRows, environmentRows] = await Promise.all([api.folders(selectedProjectId), api.environments(selectedProjectId)]);
      setFolders(folderRows);
      setEnvironments(environmentRows.filter(item => item.enabled && item.availableNow !== false));
    }
  }, [api, updateSettings]);

  const onRecorderMessage = useCallback((message: RecorderBackendMessage) => {
    if (message.method === 'setSources' && Array.isArray(message.sources)) {
      const sources = message.sources as RecorderSource[];
      const preferred = sources.find(item => item.id === 'playwright-test')
        || sources.find(item => /playwright test/i.test(item.label || '')) || sources[0];
      if (preferred?.text != null) acceptSource(preferred.text);
    }
    if (message.method === 'elementPicked' && message.elementInfo) {
      setLocator(locatorFromElement(message.elementInfo as RecorderElementInfo));
      setShowAssertion(true);
      setNotice({ kind: 'info', text: 'Element selected. Choose what this test should verify.' });
    }
  }, [acceptSource]);

  useEffect(() => {
    const recorder = new RecorderPortClient({ onMessage: onRecorderMessage, onConnectionChange: setRecorderConnected });
    recorderRef.current = recorder;
    recorder.connect();
    const stateListener = (message: unknown) => {
      if (message && typeof message === 'object' && (message as StateChangedMessage).type === 'STATE_CHANGED') setSession((message as StateChangedMessage).state);
      if (message && typeof message === 'object' && (message as RecorderConnectMessage).type === 'RECORDER_CONNECT_REQUIRED') recorder.reconnect();
      if (message && typeof message === 'object' && (message as { type?: string }).type === 'AUTH_CHANGED') void refreshProjects().catch(() => undefined);
    };
    chrome.runtime.onMessage.addListener(stateListener);
    return () => { chrome.runtime.onMessage.removeListener(stateListener); recorder.stop(); recorderRef.current = null; };
  }, [onRecorderMessage, refreshProjects]);

  useEffect(() => {
    void (async () => {
      const [storedSettings, credential, stateResponse, tabs] = await Promise.all([
        loadSettings(), loadCredential(), sendBackground({ type: 'GET_STATE' }), chrome.tabs.query({ active: true, currentWindow: true }),
      ]);
      settingsRef.current = storedSettings;
      setSettingsState(storedSettings);
      setSession(stateResponse.state);
      const tab = tabs[0];
      setCurrentTab({ title: tab?.title || '', url: tab?.url || '' });
      if (credential) await refreshProjects().catch(async (error) => {
        if (error instanceof ExtensionError && error.code === 'AUTH_EXPIRED') await clearCredential();
        setConnected(false); setNotice({ kind: 'error', text: asMessage(error) });
      });
    })();
  }, [refreshProjects]);

  useEffect(() => {
    const activated = async () => {
      const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      setCurrentTab({ title: tab?.title || '', url: tab?.url || '' });
    };
    const updated = (_id: number, change: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (tab.active && (change.url || change.title)) setCurrentTab({ title: tab.title || '', url: tab.url || '' });
    };
    chrome.tabs.onActivated.addListener(activated);
    chrome.tabs.onUpdated.addListener(updated);
    return () => { chrome.tabs.onActivated.removeListener(activated); chrome.tabs.onUpdated.removeListener(updated); };
  }, []);

  useEffect(() => {
    if (session.mode !== 'recording') return;
    const timer = window.setInterval(() => setElapsed(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [session.mode]);

  async function runAction(name: string, action: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(name); setNotice(null); setValidationIssues([]);
    try { await action(); } catch (error) {
      if (error instanceof ExtensionError && error.code === 'AUTH_EXPIRED') {
        await clearCredential();
        setConnected(false); setConnectionName(''); setProjects([]);
      }
      if (error instanceof ExtensionError && error.code === 'SECRET_VALIDATION_FAILED') {
        const details = error.details as { issues?: SourceValidationIssue[] } | undefined;
        setValidationIssues(details?.issues || []);
        recordTelemetry('validation_failed', { issueCount: details?.issues?.length || 0 });
      }
      recordTelemetry('extension_error', { errorCode: error instanceof ExtensionError ? error.code : 'UNKNOWN' });
      setNotice({ kind: 'error', text: asMessage(error) });
    } finally { setBusy(''); }
  }

  async function background(type: 'ATTACH' | 'DETACH' | 'START_RECORDING' | 'PAUSE_RECORDING' | 'RESUME_RECORDING' | 'STOP_RECORDING' | 'START_INSPECTING' | 'STOP_INSPECTING' | 'STOP_REPLAY' | 'RESET_SESSION'): Promise<void> {
    const response = await sendBackground({ type });
    setSession(response.state);
    if (!response.ok) throw new ExtensionError(response.error.code, response.error.message);
    if (['ATTACH', 'START_RECORDING', 'START_INSPECTING'].includes(type)) window.setTimeout(() => recorderRef.current?.reconnect(), 150);
  }

  async function selectProject(projectId: string): Promise<void> {
    updateSettings({ selectedProjectId: projectId, selectedEnvironmentId: '' });
    setSavedFile(null); setSavedRun(null);
    if (!projectId) { setFolders([]); setEnvironments([]); return; }
    const [folderRows, environmentRows] = await Promise.all([api.folders(projectId), api.environments(projectId)]);
    setFolders(folderRows);
    const usable = environmentRows.filter(item => item.enabled && item.availableNow !== false);
    setEnvironments(usable);
    updateSettings({ selectedEnvironmentId: usable[0]?.id || '' });
  }

  async function startRecording(): Promise<void> {
    if (!connected) throw new ExtensionError('AUTH_EXPIRED', 'Connect the recorder from Automation Tool first.');
    if (!settings.selectedProjectId) throw new ExtensionError('PROJECT_REMOVED', 'Choose a project before recording.');
    if (!settings.testName.trim()) throw new ExtensionError('INVALID_SOURCE', 'Enter a test name before recording.');
    if (!isAttachableUrl(currentTab.url)) throw new ExtensionError('UNSUPPORTED_PAGE', 'This Chrome page cannot be recorded. Open a normal website and try again.');
    setSource(''); setAssertions([]); setWarnings([]); setEnvVars([]); setSavedFile(null); setSavedRun(null); setElapsed(0);
    await background('START_RECORDING');
    recordTelemetry('recording_started');
    setNotice({ kind: 'info', text: 'Recording started. Continue in the current page.' });
  }

  async function finishRecording(): Promise<void> {
    await background('STOP_RECORDING');
    if (!source.trim()) throw new ExtensionError('INVALID_SOURCE', 'No browser actions were captured. Try recording again.');
    recordTelemetry('recording_finished', { durationSeconds: elapsed, stepCount: activityFromSource(source).length });
    setNotice({ kind: 'success', text: 'Recording complete. Review the summary, then test or save it.' });
  }

  async function beginAssertion(): Promise<void> {
    setResumeAfterAssertion(session.mode === 'recording');
    setLocator(''); setShowAssertion(false);
    await background('START_INSPECTING');
    setNotice({ kind: 'info', text: 'Choose something on the page that this test should verify.' });
  }

  async function addAssertion(): Promise<void> {
    const line = assertionSource(locator, assertionKind, assertionText);
    setAssertions(current => [...current, line]);
    setShowAssertion(false); setAssertionText('');
    await background('STOP_INSPECTING');
    if (resumeAfterAssertion) await background('RESUME_RECORDING');
    setNotice({ kind: 'success', text: 'Assertion added to this test.' });
  }

  function prepared() {
    return prepareRecording(withAssertions(source, assertions), settings.testName, settings.fileName);
  }

  async function testLocally(trace = false): Promise<void> {
    const recording = prepared();
    recordTelemetry('local_test_started');
    try {
      const response = await sendBackground({ type: 'REPLAY', source: recording.source, trace });
      setSession(response.state);
      if (!response.ok) throw new ExtensionError(response.error.code, response.error.message);
      recordTelemetry('local_test_finished', { passed: true });
      setNotice({ kind: 'success', text: trace ? 'Local test passed and its trace was downloaded.' : 'Local test passed in your current Chrome session.' });
    } catch (error) {
      recordTelemetry('local_test_finished', { passed: false });
      throw error;
    }
  }

  async function save(andRun: boolean): Promise<void> {
    if (!connected) throw new ExtensionError('AUTH_EXPIRED');
    if (!settings.selectedProjectId) throw new ExtensionError('PROJECT_REMOVED', 'Choose a project before saving.');
    const recording = prepared();
    const validation = await api.validateSource(settings.selectedProjectId, recording.source);
    if (!validation.valid) throw new ExtensionError('SECRET_VALIDATION_FAILED', undefined, true, validation);
    const sameDestination = savedFile?.projectId === settings.selectedProjectId
      && savedFile.folderPath === settings.folderPath && savedFile.fileName === recording.fileName;
    const file = await api.saveTest({
      projectId: settings.selectedProjectId,
      folderPath: settings.folderPath,
      fileName: recording.fileName,
      sourceCode: recording.source,
      description: 'Recorded with Automation Tool Chrome Recorder.',
      revision: sameDestination ? savedFile.revision : undefined,
    });
    setSavedFile(file);
    recordTelemetry('test_saved');
    if (!andRun) { setNotice({ kind: 'success', text: `Test saved to ${file.fullPath}.` }); return; }
    try {
      recordTelemetry('save_and_run_started');
      const run = await api.createRun({ projectId: settings.selectedProjectId, testFileId: file.id, environmentId: settings.selectedEnvironmentId || undefined });
      setSavedRun(run);
      setNotice({ kind: 'success', text: 'Test saved and started in Automation Tool’s isolated test environment.' });
    } catch (error) {
      throw new ExtensionError('RUN_FAILED', `The test was saved, but the server run could not start: ${asMessage(error)}`);
    }
  }

  function openWeb(path: string): void { void chrome.tabs.create({ url: `${BUILD_CONFIG.webOrigin}${path}` }); }

  async function disconnect(): Promise<void> {
    await revokeCredential();
    setConnected(false); setConnectionName(''); setProjects([]); setFolders([]); setEnvironments([]);
    setNotice({ kind: 'info', text: 'This recorder connection was revoked and removed from this device.' });
  }

  const combinedSource = withAssertions(source, assertions);
  const steps = useMemo(() => activityFromSource(source, assertions), [source, assertions]);
  const state = workflowState(session, combinedSource, busy);
  const protectedCount = steps.filter(step => step.protected).length;
  const assertionCount = steps.filter(step => step.assertion).length;
  const displayUrl = session.tabUrl || currentTab.url;
  const displayHost = (() => { try { return new URL(displayUrl).host; } catch { return 'Open a website to begin'; } })();
  const loginWarning = mayDependOnBrowserLogin(combinedSource, displayUrl);
  const isRecording = session.mode === 'recording' || session.mode === 'paused' || session.mode === 'inspecting';

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-mark">AT</div>
      <div className="brand-copy"><strong>Automation Recorder</strong><span>Turn browser actions into tests</span></div>
      <span className={`status-pill status-${session.mode}`} aria-live="polite">{busy ? state : modeLabels[session.mode]}</span>
    </header>

    <main>
      <div className="sr-only" aria-live="polite">Recorder status: {state}</div>
      <textarea className="sr-only recorder-source-probe" aria-hidden="true" tabIndex={-1} readOnly value={combinedSource} />
      {notice && <div className={`notice ${notice.kind}`} role="status"><span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="Dismiss message">×</button></div>}
      {session.lastError && <div className="notice error" role="alert"><span>{session.lastError.message}</span><button onClick={() => void runAction('reconnect', () => background('ATTACH'))}>Reconnect</button></div>}

      {!connected && <section className="panel centered-state">
        <div className="connection-icon" aria-hidden="true">↔</div>
        <h2>Connect to Automation Tool</h2>
        <p>Open Chrome Recorder in Automation Tool and choose <strong>Connect Recorder</strong>. Pairing is automatic—no token is required.</p>
        <button className="primary wide" onClick={() => openWeb('/extension')}>Open Automation Tool</button>
      </section>}

      {connected && !isRecording && state === 'Ready' && <section className="panel ready-panel">
        <div className="connected-banner"><span className="success-check">✓</span><span><strong>Connected</strong><small>{connectionName}</small></span></div>
        <label><span>Project</span><select aria-label="Project" value={settings.selectedProjectId} onChange={event => void runAction('project', () => selectProject(event.target.value))}><option value="">Choose a project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label><span>Test name</span><input aria-label="Test name" value={settings.testName} placeholder="Successful checkout" onChange={event => updateSettings({ testName: event.target.value, fileName: sanitizeFileName(event.target.value) })} /></label>
        <div className="current-page"><span>Current page</span><strong dir="ltr">{displayHost}</strong></div>
        {!projects.length && <p className="hint warning-text">Your account does not currently have access to a recordable project.</p>}
        <button className="record-button" disabled={Boolean(busy) || !projects.length} onClick={() => void runAction('record', startRecording)}><span aria-hidden="true">●</span> Start Recording</button>
      </section>}

      {connected && isRecording && <section className="panel recording-panel">
        <div className="recording-header"><span><i />{session.mode === 'paused' ? 'Paused' : session.mode === 'inspecting' ? 'Choose an element' : 'Recording'}</span><time>{elapsedLabel(elapsed)}</time></div>
        <h2>{settings.testName}</h2>
        <ol className="activity-feed">{steps.length ? steps.map((step, index) => <li key={step.id}><span>{index + 1}</span><p>{step.label}{step.protected && <b title="Sensitive value protected" aria-label="Sensitive value protected"> 🔒</b>}</p></li>) : <li className="empty-feed"><p>Actions will appear here as you use the page.</p></li>}</ol>
        <button className="add-assertion" disabled={session.mode === 'inspecting'} onClick={() => void runAction('assertion', beginAssertion)}>+ Add assertion</button>
        <div className="record-controls">{session.mode === 'paused'
          ? <button className="secondary" onClick={() => void runAction('resume', () => background('RESUME_RECORDING'))}>Resume</button>
          : <button className="secondary" disabled={session.mode === 'inspecting'} onClick={() => void runAction('pause', () => background('PAUSE_RECORDING'))}>Pause</button>}
          <button className="primary" disabled={session.mode === 'inspecting'} onClick={() => void runAction('finish', finishRecording)}>Finish</button></div>
      </section>}

      {showAssertion && locator && <section className="panel locator-panel assertion-builder">
        <h2>Add assertion</h2><p>Choose what this test should verify.</p><code>{locator}</code>
        <label><span>Verification</span><select value={assertionKind} onChange={event => setAssertionKind(event.target.value as AssertionKind)}><option value="visible">Element is visible</option><option value="text-equals">Text equals…</option><option value="text-contains">Text contains…</option><option value="enabled">Element is enabled</option><option value="checked">Element is checked</option><option value="url-contains">URL contains…</option><option value="title">Page title equals…</option></select></label>
        {['text-equals', 'text-contains', 'url-contains', 'title'].includes(assertionKind) && <label><span>Expected value</span><input value={assertionText} onChange={event => setAssertionText(event.target.value)} /></label>}
        <button className="primary wide" onClick={() => void runAction('add-assertion', addAssertion)}>Add to test</button>
      </section>}

      {connected && state === 'Review' && <section className="panel review-panel">
        <div className="completion-mark">✓</div><h2>Recording complete</h2><h3>{settings.testName}</h3>
        <div className="summary-grid"><div><strong>{steps.length}</strong><span>steps</span></div><div><strong>{assertionCount}</strong><span>assertions</span></div><div><strong>{protectedCount}</strong><span>protected 🔒</span></div></div>
        {warnings.length > 0 && <div className="security-warning"><strong>{protectedCount || 1} sensitive value was protected.</strong><span>{envVars.length ? `Configure ${envVars.join(', ')} before running this test in Automation Tool.` : warnings.join(' ')}</span></div>}
        {loginWarning && <div className="notice info"><span>This test may depend on your current browser login. Automation Tool runs server tests in a separate browser; include login steps or configured test credentials.</span></div>}
        <button className="local-test" disabled={Boolean(busy)} onClick={() => void runAction('test-local', () => testLocally(false))}>Test locally<small>Runs in your current Chrome session</small></button>
        <div className="save-actions"><button className="secondary" disabled={Boolean(busy)} onClick={() => void runAction('save', () => save(false))}>{busy === 'save' ? 'Saving…' : 'Save'}</button><button className="primary" disabled={Boolean(busy)} onClick={() => void runAction('save-run', () => save(true))}>{busy === 'save-run' ? 'Starting…' : 'Save & Run'}</button></div>
        <p className="runner-explanation">Save & Run uses Automation Tool’s isolated browser and project environment.</p>
        {(savedFile || savedRun) && <div className="deep-links">{savedFile && <button className="ghost" onClick={() => openWeb(`/files/${encodeURIComponent(savedFile.id)}`)}>Open saved test ↗</button>}{savedRun && <button className="ghost" onClick={() => openWeb(`/runs?runId=${encodeURIComponent(savedRun.id)}`)}>Open run ↗</button>}</div>}
      </section>}

      {connected && ['Testing', 'Saving', 'Running'].includes(state) && <section className="panel centered-state progress-panel" aria-busy="true">
        <div className="progress-indicator" aria-hidden="true" />
        <h2>{state}</h2>
        <p>{state === 'Testing' ? 'Running this test in your current Chrome session.' : state === 'Saving' ? 'Protecting and saving this test in Automation Tool.' : 'Saving the test and starting it in Automation Tool’s isolated environment.'}</p>
      </section>}

      {validationIssues.length > 0 && <section className="panel validation-panel" role="alert"><h2>Review sensitive data</h2>{validationIssues.map(issue => <div key={`${issue.line}-${issue.category}`}><strong>Line {issue.line}: {issue.message}</strong><span>{issue.suggestedRemediation}</span></div>)}</section>}

      {connected && <details className="panel advanced-panel">
        <summary>Advanced</summary>
        <div className="advanced-content">
          <h3>Playwright code</h3>
          <textarea aria-label="Generated Playwright Test source" spellCheck={false} value={combinedSource} onChange={event => { setAssertions([]); setSource(event.target.value); }} onBlur={() => { setAssertions([]); acceptSource(combinedSource); }} placeholder="Recorded Playwright Test code appears here." />
          <div className="toolbar"><button className="secondary" disabled={!source || Boolean(busy)} onClick={() => void runAction('trace', () => testLocally(true))}>Test locally with trace</button><button className="ghost" disabled={!source} onClick={() => void navigator.clipboard.writeText(combinedSource)}>Copy code</button><button className="ghost danger-text" onClick={() => { recorderRef.current?.dispatch('clear'); setSource(''); setAssertions([]); }}>Clear</button></div>
          <h3>Locator tools</h3>
          <div className="toolbar"><button className="secondary" disabled={Boolean(busy)} onClick={() => void runAction('inspect', beginAssertion)}>Inspect locator</button>{locator && <button className="ghost" onClick={() => void navigator.clipboard.writeText(locator)}>Copy locator</button>}</div>
          <h3>Destination file</h3><p className="destination-summary" dir="ltr">{settings.folderPath}/{settings.fileName}</p>
          <label><span>Folder</span><input list="automation-folders" value={settings.folderPath} onChange={event => updateSettings({ folderPath: event.target.value })} dir="ltr" /><datalist id="automation-folders">{folders.map(folder => <option key={folder.folderPath} value={folder.folderPath} />)}</datalist></label>
          <label><span>File name</span><input value={settings.fileName} onChange={event => updateSettings({ fileName: event.target.value })} onBlur={() => updateSettings({ fileName: sanitizeFileName(settings.fileName) })} dir="ltr" /></label>
          <label><span>Server environment</span><select value={settings.selectedEnvironmentId} onChange={event => updateSettings({ selectedEnvironmentId: event.target.value })}><option value="">Runner default</option>{environments.map(environment => <option key={environment.id} value={environment.id}>{environment.name}</option>)}</select></label>
          <div className="field-grid two"><label><span>Test ID attribute</span><input value={settings.testIdAttribute} onChange={event => updateSettings({ testIdAttribute: event.target.value })} dir="ltr" /></label><label><span>Local test delay (ms)</span><input type="number" min="0" max="2000" value={settings.slowMo} onChange={event => updateSettings({ slowMo: Math.max(0, Math.min(2000, Number(event.target.value) || 0)) })} /></label></div>
          <h3>Troubleshooting</h3><p className="hint">Recorder engine: {recorderConnected ? 'available' : 'waiting'} · Page connection: {session.attachedTabId == null ? 'not active' : 'active'}</p>
          <div className="toolbar"><button className="secondary" onClick={() => void runAction('reconnect', () => background('ATTACH'))}>Reconnect page</button><button className="ghost" onClick={() => void runAction('detach', () => background('DETACH'))}>Disconnect page</button><button className="ghost danger-text" onClick={() => void runAction('disconnect-account', disconnect)}>Disconnect account</button></div>
        </div>
      </details>}
    </main>
    <footer>Browser cookies and storage state never leave your Chrome profile.</footer>
  </div>;
}
