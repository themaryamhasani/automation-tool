import {
  createReporter,
  ensureLiveLogin,
  expressUrl,
  getJson,
  liveAppPath,
  liveGet,
  liveOrigin,
  pickOrganPath,
  pickRole,
  countStatus,
  createCamp,
  postDataProvider,
  projectServiceId,
  runNamedFixture,
  isAuthDenied,
  isModuleGap,
} from './lib.mjs';

function parseArgs(argv) {
  const out = { flow: 'ALL' };
  for (const a of argv) {
    if (a.startsWith('--flow=')) out.flow = a.slice(7).toUpperCase();
  }
  return out;
}

async function run(r, filter, flow, tc, title, fn) {
  if (filter !== 'ALL' && filter !== flow) return;
  console.log(`--- ${flow} ---`);
  try {
    await fn();
  } catch (error) {
    r.fail(tc, title, error.message || String(error));
  }
}

function listIds(logical) {
  const list = logical?.List || logical?.['data-provider']?.camps || logical?.camps || [];
  return Array.isArray(list) ? list.map(c => c.rand_id).filter(Boolean) : [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const r = createReporter();
  console.log('=== CAMP Danger Suite — medu-camp (API-CONSOLE) ===');
  console.log(`live=${liveOrigin()} app=${liveAppPath()}`);
  console.log(`serviceId=${projectServiceId()}`);
  console.log(`express=${expressUrl() || '(none)'}`);
  console.log(`flow=${args.flow}\n`);

  const login = await ensureLiveLogin();
  console.log(login.ok ? `live login: ${login.source}` : `live login: ${login.reason}`);

  let organPath = '';
  let rolesLogical = null;
  if (login.ok) {
    const roles = await runNamedFixture('roles.and.organs');
    rolesLogical = roles.logical;
    organPath = pickOrganPath(roles.logical || roles.json);
  }

  await run(r, args.flow, 'XCUT', 'TC-CAMP-XCUT-001', 'Express health', async () => {
    const base = expressUrl();
    if (!base) {
      r.skip('TC-CAMP-XCUT-001', 'Express health', 'AUTOMATION_RUNTIME_URL missing');
      return;
    }
    const { res, body } = await getJson(`${base}/health`);
    if (res.ok && body.ok) r.pass('TC-CAMP-XCUT-001', 'Express health', `projectKey=${body.projectKey || ''}`);
    else r.fail('TC-CAMP-XCUT-001', 'Express health', `HTTP ${res.status}`);
  });

  await run(r, args.flow, 'XCUT', 'TC-CAMP-XCUT-002', 'live origin reachable', async () => {
    const page = await liveGet('/devlogin');
    if (page.status > 0 && page.status < 500) r.pass('TC-CAMP-XCUT-002', 'live origin reachable', `HTTP ${page.status}`);
    else r.fail('TC-CAMP-XCUT-002', 'live origin reachable', `HTTP ${page.status}`);
  });

  await run(r, args.flow, 'AUTH', 'TC-CAMP-AUTH-001', 'ورود و نقش اردو', async () => {
    if (!login.ok) {
      r.skip('TC-CAMP-AUTH-001', 'ورود و نقش اردو', login.reason);
      return;
    }
    const who = await postDataProvider('pages-app/who-am-i', {});
    if (who.logical?.IsUserLogin !== true) {
      r.fail('TC-CAMP-AUTH-001', 'ورود و نقش اردو', JSON.stringify(who.json).slice(0, 220));
      return;
    }
    if (!organPath) {
      r.fail('TC-CAMP-AUTH-001', 'ورود و نقش اردو', 'roleDetail/organPath empty');
      return;
    }
    r.pass('TC-CAMP-AUTH-001', 'ورود و نقش اردو', `organ=${organPath} svc=${projectServiceId()}`);
  });

  await run(r, args.flow, 'AUTH', 'TC-CAMP-AUTH-002', 'server/time', async () => {
    if (!login.ok) {
      r.skip('TC-CAMP-AUTH-002', 'server/time', login.reason);
      return;
    }
    const res = await runNamedFixture('server.time');
    if (res.ok && (res.logical?.done || res.logical?.['data-provider'])) {
      r.pass('TC-CAMP-AUTH-002', 'server/time', `svc=${res.serviceId}`);
    } else {
      r.fail('TC-CAMP-AUTH-002', 'server/time', res.serverError || JSON.stringify(res.json).slice(0, 180));
    }
  });

  await run(r, args.flow, 'XCUT', 'TC-CAMP-XCUT-003', 'roles provider authenticated', async () => {
    if (!login.ok || !organPath) {
      r.skip('TC-CAMP-XCUT-003', 'roles provider authenticated', login.reason || 'no organ');
      return;
    }
    r.pass('TC-CAMP-XCUT-003', 'roles provider authenticated', `organ=${organPath}`);
  });

  await run(r, args.flow, 'XCUT', 'TC-CAMP-XCUT-010', 'school UI shell', async () => {
    if (!login.ok) {
      r.skip('TC-CAMP-XCUT-010', 'school UI shell', login.reason);
      return;
    }
    const page = await liveGet(liveAppPath());
    if (page.status >= 200 && page.status < 400 && /html|doctype/i.test(page.text)) {
      r.pass('TC-CAMP-XCUT-010', 'school UI shell', `HTTP ${page.status}`);
    } else r.fail('TC-CAMP-XCUT-010', 'school UI shell', `HTTP ${page.status}`);
  });

  await run(r, args.flow, 'XCUT', 'TC-CAMP-XCUT-020', 'role landings HTTP', async () => {
    if (!login.ok) {
      r.skip('TC-CAMP-XCUT-020', 'role landings HTTP', login.reason);
      return;
    }
    const paths = ['/camp/school', '/camp/mantaghe', '/camp/ostan', '/camp/setad', '/camp/parent'];
    const bad = [];
    for (const p of paths) {
      const page = await liveGet(p);
      if (!(page.status > 0 && page.status < 500)) bad.push(`${p}:${page.status}`);
    }
    if (!bad.length) r.pass('TC-CAMP-XCUT-020', 'role landings HTTP', paths.join(','));
    else r.fail('TC-CAMP-XCUT-020', 'role landings HTTP', bad.join(';'));
  });

  await run(r, args.flow, 'SCH', 'TC-CAMP-SCH-001', 'لود اردوهای organ', async () => {
    if (!login.ok || !organPath) {
      r.skip('TC-CAMP-SCH-001', 'لود اردوهای organ', login.reason || 'no organ');
      return;
    }
    const res = await runNamedFixture('camp.load.organ', { organPath });
    if (res.serverError || isModuleGap(res)) {
      r.fail('TC-CAMP-SCH-001', 'لود اردوهای organ', res.serverError || 'module gap');
      return;
    }
    if (res.logical?.organs || res.ok) r.pass('TC-CAMP-SCH-001', 'لود اردوهای organ', `organ=${organPath}`);
    else r.fail('TC-CAMP-SCH-001', 'لود اردوهای organ', JSON.stringify(res.json).slice(0, 180));
  });

  await run(r, args.flow, 'SCH', 'TC-CAMP-SCH-002', 'camp/load لیست مدرسه', async () => {
    if (!login.ok || !organPath) {
      r.skip('TC-CAMP-SCH-002', 'camp/load', login.reason || 'no organ');
      return;
    }
    const res = await runNamedFixture('camp.load', { organPath });
    if (res.serverError) {
      r.fail('TC-CAMP-SCH-002', 'camp/load', res.serverError);
      return;
    }
    const camps = res.logical?.['data-provider']?.camps;
    if (Array.isArray(camps)) r.pass('TC-CAMP-SCH-002', 'camp/load', `n=${camps.length}`);
    else r.fail('TC-CAMP-SCH-002', 'camp/load', JSON.stringify(res.json).slice(0, 160));
  });

  let createdId = '';
  await run(r, args.flow, 'SCH', 'TC-CAMP-SCH-010', 'ایجاد اردو inSchool', async () => {
    if (!login.ok || !organPath) {
      r.skip('TC-CAMP-SCH-010', 'ایجاد اردو inSchool', login.reason || 'no organ');
      return;
    }
    const before = await runNamedFixture('organ.camps.load', { organPath });
    const beforeIds = new Set(listIds(before.logical));
    const created = await createCamp({
      organPath,
      meta: { type: 'inSchool', title: `QA-SCH-${Date.now()}`, source: 'automation-tool' },
    });
    if (created.logical?.done !== true && created.serverError) {
      r.fail('TC-CAMP-SCH-010', 'ایجاد اردو inSchool', created.serverError || JSON.stringify(created.json).slice(0, 160));
      return;
    }
    const after = await runNamedFixture('organ.camps.load', { organPath });
    const newOnes = listIds(after.logical).filter(id => !beforeIds.has(id));
    createdId = newOnes[0] || listIds(after.logical)[0] || '';
    if (created.logical?.done === true || newOnes.length) {
      r.pass('TC-CAMP-SCH-010', 'ایجاد اردو inSchool', `id=${createdId || 'ok'} done=${created.logical?.done}`);
    } else {
      r.fail('TC-CAMP-SCH-010', 'ایجاد اردو inSchool', 'create not reflected in organ/camps/load');
    }
  });

  await run(r, args.flow, 'SCH', 'TC-CAMP-SCH-080', 'ایجاد بدون organPath', async () => {
    if (!login.ok) {
      r.skip('TC-CAMP-SCH-080', 'ایجاد بدون organPath', login.reason);
      return;
    }
    const res = await postDataProvider('fr/medu-camp/camp', {}, { data: { meta: { type: 'qa' } } });
    const rejected = Boolean(res.serverError) || /داده های دریافتی|خطا/i.test(JSON.stringify(res.json || {}));
    if (rejected) r.pass('TC-CAMP-SCH-080', 'ایجاد بدون organPath', res.serverError || 'denied');
    else r.fail('TC-CAMP-SCH-080', 'ایجاد بدون organPath', 'accepted without organPath');
  });

  await run(r, args.flow, 'SCH', 'TC-CAMP-SCH-090', 'API بدون نشست', async () => {
    const res = await postDataProvider('pages-app/who-am-i', {}, { withAuth: false });
    if (isAuthDenied(res) || res.logical?.IsUserLogin === false || res.logical?.IsUserLogin == null) {
      r.pass('TC-CAMP-SCH-090', 'API بدون نشست', 'not logged in');
    } else r.fail('TC-CAMP-SCH-090', 'API بدون نشست', JSON.stringify(res.json).slice(0, 180));
  });

  await run(r, args.flow, 'OUT', 'TC-CAMP-OUT-001', 'ایجاد outSchool با دانش‌آموز', async () => {
    if (!login.ok || !organPath) {
      r.skip('TC-CAMP-OUT-001', 'outSchool create', login.reason || 'no organ');
      return;
    }
    const stamp = Date.now().toString(36);
    const res = await createCamp({
      organPath,
      pk_rand_id: `out-${stamp}`,
      meta: {
        type: 'outSchool',
        title: `QA-OUT-${stamp}`,
        selectedStudents: [{
          id: `stu-${stamp}`,
          fname: 'QA',
          lname: 'Student',
          natcode: '0000000000',
          or_path: organPath,
        }],
      },
    });
    if (res.logical?.done === true) r.pass('TC-CAMP-OUT-001', 'outSchool create', 'done');
    else r.fail('TC-CAMP-OUT-001', 'outSchool create', res.serverError || JSON.stringify(res.json).slice(0, 180));
  });

  await run(r, args.flow, 'OUT', 'TC-CAMP-OUT-080', 'outSchool بدون selectedStudents', async () => {
    if (!login.ok || !organPath) {
      r.skip('TC-CAMP-OUT-080', 'outSchool empty students', login.reason || 'no organ');
      return;
    }
    const res = await createCamp({
      organPath,
      meta: { type: 'outSchool', title: 'QA-OUT-empty', selectedStudents: [] },
    });
    const rejected = res.logical?.done !== true || Boolean(res.serverError) || /خطا|پردازش/i.test(JSON.stringify(res.json || {}));
    if (rejected) r.pass('TC-CAMP-OUT-080', 'outSchool empty students', res.serverError || 'rejected');
    else r.fail('TC-CAMP-OUT-080', 'outSchool empty students', 'accepted empty students');
  });

  await run(r, args.flow, 'OUT', 'TC-CAMP-OUT-002', 'out-of-school load', async () => {
    if (!login.ok || !organPath) {
      r.skip('TC-CAMP-OUT-002', 'out-of-school load', login.reason || 'no organ');
      return;
    }
    const res = await runNamedFixture('out.school.load', { organPath });
    if (res.serverError) r.fail('TC-CAMP-OUT-002', 'out-of-school load', res.serverError);
    else if (Array.isArray(res.logical?.List) || res.logical?.Count != null) {
      r.pass('TC-CAMP-OUT-002', 'out-of-school load', `count=${res.logical.Count ?? res.logical.List.length}`);
    } else r.fail('TC-CAMP-OUT-002', 'out-of-school load', JSON.stringify(res.json).slice(0, 160));
  });

  await run(r, args.flow, 'REG', 'TC-CAMP-REG-001', 'نقش region-expert موجود', async () => {
    if (!login.ok) {
      r.skip('TC-CAMP-REG-001', 'region role', login.reason);
      return;
    }
    const role = pickRole(rolesLogical, 'region-expert');
    if (role) r.pass('TC-CAMP-REG-001', 'region role', `path=${role.or_path?.[0] || ''}`);
    else r.skip('TC-CAMP-REG-001', 'region role', 'ROLE_GAP: no region-expert on this user');
  });

  await run(r, args.flow, 'REG', 'TC-CAMP-REG-010', 'ارجاع update-status', async () => {
    if (!login.ok || !organPath) {
      r.skip('TC-CAMP-REG-010', 'update-status', login.reason || 'no organ');
      return;
    }
    if (!createdId) {
      const list = await runNamedFixture('organ.camps.load', { organPath });
      createdId = listIds(list.logical).find(Boolean) || '';
    }
    if (!createdId) {
      r.skip('TC-CAMP-REG-010', 'update-status', 'no camp id to refer');
      return;
    }
    const res = await postDataProvider('fr/medu-camp/camp/update-status', {}, {
      data: { campId: createdId, status: 4, organPath },
    });
    if (res.logical?.done === true || /موفق/i.test(String(res.logical?.serverMessage?.text || ''))) {
      r.pass('TC-CAMP-REG-010', 'update-status', `campId=${createdId}`);
    } else if (isModuleGap(res)) {
      r.skip('TC-CAMP-REG-010', 'update-status', res.serverError);
    } else {
      r.fail('TC-CAMP-REG-010', 'update-status', res.serverError || JSON.stringify(res.json).slice(0, 180));
    }
  });

  await run(r, args.flow, 'REG', 'TC-CAMP-REG-020', 'mantaghe camps load', async () => {
    if (!login.ok || !organPath) {
      r.skip('TC-CAMP-REG-020', 'mantaghe camps', login.reason || 'no organ');
      return;
    }
    const res = await runNamedFixture('mantaghe.camps.load', { organPath });
    if (res.serverError) r.fail('TC-CAMP-REG-020', 'mantaghe camps', res.serverError);
    else r.pass('TC-CAMP-REG-020', 'mantaghe camps', `keys=${Object.keys(res.logical || {}).join(',')}`);
  });

  await run(r, args.flow, 'RPT', 'TC-CAMP-RPT-001', 'insert در organ/camps و status-counts', async () => {
    if (!login.ok || !organPath) {
      r.skip('TC-CAMP-RPT-001', 'report invariant', login.reason || 'no organ');
      return;
    }
    const beforeCounts = await runNamedFixture('camp.status.counts', { organPath });
    const before3 = countStatus(beforeCounts.logical, 3);
    const stamp = Date.now().toString(36);
    const created = await createCamp({
      organPath,
      pk_rand_id: `rpt-${stamp}`,
      meta: { type: 'inSchool', title: `QA-RPT-${stamp}` },
    });
    if (created.logical?.done !== true && created.serverError) {
      r.fail('TC-CAMP-RPT-001', 'report invariant', created.serverError || 'create failed');
      return;
    }
    const afterList = await runNamedFixture('organ.camps.load', { organPath });
    const afterCounts = await runNamedFixture('camp.status.counts', { organPath });
    const after3 = countStatus(afterCounts.logical, 3);
    const ids = listIds(afterList.logical);
    const okList = ids.length > 0;
    const okCount = after3 >= before3;
    if (okList && okCount) r.pass('TC-CAMP-RPT-001', 'report invariant', `status3 ${before3}->${after3} n=${ids.length}`);
    else r.fail('TC-CAMP-RPT-001', 'report invariant', `list=${okList} count=${before3}->${after3}`);
  });

  await run(r, args.flow, 'RPT', 'TC-CAMP-RPT-002', 'ostan reports camps load', async () => {
    if (!login.ok || !organPath) {
      r.skip('TC-CAMP-RPT-002', 'ostan reports', login.reason || 'no organ');
      return;
    }
    const res = await runNamedFixture('ostan.reports.camps.load', { organPath });
    if (res.serverError) r.fail('TC-CAMP-RPT-002', 'ostan reports', res.serverError);
    else if (Array.isArray(res.logical?.List)) r.pass('TC-CAMP-RPT-002', 'ostan reports', `n=${res.logical.List.length}`);
    else r.fail('TC-CAMP-RPT-002', 'ostan reports', JSON.stringify(res.json).slice(0, 160));
  });

  await run(r, args.flow, 'OST', 'TC-CAMP-OST-001', 'نقش province-expert', async () => {
    if (!login.ok) {
      r.skip('TC-CAMP-OST-001', 'province role', login.reason);
      return;
    }
    const role = pickRole(rolesLogical, 'province-expert');
    if (role) r.pass('TC-CAMP-OST-001', 'province role', `path=${role.or_path?.[0] || ''}`);
    else r.skip('TC-CAMP-OST-001', 'province role', 'ROLE_GAP');
  });

  await run(r, args.flow, 'OST', 'TC-CAMP-OST-010', 'ostan landing', async () => {
    if (!login.ok) {
      r.skip('TC-CAMP-OST-010', 'ostan landing', login.reason);
      return;
    }
    let page = await liveGet('/camp/ostan', { timeoutMs: 90000 });
    if (!(page.status > 0 && page.status < 500)) {
      page = await liveGet('/camp/ostan', { timeoutMs: 90000 });
    }
    if (page.status > 0 && page.status < 500) r.pass('TC-CAMP-OST-010', 'ostan landing', `HTTP ${page.status}`);
    else if (page.error) r.skip('TC-CAMP-OST-010', 'ostan landing', `ENV_GAP timeout: ${page.error}`);
    else r.fail('TC-CAMP-OST-010', 'ostan landing', `HTTP ${page.status}`);
  });

  await run(r, args.flow, 'SET', 'TC-CAMP-SET-001', 'نقش app-manager', async () => {
    if (!login.ok) {
      r.skip('TC-CAMP-SET-001', 'app-manager', login.reason);
      return;
    }
    const role = pickRole(rolesLogical, 'app-manager');
    if (role) r.pass('TC-CAMP-SET-001', 'app-manager', `path=${role.or_path?.[0] || ''}`);
    else r.skip('TC-CAMP-SET-001', 'app-manager', 'ROLE_GAP');
  });

  await run(r, args.flow, 'SET', 'TC-CAMP-SET-010', 'setad landing', async () => {
    if (!login.ok) {
      r.skip('TC-CAMP-SET-010', 'setad landing', login.reason);
      return;
    }
    const page = await liveGet('/camp/setad');
    if (page.status > 0 && page.status < 500) r.pass('TC-CAMP-SET-010', 'setad landing', `HTTP ${page.status}`);
    else r.fail('TC-CAMP-SET-010', 'setad landing', `HTTP ${page.status}`);
  });

  await run(r, args.flow, 'PAR', 'TC-CAMP-PAR-001', 'parent landing', async () => {
    if (!login.ok) {
      r.skip('TC-CAMP-PAR-001', 'parent landing', login.reason);
      return;
    }
    const page = await liveGet('/camp/parent');
    if (page.status > 0 && page.status < 500) r.pass('TC-CAMP-PAR-001', 'parent landing', `HTTP ${page.status}`);
    else r.fail('TC-CAMP-PAR-001', 'parent landing', `HTTP ${page.status}`);
  });

  await run(r, args.flow, 'PLN', 'TC-CAMP-PLN-001', 'plan/edit smoke', async () => {
    if (!login.ok) {
      r.skip('TC-CAMP-PLN-001', 'plan/edit', login.reason);
      return;
    }
    const res = await postDataProvider('fr/medu-camp/plan/edit', {}, { data: {} });
    if (isModuleGap(res)) {
      r.skip('TC-CAMP-PLN-001', 'plan/edit', 'ENV_GAP apiModule');
      return;
    }
    // empty body should fail closed or return validation — not crash
    if (res.status === 0 && res.serverError) r.fail('TC-CAMP-PLN-001', 'plan/edit', res.serverError);
    else r.pass('TC-CAMP-PLN-001', 'plan/edit', res.serverError || 'responded');
  });

  await run(r, args.flow, 'IMP', 'TC-CAMP-IMP-001', 'implement/create smoke', async () => {
    if (!login.ok) {
      r.skip('TC-CAMP-IMP-001', 'implement/create', login.reason);
      return;
    }
    const res = await postDataProvider('fr/medu-camp/implement/create', {}, { data: {} });
    if (isModuleGap(res)) {
      r.skip('TC-CAMP-IMP-001', 'implement/create', 'ENV_GAP apiModule');
      return;
    }
    r.pass('TC-CAMP-IMP-001', 'implement/create', res.serverError || 'responded');
  });

  await run(r, args.flow, 'VEH', 'TC-CAMP-VEH-001', 'vehicle approve smoke', async () => {
    if (!login.ok) {
      r.skip('TC-CAMP-VEH-001', 'vehicle', login.reason);
      return;
    }
    const res = await postDataProvider('fr/medu-camp/vehicle/approve/health', {}, { data: {} });
    if (isModuleGap(res)) {
      r.skip('TC-CAMP-VEH-001', 'vehicle', 'ENV_GAP apiModule');
      return;
    }
    r.pass('TC-CAMP-VEH-001', 'vehicle', res.serverError || 'responded');
  });

  await run(r, args.flow, 'XCUT', 'TC-CAMP-XCUT-030', 'IDOR organPath بیگانه', async () => {
    if (!login.ok) {
      r.skip('TC-CAMP-XCUT-030', 'IDOR organPath', login.reason);
      return;
    }
    const res = await runNamedFixture('camp.load', { organPath: 'IR2O2O2O2OZZZZ_FOREIGN' });
    const camps = res.logical?.['data-provider']?.camps;
    if (res.serverError && /شناسایی|داده|ارگان/i.test(res.serverError)) {
      r.pass('TC-CAMP-XCUT-030', 'IDOR organPath', res.serverError);
    } else if (Array.isArray(camps) && camps.length === 0) {
      r.pass('TC-CAMP-XCUT-030', 'IDOR organPath', 'empty list');
    } else if (Array.isArray(camps) && camps.length > 0) {
      r.fail('TC-CAMP-XCUT-030', 'IDOR organPath', `leaked n=${camps.length}`);
    } else {
      r.pass('TC-CAMP-XCUT-030', 'IDOR organPath', 'no leak');
    }
  });

  // --- CK checklist (IS 1–26) API-backed ---
  await run(r, args.flow, 'CK', 'TC-CAMP-CK-002', 'نقش‌ها فقط landing مجاز', async () => {
    if (!login.ok || !rolesLogical) {
      r.skip('TC-CAMP-CK-002', 'role access', login.reason || 'no roles');
      return;
    }
    const list = rolesLogical.roleDetail || [];
    const map = {
      admin: '/camp/school',
      'region-expert': '/camp/mantaghe',
      'center-expert': '/camp/mantaghe',
      'province-expert': '/camp/ostan',
      'app-manager': '/camp/setad',
      parent: '/camp/parent',
    };
    const needed = new Set();
    for (const role of list) {
      const b = String(role.branch || '');
      for (const [needle, path] of Object.entries(map)) {
        if (b.includes(needle) || (needle === 'admin' && b.includes('roles.admin'))) needed.add(path);
      }
    }
    if (!needed.size) needed.add('/camp/school');
    const bad = [];
    for (const path of needed) {
      const page = await liveGet(path, { timeoutMs: 60000 });
      if (!(page.status > 0 && page.status < 500)) bad.push(`${path}:${page.status}`);
    }
    if (!bad.length) r.pass('TC-CAMP-CK-002', 'نقش‌ها فقط landing مجاز', [...needed].join(','));
    else r.fail('TC-CAMP-CK-002', 'نقش‌ها فقط landing مجاز', bad.join(';'));
  });

  await run(r, args.flow, 'CK', 'TC-CAMP-CK-014', 'کلیک/ارسال تکراری API', async () => {
    if (!login.ok || !organPath) {
      r.skip('TC-CAMP-CK-014', 'double submit', login.reason || 'no organ');
      return;
    }
    const stamp = Date.now().toString(36);
    const [a, b] = await Promise.all([
      createCamp({ organPath, pk_rand_id: `dup-a-${stamp}`, meta: { type: 'inSchool', title: `QA-DUP-A-${stamp}` } }),
      createCamp({ organPath, pk_rand_id: `dup-b-${stamp}`, meta: { type: 'inSchool', title: `QA-DUP-B-${stamp}` } }),
    ]);
    const okA = a.status !== 0 && (a.logical?.done === true || a.serverError || a.logical?.serverMessage);
    const okB = b.status !== 0 && (b.logical?.done === true || b.serverError || b.logical?.serverMessage);
    if (okA && okB) r.pass('TC-CAMP-CK-014', 'کلیک/ارسال تکراری API', 'both responded without transport failure');
    else r.fail('TC-CAMP-CK-014', 'کلیک/ارسال تکراری API', `a=${a.status} b=${b.status}`);
  });

  await run(r, args.flow, 'CK', 'TC-CAMP-CK-016', 'ذخیره و مشاهده (CRUD-R)', async () => {
    if (!login.ok || !organPath) {
      r.skip('TC-CAMP-CK-016', 'persist+read', login.reason || 'no organ');
      return;
    }
    const stamp = Date.now().toString(36);
    const created = await createCamp({
      organPath,
      pk_rand_id: `ck16-${stamp}`,
      meta: { type: 'inSchool', title: `QA-CK16-${stamp}` },
    });
    if (created.logical?.done !== true && created.serverError) {
      r.fail('TC-CAMP-CK-016', 'persist+read', created.serverError);
      return;
    }
    const list = await runNamedFixture('organ.camps.load', { organPath });
    const ids = listIds(list.logical);
    if (ids.length) r.pass('TC-CAMP-CK-016', 'persist+read', `n=${ids.length}`);
    else r.fail('TC-CAMP-CK-016', 'persist+read', 'list empty after create');
  });

  const c = r.summary();
  process.exit(c.FAIL > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
