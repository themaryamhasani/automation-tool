import type { SessionState } from '../messaging/contracts';

export type UserWorkflowState = 'Ready' | 'Recording' | 'Paused' | 'Review' | 'Testing' | 'Saving' | 'Running' | 'Needs attention';

export interface ActivityStep {
  id: string;
  label: string;
  protected: boolean;
  assertion: boolean;
}

export function workflowState(session: SessionState, source: string, busy = ''): UserWorkflowState {
  if (busy === 'save') return 'Saving';
  if (busy === 'save-run') return 'Running';
  if (busy === 'test-local' || busy === 'trace') return 'Testing';
  if (session.mode === 'recording' || session.mode === 'inspecting') return 'Recording';
  if (session.mode === 'paused') return 'Paused';
  if (session.mode === 'playing') return 'Testing';
  if (session.mode === 'error' || session.mode === 'reattach-required') return 'Needs attention';
  if (source.trim()) return 'Review';
  return 'Ready';
}

function quoted(line: string): string[] {
  return [...line.matchAll(/['"]([^'"]{1,100})['"]/g)].map(match => match[1]);
}

function targetLabel(line: string): string {
  const roleName = line.match(/getByRole\([^,]+,\s*\{[^}]*name:\s*['"]([^'"]+)['"]/i)?.[1];
  const semantic = line.match(/getBy(?:Label|Text|Placeholder|TestId)\(\s*['"]([^'"]+)['"]/i)?.[1];
  return roleName || semantic || quoted(line)[0] || 'element';
}

export function activityFromSource(source: string, assertionLines: string[] = []): ActivityStep[] {
  const lines = [...source.replace(/\r\n?/g, '\n').split('\n'), ...assertionLines];
  const steps: ActivityStep[] = [];
  lines.forEach((line, index) => {
    const text = line.trim();
    let label = '';
    if (/\bpage\.goto\(/.test(text)) label = `Open ${quoted(text)[0] || 'page'}`;
    else if (/\.(?:click|dblclick)\(/.test(text)) label = `Click “${targetLabel(text)}”`;
    else if (/\.fill\(/.test(text)) label = `Fill ${targetLabel(text)}`;
    else if (/\.type\(/.test(text)) label = `Type in ${targetLabel(text)}`;
    else if (/\.(?:check|uncheck)\(/.test(text)) label = `${text.includes('.uncheck(') ? 'Uncheck' : 'Check'} “${targetLabel(text)}”`;
    else if (/\.selectOption\(/.test(text)) label = `Choose an option in “${targetLabel(text)}”`;
    else if (/\bexpect\(/.test(text)) label = `Verify ${targetLabel(text)}`;
    if (label) steps.push({
      id: `${index}-${steps.length}`,
      label,
      protected: /process\.env\.|Sensitive browser state removed/.test(text),
      assertion: /\bexpect\(/.test(text),
    });
  });
  return steps;
}

export type AssertionKind = 'visible' | 'text-equals' | 'text-contains' | 'url-contains' | 'title' | 'enabled' | 'checked';

function quote(value: string): string { return JSON.stringify(value.trim()); }

export function assertionSource(locator: string, kind: AssertionKind, expected = ''): string {
  if (kind === 'url-contains' || kind === 'title') {
    if (!expected.trim()) throw new Error(`Enter the ${kind === 'title' ? 'page title' : 'URL text'} to verify.`);
    return kind === 'title'
      ? `  await expect(page).toHaveTitle(${quote(expected)});`
      : `  await expect(page).toHaveURL(new RegExp(${quote(expected)}));`;
  }
  if (!locator.startsWith('page.')) throw new Error('Choose an element on the page first.');
  if (kind === 'visible') return `  await expect(${locator}).toBeVisible();`;
  if (kind === 'enabled') return `  await expect(${locator}).toBeEnabled();`;
  if (kind === 'checked') return `  await expect(${locator}).toBeChecked();`;
  if (!expected.trim()) throw new Error('Enter the text to verify.');
  if (kind === 'text-equals') return `  await expect(${locator}).toHaveText(${quote(expected)});`;
  return `  await expect(${locator}).toContainText(${quote(expected)});`;
}

export function withAssertions(source: string, assertions: string[]): string {
  if (!assertions.length) return source;
  const closing = source.lastIndexOf('\n});');
  if (closing < 0) return `${source.trimEnd()}\n${assertions.join('\n')}\n`;
  return `${source.slice(0, closing)}\n${assertions.join('\n')}${source.slice(closing)}`;
}

export function mayDependOnBrowserLogin(source: string, pageUrl: string): boolean {
  if (!/^https?:/i.test(pageUrl) || !source.trim()) return false;
  const hasLoginSteps = /password|sign[ -]?in|log[ -]?in|process\.env\.TEST_(?:PASSWORD|TOKEN)/i.test(source);
  const opensRoot = /page\.goto\(\s*['"]https?:\/\/[^/'"]+\/?['"]\s*\)/i.test(source);
  return !hasLoginSteps && !opensRoot;
}
