export interface RecorderSource {
  id: string;
  label?: string;
  group?: string;
  text: string;
  language?: string;
  isRecorded?: boolean;
}

export interface RecorderElementInfo {
  selector?: string;
  locator?: string;
  ariaSnapshot?: string;
  tag?: string;
  preview?: string;
}

export interface SanitizationResult {
  source: string;
  warnings: string[];
  environmentVariables: string[];
  changed: boolean;
}

export interface PreparedRecording extends SanitizationResult {
  fileName: string;
  testName: string;
}
