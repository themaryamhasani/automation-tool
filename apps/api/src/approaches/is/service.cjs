const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { listPacks, getPack } = require('./packs.cjs');

class ApproachError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isRoot() {
  return path.resolve(process.env.IS_ROOT || 'D:\\AllApp\\IS\\integrated-systems');
}

function testRoot() {
  return path.resolve(isRoot(), process.env.IS_TEST_REL || 'test');
}

function docRoot() {
  return path.resolve(isRoot(), process.env.IS_DOC_REL || 'test/doc');
}

function assertInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new ApproachError('IS_UNSAFE_PATH', 'مسیر خارج از ریشه IS است.', 422);
  }
  return resolved;
}

function relativePath(value) {
  const sourcePath = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!sourcePath || sourcePath.includes('\0') || sourcePath.startsWith('/') || /^[a-zA-Z]:/.test(sourcePath)) {
    throw new ApproachError('IS_UNSAFE_PATH', 'مسیر فایل معتبر نیست.', 422);
  }
  const parts = sourcePath.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new ApproachError('IS_UNSAFE_PATH', 'مسیر فایل شامل بخش ناامن است.', 422);
  }
  return parts.join('/');
}

function ensureIsLayout() {
  const root = isRoot();
  const tests = testRoot();
  const docs = docRoot();
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new ApproachError('IS_ROOT_MISSING', `ریشه IS پیدا نشد: ${root}`, 409);
  }
  if (!fs.existsSync(tests) || !fs.statSync(tests).isDirectory()) {
    throw new ApproachError('IS_TEST_MISSING', `پوشه test پیدا نشد: ${tests}`, 409);
  }
  if (!fs.existsSync(docs) || !fs.statSync(docs).isDirectory()) {
    throw new ApproachError('IS_DOC_MISSING', `پوشه test/doc پیدا نشد: ${docs}`, 409);
  }
  return { root, tests, docs };
}

function packPaths(packId) {
  const pack = getPack(packId);
  if (!pack) throw new ApproachError('IS_PACK_NOT_FOUND', 'بسته QA پیدا نشد.', 404);
  const { root, docs } = ensureIsLayout();
  const productRoot = assertInside(docs, path.join(docs, pack.docPath));
  if (!fs.existsSync(productRoot)) throw new ApproachError('IS_PACK_NOT_FOUND', `پوشه بسته ${pack.id} روی دیسک نیست.`, 404);
  return {
    pack,
    repoRoot: root,
    docRoot: docs,
    productRoot,
    scriptsRoot: path.join(productRoot, 'scripts'),
    reportsRoot: path.join(productRoot, 'reports'),
    dangerCwd: path.join(productRoot, pack.danger.cwd),
    k6Cwd: path.join(productRoot, pack.k6.cwd),
    e2eCwd: path.join(productRoot, pack.e2e.cwd),
    unitCwd: path.join(root, pack.unit.cwdFromRepo),
    boardScript: path.join(docs, 'build-report-boards.mjs'),
  };
}

