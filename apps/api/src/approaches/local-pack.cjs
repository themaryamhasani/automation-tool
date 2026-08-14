const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

class LocalPackError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const TEXT_EXT = new Set(['.md', '.mjs', '.js', '.cjs', '.ts', '.tsx', '.json', '.txt', '.ps1', '.yml', '.yaml', '.css', '.html']);
const FOLDERS = ['scripts/api', 'scripts/e2e', 'scripts/unit', 'scripts/vitest', 'reports/by-flow/raw', 'reports/by-tool', 'reports/history', 'flows', 'cases', 'runbooks', 'checklists'];

function packsRoot() {
  return path.resolve(__dirname, '..', '..', '..', '..', process.env.LOCAL_PACK_ROOT || 'runtime/packs');
}

function appsRoot() {
  return path.resolve(__dirname, '..', '..', '..', '..', process.env.LOCAL_APP_ROOT || 'runtime/apps');
}

function safeKey(value) {
  const key = String(value || '').trim();
  if (!key || key.includes('\0') || key.includes('..') || /[\\/]/.test(key)) {
    throw new LocalPackError('PACK_KEY_INVALID', 'کلید بسته معتبر نیست.', 422);
  }
  return key.replace(/[^\w.-]+/g, '_').slice(0, 120);
}

function packRoot(approach, key) {
  return path.join(packsRoot(), String(approach || 'cde').toLowerCase(), safeKey(key));
}

function assertInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new LocalPackError('PACK_UNSAFE_PATH', 'مسیر خارج از بسته محلی است.', 422);
  }
  return resolved;
}

function relativePath(value) {
  const sourcePath = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!sourcePath) return '';
  if (sourcePath.includes('\0') || sourcePath.startsWith('/') || /^[a-zA-Z]:/.test(sourcePath)) {
    throw new LocalPackError('PACK_UNSAFE_PATH', 'مسیر فایل معتبر نیست.', 422);
  }
  const parts = sourcePath.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new LocalPackError('PACK_UNSAFE_PATH', 'مسیر فایل شامل بخش ناامن است.', 422);
  }
  return parts.join('/');
}

function seedScripts(root, key) {
  const health = `const base = process.env.AUTOMATION_RUNTIME_URL || process.env.BASE_URL || 'http://127.0.0.1:4520';
const res = await fetch(\`\${base.replace(/\\/$/, '')}/health\`);
const body = await res.json().catch(() => ({}));
const ok = res.ok && body.ok === true;
console.log('--- ALL ---');
console.log(ok ? '  ✓ PASS  TC-CDE-HLTH-001 — runtime Express health' : '  ✗ FAIL  TC-CDE-HLTH-001 — runtime Express health');
console.log('=== SUMMARY ===');
console.log(ok ? 'PASS=1  FAIL=0  SKIP=0  TOTAL=1' : 'PASS=0  FAIL=1  SKIP=0  TOTAL=1');
if (!ok) process.exit(1);
`;
  const spec = `import { test, expect } from '@playwright/test';

test('CDE express runtime health', async ({ request }) => {
  const base = process.env.AUTOMATION_RUNTIME_URL || process.env.E2E_BASE_URL || 'http://127.0.0.1:4520';
  const res = await request.get(\`\${base.replace(/\\/$/, '')}/health\`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBeTruthy();
});
`;
  const k6 = `import http from 'k6/http';
import { check } from 'k6';
export const options = { vus: 1, duration: '8s' };
export default function () {
  const base = __ENV.AUTOMATION_RUNTIME_URL || __ENV.BASE_URL || 'http://127.0.0.1:4520';
  const res = http.get(\`\${String(base).replace(/\\/$/, '')}/health\`);
  check(res, { 'status is 200': (r) => r.status === 200 });
}
`;
  const unit = `const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('CDE express package has a runtime manifest', () => {
  const appRoot = process.env.CDE_EXPRESS_ROOT;
  assert.ok(appRoot, 'CDE_EXPRESS_ROOT is set');
  assert.equal(fs.existsSync(path.join(appRoot, 'automation-runtime-manifest.json')), true);
  assert.equal(fs.existsSync(path.join(appRoot, 'server.cjs')), true);
});
`;
  const writeIfMissing = (rel, code) => {
    const target = path.join(root, rel);
    if (fs.existsSync(target)) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, code, 'utf8');
  };
  const surfacePath = path.join(__dirname, 'templates', 'cde-runtime-surface.mjs');
  const surface = fs.existsSync(surfacePath) ? fs.readFileSync(surfacePath, 'utf8') : health;
  writeIfMissing('scripts/api/run.mjs', health);
  writeIfMissing('scripts/api/runtime-surface.mjs', surface);
  writeIfMissing('scripts/e2e/health.spec.ts', spec);
  writeIfMissing('scripts/k6.js', k6);
  writeIfMissing('scripts/unit/runtime.test.cjs', unit);
  writeIfMissing('scripts/vitest/runtime.test.cjs', unit);
  writeIfMissing('00-readme.md', `# بسته تست ${key}

اسکریپت‌ها اینجا نوشته می‌شوند؛ سورس CDE دست نمی‌خورد.

رانتایم قبل از اجرا سورس انتخاب‌شده را به یک پکیج Express محلی تبدیل می‌کند و گزارش را در \`reports/\` با همان قرارداد IS می‌نویسد.
`);
  writeIfMissing('scripts/RUN-BY-FLOW.md', `# اجرای فلو‌محور — ${key}

از تب **اجرا** ابزار و FLOW را انتخاب کنید. گزارش‌ها مثل IS در \`reports/\` نوشته می‌شوند:

- [reports/01-status-board.md](../reports/01-status-board.md)
- [reports/by-flow/](../reports/by-flow/_index.md)
- [reports/by-tool/](../reports/by-tool/_index.md)
- [reports/history/](../reports/history/)
`);
  writeIfMissing('reports/00-readme.md', `# گزارش‌ها — ${key}

| فایل / پوشه | سؤال |
|-------------|------|
| [01-status-board.md](01-status-board.md) | **الان** وضعیت چیست؟ |
| [by-flow/](by-flow/_index.md) | جزئیات هر FLOW |
| [by-tool/](by-tool/_index.md) | danger / k6 / e2e / unit |
| [history/](history/) | آرشیو زمانی |
`);
}

