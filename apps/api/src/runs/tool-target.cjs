const path = require('node:path');
const { isStaticTool } = require('../approaches/constants.cjs');

class ToolTargetError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function normalize(selected) {
  return String(selected || '').replace(/\\/g, '/');
}

function pickSelected(selected, test) {
  const value = normalize(selected);
  return value && test(value) ? value : null;
}

function resolveToolTarget({ toolKind, selected, defaults }) {
  const kind = String(toolKind || '').toUpperCase();
  const value = normalize(selected);
  if (kind === 'DANGER') {
    const testFilePath = pickSelected(value, item => item.endsWith('.mjs')) || defaults.danger;
    return { testFilePath, toolTarget: testFilePath };
  }
  if (kind === 'K6') {
    const testFilePath = pickSelected(value, item => item.endsWith('.js') && !item.endsWith('.spec.js')) || defaults.k6;
    return { testFilePath, toolTarget: path.basename(testFilePath) };
  }
  if (kind === 'PLAYWRIGHT' || kind === 'AXE') {
    const testFilePath = pickSelected(value, item => /\.(spec|test)\.(ts|js|mjs)$/i.test(item)) || defaults.playwright;
    return { testFilePath, toolTarget: kind === 'AXE' ? 'axe' : testFilePath };
  }
  if (kind === 'VITEST') {
    const testFilePath = pickSelected(value, item => /\.test\.(cjs|js|mjs|ts)$/i.test(item)) || defaults.unit;
    return { testFilePath, toolTarget: testFilePath };
  }
  if (isStaticTool(kind)) {
    return { testFilePath: value || defaults.root || '.', toolTarget: kind.toLowerCase() };
  }
  throw new ToolTargetError('INVALID_TOOL', 'ابزار تست معتبر نیست.');
}

function timeoutFor(toolKind, { flowId, approach, fallback = 180 } = {}) {
  const kind = String(toolKind || '').toUpperCase();
  const base = Number(fallback) || 180;
  if (kind === 'DANGER' && (!flowId || flowId === 'ALL')) return Math.max(base, 1800);
  if ((approach === 'GITHUB' || approach === 'GIT_EDUS') && (kind === 'PLAYWRIGHT' || kind === 'AXE')) return Math.max(base, 1800);
  if (kind === 'K6' || kind === 'PLAYWRIGHT' || kind === 'AXE') return Math.max(base, 900);
  if (kind === 'SEMGREP' || kind === 'AUDIT') return Math.max(base, 600);
  if (isStaticTool(kind)) return Math.max(base, 300);
  return base;
}

module.exports = { resolveToolTarget, timeoutFor, ToolTargetError };