async function pingHealth(item) {
  const started = Date.now();
  try {
    const response = await fetch(item.url, { method: 'GET', signal: AbortSignal.timeout(4000) });
    return {
      name: item.name,
      url: item.url,
      optional: Boolean(item.optional),
      ok: response.status > 0 && response.status < 500,
      status: response.status,
      ms: Date.now() - started,
    };
  } catch (error) {
    return {
      name: item.name,
      url: item.url,
      optional: Boolean(item.optional),
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function packHealth(packId) {
  const pack = getPack(packId);
  if (!pack) throw new ApproachError('IS_PACK_NOT_FOUND', 'بسته QA پیدا نشد.', 404);
  const checks = await Promise.all(pack.health.map(pingHealth));
  const requiredDown = checks.filter(item => !item.optional && !item.ok);
  return {
    packId: pack.id,
    title: pack.title,
    ready: requiredDown.length === 0,
    message: requiredDown.length
      ? `اپ IS برای ${pack.title} در دسترس نیست. ابتدا سرویس‌های ${requiredDown.map(item => item.name).join('، ')} را بالا بیاورید.`
      : `runtime ${pack.title} آماده است.`,
    checks,
  };
}

async function overallHealth() {
  const layout = (() => {
    try { return { ...ensureIsLayout(), ok: true }; }
    catch (error) { return { ok: false, message: error.message, code: error.code }; }
  })();
  const packs = [];
  for (const pack of listPacks()) packs.push(await packHealth(pack.id));
  return {
    connected: Boolean(layout.ok),
    root: layout.root || isRoot(),
    docRoot: layout.docs || docRoot(),
    message: layout.ok ? 'پوشه IS و test/doc خوانده شد.' : layout.message,
    ready: layout.ok && packs.some(pack => pack.ready),
    packs,
  };
}

const SKIP_DIR = new Set(['node_modules', 'test-results', 'playwright-report', '.git', 'dist']);
const TEXT_EXT = new Set(['.md', '.mjs', '.js', '.ts', '.tsx', '.json', '.txt', '.ps1', '.env', '.example', '.yml', '.yaml', '.css', '.html']);

function listTree(directory, relative = '', depth = 0, acc = []) {
  if (depth > 6 || acc.length > 400) return acc;
  if (!fs.existsSync(directory)) return acc;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    if (SKIP_DIR.has(entry.name)) continue;
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      acc.push({ path: rel, type: 'dir' });
      listTree(path.join(directory, entry.name), rel, depth + 1, acc);
    } else {
      acc.push({ path: rel, type: 'file', size: fs.statSync(path.join(directory, entry.name)).size });
    }
  }
  return acc;
}

function readPackFile(packId, filePath) {
  const { productRoot } = packPaths(packId);
  const relative = relativePath(filePath);
  const target = assertInside(productRoot, path.join(productRoot, ...relative.split('/')));
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new ApproachError('IS_FILE_NOT_FOUND', 'فایل پیدا نشد.', 404);
  }
  const ext = path.extname(target).toLowerCase();
  if (!TEXT_EXT.has(ext) && !target.endsWith('.env.example')) {
    throw new ApproachError('IS_FILE_BINARY', 'فقط فایل‌های متنی قابل مشاهده‌اند.', 422);
  }
  const stat = fs.statSync(target);
  if (stat.size > 1_500_000) throw new ApproachError('IS_FILE_TOO_LARGE', 'فایل برای نمایش خیلی بزرگ است.', 422);
  return { path: relative, code: fs.readFileSync(target, 'utf8'), size: stat.size };
}

function packCatalog(packId) {
  const { pack, productRoot, reportsRoot, scriptsRoot } = packPaths(packId);
  const reports = fs.existsSync(reportsRoot) ? listTree(reportsRoot, 'reports', 0, []) : [];
  const scripts = fs.existsSync(scriptsRoot) ? listTree(scriptsRoot, 'scripts', 0, []) : [];
  return {
    id: pack.id,
    title: pack.title,
    alias: pack.alias || null,
    docPath: pack.docPath,
    flows: pack.flows,
    automatedFlows: pack.automatedFlows || pack.flows,
    tools: {
      DANGER: { cwd: pack.danger.cwd, entry: pack.danger.entry, runByFlow: pack.danger.runByFlow, rawFile: pack.danger.rawFile },
      K6: { cwd: pack.k6.cwd, script: pack.k6.script, rawFile: pack.k6.rawFile },
      PLAYWRIGHT: { cwd: pack.e2e.cwd, npmScript: pack.e2e.npmScript, rawFile: pack.e2e.rawFile, channel: pack.e2e.channel, baseUrl: pack.e2eBaseUrl },
      VITEST: { cwd: pack.unit.cwdFromRepo, command: pack.unit.command, rawFile: pack.unit.rawFile },
    },
    reportLayout: {
      readme: 'reports/00-readme.md',
      board: 'reports/01-status-board.md',
      byFlow: 'reports/by-flow',
      byTool: 'reports/by-tool',
      history: 'reports/history',
    },
    tree: [...scripts.slice(0, 250), ...reports.slice(0, 150)],
    exists: {
      product: fs.existsSync(productRoot),
      reports: fs.existsSync(reportsRoot),
      scripts: fs.existsSync(scriptsRoot),
    },
  };
}