function ensurePack(approach, key, meta = {}) {
  const root = packRoot(approach, key);
  for (const folder of FOLDERS) fs.mkdirSync(path.join(root, folder), { recursive: true });
  seedScripts(root, key);
  const info = {
    approach: String(approach || 'CDE').toUpperCase(),
    key,
    title: meta.title || key,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'pack.json'), JSON.stringify(info, null, 2), 'utf8');
  return {
    ...info,
    root,
    relativePath: `${String(approach || 'cde').toLowerCase()}/${safeKey(key)}`,
    exists: true,
    runnable: true,
    hasScripts: true,
    hasReports: true,
    hasCases: fs.existsSync(path.join(root, 'cases')),
  };
}

function describePack(approach, key) {
  const pack = ensurePack(approach, key);
  return {
    id: key,
    title: pack.title,
    packKey: key,
    approach: pack.approach,
    relativePath: pack.relativePath,
    exists: true,
    runnable: true,
    hasScripts: true,
    hasReports: true,
    hasCases: pack.hasCases,
    flows: ['ALL'],
    automatedFlows: ['ALL'],
    tools: {
      DANGER: { cwd: 'scripts/api', entry: 'run.mjs' },
      K6: { cwd: 'scripts', script: 'k6.js' },
      PLAYWRIGHT: { cwd: 'scripts/e2e' },
      VITEST: { cwd: 'scripts/vitest' },
    },
    reportLayout: {
      readme: 'reports/00-readme.md',
      board: 'reports/01-status-board.md',
      byFlow: 'reports/by-flow',
      byTool: 'reports/by-tool',
      history: 'reports/history',
    },
  };
}

function resolveFile(approach, key, filePath) {
  const root = packRoot(approach, key);
  const relative = relativePath(filePath);
  const target = relative ? assertInside(root, path.join(root, ...relative.split('/'))) : root;
  return { root, relative, target };
}

async function listDir(approach, key, filePath = '', recursive = false, depth = 8) {
  ensurePack(approach, key);
  const { relative, target } = resolveFile(approach, key, filePath);
  let stat;
  try { stat = await fsp.stat(target); } catch { throw new LocalPackError('PACK_DIR_NOT_FOUND', 'پوشه پیدا نشد.', 404); }
  if (!stat.isDirectory()) throw new LocalPackError('PACK_DIR_NOT_FOUND', 'پوشه پیدا نشد.', 404);
  const children = (await fsp.readdir(target, { withFileTypes: true }))
    .filter(entry => !['node_modules', 'dist', 'test-results', 'playwright-report', '.git'].includes(entry.name));
  const entries = [];
  for (const entry of children) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    const full = path.join(target, entry.name);
    const info = await fsp.stat(full);
    const row = { name: entry.name, path: child, type: entry.isDirectory() ? 'dir' : 'file', size: info.size };
    if (recursive && depth > 0 && row.type === 'dir') {
      row.children = (await listDir(approach, key, child, true, depth - 1)).entries;
    }
    entries.push(row);
  }
  entries.sort((left, right) => Number(right.type === 'dir') - Number(left.type === 'dir') || left.name.localeCompare(right.name));
  return { path: relative, entries };
}

