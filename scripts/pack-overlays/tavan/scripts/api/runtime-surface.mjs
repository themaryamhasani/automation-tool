const base = (process.env.AUTOMATION_RUNTIME_URL || process.env.BASE_URL || 'http://127.0.0.1:4520').replace(/\/$/, '');
const expectedKey = process.env.CDE_PROJECT_KEY || '';
const cases = [];

function record(id, title, ok, detail = '') {
  cases.push({ id, title, ok, detail });
  console.log(ok ? `  ✓ PASS  ${id} — ${title}` : `  ✗ FAIL  ${id} — ${title}${detail ? ` (${detail})` : ''}`);
}

async function getJson(route) {
  const res = await fetch(`${base}${route}`);
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function getText(route) {
  const res = await fetch(`${base}${route}`);
  const text = await res.text();
  return { res, text };
}

function pick(list, needles) {
  if (!Array.isArray(list) || !list.length) return null;
  for (const needle of needles) {
    const hit = list.find(item => String(item.packId || '').toLowerCase().includes(needle));
    if (hit) return hit;
  }
  return list[0];
}

console.log('--- ALL ---');
const health = await getJson('/health');
record(
  'TC-CDE-RT-001',
  'runtime Express health',
  health.res.ok && health.body.ok === true && health.body.kind === 'cde-express-runtime',
  `status=${health.res.status}`,
);
record(
  'TC-CDE-RT-002',
  expectedKey ? `projectKey is ${expectedKey}` : 'projectKey present',
  expectedKey ? health.body.projectKey === expectedKey : Boolean(health.body.projectKey),
  `got=${health.body.projectKey}`,
);

const catalog = await getJson('/__runtime/catalog');
record('TC-CDE-RT-003', 'runtime catalog', catalog.res.ok && catalog.body.ok === true, `status=${catalog.res.status}`);
const webUi = catalog.body.webUi || [];
const apiModule = catalog.body.apiModule || [];
record('TC-CDE-RT-004', 'Web UI packages in snapshot', webUi.length > 0, `count=${webUi.length}`);
record('TC-CDE-RT-005', 'API Module packages in snapshot', apiModule.length > 0, `count=${apiModule.length}`);

const web = pick(webUi, ['community/auth', 'tavan', 'auth', 'community']);
if (web) {
  const ui = await getText(`/__runtime/ui?packId=${encodeURIComponent(web.packId)}`);
  record(
    'TC-CDE-RT-006',
    `Web UI source served (${web.packId})`,
    ui.res.ok && ui.text.length > 20,
    `status=${ui.res.status} bytes=${ui.text.length}`,
  );
  const src = await getText(`/__runtime/source?kind=web-ui&packId=${encodeURIComponent(web.packId)}&file=${encodeURIComponent(web.entry || '')}`);
  record('TC-CDE-RT-007', 'Web UI entry via source route', src.res.ok && src.text.length > 20, `status=${src.res.status}`);
} else {
  record('TC-CDE-RT-006', 'Web UI source served', false, 'no web-ui package');
  record('TC-CDE-RT-007', 'Web UI entry via source route', false, 'no web-ui package');
}

const api = pick(apiModule, ['announcement', 'auth', 'community', 'tavan']);
if (api) {
  const js = await getText(`/__runtime/api-module?packId=${encodeURIComponent(api.packId)}`);
  record(
    'TC-CDE-RT-008',
    `API Module source served (${api.packId})`,
    js.res.ok && js.text.length > 10,
    `status=${js.res.status} bytes=${js.text.length}`,
  );
} else {
  record('TC-CDE-RT-008', 'API Module source served', false, 'no api-module package');
}

const pass = cases.filter(item => item.ok).length;
const fail = cases.filter(item => !item.ok).length;
console.log('=== SUMMARY ===');
console.log(`PASS=${pass}  FAIL=${fail}  SKIP=0  TOTAL=${cases.length}`);
if (fail) process.exit(1);

