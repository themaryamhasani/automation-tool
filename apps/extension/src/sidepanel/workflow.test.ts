import { describe, expect, it } from 'vitest';
import { activityFromSource, assertionSource, mayDependOnBrowserLogin, withAssertions, workflowState } from './workflow';

const session = { mode: 'attached', attachedTabId: 1, tabTitle: '', tabUrl: '', active: true, canReplay: true, traceAvailable: false, lastError: null, updatedAt: '' } as const;

describe('recorder user workflow', () => {
  it('maps internal state to user states', () => {
    expect(workflowState(session, '')).toBe('Ready');
    expect(workflowState({ ...session, mode: 'recording' }, '')).toBe('Recording');
    expect(workflowState(session, 'test source')).toBe('Review');
    expect(workflowState(session, 'test source', 'test-local')).toBe('Testing');
    expect(workflowState(session, 'test source', 'save')).toBe('Saving');
    expect(workflowState(session, 'test source', 'save-run')).toBe('Running');
    expect(workflowState({ ...session, mode: 'reattach-required' }, '')).toBe('Needs attention');
  });

  it('summarizes actions without exposing values', () => {
    const steps = activityFromSource("await page.getByLabel('Password').fill(process.env.TEST_PASSWORD ?? '');\nawait page.getByRole('button', { name: 'Checkout' }).click();");
    expect(steps.map(step => step.label)).toEqual(['Fill Password', 'Click “Checkout”']);
    expect(steps[0].protected).toBe(true);
  });

  it('creates semantic assertions and inserts them into a test', () => {
    const assertion = assertionSource("page.getByText('Done')", 'visible');
    expect(withAssertions("test('x', async ({ page }) => {\n});\n", [assertion])).toContain('toBeVisible');
    expect(assertionSource('', 'url-contains', '/checkout')).toContain('toHaveURL');
  });

  it('flags likely dependence on an existing signed-in session conservatively', () => {
    expect(mayDependOnBrowserLogin("await page.goto('https://shop.test/account');", 'https://shop.test/account')).toBe(true);
    expect(mayDependOnBrowserLogin("await page.getByLabel('Password').fill(process.env.TEST_PASSWORD ?? '');", 'https://shop.test')).toBe(false);
  });
});
