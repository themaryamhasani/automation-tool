const fs = require('node:fs');
const path = require('node:path');
const { readOverview } = require('./registry.cjs');

function docRoot() {
  return path.resolve(process.env.IS_ROOT || 'D:\\AllApp\\IS\\integrated-systems', process.env.IS_DOC_REL || 'test/doc');
}

const SKIP_DIR = new Set(['node_modules', 'test-results', 'playwright-report', '.git', 'dist', '_meta', '_shared']);

function findDangerDir(productRoot) {
  const apiDir = path.join(productRoot, 'scripts', 'api');
  if (!fs.existsSync(apiDir)) return null;
  for (const name of fs.readdirSync(apiDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    if (fs.existsSync(path.join(apiDir, name.name, 'run.mjs'))) return name.name;
  }
  return null;
}

function readProductCode(productRoot, slug) {
  const readme = path.join(productRoot, '00-readme.md');
  if (!fs.existsSync(readme)) return slug.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 6).toUpperCase();
  const match = fs.readFileSync(readme, 'utf8').match(/^product:\s*(\S+)/m);
  return match ? match[1].toUpperCase() : slug.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 6).toUpperCase();
}

function hasRunnableLayout(productRoot) {
  return fs.existsSync(path.join(productRoot, 'scripts', 'run-by-flow.mjs'))
    && Boolean(findDangerDir(productRoot));
}

function inferPackFromDocRel(docRel) {
  const docs = docRoot();
  const normalized = String(docRel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const productRoot = path.join(docs, normalized);
  if (!fs.existsSync(productRoot) || !hasRunnableLayout(productRoot)) return null;

  const slug = slugFromDocPath(normalized);
  const dangerDir = findDangerDir(productRoot);
  const overview = readOverview(productRoot);
  const id = overview.productCode || readProductCode(productRoot, slug);
  const port = overview.port || '4000';
  const title = fs.existsSync(path.join(productRoot, '00-readme.md'))
    ? (fs.readFileSync(path.join(productRoot, '00-readme.md'), 'utf8').match(/^#\s+QA Map —\s+(.+?)\s*\(/m)?.[1]
      || fs.readFileSync(path.join(productRoot, '00-readme.md'), 'utf8').match(/^#\s+(.+)$/m)?.[1]
      || slug)
    : slug;

  return {
    id,
    title: title.trim(),
    docPath: normalized,
    serviceRoot: overview.serviceRoot || '',
    health: [
      { name: slug, url: `http://127.0.0.1:${port}/health` },
      { name: 'gateway', url: 'http://127.0.0.1:4000/health', optional: true },
    ],
    e2eBaseUrl: overview.e2eBaseUrl || `http://127.0.0.1:${port}/`,
    flows: ['XCUT', 'SEC'],
    automatedFlows: ['XCUT', 'SEC'],
    danger: {
      cwd: `scripts/api/${dangerDir}`,
      entry: 'run.mjs',
      runByFlow: 'scripts/run-by-flow.mjs',
      rawFile: `${slug}-danger-run-raw.txt`,
    },
    k6: {
      cwd: `scripts/api/${dangerDir}`,
      script: `k6-${slug}-security-perf.js`,
      rawFile: `${slug}-k6-raw.txt`,
    },
    e2e: {
      cwd: 'scripts/e2e',
      npmScript: 'e2e',
      rawFile: `${slug}-e2e-raw.txt`,
      channel: 'chrome',
    },
    unit: overview.serviceRoot
      ? {
        cwdFromRepo: overview.serviceRoot,
        command: ['npx', 'vitest', 'run'],
        rawFile: `${slug}-vitest-raw.txt`,
      }
      : {
        cwdFromRepo: '.',
        command: ['npx', 'vitest', 'run'],
        rawFile: `${slug}-vitest-raw.txt`,
      },
  };
}

function slugFromDocPath(docPath) {
  return String(docPath || '').split('/').filter(Boolean).pop() || 'product';
}

function scanInferredPacks(knownDocPaths) {
  const docs = docRoot();
  if (!fs.existsSync(docs)) return [];
  const known = new Set([...knownDocPaths].map(item => String(item).replace(/\\/g, '/')));
  const inferred = [];

  function walk(dir, rel, depth) {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIR.has(entry.name) || entry.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (known.has(childRel)) continue;
      const child = path.join(dir, entry.name);
      if (hasRunnableLayout(child)) {
        const pack = inferPackFromDocRel(childRel);
        if (pack) {
          inferred.push(pack);
          known.add(childRel);
        }
      } else {
        walk(child, childRel, depth + 1);
      }
    }
  }

  walk(docs, '', 0);
  return inferred;
}

module.exports = {
  hasRunnableLayout,
  inferPackFromDocRel,
  scanInferredPacks,
};
