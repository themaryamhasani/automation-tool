const fs = require('node:fs');
const path = require('node:path');
const { appsRoot, safeKey } = require('../approaches/local-pack.cjs');
const { compileDataServicePackage } = require('./data-service-compiler.cjs');

function expressModulePath() {
  try { return require.resolve('express'); }
  catch {
    return require.resolve('express', { paths: [path.resolve(__dirname, '..', '..', 'apps', 'api')] });
  }
}

function runtimePort(projectKey) {
  const base = Math.max(4000, Number(process.env.CDE_RUNTIME_PORT_BASE || 4520));
  let hash = 0;
  for (const char of String(projectKey || '')) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return base + (Math.abs(hash) % 40);
}

function copyTree(files, sourceRoot) {
  for (const file of files) {
    const relative = String(file.path || '').replace(/\\/g, '/');
    if (!relative || relative.split('/').some(part => part === '..')) continue;
    const target = path.join(sourceRoot, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.code ?? '', 'utf8');
  }
}

function compileDataServices(sourceRoot) {
  const dsRoot = path.join(sourceRoot, 'data-service', 'packages');
  if (!fs.existsSync(dsRoot)) return [];
  const compiled = [];
  for (const pack of fs.readdirSync(dsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    const packDir = path.join(dsRoot, pack.name);
    const srcDir = fs.existsSync(path.join(packDir, 'source')) ? path.join(packDir, 'source') : packDir;
    const files = [];
    const walk = (dir, rel = '') => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, childRel);
        else files.push({ name: childRel, code: fs.readFileSync(full, 'utf8') });
      }
    };
    walk(srcDir);
    if (!files.length) continue;
    try {
      const build = compileDataServicePackage(files);
      const buildDir = path.join(packDir, 'build');
      fs.mkdirSync(buildDir, { recursive: true });
      for (const file of build) {
        const target = path.join(buildDir, ...file.name.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.build, 'utf8');
      }
      compiled.push({ packId: decodeURIComponent(pack.name), buildDir, files: build.length });
    } catch (error) {
      compiled.push({ packId: decodeURIComponent(pack.name), error: error.message });
    }
  }
  return compiled;
}

