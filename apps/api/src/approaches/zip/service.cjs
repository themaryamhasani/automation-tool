const fs = require('node:fs/promises');
const path = require('node:path');
const JSZip = require('jszip');

class ZipError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');

function sourcesRoot() {
  const configured = process.env.SOURCE_WORK_ROOT;
  if (configured && path.isAbsolute(configured)) return configured;
  return path.resolve(repoRoot, configured || path.join('runtime', 'sources'));
}

function projectZipRoot(projectId) {
  const root = path.resolve(sourcesRoot(), 'zip', String(projectId));
  if (!root.startsWith(sourcesRoot())) throw new ZipError('ZIP_UNSAFE_PATH', 'مسیر استخراج نامعتبر است.', 422);
  return root;
}

function safeZipPath(value) {
  const relative = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!relative || relative.includes('\0') || relative.split('/').some(part => !part || part === '.' || part === '..')) {
    return null;
  }
  return relative;
}

async function extractZipBuffer(projectId, buffer, originalName) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files);
  if (names.length > 8000) throw new ZipError('ZIP_TOO_MANY_FILES', 'تعداد فایل‌های زیپ بیش از حد مجاز است.', 422);
  const targetRoot = projectZipRoot(projectId);
  await fs.rm(targetRoot, { recursive: true, force: true });
  await fs.mkdir(targetRoot, { recursive: true });
  let fileCount = 0;
  let bytes = 0;
  for (const name of names) {
    const entry = zip.files[name];
    const relative = safeZipPath(name);
    if (!relative) continue;
    const dest = path.resolve(targetRoot, ...relative.split('/'));
    if (!dest.startsWith(`${targetRoot}${path.sep}`) && dest !== targetRoot) continue;
    if (entry.dir) {
      await fs.mkdir(dest, { recursive: true });
      continue;
    }
    const content = await entry.async('nodebuffer');
    bytes += content.length;
    if (bytes > 250 * 1024 * 1024) throw new ZipError('ZIP_TOO_LARGE', 'حجم استخراج‌شده زیپ بیش از حد مجاز است.', 422);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, content);
    fileCount += 1;
  }
  return {
    originalName: String(originalName || 'source.zip').slice(0, 255),
    extractedAt: new Date().toISOString(),
    fileCount,
    bytes,
    root: targetRoot,
  };
}

const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'test-results', 'playwright-report']);
const WRITE_EXT = new Set(['.md', '.mjs', '.js', '.cjs', '.ts', '.tsx', '.json', '.txt', '.ps1', '.yml', '.yaml', '.css', '.html']);

async function ensureExtracted(projectId) {
  const root = projectZipRoot(projectId);
  try { await fs.access(root); } catch {
    throw new ZipError('ZIP_REQUIRED', 'ابتدا فایل زیپ را آپلود کنید.', 409);
  }
  return root;
}

function resolveExtracted(projectId, filePath, { allowRoot = false } = {}) {
  const root = projectZipRoot(projectId);
  const relative = filePath ? safeZipPath(filePath) : '';
  if (filePath && !relative) throw new ZipError('ZIP_UNSAFE_PATH', 'مسیر نامعتبر است.', 422);
  if (!allowRoot && !relative) throw new ZipError('ZIP_UNSAFE_PATH', 'مسیر نامعتبر است.', 422);
  const target = relative ? path.resolve(root, ...relative.split('/')) : root;
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new ZipError('ZIP_UNSAFE_PATH', 'مسیر نامعتبر است.', 422);
  }
  return { root, relative, target };
}

async function listExtracted(projectId, relative = '', depth = 0, acc = []) {
  const root = projectZipRoot(projectId);
  const current = relative ? path.resolve(root, ...relative.split('/')) : root;
  if (!current.startsWith(root) && current !== root) throw new ZipError('ZIP_UNSAFE_PATH', 'مسیر نامعتبر است.', 422);
  try { await fs.access(current); } catch { return acc; }
  if (depth > 6 || acc.length > 500) return acc;
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIR.has(entry.name)) continue;
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      acc.push({ path: rel, type: 'dir' });
      await listExtracted(projectId, rel, depth + 1, acc);
    } else {
      const stat = await fs.stat(path.join(current, entry.name));
      acc.push({ path: rel, type: 'file', size: stat.size });
    }
  }
  return acc;
}

