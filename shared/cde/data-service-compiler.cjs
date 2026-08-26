const babel = require('@babel/core');
const presetEnv = require('@babel/preset-env');
const presetReact = require('@babel/preset-react');
const presetTypeScript = require('@babel/preset-typescript');

class CdeCompileError extends Error {
  constructor(message, fileName) { super(message); this.code = 'CDE_COMPILE_FAILED'; this.status = 422; this.fileName = fileName; }
}
function normalizeSourcePath(value) {
  const sourcePath = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!sourcePath || sourcePath.includes('\0') || sourcePath.startsWith('/') || /^[a-zA-Z]:/.test(sourcePath)) throw new CdeCompileError('مسیر سورس معتبر نیست.', sourcePath);
  const parts = sourcePath.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new CdeCompileError('مسیر سورس شامل بخش ناامن است.', sourcePath);
  return parts.join('/');
}
function readTsConfig(files) {
  const config = files.find(file => normalizeSourcePath(file.name) === 'tsconfig.json');
  if (!config) return {};
  try { return JSON.parse(String(config.code || '{}')); }
  catch { throw new CdeCompileError('فایل tsconfig.json معتبر نیست.', 'tsconfig.json'); }
}
function globRegex(pattern) {
  const normalized = String(pattern || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '::DS::').replace(/\*/g, '[^/]*').replace(/::DS::/g, '.*');
  return new RegExp(`^${escaped}(?:/.*)?$`);
}
function filterFiles(files, config) {
  const sources = files.filter(file => normalizeSourcePath(file.name) !== 'tsconfig.json');
  const include = Array.isArray(config.include) && config.include.length ? config.include.map(globRegex) : [/.*/];
  const exclude = Array.isArray(config.exclude) ? config.exclude.map(globRegex) : [/^node_modules(?:\/|$)/, /^dist(?:\/|$)/];
  return sources.filter(file => { const name = normalizeSourcePath(file.name); return include.some(pattern => pattern.test(name)) && !exclude.some(pattern => pattern.test(name)); });
}
function transform(code, fileName, typescript) {
  try {
    return babel.transformSync(String(code || ''), {
      filename: fileName, babelrc: false, configFile: false, sourceMaps: false,
      presets: [[presetEnv, { targets: { node: '18' }, modules: 'commonjs' }], [presetReact, { runtime: 'classic' }], ...(typescript ? [[presetTypeScript, { allowNamespaces: true }]] : [])],
    })?.code || '';
  } catch (error) { throw new CdeCompileError(`کامپایل ${typescript ? 'TypeScript' : 'JavaScript'} ناموفق بود: ${error.message}`, fileName); }
}
function compileDataServicePackage(files) {
  if (!Array.isArray(files) || !files.length) throw new CdeCompileError('شاخه Data Service حداقل یک فایل لازم دارد.');
  const normalized = files.map(file => ({ name: normalizeSourcePath(file.name), code: String(file.code ?? ''), oppend: Boolean(file.oppend) }));
  const seen = new Set();
  for (const file of normalized) { const key = file.name.toLocaleLowerCase('en-US'); if (seen.has(key)) throw new CdeCompileError('مسیر فایل‌ها با تفاوت حروف بزرگ و کوچک تداخل دارد.', file.name); seen.add(key); }
  const config = readTsConfig(normalized); const rootDir = String(config?.compilerOptions?.rootDir || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  return filterFiles(normalized, config).flatMap(file => {
    let output = file.name; if (rootDir && output.startsWith(`${rootDir}/`)) output = output.slice(rootDir.length + 1);
    if (/\.jsx?$/i.test(output)) return [{ name: output, build: transform(file.code, output, false) }];
    if (/\.tsx?$/i.test(output)) return [{ name: output.replace(/\.ts$/i, '.js').replace(/\.tsx$/i, '.jsx'), build: transform(file.code, output, true) }];
    if (/\.json$/i.test(output)) { try { JSON.parse(file.code); } catch { throw new CdeCompileError('فایل JSON معتبر نیست.', output); } return [{ name: output, build: file.code }]; }
    return [];
  });
}
function compileDataServiceBranchContent(content) {
  if (!content || content.type !== 'JS' || !Array.isArray(content.content)) throw new CdeCompileError('شاخه انتخاب‌شده یک پکیج JS Data Service نیست.');
  return { ...content, build: compileDataServicePackage(content.content) };
}
module.exports = { CdeCompileError, compileDataServiceBranchContent, compileDataServicePackage, normalizeSourcePath };