function writeServer(appRoot, manifest) {
  const code = `const fs = require('node:fs');
const path = require('node:path');
const express = require(${JSON.stringify(expressModulePath())});

const manifest = require('./automation-runtime-manifest.json');
const app = express();
app.use(express.json({ limit: '2mb' }));

function walkFiles(dir, rel = '') {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? rel + '/' + entry.name : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, childRel));
    else out.push(childRel);
  }
  return out;
}

function pickEntry(files) {
  const preferred = ['index.html', 'index.jsx', 'index.js', 'imports.js', 'actions.js'];
  for (const name of preferred) {
    const hit = files.find(file => file === name || file.endsWith('/' + name));
    if (hit) return hit;
  }
  return files[0] || null;
}

function listPackages(kind) {
  const root = path.join(__dirname, 'source', kind, 'packages');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(pack => {
      const hasSourceSub = fs.existsSync(path.join(root, pack.name, 'source'));
      const sourceDir = hasSourceSub
        ? path.join(root, pack.name, 'source')
        : path.join(root, pack.name);
      const files = walkFiles(sourceDir);
      return {
        packId: decodeURIComponent(pack.name),
        encodedId: pack.name,
        files,
        entry: pickEntry(files),
        sourcePrefix: hasSourceSub
          ? kind + '/packages/' + pack.name + '/source'
          : kind + '/packages/' + pack.name,
      };
    })
    .sort((left, right) => left.packId.localeCompare(right.packId));
}

app.get('/health', (_req, res) => {
  const webUi = listPackages('web-ui');
  const apiModule = listPackages('api-module');
  res.json({
    ok: true,
    kind: 'cde-express-runtime',
    projectKey: manifest.projectKey,
    port: manifest.port,
    compiledAt: manifest.compiledAt,
    packages: manifest.packages,
    dataServices: manifest.dataServices,
    webUiCount: webUi.length,
    apiModuleCount: apiModule.length,
  });
});
app.get('/__runtime/manifest', (_req, res) => res.json(manifest));
app.get('/__runtime/catalog', (_req, res) => {
  const webUi = listPackages('web-ui');
  const apiModule = listPackages('api-module');
  res.json({ ok: true, projectKey: manifest.projectKey, webUi, apiModule, dataServices: manifest.dataServices || [] });
});
function findPack(kind, packId) {
  const wanted = String(packId || '');
  return listPackages(kind).find(item => item.packId === wanted || item.encodedId === wanted || item.encodedId === encodeURIComponent(wanted));
}

function sendPackFile(res, kind, packId, fileName) {
  const pack = findPack(kind, packId);
  if (!pack) return res.status(404).json({ ok: false, message: 'پکیج پیدا نشد.', kind, packId });
  const relative = String(fileName || pack.entry || '');
  if (!relative || relative.split('/').some(part => part === '..')) {
    return res.status(400).json({ ok: false, message: 'مسیر فایل معتبر نیست.' });
  }
  const target = path.join(__dirname, 'source', pack.sourcePrefix, ...relative.split('/'));
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return res.status(404).json({ ok: false, message: 'فایل سورس پیدا نشد.', kind, packId, file: relative });
  }
  const ext = path.extname(target).toLowerCase();
  const type = ext === '.html' ? 'html' : ext === '.js' || ext === '.mjs' || ext === '.jsx' ? 'javascript' : 'text';
  res.type(type).send(fs.readFileSync(target, 'utf8'));
}

app.get('/__runtime/source', (req, res) => sendPackFile(res, String(req.query.kind || ''), req.query.packId, req.query.file));
app.get('/__runtime/ui', (req, res) => sendPackFile(res, 'web-ui', req.query.packId));
app.get('/__runtime/api-module', (req, res) => sendPackFile(res, 'api-module', req.query.packId));
app.use('/__source', express.static(path.join(__dirname, 'source')));

for (const item of manifest.dataServices || []) {
  if (!item.buildDir) continue;
  const indexCandidates = ['index.js', 'src/index.js', 'main.js'].map(name => path.join(item.buildDir, name));
  const entry = indexCandidates.find(file => fs.existsSync(file));
  if (!entry) continue;
  try {
    const loaded = require(entry);
    const handler = loaded?.app || loaded?.router || loaded?.default || loaded;
    if (typeof handler === 'function' && handler.handle) app.use(\`/ds/\${encodeURIComponent(item.packId)}\`, handler);
    else if (typeof loaded?.createApp === 'function') app.use(\`/ds/\${encodeURIComponent(item.packId)}\`, loaded.createApp());
  } catch (error) {
    console.error('data-service mount skipped', item.packId, error.message);
  }
}

app.use((req, res) => res.status(404).json({ ok: false, path: req.path, message: 'این مسیر در پکیج Express تولیدشده از CDE تعریف نشده است.' }));
const port = Number(process.env.PORT || manifest.port || 4520);
app.listen(port, '127.0.0.1', () => {
  console.log(\`cde-express-runtime \${manifest.projectKey} http://127.0.0.1:\${port}\`);
});
`;
  fs.writeFileSync(path.join(appRoot, 'server.cjs'), code, 'utf8');
  fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({
    name: `cde-express-${safeKey(manifest.projectKey)}`,
    private: true,
    version: '1.0.0',
    description: 'Express runtime generated from CDE source; tests live in automation-tool packs.',
    main: 'server.cjs',
    scripts: { start: 'node server.cjs' },
  }, null, 2), 'utf8');
}

function safeClearDir(target) {
  if (!fs.existsSync(target)) return target;
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    return target;
  } catch (error) {
    if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code)) throw error;
    const fallback = `${target}-${Date.now().toString(36)}`;
    return fallback;
  }
}

function buildExpressPackage({ projectKey, files, packages = [] }) {
  const key = safeKey(projectKey);
  let appRoot = path.join(appsRoot(), 'cde', key);
  appRoot = safeClearDir(appRoot);
  const sourceRoot = path.join(appRoot, 'source');
  fs.mkdirSync(sourceRoot, { recursive: true });
  copyTree(files || [], sourceRoot);
  const dataServices = compileDataServices(sourceRoot);
  const port = runtimePort(projectKey);
  const manifest = {
    format: 1,
    kind: 'cde-express-runtime',
    projectKey,
    port,
    compiledAt: new Date().toISOString(),
    packages: (packages || []).map(item => ({
      repositoryType: item.repositoryType,
      packId: item.packId,
      repoName: item.repoName,
      versionId: item.versionId,
    })),
    dataServices,
    fileCount: (files || []).length,
  };
  fs.writeFileSync(path.join(appRoot, 'automation-runtime-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  writeServer(appRoot, manifest);
  return { appRoot, port, baseUrl: `http://127.0.0.1:${port}`, manifest };
}

module.exports = { buildExpressPackage, runtimePort, appsRoot };
