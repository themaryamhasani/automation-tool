#!/usr/bin/env node
/**
 * Wire medu-camp: login automation-tool, CDE, project+mapping, branch picks, runtime login, optional runs.
 * Credentials from env only — never printed.
 */
const fs = require('node:fs');
const path = require('node:path');

const API = process.env.API_BASE_URL || 'http://localhost:4280';
const ORIGIN = 'https://adib.m.edus.ir';

const CDE_PHONE = process.env.CDE_SELF_CHECK_PHONE || process.env.CDE_LOGIN_PHONE || '09022849799';
const CDE_PASSWORD = process.env.CDE_SELF_CHECK_PASSWORD || process.env.CDE_LOGIN_PASSWORD || '';
const CAMP_PHONE = process.env.CAMP_LOGIN_PHONE || '9056026346';
const CAMP_PASSWORD = process.env.CAMP_LOGIN_PASSWORD || '';

if (!CDE_PASSWORD || !CAMP_PASSWORD) {
  console.error('Set CDE_LOGIN_PASSWORD and CAMP_LOGIN_PASSWORD (or CDE_SELF_CHECK_PASSWORD) in env.');
  process.exit(2);
}

const jar = new Map();

function storeCookies(res) {
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  for (const line of raw) {
    const part = String(line).split(';')[0];
    const i = part.indexOf('=');
    if (i > 0) jar.set(part.slice(0, i), part.slice(i + 1));
  }
}

async function api(method, urlPath, body) {
  const headers = { accept: 'application/json' };
  if (jar.size) headers.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  storeCookies(res);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { _raw: text.slice(0, 500) }; }
  if (!res.ok) {
    const err = new Error(`${method} ${urlPath} -> ${res.status} ${JSON.stringify(json)}`);
    err.status = res.status;
    err.json = json;
    throw err;
  }
  return json;
}

function preferBranch(branches) {
  if (!Array.isArray(branches) || !branches.length) return null;
  const pubMeta = branches.find(b => b.selector?.kind === 'PERSONAL' && /pub/i.test(JSON.stringify(b.meta || {})));
  if (pubMeta) return pubMeta.selector;
  const pub = branches.find(b => b.selector?.kind === 'PUBLIC');
  if (pub) return pub.selector;
  // newest personal by highest index
  const personal = branches.filter(b => b.selector?.kind === 'PERSONAL')
    .sort((a, b) => (b.selector.index || 0) - (a.selector.index || 0));
  return (personal[0] || branches[0]).selector;
}

const KEY_PACKS = [
  { type: 'WEB_UI', packId: 'pages/component/medu-camp/App' },
  { type: 'WEB_UI', packId: 'pages/component/medu-camp/pages/School' },
  { type: 'WEB_UI', packId: 'pages/component/medu-camp/pages/Dashboard' },
  { type: 'WEB_UI', packId: 'pages/component/medu-camp/pages/Mantaghe' },
  { type: 'WEB_UI', packId: 'pages/component/medu-camp/pages/Ostan' },
  { type: 'WEB_UI', packId: 'pages/component/medu-camp/pages/Parent' },
  { type: 'WEB_UI', packId: 'pages/component/medu-camp/sections/Reports' },
  { type: 'WEB_UI', packId: 'pages/component/medu-camp/sections/OstanReports' },
  { type: 'WEB_UI', packId: 'pages/component/medu-camp/sections/RegisterOutOfSchool' },
  { type: 'WEB_UI', packId: 'pages/component/medu-camp/sections/SectionApproveCamp' },
  { type: 'WEB_UI', packId: 'pages/component/medu-camp/sections/PlanManagement' },
  { type: 'API_MODULE', packId: 'ds/medu-camp/roles-and-organs' },
  { type: 'API_MODULE', packId: 'ds/medu-camp/camp/load' },
  { type: 'API_MODULE', packId: 'ds/medu-camp/camp/load/organ' },
  { type: 'API_MODULE', packId: 'ds/medu-camp/server/time' },
  { type: 'API_MODULE', packId: 'ds/medu-camp/camp/status-counts' },
  { type: 'API_MODULE', packId: 'ds/medu-camp/camp/out-of-school/load' },
  { type: 'API_MODULE', packId: 'ds/medu-camp/mantaghe/camps/load' },
  { type: 'API_MODULE', packId: 'ds/medu-camp/organ/camps/load' },
  { type: 'API_MODULE', packId: 'ds/medu-camp/ostan/reports/camps' },
  { type: 'API_MODULE', packId: 'ds/medu-camp/ostan/reports/camps/load' },
  { type: 'API_MODULE', packId: 'ds/medu-camp/setad/reports/camps' },
  { type: 'API_MODULE', packId: 'ds/medu-camp/setad/reports/camps/load' },
  { type: 'API_MODULE', packId: 'fr/medu-camp/camp' },
  { type: 'API_MODULE', packId: 'fr/medu-camp/camp/update-status' },
  { type: 'API_MODULE', packId: 'fr/medu-camp/camp/approve/meta' },
  { type: 'API_MODULE', packId: 'fr/medu-camp/mantaghe/approve/meta' },
  { type: 'API_MODULE', packId: 'fr/medu-camp/camp/create' },
  { type: 'API_MODULE', packId: 'fr/medu-camp/plan/edit' },
  { type: 'API_MODULE', packId: 'fr/medu-camp/implement/create' },
];

