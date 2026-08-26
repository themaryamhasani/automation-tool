/**
 * Thin CDE pack scaffold — shared skeleton for 100–200 packs.
 * Product-specific danger scripts live in scripts/pack-overlays/<key>/.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DIRS = [
  'docs/business-rules',
  'docs/test-strategy',
  'data',
  'flows',
  'incidents',
  'cases/_index',
  'checklists',
  'runbooks/smoke',
  'runbooks/release',
  'scripts/api',
  'scripts/e2e/specs',
  'scripts/e2e/.auth',
  'scripts/k6',
  'scripts/vitest',
  'scripts/unit',
  'scripts/links',
  'reports/by-flow/raw',
  'reports/by-tool',
  'reports/history',
];

function packRoot(approach, key) {
  return path.join(ROOT, 'runtime', 'packs', String(approach || 'cde').toLowerCase(), String(key));
}

function overlayRoot(key) {
  return path.join(ROOT, 'scripts', 'pack-overlays', String(key));
}

function writeFile(targetRoot, rel, body, { overwrite = true } = {}) {
  const target = path.join(targetRoot, rel);
  if (!overwrite && fs.existsSync(target)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const text = typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`;
  fs.writeFileSync(target, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
  return true;
}

function ensureDirs(targetRoot, dirs = DEFAULT_DIRS) {
  for (const dir of dirs) fs.mkdirSync(path.join(targetRoot, dir), { recursive: true });
}

function copyTree(fromRoot, toRoot) {
  if (!fs.existsSync(fromRoot)) return 0;
  let count = 0;
  const walk = (dir, rel = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const nextRel = rel ? path.posix.join(rel.replace(/\\/g, '/'), entry.name) : entry.name;
      const src = path.join(dir, entry.name);
      const dest = path.join(toRoot, nextRel);
      if (entry.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        walk(src, nextRel);
      } else if (entry.isFile()) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        count += 1;
      }
    }
  };
  walk(fromRoot);
  return count;
}

function standardTooling(key, origin) {
  const base = String(origin || 'http://127.0.0.1:4520').replace(/\/$/, '');
  return {
    'biome.json': `{
  "files": { "ignore": ["node_modules", "dist", "coverage", "reports", "_scratch"] },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "formatter": { "enabled": false }
}
`,
    '.spectral.yaml': `extends:
  - spectral:oas
rules:
  info-contact: off
  info-description: off
  operation-operationId: off
  operation-tags: off
`,
    'scripts/openapi.yaml': `openapi: 3.0.3
info:
  title: ${key} runtime
  version: 1.0.0
paths:
  /health:
    get:
      summary: Health
      responses:
        '200':
          description: ok
`,
    'scripts/e2e/health.spec.ts': `import { test, expect } from '@playwright/test';

test('${key} express runtime health', async ({ request }) => {
  const base = process.env.AUTOMATION_RUNTIME_URL || process.env.E2E_BASE_URL || '${base}';
  const res = await request.get(\`\${base.replace(/\\/$/, '')}/health\`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBeTruthy();
});
`,
    'scripts/unit/runtime.test.cjs': `const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('${key} pack.json exists', () => {
  const pack = path.resolve(__dirname, '..', '..', 'pack.json');
  assert.equal(fs.existsSync(pack), true);
  const info = JSON.parse(fs.readFileSync(pack, 'utf8'));
  assert.equal(info.key, '${key}');
});
`,
    'scripts/vitest/runtime.test.cjs': `const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('${key} pack.json exists', () => {
  const pack = path.resolve(__dirname, '..', '..', 'pack.json');
  assert.equal(fs.existsSync(pack), true);
});
`,
    'scripts/k6.js': `import http from 'k6/http';
import { check } from 'k6';
export const options = { vus: 1, duration: '8s' };
export default function () {
  const base = __ENV.AUTOMATION_RUNTIME_URL || __ENV.BASE_URL || '${base}';
  const res = http.get(\`\${String(base).replace(/\\/$/, '')}/health\`);
  check(res, { 'status is 200': (r) => r.status === 200 });
}
`,
    'scripts/k6/load.js': `import http from 'k6/http';
import { check } from 'k6';
export const options = { vus: 1, duration: '8s' };
export default function () {
  const base = __ENV.AUTOMATION_RUNTIME_URL || __ENV.BASE_URL || '${base}';
  const res = http.get(\`\${String(base).replace(/\\/$/, '')}/health\`);
  check(res, { 'status is 200': (r) => r.status === 200 });
}
`,
    'scripts/k6/health.js': `import http from 'k6/http';
import { check } from 'k6';
export const options = { vus: 1, duration: '5s' };
export default function () {
  const base = __ENV.AUTOMATION_RUNTIME_URL || __ENV.BASE_URL || '${base}';
  const res = http.get(\`\${String(base).replace(/\\/$/, '')}/health\`);
  check(res, { 'health 200': (r) => r.status === 200 });
}
`,
    'scripts/k6/security-perf.js': `import http from 'k6/http';
import { check } from 'k6';
export const options = {
  vus: 2,
  duration: '10s',
  thresholds: { http_req_failed: ['rate<0.95'] },
};
export default function () {
  const base = (__ENV.AUTOMATION_RUNTIME_ORIGIN || __ENV.BASE_URL || '${base}').replace(/\\/$/, '');
  const res = http.get(\`\${base}/health\`);
  check(res, { reachable: (r) => r.status > 0 });
}
`,
    'incidents/_index.md': `# Incidents — ${key}\n\nهنوز INC ثبت نشده.\n`,
    'reports/00-readme.md': `# گزارش‌ها — ${key}\n\n- [01-status-board.md](01-status-board.md)\n- [by-flow/](by-flow/)\n- [by-tool/](by-tool/)\n- [history/](history/)\n`,
    'reports/01-status-board.md': `# تخته وضعیت — ${key}\n\nآخرین اجرا هنوز ثبت نشده.\n`,
    'reports/by-flow/_index.md': `# by-flow — ${key}\n`,
    'reports/by-tool/_index.md': `# by-tool — ${key}\n`,
  };
}

/**
 * @param {object} def
 * @param {string} def.key
 * @param {string} [def.approach]
 * @param {string} def.title
 * @param {object} [def.target] pack.json target fields
 * @param {string[]} [def.extraDirs]
 * @param {Record<string, string|object>} [def.files] relative path → body
 * @param {boolean} [def.copyOverlay=true]
 * @param {boolean} [def.overwriteTooling=false]
 * @param {boolean} [def.overwriteFiles=false]
 * @param {boolean} [def.overwritePackJson=true]
 */
