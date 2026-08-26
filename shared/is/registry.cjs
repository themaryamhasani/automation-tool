const fs = require('node:fs');
const path = require('node:path');

function docRoot() {
  return path.resolve(process.env.IS_ROOT || 'D:\\AllApp\\IS\\integrated-systems', process.env.IS_DOC_REL || 'test/doc');
}

function loadRegistry() {
  const file = path.join(docRoot(), '_meta', 'product-registry.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readOverview(productRoot) {
  const file = path.join(productRoot, '01-overview.md');
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  const portMatch = text.match(/پورت(?:\s+dev)?[^\d]*(\d{4})/i) || text.match(/پورت[^\d]*\*\*(\d{4})\*\*/i);
  const mfMatch = text.match(/`(https?:\/\/localhost:\d+[^`]*)`/i) || text.match(/(https?:\/\/localhost:\d+\/[^`\s|]+)/i);
  const serviceMatch = text.match(/`(services\/[^`]+)`/);
  const productMatch = text.match(/^product:\s*(\S+)/m);
  return {
    port: portMatch ? portMatch[1] : '',
    e2eBaseUrl: mfMatch ? mfMatch[1] : '',
    serviceRoot: serviceMatch ? serviceMatch[1] : '',
    productCode: productMatch ? productMatch[1] : '',
  };
}

function slugFromDocPath(docPath) {
  return String(docPath || '').split('/').filter(Boolean).pop() || 'product';
}

function buildPackFromRegistry(def) {
  const docs = docRoot();
  const docPath = String(def.pack || '').replace(/\\/g, '/');
  const productRoot = path.join(docs, docPath);
  const overview = fs.existsSync(productRoot) ? readOverview(productRoot) : {};
  const slug = slugFromDocPath(docPath);
  const port = overview.port || '4000';
  const dangerDir = def.dangerDir || `${slug}-danger`;
  const dangerRaw = def.dangerRawName || `${slug}-danger-run-raw.txt`;
  const e2eRaw = def.e2eRawName || `${slug}-e2e-raw.txt`;
  const flows = Array.isArray(def.flows) && def.flows.length ? def.flows : ['XCUT', 'SEC'];
  const automatedFlows = Array.isArray(def.p1StableFlows) && def.p1StableFlows.length ? def.p1StableFlows : flows;
  const serviceRoot = overview.serviceRoot || '';
  return {
    id: def.id,
    title: def.title,
    docPath,
    serviceRoot,
    health: [
      { name: slug, url: `http://127.0.0.1:${port}/health` },
      { name: 'gateway', url: 'http://127.0.0.1:4000/health', optional: true },
    ],
    e2eBaseUrl: overview.e2eBaseUrl || `http://127.0.0.1:${port}/`,
    flows,
    automatedFlows,
    danger: {
      cwd: `scripts/api/${dangerDir}`,
      entry: 'run.mjs',
      runByFlow: 'scripts/run-by-flow.mjs',
      rawFile: dangerRaw,
    },
    k6: {
      cwd: `scripts/api/${dangerDir}`,
      script: `k6-${slug}-security-perf.js`,
      rawFile: `${slug}-k6-raw.txt`,
    },
    e2e: {
      cwd: 'scripts/e2e',
      npmScript: 'e2e',
      rawFile: e2eRaw,
      channel: 'chrome',
    },
    unit: serviceRoot
      ? {
        cwdFromRepo: serviceRoot,
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

function listRegistryPacks() {
  const registry = loadRegistry();
  if (!registry?.products) return [];
  return Object.values(registry.products).map(buildPackFromRegistry);
}

function resolveRegistryKey(input) {
  const registry = loadRegistry();
  if (!registry?.products) return null;
  const raw = String(input || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  for (const def of Object.values(registry.products)) {
    if (def.id === upper) return def;
  }
  const lower = raw.toLowerCase();
  const key = registry.aliases?.[lower];
  if (key && registry.products[key]) return registry.products[key];
  if (registry.products[lower]) return registry.products[lower];
  return null;
}

module.exports = {
  loadRegistry,
  readOverview,
  buildPackFromRegistry,
  listRegistryPacks,
  resolveRegistryKey,
};