async function main() {
  console.log('1) automation login');
  await api('POST', '/api/auth/login', { identity: 'admin@automation.local', password: 'Admin@12345' });

  console.log('2) CDE connect');
  let cde = await api('POST', '/api/cde/session/start', { userLoginName: CDE_PHONE });
  if (cde.nextStep === 'password' && cde.challenge) {
    cde = await api('POST', '/api/cde/session/password', { password: CDE_PASSWORD, challenge: cde.challenge });
  }
  if (!cde.connected) throw new Error('CDE not connected');

  console.log('3) ensure project');
  let projects = await api('GET', '/api/projects');
  let project = (projects || []).find(p => p.code === 'medu-camp' || p.name === 'medu-camp');
  if (!project) {
    project = await api('POST', '/api/projects', {
      name: 'medu-camp',
      code: 'medu-camp',
      description: 'سامانه اردو',
      sourceApproach: 'CDE',
    });
  } else if (project.sourceApproach !== 'CDE') {
    project = await api('PUT', `/api/projects/${project.id}`, {
      name: project.name,
      code: project.code,
      description: project.description || 'سامانه اردو',
      isActive: true,
      sourceApproach: 'CDE',
    });
  }
  console.log(`project=${project.id}`);

  console.log('4) mapping');
  await api('PUT', `/api/projects/${project.id}/cde-mapping`, {
    projectKey: 'medu-camp',
    webUiRepoName: 'medu-camp/web-ui',
    dataServiceRepoName: 'medu-camp/data-service',
    apiModuleRepoName: 'medu-camp/api-module',
    messageConsumerRepoName: '',
    enabled: true,
  });

  console.log('5) environment adib');
  let envs = await api('GET', `/api/projects/${project.id}/environments`).catch(() => null);
  if (!envs) {
    // fallback list
    const all = await api('GET', '/api/environments').catch(() => []);
    envs = (all || []).filter(e => e.projectId === project.id || e.project_id === project.id);
  }
  let environment = (Array.isArray(envs) ? envs : []).find(e => String(e.base_url || e.baseUrl || '').includes('adib.m.edus.ir'));
  if (!environment) {
    try {
      environment = await api('POST', `/api/projects/${project.id}/environments`, {
        name: 'adib-live',
        baseUrl: ORIGIN,
        apiBaseUrl: ORIGIN,
        gatewayBaseUrl: ORIGIN,
        enabled: true,
      });
    } catch (error) {
      // ensure via workspace runtime path
      console.warn('env create via projects failed, will use runtime workspace env', error.message);
    }
  }

  const mapping = await api('GET', `/api/projects/${project.id}/cde-mapping`);
  const repoByType = {
    WEB_UI: mapping.webUiRepoName,
    DATA_SERVICE: mapping.dataServiceRepoName,
    API_MODULE: mapping.apiModuleRepoName,
    MESSAGE_CONSUMER: mapping.messageConsumerRepoName,
  };

  console.log('6) branch selections for key packs');
  for (const item of KEY_PACKS) {
    const repoName = repoByType[item.type];
    if (!repoName) {
      console.warn(`  skip ${item.packId}: no repo for ${item.type}`);
      continue;
    }
    try {
      await api('POST', `/api/cde/projects/medu-camp/package`, {
        repositoryType: item.type,
        packId: item.packId,
        projectId: project.id,
        selectBranch: true,
      });
      console.log(`  already selected ${item.type} ${item.packId}`);
    } catch (error) {
      const branches = error.json?.details?.branches;
      const selector = preferBranch(branches);
      if (!selector) {
        console.warn(`  skip ${item.packId}: ${error.message}`);
        continue;
      }
      await api('POST', `/api/projects/${project.id}/cde-branch-selection`, {
        repositoryType: item.type,
        repoName,
        packId: item.packId,
        branch: selector,
      });
      await api('POST', `/api/cde/projects/medu-camp/package`, {
        repositoryType: item.type,
        packId: item.packId,
        projectId: project.id,
        branch: selector,
      });
      console.log(`  selected ${item.type} ${item.packId} -> ${JSON.stringify(selector)}`);
    }
  }

  console.log('7) runtime login on adib');
  // Prefer environment-scoped runtime session
  let runtimePath;
  if (environment?.id) {
    runtimePath = `/api/environments/${environment.id}/runtime-session`;
  } else {
    runtimePath = `/api/cde/projects/medu-camp/runtime-session`;
  }
  let rt;
  try {
    rt = await api('POST', `${runtimePath}/start`, { userLoginName: CAMP_PHONE, origin: ORIGIN });
  } catch (error) {
    // try workspace style
    runtimePath = `/api/cde/projects/medu-camp/runtime-session`;
    rt = await api('POST', `${runtimePath}/start`, { userLoginName: CAMP_PHONE, origin: ORIGIN });
  }
  if (rt.nextStep === 'password' && rt.challenge) {
    rt = await api('POST', `${runtimePath}/password`, {
      password: CAMP_PASSWORD,
      challenge: rt.challenge,
      origin: ORIGIN,
    });
  }
  console.log(`runtime connected=${Boolean(rt.connected)} origin=${rt.origin || ORIGIN}`);

  const out = {
    projectId: project.id,
    environmentId: environment?.id || rt.environmentId || null,
    runtimeConnected: Boolean(rt.connected),
    origin: ORIGIN,
  };
  fs.writeFileSync(path.join(__dirname, '..', 'runtime', 'packs', 'cde', 'medu-camp', '.wire-state.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('wire-state written', out);

  if (process.argv.includes('--run')) {
    console.log('8) enqueue DANGER + PLAYWRIGHT runs');
    const danger = await api('POST', '/api/runs', {
      projectId: project.id,
      approach: 'CDE',
      packId: 'medu-camp',
      toolKind: 'DANGER',
      flowId: 'ALL',
      testFilePath: 'scripts/api/run.mjs',
      environmentId: out.environmentId,
      refreshSnapshot: true,
    });
    const pw = await api('POST', '/api/runs', {
      projectId: project.id,
      approach: 'CDE',
      packId: 'medu-camp',
      toolKind: 'PLAYWRIGHT',
      flowId: 'XCUT',
      testFilePath: 'scripts/e2e/school-live.spec.ts',
      environmentId: out.environmentId,
    });
    const vitest = await api('POST', '/api/runs', {
      projectId: project.id,
      approach: 'CDE',
      packId: 'medu-camp',
      toolKind: 'VITEST',
      flowId: 'ALL',
      testFilePath: 'scripts/vitest/runtime.test.cjs',
      environmentId: out.environmentId,
    });
    console.log({ danger: danger.id, playwright: pw.id, vitest: vitest.id });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