function defaultUnitPath(approach, key) {
  const root = packRoot(approach, key);
  const vitest = path.join(root, 'scripts', 'vitest', 'runtime.test.cjs');
  if (fs.existsSync(vitest)) return 'scripts/vitest/runtime.test.cjs';
  return 'scripts/unit/runtime.test.cjs';
}

async function readFile(approach, key, filePath) {
  const { relative, target } = resolveFile(approach, key, filePath);
  let stat;
  try { stat = await fsp.stat(target); } catch { throw new LocalPackError('PACK_FILE_NOT_FOUND', 'فایل پیدا نشد.', 404); }
  if (!stat.isFile()) throw new LocalPackError('PACK_FILE_NOT_FOUND', 'فایل پیدا نشد.', 404);
  const ext = path.extname(target).toLowerCase();
  if (!TEXT_EXT.has(ext)) throw new LocalPackError('PACK_FILE_BINARY', 'فقط فایل‌های متنی قابل مشاهده‌اند.', 422);
  if (stat.size > 1_500_000) throw new LocalPackError('PACK_FILE_TOO_LARGE', 'فایل برای نمایش خیلی بزرگ است.', 422);
  return { path: relative, name: path.basename(target), code: await fsp.readFile(target, 'utf8'), size: stat.size, updatedAt: stat.mtime.toISOString() };
}

function writeFile(approach, key, filePath, code, { create = false } = {}) {
  ensurePack(approach, key);
  const { relative, target } = resolveFile(approach, key, filePath);
  const ext = path.extname(target).toLowerCase();
  if (!TEXT_EXT.has(ext)) throw new LocalPackError('PACK_FILE_TYPE', 'این نوع فایل قابل ایجاد/ویرایش نیست.', 422);
  if (typeof code !== 'string') throw new LocalPackError('PACK_INVALID_SOURCE', 'محتوای فایل الزامی است.', 422);
  if (Buffer.byteLength(code) > 2 * 1024 * 1024) throw new LocalPackError('PACK_FILE_TOO_LARGE', 'حجم فایل حداکثر دو مگابایت است.', 422);
  const exists = fs.existsSync(target);
  if (create && exists) throw new LocalPackError('PACK_FILE_EXISTS', 'فایلی با این نام از قبل وجود دارد.', 409);
  if (!create && !exists) throw new LocalPackError('PACK_FILE_NOT_FOUND', 'فایل پیدا نشد.', 404);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, code, 'utf8');
  const stat = fs.statSync(target);
  return { path: relative, name: path.basename(target), code, size: stat.size, created: Boolean(create), updatedAt: stat.mtime.toISOString() };
}

async function mkdirDir(approach, key, filePath) {
  ensurePack(approach, key);
  const { root, relative, target } = resolveFile(approach, key, filePath);
  if (!relative || target === root) throw new LocalPackError('PACK_ROOT_PROTECTED', 'ریشه بسته قابل ایجاد به‌عنوان پوشه جدید نیست.', 422);
  let stat = null;
  try { stat = await fsp.stat(target); } catch { stat = null; }
  if (stat?.isFile()) throw new LocalPackError('PACK_NOT_A_DIR', 'فایلی با این نام از قبل وجود دارد.', 409);
  if (stat?.isDirectory()) throw new LocalPackError('PACK_DIR_EXISTS', 'پوشه‌ای با این نام از قبل وجود دارد.', 409);
  await fsp.mkdir(target, { recursive: true });
  return { path: relative, name: path.basename(target), type: 'dir' };
}

async function removePath(approach, key, filePath) {
  ensurePack(approach, key);
  const { root, relative, target } = resolveFile(approach, key, filePath);
  if (!relative || target === root) throw new LocalPackError('PACK_ROOT_PROTECTED', 'ریشه بسته قابل حذف نیست.', 422);
  let stat;
  try { stat = await fsp.stat(target); } catch { throw new LocalPackError('PACK_ENTRY_NOT_FOUND', 'فایل یا پوشه پیدا نشد.', 404); }
  await fsp.rm(target, { recursive: true, force: false });
  return { path: relative, type: stat.isDirectory() ? 'dir' : 'file', deleted: true };
}

module.exports = {
  LocalPackError,
  packsRoot,
  appsRoot,
  safeKey,
  packRoot,
  ensurePack,
  describePack,
  listDir,
  readFile,
  writeFile,
  mkdirDir,
  removePath,
  defaultUnitPath,
};