function status() {
  try {
    const layout = ensureIsLayout();
    return { connected: true, root: layout.root, testRoot: layout.tests, docRoot: layout.docs, packs: listPacks() };
  } catch (error) {
    return { connected: false, root: isRoot(), testRoot: testRoot(), docRoot: docRoot(), packs: listPacks(), message: error.message, code: error.code };
  }
}

const WRITE_EXT = new Set(['.md', '.mjs', '.js', '.cjs', '.ts', '.tsx', '.json', '.txt', '.ps1', '.yml', '.yaml', '.css', '.html']);

function resolveTestPath(filePath) {
  const { tests } = ensureIsLayout();
  const relative = filePath ? relativePath(filePath) : '';
  const target = relative ? assertInside(tests, path.join(tests, ...relative.split('/'))) : tests;
  return { tests, relative, target };
}

async function listDir(filePath = '') {
  const { tests, relative, target } = resolveTestPath(filePath);
  let stat;
  try { stat = await fsp.stat(target); } catch { throw new ApproachError('IS_DIR_NOT_FOUND', 'پوشه پیدا نشد.', 404); }
  if (!stat.isDirectory()) throw new ApproachError('IS_DIR_NOT_FOUND', 'پوشه پیدا نشد.', 404);
  const entries = (await fsp.readdir(target, { withFileTypes: true }))
    .filter(entry => !['node_modules', 'dist', 'test-results', 'playwright-report', '.git', '.qa-sync'].includes(entry.name));
  const rows = await Promise.all(entries.map(async entry => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    const full = path.join(target, entry.name);
    const info = await fsp.stat(full);
    return {
      name: entry.name,
      path: child,
      type: entry.isDirectory() ? 'dir' : 'file',
      size: entry.isFile() ? info.size : 0,
      updatedAt: info.mtime.toISOString(),
    };
  }));
  rows.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return { root: tests, path: relative, entries: rows };
}

async function readTestFile(filePath) {
  const { relative, target } = resolveTestPath(filePath);
  let stat;
  try { stat = await fsp.stat(target); } catch { throw new ApproachError('IS_FILE_NOT_FOUND', 'فایل پیدا نشد.', 404); }
  if (!stat.isFile()) throw new ApproachError('IS_FILE_NOT_FOUND', 'فایل پیدا نشد.', 404);
  const ext = path.extname(target).toLowerCase();
  if (!TEXT_EXT.has(ext) && !target.endsWith('.env.example')) throw new ApproachError('IS_FILE_BINARY', 'فقط فایل‌های متنی قابل مشاهده‌اند.', 422);
  if (stat.size > 1_500_000) throw new ApproachError('IS_FILE_TOO_LARGE', 'فایل برای نمایش خیلی بزرگ است.', 422);
  return { path: relative, name: path.basename(target), code: await fsp.readFile(target, 'utf8'), size: stat.size, updatedAt: stat.mtime.toISOString() };
}

function writeTestFile(filePath, code, { create = false } = {}) {
  const { relative, target } = resolveTestPath(filePath);
  const ext = path.extname(target).toLowerCase();
  if (!WRITE_EXT.has(ext) && !target.endsWith('.env.example')) throw new ApproachError('IS_FILE_TYPE', 'این نوع فایل قابل ایجاد/ویرایش نیست.', 422);
  if (typeof code !== 'string') throw new ApproachError('IS_INVALID_SOURCE', 'محتوای فایل الزامی است.', 422);
  if (Buffer.byteLength(code) > 2 * 1024 * 1024) throw new ApproachError('IS_FILE_TOO_LARGE', 'حجم فایل حداکثر دو مگابایت است.', 422);
  const exists = fs.existsSync(target);
  if (create && exists) throw new ApproachError('IS_FILE_EXISTS', 'فایلی با این نام از قبل وجود دارد.', 409);
  if (!create && !exists) throw new ApproachError('IS_FILE_NOT_FOUND', 'فایل پیدا نشد.', 404);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, code, 'utf8');
  const stat = fs.statSync(target);
  return { path: relative, name: path.basename(target), code, size: stat.size, created: Boolean(create), updatedAt: stat.mtime.toISOString() };
}

