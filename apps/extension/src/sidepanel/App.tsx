import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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

type BottomTab = 'locator' | 'log' | 'settings';

const emptySession: SessionState = {
  mode: 'disconnected', attachedTabId: null, tabTitle: '', tabUrl: '', active: false,
  canReplay: false, traceAvailable: false, lastError: null, updatedAt: new Date(0).toISOString(),
};

const modeLabels: Record<SessionMode, string> = {
  disconnected: 'Ready', 'reattach-required': 'Reconnect', attaching: '…', attached: 'Ready',
  recording: 'Recording', paused: 'Paused', inspecting: 'Inspect', playing: 'Running', error: 'Error',
};

function pickEnvironmentForSource(
  environments: EnvironmentSummary[],
  selectedId: string,
  source: string,
): string | undefined {
  const usable = environments.filter(item => item.enabled !== false);
  if (!usable.length) return undefined;
  if (selectedId && usable.some(item => item.id === selectedId)) {
    const selected = usable.find(item => item.id === selectedId)!;
    try {
      const selectedHost = new URL(selected.baseUrl).hostname.toLowerCase();
      const mentionsAdib = /adib\.m\.edus\.ir/i.test(source);
      if (!(mentionsAdib && /cde\.edus\.ir/i.test(selectedHost))) return selected.id;
    } catch {
      return selected.id;
    }
  }
  const hosts = [...String(source || '').matchAll(/https?:\/\/([^/"'\s]+)/gi)]
    .map(match => match[1].toLowerCase());
  const ranked = usable
    .map(item => {
      let host = '';
      try { host = new URL(item.baseUrl).hostname.toLowerCase(); } catch { host = ''; }
      const exact = hosts.some(h => h === host) ? 3 : 0;
      const adib = /adib/i.test(host) && hosts.some(h => /adib/i.test(h)) ? 2 : 0;
      const soha = /soha/i.test(host) && hosts.some(h => /soha|adib/i.test(h)) ? 1 : 0;
      return { id: item.id, score: exact + adib + soha };
    })
    .sort((a, b) => b.score - a.score);
  if (ranked[0]?.score) return ranked[0].id;
  return usable[0]?.id;
}

function IconPick() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2.5 2.5h4v1h-3v3h-1zm7 0h4v4h-1v-3h-3zm-7 7h1v3h3v1h-4zm10 0h1v4h-4v-1h3zM7 7.5 5.5 13l2-1.2L9 14.5 10.5 12 13 13.5 7 7.5z"/></svg>;
}
function IconEye() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 3c-3.2 0-5.9 2-7.2 4.7a.5.5 0 0 0 0 .6C2.1 11 4.8 13 8 13s5.9-2 7.2-4.7a.5.5 0 0 0 0-.6C13.9 5 11.2 3 8 3zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0-1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg>;
}
function IconCopy() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5 2h7a1 1 0 0 1 1 1v8h-1V3H5V2zm-2 2h7a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm0 1v8h7V5H3z"/></svg>;
}
function IconPlay() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 2.5v11l9-5.5L4 2.5z"/></svg>;
}
function IconPause() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.5 2h3v12h-3zm6 0h3v12h-3z"/></svg>;
}
function IconStop() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.5 3.5h9v9h-9z"/></svg>;
}
function IconSave() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2.5 2.5h8.2L13.5 5.3V13.5h-11zm1 1v9h9v-7.3L10 3.5H3.5zm1.5 0H9v3H5zm1 5h5v4H6z"/></svg>;
}

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
  const [bottomTab, setBottomTab] = useState<BottomTab>('log');
  const [editorShare, setEditorShare] = useState(0.72);
  const recorderRef = useRef<RecorderPortClient | null>(null);
  const settingsRef = useRef<ExtensionSettings>(DEFAULT_SETTINGS);
  const busyRef = useRef('');
  const resizeRef = useRef<{ startY: number; startShare: number } | null>(null);
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
      setBottomTab('locator');
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
        loadSettings(), loadCredential(), sendBackground({ type: 'GET_STATE' }), chrome.tabs.query({ active: true, lastFocusedWindow: true }),
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
    if (!notice || notice.kind === 'error') return;
    const timer = window.setTimeout(() => setNotice(null), notice.kind === 'success' ? 3500 : 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const refreshLiveTab = async () => {
      const tab = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
      setCurrentTab({ title: tab?.title || '', url: tab?.url || '' });
    };
    void refreshLiveTab();
    const activated = () => { void refreshLiveTab(); };
    const updated = (_id: number, change: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (tab.active && (change.url || change.title || change.status === 'complete')) {
        setCurrentTab({ title: tab.title || '', url: tab.url || '' });
      }
    };
    chrome.tabs.onActivated.addListener(activated);
    chrome.tabs.onUpdated.addListener(updated);
    const focusListener = () => { void refreshLiveTab(); };
    window.addEventListener('focus', focusListener);
    return () => {
      chrome.tabs.onActivated.removeListener(activated);
      chrome.tabs.onUpdated.removeListener(updated);
      window.removeEventListener('focus', focusListener);
    };
  }, []);

  useEffect(() => {
    if (session.mode !== 'recording') return;
    const timer = window.setInterval(() => setElapsed(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [session.mode]);

  async function runAction(name: string, action: () => Promise<void>): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = name;
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
    } finally {
      busyRef.current = '';
      setBusy('');
    }
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
    const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const liveUrl = focused?.url || currentTab.url;
    if (!isAttachableUrl(liveUrl)) throw new ExtensionError('UNSUPPORTED_PAGE', 'This Chrome page cannot be recorded. Open a normal website tab, then press Record.');
    setCurrentTab({ title: focused?.title || '', url: liveUrl });
    setSource(''); setAssertions([]); setWarnings([]); setEnvVars([]); setSavedFile(null); setSavedRun(null); setElapsed(0);
    setBottomTab('log');
    await background('START_RECORDING');
    recordTelemetry('recording_started');
    setNotice({ kind: 'info', text: 'Recording…' });
  }

  async function finishRecording(): Promise<void> {
    await background('STOP_RECORDING');
    if (!source.trim()) throw new ExtensionError('INVALID_SOURCE', 'No browser actions were captured. Try recording again.');
    recordTelemetry('recording_finished', { durationSeconds: elapsed, stepCount: activityFromSource(source).length });
    setBottomTab('log');
    setNotice({ kind: 'success', text: 'Recording complete' });
  }

  async function beginAssertion(): Promise<void> {
    setResumeAfterAssertion(session.mode === 'recording');
    setLocator(''); setShowAssertion(false);
    setBottomTab('locator');
    await background('START_INSPECTING');
    setNotice({ kind: 'info', text: 'Pick an element on the page' });
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
    if (!andRun) {
      setNotice({ kind: 'success', text: `Test saved to ${file.fullPath}.` });
      return;
    }
    const environmentId = pickEnvironmentForSource(
      environments,
      settings.selectedEnvironmentId,
      recording.source,
    );
    if (environments.length && !environmentId) {
      throw new ExtensionError('RUN_FAILED', 'The test was saved, but no server environment is available. Choose one under Settings, then try Save & Run again.');
    }
    try {
      recordTelemetry('save_and_run_started');
      const exported = await sendBackground({ type: 'EXPORT_STORAGE_STATE' });
      if (!exported.ok) {
        throw new ExtensionError(exported.error.code, exported.error.message);
      }
      const browserStorageState = exported.storageState;
      if (!browserStorageState?.cookies?.length) {
        throw new ExtensionError(
          'RUN_FAILED',
          'The test was saved, but no login cookies were found. Stay signed in on the target page (local Run works because it reuses your Chrome tab), then click Run again.',
        );
      }
      const run = await api.createRun({
        projectId: settings.selectedProjectId,
        testFileId: file.id,
        environmentId,
        browserStorageState,
      });
      setSavedRun(run);
      setNotice({
        kind: 'success',
        text: `Saved and queued with ${browserStorageState.cookies.length} login cookie(s) — opening the run…`,
      });
      openWeb(`/runs?runId=${encodeURIComponent(run.id)}`);
    } catch (error) {
      throw new ExtensionError('RUN_FAILED', `The test was saved, but the server run could not start: ${asMessage(error)}`);
    }
  }

  function openWeb(path: string): void {
    void chrome.tabs.create({ url: `${BUILD_CONFIG.webOrigin}${path}` });
  }

  function onSplitterPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    resizeRef.current = { startY: event.clientY, startShare: editorShare };
  }

  function onSplitterPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!resizeRef.current) return;
    const workspace = event.currentTarget.parentElement;
    if (!workspace) return;
    const height = workspace.getBoundingClientRect().height || 1;
    const delta = (event.clientY - resizeRef.current.startY) / height;
    setEditorShare(Math.max(0.35, Math.min(0.82, resizeRef.current.startShare + delta)));
  }

  function onSplitterPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    resizeRef.current = null;
  }

  async function disconnect(): Promise<void> {
    await revokeCredential();
    setConnected(false); setConnectionName(''); setProjects([]); setFolders([]); setEnvironments([]);
    setNotice({ kind: 'info', text: 'This recorder connection was revoked and removed from this device.' });
  }

  const combinedSource = withAssertions(source, assertions);
  const steps = useMemo(() => activityFromSource(source, assertions), [source, assertions]);
  const state = workflowState(session, combinedSource, busy);
  const protectedCount = steps.filter(step => step.protected).length;
  const sessionOwnsTab = ['attaching', 'attached', 'recording', 'paused', 'inspecting', 'playing'].includes(session.mode);
  const displayUrl = sessionOwnsTab && session.tabUrl ? session.tabUrl : (currentTab.url || session.tabUrl || '');
  const displayHost = (() => { try { return new URL(displayUrl).host; } catch { return ''; } })();
  const loginWarning = mayDependOnBrowserLogin(combinedSource, displayUrl);
  const isRecording = session.mode === 'recording' || session.mode === 'paused' || session.mode === 'inspecting';
  const hasSource = Boolean(combinedSource.trim());
  const canPersist = connected && hasSource && !isRecording && !busy;
  const lineCount = Math.max(combinedSource.split('\n').length, 1);
  const modeText = busy ? state : modeLabels[session.mode];
  const modeClass = session.mode === 'recording' ? 'live' : (session.mode === 'attached' || state === 'Ready') ? 'ok' : '';
  const strip = notice || (session.lastError ? { kind: 'error' as const, text: session.lastError.message } : null)
    || (connected && ['Testing', 'Saving', 'Running'].includes(state)
      ? { kind: 'info' as const, text: state === 'Testing' ? 'Running locally…' : state === 'Saving' ? 'Saving…' : 'Save & Run…' }
      : null);

  return <div className="app-shell">
    <header className="titlebar">
      <span className="logo" aria-hidden="true" />
      <strong>Automation Recorder</strong>
      <span className={`mode ${modeClass}`} aria-live="polite">{modeText}</span>
    </header>

    {connected && <div className="toolbar" role="toolbar" aria-label="Recorder actions">
      {!isRecording
        ? <button type="button" className="tb record" disabled={Boolean(busy) || !projects.length} onClick={() => void runAction('record', startRecording)} title="Record">
          <span className="rec" aria-hidden="true" /> Record
        </button>
        : <>
          <button type="button" className="tb record hot" disabled={session.mode === 'inspecting' || Boolean(busy)} onClick={() => void runAction('finish', finishRecording)} title="Stop recording">
            <IconStop /> Stop
          </button>
          {session.mode === 'paused'
            ? <button type="button" className="tb" disabled={Boolean(busy)} onClick={() => void runAction('resume', () => background('RESUME_RECORDING'))} title="Resume"><IconPlay /></button>
            : <button type="button" className="tb" disabled={session.mode === 'inspecting' || Boolean(busy)} onClick={() => void runAction('pause', () => background('PAUSE_RECORDING'))} title="Pause"><IconPause /></button>}
          <span className="tb timer" aria-live="polite">{elapsedLabel(elapsed)}</span>
        </>}
      <span className="sep" aria-hidden="true" />
      <button type="button" className="tb" disabled={Boolean(busy)} onClick={() => void runAction('inspect', beginAssertion)} title="Pick locator"><IconPick /></button>
      <button type="button" className="tb" disabled={session.mode === 'inspecting' || Boolean(busy) || (!isRecording && !hasSource)} onClick={() => void runAction('assertion', beginAssertion)} title="Add assertion"><IconEye /></button>
      <button type="button" className="tb" disabled={!hasSource} onClick={() => void navigator.clipboard.writeText(combinedSource)} title="Copy code"><IconCopy /></button>
      <span className="sep" aria-hidden="true" />
      <button type="button" className="tb" disabled={!hasSource || Boolean(busy) || isRecording} onClick={() => void runAction('test-local', () => testLocally(false))} title="Run locally"><IconPlay /></button>
      <button type="button" className="tb" disabled={!canPersist} onClick={() => void runAction('save', () => save(false))} title="Save"><IconSave />{busy === 'save' ? '…' : ''}</button>
      <button type="button" className="tb primary" disabled={!canPersist} onClick={() => void runAction('save-run', () => save(true))} title="Save & Run">{busy === 'save-run' ? '…' : 'Run'}</button>
      <span className="grow" />
      <span className="tb-label">Target</span>
      <select className="tb-select" aria-label="Project" value={settings.selectedProjectId} onChange={event => void runAction('project', () => selectProject(event.target.value))}>
        <option value="">Project…</option>
        {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
    </div>}

    {strip && <div className={`strip ${strip.kind === 'success' ? 'ok' : strip.kind === 'error' ? 'err' : 'info'}`} role={strip.kind === 'error' ? 'alert' : 'status'}>
      <span>{strip.text}</span>
      {session.lastError
        ? <button type="button" onClick={() => void runAction('reconnect', () => background('ATTACH'))}>Reconnect</button>
        : <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>}
    </div>}
    {validationIssues.length > 0 && <div className="strip err" role="alert"><span>Sensitive data on line {validationIssues[0].line}: {validationIssues[0].message}</span></div>}

    <div className="sr-only" aria-live="polite">Recorder status: {state}</div>
    <textarea className="sr-only recorder-source-probe" aria-hidden="true" tabIndex={-1} readOnly value={combinedSource} />

    <div
      className={`workspace ${!connected ? 'solo' : ''}`}
      style={connected ? {
        ['--editor-fr' as string]: `${editorShare}fr`,
        ['--bottom-fr' as string]: `${Math.max(0.18, 1 - editorShare)}fr`,
      } : undefined}
    >
      {!connected && <section className="center">
        <h2>Connect recorder</h2>
        <p>Open Automation Tool → Chrome Recorder → Connect Recorder.</p>
        <button type="button" className="tb primary" onClick={() => openWeb('/extension')}>Open Automation Tool</button>
      </section>}

      {connected && <>
        <section className="editor" aria-label="Generated Playwright test">
          <div className="gutter" aria-hidden="true">{Array.from({ length: lineCount }, (_, index) => <span key={index}>{index + 1}</span>)}</div>
          <textarea
            aria-label="Generated Playwright Test source"
            spellCheck={false}
            value={combinedSource}
            onChange={event => { setAssertions([]); setSource(event.target.value); }}
            onBlur={() => { if (combinedSource.trim()) { setAssertions([]); acceptSource(combinedSource); } }}
            placeholder={"import { test, expect } from '@playwright/test';\n\ntest('test', async ({ page }) => {\n});"}
          />
        </section>

        <div
          className="splitter"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize editor and bottom panel"
          onPointerDown={onSplitterPointerDown}
          onPointerMove={onSplitterPointerMove}
          onPointerUp={onSplitterPointerUp}
          onPointerCancel={onSplitterPointerUp}
        />

        <div className="bottom">
          <div className="tabs" role="tablist" aria-label="Recorder panels">
            <button type="button" role="tab" aria-selected={bottomTab === 'locator'} onClick={() => setBottomTab('locator')}>Locator</button>
            <button type="button" role="tab" aria-selected={bottomTab === 'log'} onClick={() => setBottomTab('log')}>Log</button>
            <button type="button" role="tab" aria-selected={bottomTab === 'settings'} onClick={() => setBottomTab('settings')}>Settings</button>
          </div>
          <div className="tab-body" role="tabpanel">
            {bottomTab === 'locator' && <div className="stack">
              {showAssertion && locator ? <>
                <code>{locator}</code>
                <label>Assertion
                  <select value={assertionKind} onChange={event => setAssertionKind(event.target.value as AssertionKind)}>
                    <option value="visible">Visible</option>
                    <option value="text-equals">Text equals</option>
                    <option value="text-contains">Text contains</option>
                    <option value="enabled">Enabled</option>
                    <option value="checked">Checked</option>
                    <option value="url-contains">URL contains</option>
                    <option value="title">Title equals</option>
                  </select>
                </label>
                {['text-equals', 'text-contains', 'url-contains', 'title'].includes(assertionKind) && <label>Value<input value={assertionText} onChange={event => setAssertionText(event.target.value)} /></label>}
                <div className="row">
                  <button type="button" className="tb primary" onClick={() => void runAction('add-assertion', addAssertion)}>Add</button>
                  {locator && <button type="button" className="tb" onClick={() => void navigator.clipboard.writeText(locator)}><IconCopy /> Copy</button>}
                </div>
              </> : <>
                <p className="muted">Use the pick tool, then assert or copy the locator.</p>
                <div className="row">
                  <button type="button" className="tb" disabled={Boolean(busy)} onClick={() => void runAction('inspect', beginAssertion)}><IconPick /> Pick</button>
                  {locator && <button type="button" className="tb" onClick={() => void navigator.clipboard.writeText(locator)}><IconCopy /> Copy</button>}
                </div>
                {locator && <code>{locator}</code>}
              </>}
            </div>}

            {bottomTab === 'log' && <>
              {warnings.length > 0 && <p className="warn">{envVars.length ? `Protected secrets → set ${envVars.join(', ')} before server run.` : warnings[0]}</p>}
              {loginWarning && <p className="warn">May depend on your browser login. Add login steps before Save &amp; Run.</p>}
              <ol className="steps">
                {steps.length
                  ? steps.map((step, index) => <li key={step.id}><i>{index + 1}</i><span>{step.label}{step.protected ? ' 🔒' : ''}</span></li>)
                  : <li className="empty">{isRecording ? 'Waiting for actions…' : 'No steps yet'}</li>}
              </ol>
              {(savedFile || savedRun) && <div className="row" style={{ marginTop: 8 }}>
                {savedFile && <button type="button" className="linkish" onClick={() => openWeb(`/files/${encodeURIComponent(savedFile.id)}`)}>Open saved test</button>}
                {savedRun && <button type="button" className="linkish" onClick={() => openWeb(`/runs?runId=${encodeURIComponent(savedRun.id)}`)}>Open run</button>}
              </div>}
            </>}

            {bottomTab === 'settings' && <div className="stack">
              <label>Test name<input aria-label="Test name" value={settings.testName} onChange={event => updateSettings({ testName: event.target.value, fileName: sanitizeFileName(event.target.value) })} /></label>
              <label>Folder<input list="automation-folders" value={settings.folderPath} onChange={event => updateSettings({ folderPath: event.target.value })} dir="ltr" /><datalist id="automation-folders">{folders.map(folder => <option key={folder.folderPath} value={folder.folderPath} />)}</datalist></label>
              <label>File<input value={settings.fileName} onChange={event => updateSettings({ fileName: event.target.value })} onBlur={() => updateSettings({ fileName: sanitizeFileName(settings.fileName) })} dir="ltr" /></label>
              <label>Environment
                <select value={settings.selectedEnvironmentId} onChange={event => updateSettings({ selectedEnvironmentId: event.target.value })}>
                  <option value="">Runner default</option>
                  {environments.map(environment => <option key={environment.id} value={environment.id}>{environment.name}</option>)}
                </select>
              </label>
              <label>Test id attribute<input value={settings.testIdAttribute} onChange={event => updateSettings({ testIdAttribute: event.target.value })} dir="ltr" /></label>
              <label>Slow mo (ms)<input type="number" min="0" max="2000" value={settings.slowMo} onChange={event => updateSettings({ slowMo: Math.max(0, Math.min(2000, Number(event.target.value) || 0)) })} /></label>
              {displayHost && <p className="muted" dir="ltr">Page · {displayHost}</p>}
              {connectionName && <p className="muted">{connectionName}</p>}
              <p className="muted">Engine {recorderConnected ? 'ok' : '…'} · tab {session.attachedTabId == null ? 'idle' : 'attached'}{protectedCount ? ` · ${protectedCount} protected` : ''}</p>
              <div className="row">
                <button type="button" className="tb" disabled={!source || Boolean(busy) || isRecording} onClick={() => void runAction('trace', () => testLocally(true))}>Trace</button>
                <button type="button" className="tb" onClick={() => void runAction('reconnect', () => background('ATTACH'))}>Reconnect</button>
                <button type="button" className="tb" onClick={() => void runAction('detach', () => background('DETACH'))}>Detach</button>
                <button type="button" className="tb danger" onClick={() => { recorderRef.current?.dispatch('clear'); setSource(''); setAssertions([]); }}>Clear</button>
                <button type="button" className="tb danger" onClick={() => void runAction('disconnect-account', disconnect)}>Disconnect</button>
              </div>
              {!projects.length && <p className="warn">No recordable project on this account.</p>}
            </div>}
          </div>
        </div>
      </>}
    </div>
  </div>;
}
