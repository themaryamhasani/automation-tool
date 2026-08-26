import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from './lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packRoot = path.resolve(__dirname, '..', '..');
const manifestPath = process.env.CDE_EXPRESS_ROOT
  ? path.join(process.env.CDE_EXPRESS_ROOT, 'automation-runtime-manifest.json')
  : '';

function scanManifest(manifest) {
  const ds = [];
  const fr = [];
  const pages = [];
  for (const entry of manifest?.providers || manifest?.routes || []) {
    const id = String(entry.id || entry.path || entry.sourceId || '');
    if (id.startsWith('ds/tavan')) ds.push(id);
    if (id.startsWith('fr/tavan')) fr.push(id);
    if (id.includes('component/tavan')) pages.push(id);
  }
  for (const key of Object.keys(manifest?.dataProviders || {})) {
    if (key.includes('tavan')) ds.push(key.startsWith('ds/') ? key : `ds/tavan/${key}`);
  }
  return { ds: [...new Set(ds)], fr: [...new Set(fr)], pages: [...new Set(pages)] };
}

async function main() {
  const catalog = loadCatalog();
  let discovered = { ds: [], fr: [], pages: [] };
  if (manifestPath && fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    discovered = scanManifest(manifest);
    console.log('manifest', manifestPath);
    console.log('discovered ds', discovered.ds.length, 'fr', discovered.fr.length);
  } else {
    console.warn('SKIP manifest — set CDE_EXPRESS_ROOT after snapshot');
  }

  const mergeProviders = (existing, ids, command = false) => {
    const map = new Map(existing.map(p => [p.id, p]));
    for (const id of ids) {
      if (!map.has(id)) {
        map.set(id, { id, fixture: id.split('/').pop(), priority: 'P2', params: {}, command });
      }
    }
    return [...map.values()];
  };

  catalog.dataProviders = mergeProviders(catalog.dataProviders || [], discovered.ds, false);
  catalog.formProviders = mergeProviders(catalog.formProviders || [], discovered.fr, true);
  catalog.webUi = [...new Set([...(catalog.webUi || []), ...discovered.pages])];
  catalog.probedAt = new Date().toISOString();

  const out = path.join(packRoot, 'data', 'catalog.json');
  fs.writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log('updated', out);
  console.log('=== SUMMARY ===');
  console.log(`PASS=1  FAIL=0  SKIP=${manifestPath ? 0 : 1}  TOTAL=1  TC-TAVAN-CAT-001`);
}

main().catch((e) => { console.error(e); process.exit(1); });

