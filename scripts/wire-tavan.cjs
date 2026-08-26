#!/usr/bin/env node
/**
 * Wire tavan: CDE session, project mapping, optional catalog probe.
 * Usage: node scripts/wire-tavan.cjs
 * Requires API up + CDE credentials in env (never committed).
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACK = path.join(ROOT, 'runtime', 'packs', 'cde', 'tavan');

async function api(method, urlPath, body) {
  const base = process.env.AUTOMATION_API_URL || 'http://127.0.0.1:3001';
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: process.env.AUTOMATION_COOKIE || '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${urlPath} → ${res.status} ${text.slice(0, 200)}`);
  return json;
}

async function main() {
  console.log('wire-tavan: ensure project + mapping (manual CDE login may be required in UI)');
  let projects = [];
  try {
    projects = await api('GET', '/api/projects');
  } catch (e) {
    console.warn('API not reachable — write local wire-state only:', e.message);
  }

  let project = (projects || []).find(p => p.code === 'tavan');
  if (!project && projects) {
    project = await api('POST', '/api/projects', {
      name: 'سامانه توان',
      code: 'tavan',
      description: 'CDE tavan full QA pack',
    });
  }

  const out = {
    projectKey: 'tavan',
    packPath: 'runtime/packs/cde/tavan',
    preferredOrigin: process.env.TAVAN_LIVE_ORIGIN || 'https://soha.m.edus.ir',
    projectServiceId: process.env.AUTOMATION_PROJECT_SERVICE_ID || 'tavan.medu.ir',
    wiredAt: new Date().toISOString(),
    projectId: project?.id || null,
    nextSteps: [
      'Connect CDE in UI and select tavan Web UI + API Module branches',
      'Create runtime session → snapshot',
      'node runtime/packs/cde/tavan/scripts/api/catalog-probe.mjs',
      'node runtime/packs/cde/tavan/scripts/api/run.mjs --flow=ALL',
    ],
  };

  fs.writeFileSync(path.join(PACK, '.wire-state.json'), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log('wire-state written', out);
}

main().catch((e) => { console.error(e); process.exit(1); });
