import type { SessionState } from '../messaging/contracts';

export interface BrowserAutomationAdapter {
  connect(tabId?: number): Promise<SessionState>;
  disconnect(): Promise<SessionState>;
  startRecording(): Promise<SessionState>;
  pauseRecording(): Promise<SessionState>;
  resumeRecording(): Promise<SessionState>;
  stopRecording(): Promise<SessionState>;
  startElementSelection(): Promise<SessionState>;
  cancelElementSelection(): Promise<SessionState>;
  runLocally(source: string, trace?: boolean): Promise<SessionState>;
  stopLocalRun(): Promise<SessionState>;
  getStatus(): SessionState;
}