async function listExtractedDir(projectId, filePath = '') {
  await ensureExtracted(projectId);
  const { relative, target } = resolveExtracted(projectId, filePath, { allowRoot: true });
  let stat;
  try { stat = await fs.stat(target); } catch { throw new ZipError('ZIP_DIR_NOT_FOUND', 'پوشه پیدا نشد.', 404); }
  if (!stat.isDirectory()) throw new ZipError('ZIP_DIR_NOT_FOUND', 'پوشه پیدا نشد.', 404);
  const children = await fs.readdir(target, { withFileTypes: true });
  const entries = [];
  for (const entry of children) {
    if (SKIP_DIR.has(entry.name)) continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    const full = path.join(target, entry.name);
    const info = await fs.stat(full);
    entries.push({
      name: entry.name,
      path: child,
      type: entry.isDirectory() ? 'dir' : 'file',
      size: entry.isFile() ? info.size : 0,
      updatedAt: info.mtime.toISOString(),
    });
  }
  entries.sort((left, right) => (left.type === right.type ? left.name.localeCompare(right.name) : left.type === 'dir' ? -1 : 1));
  return { path: relative, entries };
}

async function readExtractedFile(projectId, filePath) {
  await ensureExtracted(projectId);
  const { relative, target } = resolveExtracted(projectId, filePath);
  let stat;
  try { stat = await fs.stat(target); } catch { throw new ZipError('ZIP_FILE_NOT_FOUND', 'فایل پیدا نشد.', 404); }
  if (!stat.isFile()) throw new ZipError('ZIP_FILE_NOT_FOUND', 'فایل پیدا نشد.', 404);
  if (stat.size > 1_500_000) throw new ZipError('ZIP_FILE_TOO_LARGE', 'فایل برای نمایش خیلی بزرگ است.', 422);
  return { path: relative, name: path.basename(target), code: await fs.readFile(target, 'utf8'), size: stat.size };
}

async function writeExtractedFile(projectId, filePath, code, { create = false } = {}) {
  await ensureExtracted(projectId);
  const { relative, target } = resolveExtracted(projectId, filePath);
  const ext = path.extname(target).toLowerCase();
  if (create && !WRITE_EXT.has(ext) && !target.endsWith('.env.example')) {
    throw new ZipError('ZIP_FILE_TYPE', 'این نوع فایل قابل ایجاد نیست.', 422);
  }
  if (typeof code !== 'string') throw new ZipError('ZIP_INVALID_SOURCE', 'محتوای فایل الزامی است.', 422);
  if (Buffer.byteLength(code) > 2 * 1024 * 1024) throw new ZipError('ZIP_FILE_TOO_LARGE', 'حجم فایل حداکثر دو مگابایت است.', 422);
  let stat = null;
  try { stat = await fs.stat(target); } catch { stat = null; }
  if (stat?.isDirectory()) throw new ZipError('ZIP_NOT_A_FILE', 'این مسیر یک پوشه است.', 422);
  if (create && stat) throw new ZipError('ZIP_FILE_EXISTS', 'فایلی با این نام از قبل وجود دارد.', 409);
  if (!create && !stat) throw new ZipError('ZIP_FILE_NOT_FOUND', 'فایل پیدا نشد.', 404);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, code, 'utf8');
  const saved = await fs.stat(target);
  return { path: relative, name: path.basename(target), code, size: saved.size, created: Boolean(create), updatedAt: saved.mtime.toISOString() };
}

async function mkdirExtracted(projectId, dirPath) {
  await ensureExtracted(projectId);
  const { relative, target } = resolveExtracted(projectId, dirPath);
  let stat = null;
  try { stat = await fs.stat(target); } catch { stat = null; }
  if (stat?.isFile()) throw new ZipError('ZIP_NOT_A_DIR', 'فایلی با این نام از قبل وجود دارد.', 409);
  if (stat?.isDirectory()) throw new ZipError('ZIP_DIR_EXISTS', 'پوشه‌ای با این نام از قبل وجود دارد.', 409);
  await fs.mkdir(target, { recursive: true });
  return { path: relative, name: path.basename(target), type: 'dir' };
}

async function removeExtracted(projectId, entryPath) {
  await ensureExtracted(projectId);
  const { root, relative, target } = resolveExtracted(projectId, entryPath);
  if (target === root) throw new ZipError('ZIP_ROOT_PROTECTED', 'ریشه آرشیو قابل حذف نیست.', 422);
  let stat;
  try { stat = await fs.stat(target); } catch { throw new ZipError('ZIP_ENTRY_NOT_FOUND', 'فایل یا پوشه پیدا نشد.', 404); }
  await fs.rm(target, { recursive: true, force: false });
  return { path: relative, type: stat.isDirectory() ? 'dir' : 'file', deleted: true };
}

module.exports = {
  ZipError,
  extractZipBuffer,
  listExtracted,
  listExtractedDir,
  readExtractedFile,
  writeExtractedFile,
  mkdirExtracted,
  removeExtracted,
  projectZipRoot,
  sourcesRoot,
};