async function mkdirTestDir(filePath) {
  const { tests, relative, target } = resolveTestPath(filePath);
  if (!relative || target === tests) throw new ApproachError('IS_ROOT_PROTECTED', 'ریشه test/ قابل ایجاد به‌عنوان پوشه جدید نیست.', 422);
  let stat = null;
  try { stat = await fsp.stat(target); } catch { stat = null; }
  if (stat?.isFile()) throw new ApproachError('IS_NOT_A_DIR', 'فایلی با این نام از قبل وجود دارد.', 409);
  if (stat?.isDirectory()) throw new ApproachError('IS_DIR_EXISTS', 'پوشه‌ای با این نام از قبل وجود دارد.', 409);
  await fsp.mkdir(target, { recursive: true });
  return { path: relative, name: path.basename(target), type: 'dir' };
}

async function removeTestPath(filePath) {
  const { tests, relative, target } = resolveTestPath(filePath);
  if (!relative || target === tests) throw new ApproachError('IS_ROOT_PROTECTED', 'ریشه test/ قابل حذف نیست.', 422);
  let stat;
  try { stat = await fsp.stat(target); } catch { throw new ApproachError('IS_ENTRY_NOT_FOUND', 'فایل یا پوشه پیدا نشد.', 404); }
  await fsp.rm(target, { recursive: true, force: false });
  return { path: relative, type: stat.isDirectory() ? 'dir' : 'file', deleted: true };
}

function productMeta(root, docPath, extra = {}) {
  const productRoot = path.join(root, docPath);
  const readme = path.join(productRoot, '00-readme.md');
  return {
    relativePath: `doc/${docPath}`.replace(/\\/g, '/'),
    exists: fs.existsSync(productRoot),
    hasScripts: fs.existsSync(path.join(productRoot, 'scripts')),
    hasReports: fs.existsSync(path.join(productRoot, 'reports')),
    hasCases: fs.existsSync(path.join(productRoot, 'cases')),
    summary: fs.existsSync(readme) ? fs.readFileSync(readme, 'utf8').split(/\r?\n/).slice(0, 8).join('\n') : '',
    ...extra,
  };
}

function discoverDocProducts(docs, knownPaths) {
  const extras = [];
  function walk(dir, rel, depth) {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIR.has(entry.name) || entry.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (knownPaths.has(childRel)) continue;
      const child = path.join(dir, entry.name);
      const hasQa = ['scripts', 'cases', 'reports'].some(name => fs.existsSync(path.join(child, name)));
      if (hasQa) {
        extras.push({
          id: `DOC_${childRel.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}`,
          title: entry.name,
          docPath: childRel,
          flows: [],
          automatedFlows: [],
          kind: 'discovered',
          runnable: false,
          ...productMeta(docs, childRel),
        });
      } else walk(child, childRel, depth + 1);
    }
  }
  walk(docs, '', 0);
  return extras;
}

function products() {
  const layout = ensureIsLayout();
  const packs = listPacks().map(pack => ({
    ...pack,
    kind: 'qa-pack',
    runnable: true,
    ...productMeta(layout.docs, pack.docPath),
  }));
  const known = new Set(packs.map(pack => String(pack.docPath).replace(/\\/g, '/')));
  return [...packs, ...discoverDocProducts(layout.docs, known)];
}

module.exports = {
  ApproachError,
  isRoot,
  testRoot,
  docRoot,
  ensureIsLayout,
  packPaths,
  packHealth,
  overallHealth,
  packCatalog,
  readPackFile,
  listPacks,
  getPack,
  status,
  relativePath,
  assertInside,
  listDir,
  readTestFile,
  writeTestFile,
  mkdirTestDir,
  removeTestPath,
  products,
};