function scaffoldCdePack(def) {
  const key = String(def.key || '').trim();
  if (!key) throw new Error('pack def.key is required');
  const approach = String(def.approach || 'CDE').toUpperCase();
  const root = packRoot(approach, key);
  const dirs = [...DEFAULT_DIRS, ...(def.extraDirs || [])];
  ensureDirs(root, dirs);

  const packJson = {
    approach,
    key,
    title: def.title || key,
    ...(def.target || {}),
    updatedAt: new Date().toISOString(),
  };
  writeFile(root, 'pack.json', `${JSON.stringify(packJson, null, 2)}\n`, {
    overwrite: def.overwritePackJson !== false,
  });

  const tooling = standardTooling(key, def.target?.preferredOrigin || def.target?.appOrigin);
  for (const [rel, body] of Object.entries(tooling)) {
    writeFile(root, rel, body, { overwrite: Boolean(def.overwriteTooling) });
  }

  for (const [rel, body] of Object.entries(def.files || {})) {
    writeFile(root, rel, body, { overwrite: Boolean(def.overwriteFiles) });
  }

  let overlayFiles = 0;
  if (def.copyOverlay !== false) {
    overlayFiles = copyTree(overlayRoot(key), root);
  }

  return { root, key, approach, overlayFiles, packJson };
}

module.exports = {
  ROOT,
  DEFAULT_DIRS,
  packRoot,
  overlayRoot,
  writeFile,
  ensureDirs,
  copyTree,
  standardTooling,
  scaffoldCdePack,
};
