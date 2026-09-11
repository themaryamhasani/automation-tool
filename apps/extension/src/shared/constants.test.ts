import { describe, expect, it } from 'vitest';
import { isAttachableUrl } from './constants';

describe('tab URL policy', () => {
  it('allows normal web pages and rejects restricted Chrome targets', () => {
    expect(isAttachableUrl('https://example.com/path')).toBe(true);
    expect(isAttachableUrl('http://localhost:5180')).toBe(true);
    expect(isAttachableUrl('chrome://settings')).toBe(false);
    expect(isAttachableUrl('chrome-extension://abc/panel.html')).toBe(false);
    expect(isAttachableUrl('https://chromewebstore.google.com/detail/example/id')).toBe(false);
  });
});
