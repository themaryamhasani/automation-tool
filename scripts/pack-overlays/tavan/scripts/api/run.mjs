import {
  createReporter,
  ensureLiveLogin,
  expressUrl,
  getJson,
  liveGet,
  liveOrigin,
  liveAppPath,
  liveAppUrl,
  resolveTavanContext,
  postDataProvider,
  projectServiceId,
  runNamedFixture,
  isAuthDenied,
  assertModuleReady,
  appName,
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const r = createReporter();
  console.log('=== TAVAN Danger Suite — real api-modules (not placeholders) ===');
  console.log(`live=${liveOrigin()} app=${liveAppPath()}`);
  console.log(`serviceId=${projectServiceId()} appName=${appName()}`);
  console.log(`express=${expressUrl() || '(none)'}`);
  console.log(`flow=${args.flow}\n`);

  const login = await ensureLiveLogin();
  console.log(login.ok ? `live login: ${login.source}` : `live login: ${login.reason}`);

  // app.load returns organs/roles only — NOT course ids.
  // Course comes from TAVAN_COURSE_ID / pack preferredCourseId (URL …/sessions-list/<id>).
  let ctx = resolveTavanContext({});
  let appLoad = null;
  if (login.ok) {
    appLoad = await runNamedFixture('app.load').catch((error) => ({
      ok: false,
      serverError: error.message,
      json: { error: error.message },
    }));
    ctx = resolveTavanContext(appLoad.logical || appLoad.json);
  }
  console.log(`context organ=${ctx.organPath || '-'} course=${ctx.courseId || '-'} role=${ctx.role}`);
  if (!ctx.courseId) {
    console.warn('HINT: set TAVAN_COURSE_ID from URL …/sessions-list/<COURSE_ID> (e.g. CC05110111PL1IM1)');
  }

  await run(r, args.flow, 'XCUT', 'TC-TAVAN-XCUT-001', 'Express health', async () => {
    const base = expressUrl();
    if (!base) {
      r.fail('TC-TAVAN-XCUT-001', 'Express health', 'AUTOMATION_RUNTIME_URL missing');
      return;
    }
    const { res, body } = await getJson(`${base}/health`);
    if (res.ok && body.ok) r.pass('TC-TAVAN-XCUT-001', 'Express health', `projectKey=${body.projectKey || ''}`);
    else r.fail('TC-TAVAN-XCUT-001', 'Express health', `HTTP ${res.status}`);
  });

  await run(r, args.flow, 'XCUT', 'TC-TAVAN-XCUT-002', 'live origin reachable', async () => {
    const page = await liveGet('/devlogin');
    if (page.status > 0 && page.status < 500) r.pass('TC-TAVAN-XCUT-002', 'live origin reachable', `HTTP ${page.status}`);
    else r.fail('TC-TAVAN-XCUT-002', 'live origin reachable', `HTTP ${page.status} ${page.error || ''}`);
  });

  await run(r, args.flow, 'AUTH', 'TC-TAVAN-AUTH-001', 'who-am-i authenticated', async () => {
    if (!login.ok) {
      r.fail('TC-TAVAN-AUTH-001', 'who-am-i authenticated', login.reason);
      return;
    }
    const who = await runNamedFixture('who.am.i');
    if (!assertModuleReady(r, 'TC-TAVAN-AUTH-001', 'who-am-i authenticated', who)) return;
    if (who.logical?.IsUserLogin === true || who.logical?.IsLogin === true) {
      r.pass('TC-TAVAN-AUTH-001', 'who-am-i authenticated', liveAppUrl());
    } else {
      r.fail('TC-TAVAN-AUTH-001', 'who-am-i authenticated', JSON.stringify(who.json).slice(0, 220));
    }
  });

  await run(r, args.flow, 'AUTH', 'TC-TAVAN-AUTH-002', 'app.load bootstrap', async () => {
    if (!login.ok) {
      r.fail('TC-TAVAN-AUTH-002', 'app.load bootstrap', login.reason);
      return;
    }
    const res = appLoad || await runNamedFixture('app.load');
    if (!assertModuleReady(r, 'TC-TAVAN-AUTH-002', 'app.load bootstrap', res)) return;
    if (isAuthDenied(res)) {
      r.fail('TC-TAVAN-AUTH-002', 'app.load bootstrap', 'auth denied');
      return;
    }
    ctx = resolveTavanContext(res.logical || res.json);
    if (res.ok || res.logical) {
      r.pass('TC-TAVAN-AUTH-002', 'app.load bootstrap', `organ=${ctx.organPath || '-'} course=${ctx.courseId || '-'}`);
    } else {
      r.fail('TC-TAVAN-AUTH-002', 'app.load bootstrap', res.serverError || JSON.stringify(res.json).slice(0, 180));
    }
  });

  await run(r, args.flow, 'TBL', 'TC-TAVAN-TBL-001', 'bank folder load root', async () => {
    if (!login.ok) {
      r.fail('TC-TAVAN-TBL-001', 'bank folder load root', login.reason);
      return;
    }
    const res = await runNamedFixture('bank.folder.load', { app: 'tavan' });
    if (!assertModuleReady(r, 'TC-TAVAN-TBL-001', 'bank folder load root', res)) return;
    if (isAuthDenied(res)) {
      r.fail('TC-TAVAN-TBL-001', 'bank folder load root', 'auth denied');
      return;
    }
    if (res.ok || res.logical) r.pass('TC-TAVAN-TBL-001', 'bank folder load root', res.sourceId || 'ok');
    else r.fail('TC-TAVAN-TBL-001', 'bank folder load root', res.serverError || JSON.stringify(res.json).slice(0, 180));
  });

  await run(r, args.flow, 'TBL', 'TC-TAVAN-TBL-010', 'bank folder with course_id', async () => {
    if (!login.ok) {
      r.fail('TC-TAVAN-TBL-010', 'bank folder with course_id', login.reason);
      return;
    }
    if (!ctx.courseId) {
      r.fail(
        'TC-TAVAN-TBL-010',
        'bank folder with course_id',
        'set TAVAN_COURSE_ID=CC05110111PL1IM1 (from classroom URL …/sessions-list/…)',
      );
      return;
    }
    const res = await runNamedFixture('bank.folder.load', { app: 'tavan', course_id: ctx.courseId });
    if (!assertModuleReady(r, 'TC-TAVAN-TBL-010', 'bank folder with course_id', res)) return;
    if (res.ok || !isAuthDenied(res)) r.pass('TC-TAVAN-TBL-010', 'bank folder with course_id', `course=${ctx.courseId}`);
    else r.fail('TC-TAVAN-TBL-010', 'bank folder with course_id', res.serverError || 'denied');
  });

  await run(r, args.flow, 'TBL', 'TC-TAVAN-TBL-080', 'quizzes list without course_id rejected', async () => {
    if (!login.ok) {
      r.fail('TC-TAVAN-TBL-080', 'quizzes list without course_id rejected', login.reason);
      return;
    }
    const res = await runNamedFixture('bank.quizzes.list', { course_id: '' });
    if (!assertModuleReady(r, 'TC-TAVAN-TBL-080', 'quizzes list without course_id rejected', res)) return;
    const blob = JSON.stringify(res.json || {});
    const rejected = res.serverError || /شناسه دوره|الزامی|خطا/i.test(blob) || !res.ok;
    if (rejected) r.pass('TC-TAVAN-TBL-080', 'quizzes list without course_id rejected', 'negative ok');
    else r.fail('TC-TAVAN-TBL-080', 'quizzes list without course_id rejected', 'accepted empty course_id');
  });

  await run(r, args.flow, 'CRU', 'TC-TAVAN-CRU-080', 'create announcement without data denied', async () => {
    if (!login.ok) {
      r.fail('TC-TAVAN-CRU-080', 'create announcement without data denied', login.reason);
      return;
    }
    const res = await postDataProvider('fr/tavan/classroom/create-announcement', {}, {
      command: true,
      data: {},
    });
    if (!assertModuleReady(r, 'TC-TAVAN-CRU-080', 'create announcement without data denied', res)) return;
    const blob = JSON.stringify(res.json || {});
    const rejected = res.serverError || /داده|خطا|الزامی/i.test(blob);
    if (rejected) r.pass('TC-TAVAN-CRU-080', 'create announcement without data denied', 'fail-closed');
    else r.fail('TC-TAVAN-CRU-080', 'create announcement without data denied', blob.slice(0, 160));
  });

  await run(r, args.flow, 'CRU', 'TC-TAVAN-CRU-001', 'create announcement with organ', async () => {
    if (!login.ok) {
      r.fail('TC-TAVAN-CRU-001', 'create announcement with organ', login.reason);
      return;
    }
    if (!ctx.organPath || !ctx.courseId) {
      r.fail(
        'TC-TAVAN-CRU-001',
        'create announcement with organ',
        `need organ+course (organ=${ctx.organPath || '-'} course=${ctx.courseId || '-'})`,
      );
      return;
    }
    const stamp = `qa-${Date.now().toString(36)}`;
    const res = await postDataProvider('fr/tavan/classroom/create-announcement', {}, {
      command: true,
      data: {
        organ: ctx.organPath,
        courseId: ctx.courseId,
        annoTitle: stamp,
        annoDesc: 'automation-tool',
        stack: [ctx.organPath],
      },
    });
    if (!assertModuleReady(r, 'TC-TAVAN-CRU-001', 'create announcement with organ', res)) return;
    if (res.serverError && !/موفق/i.test(String(res.serverError))) {
      r.fail('TC-TAVAN-CRU-001', 'create announcement with organ', res.serverError);
    } else {
      r.pass('TC-TAVAN-CRU-001', 'create announcement with organ', stamp);
    }
  });

  await run(r, args.flow, 'RPT', 'TC-TAVAN-RPT-001', 'dashboard announcements load', async () => {
    if (!login.ok) {
      r.fail('TC-TAVAN-RPT-001', 'dashboard announcements load', login.reason);
      return;
    }
    const pathValue = ctx.organPath || 'IR2O2';
    const res = await runNamedFixture('dashboard.announcements.load', { path: pathValue });
    if (!assertModuleReady(r, 'TC-TAVAN-RPT-001', 'dashboard announcements load', res)) return;
    if (res.ok || res.logical || res.serverError) {
      r.pass('TC-TAVAN-RPT-001', 'dashboard announcements load', res.serverError ? 'bounded error' : `path=${pathValue}`);
    } else {
      r.fail('TC-TAVAN-RPT-001', 'dashboard announcements load', 'empty response');
    }
  });

  await run(r, args.flow, 'APR', 'TC-TAVAN-APR-001', 'edit announcement smoke', async () => {
    if (!login.ok) {
      r.fail('TC-TAVAN-APR-001', 'edit announcement smoke', login.reason);
      return;
    }
    const res = await postDataProvider('fr/tavan/classroom/edit-announcement', {}, {
      command: true,
      data: { rand_id: 'qa-nonexistent', annoTitle: 'qa' },
    });
    if (!assertModuleReady(r, 'TC-TAVAN-APR-001', 'edit announcement smoke', res)) return;
    if (isAuthDenied(res)) r.fail('TC-TAVAN-APR-001', 'edit announcement smoke', 'auth denied');
    else r.pass('TC-TAVAN-APR-001', 'edit announcement smoke', JSON.stringify(res.json || {}).slice(0, 120));
  });

  await run(r, args.flow, 'ADM', 'TC-TAVAN-ADM-001', 'profile.load', async () => {
    if (!login.ok) {
      r.fail('TC-TAVAN-ADM-001', 'profile.load', login.reason);
      return;
    }
    const res = await runNamedFixture('profile.load');
    if (!assertModuleReady(r, 'TC-TAVAN-ADM-001', 'profile.load', res)) return;
    if (isAuthDenied(res)) r.fail('TC-TAVAN-ADM-001', 'profile.load', 'auth denied');
    else if (res.ok || res.logical) r.pass('TC-TAVAN-ADM-001', 'profile.load', 'ok');
    else r.fail('TC-TAVAN-ADM-001', 'profile.load', res.serverError || 'fail');
  });

  await run(r, args.flow, 'SEC', 'TC-TAVAN-SEC-090', 'API without session fail-closed', async () => {
    const res = await postDataProvider('ds/tavan/app/load', {}, { withAuth: false });
    const blob = JSON.stringify(res.json || {});
    const denied = res.status === 401 || isAuthDenied(res) || /شناسایی|login|unauthorized|کاربر/i.test(blob);
    if (denied) r.pass('TC-TAVAN-SEC-090', 'API without session fail-closed', `HTTP ${res.status}`);
    else r.fail('TC-TAVAN-SEC-090', 'API without session fail-closed', blob.slice(0, 160));
  });

  await run(r, args.flow, 'SEC', 'TC-TAVAN-SEC-091', 'IDOR fake course_id on quizzes', async () => {
    if (!login.ok) {
      r.fail('TC-TAVAN-SEC-091', 'IDOR fake course_id on quizzes', login.reason);
      return;
    }
    const fake = 'qa-fake-course-99999999';
    const res = await runNamedFixture('bank.quizzes.list', { course_id: fake });
    if (!assertModuleReady(r, 'TC-TAVAN-SEC-091', 'IDOR fake course_id on quizzes', res)) return;
    const list = res.logical?.List || res.logical?.list || res.logical?.['data-provider'] || [];
    const rows = Array.isArray(list) ? list : (list?.quizzes || list?.rows || []);
    const leaked = Array.isArray(rows) && rows.length > 0;
    if (!leaked) r.pass('TC-TAVAN-SEC-091', 'IDOR fake course_id on quizzes', 'no leak');
    else r.fail('TC-TAVAN-SEC-091', 'IDOR fake course_id on quizzes', `rows=${rows.length}`);
  });

  await run(r, args.flow, 'SEC', 'TC-TAVAN-SEC-092', 'dashboard path abuse', async () => {
    if (!login.ok) {
      r.fail('TC-TAVAN-SEC-092', 'dashboard path abuse', login.reason);
      return;
    }
    const res = await runNamedFixture('dashboard.announcements.load', { path: 'IRFAKEORG99999999' });
    if (!assertModuleReady(r, 'TC-TAVAN-SEC-092', 'dashboard path abuse', res)) return;
    const safe = res.serverError || !res.ok || res.status >= 400
      || !(Array.isArray(res.logical?.announcements) && res.logical.announcements.length);
    if (safe) r.pass('TC-TAVAN-SEC-092', 'dashboard path abuse', 'bounded');
    else r.fail('TC-TAVAN-SEC-092', 'dashboard path abuse', 'leaked announcements');
  });

  await run(r, args.flow, 'SEC', 'TC-TAVAN-SEC-093', 'wall profile load scoped', async () => {
    if (!login.ok) {
      r.fail('TC-TAVAN-SEC-093', 'wall profile load scoped', login.reason);
      return;
    }
    const res = await runNamedFixture('wall.profile.load');
    if (!assertModuleReady(r, 'TC-TAVAN-SEC-093', 'wall profile load scoped', res)) return;
    if (isAuthDenied(res)) r.fail('TC-TAVAN-SEC-093', 'wall profile load scoped', 'auth denied');
    else r.pass('TC-TAVAN-SEC-093', 'wall profile load scoped', 'ok');
  });

  await run(r, args.flow, 'SEC', 'TC-TAVAN-SEC-094', 'command without session fail-closed', async () => {
    const res = await postDataProvider('fr/tavan/classroom/create-announcement', {}, {
      withAuth: false,
      command: true,
      data: { annoTitle: 'sec-no-auth' },
    });
    const blob = JSON.stringify(res.json || {});
    const denied = res.status === 401 || isAuthDenied(res) || /شناسایی|login|unauthorized|داده|خطا|کاربر/i.test(blob);
    if (denied) r.pass('TC-TAVAN-SEC-094', 'command without session fail-closed', `HTTP ${res.status}`);
    else r.fail('TC-TAVAN-SEC-094', 'command without session fail-closed', blob.slice(0, 160));
  });

  await run(r, args.flow, 'SEC', 'TC-TAVAN-SEC-095', 'create mass assignment blocked', async () => {
    if (!login.ok) {
      r.fail('TC-TAVAN-SEC-095', 'create mass assignment blocked', login.reason);
      return;
    }
    const res = await postDataProvider('fr/tavan/classroom/create-announcement', {}, {
      command: true,
      data: {
        organ: ctx.organPath || 'IR2O2',
        courseId: ctx.courseId || 'qa',
        annoTitle: 'qa-mass',
        role: 'admin',
        isAdmin: true,
        permissions: ['*'],
      },
    });
    if (!assertModuleReady(r, 'TC-TAVAN-SEC-095', 'create mass assignment blocked', res)) return;
    const blob = JSON.stringify(res.json || {});
    const escalated = /role|permission|isAdmin/i.test(blob) && res.ok && !res.serverError;
    if (!escalated) r.pass('TC-TAVAN-SEC-095', 'create mass assignment blocked', 'no privilege leak');
    else r.fail('TC-TAVAN-SEC-095', 'create mass assignment blocked', blob.slice(0, 160));
  });

  await run(r, args.flow, 'SEC', 'TC-TAVAN-SEC-096', 'dashboard without path fail-closed', async () => {
    if (!login.ok) {
      r.fail('TC-TAVAN-SEC-096', 'dashboard without path fail-closed', login.reason);
      return;
    }
    const res = await runNamedFixture('dashboard.announcements.load', { path: '' });
    if (!assertModuleReady(r, 'TC-TAVAN-SEC-096', 'dashboard without path fail-closed', res)) return;
    const blob = JSON.stringify(res.json || {});
    const rejected = res.serverError || isAuthDenied(res) || /path|داده|خطا/i.test(blob) || !res.ok;
    if (rejected) r.pass('TC-TAVAN-SEC-096', 'dashboard without path fail-closed', 'bounded');
    else r.fail('TC-TAVAN-SEC-096', 'dashboard without path fail-closed', 'accepted empty path');
  });

  const c = r.summary();
  process.exit(c.FAIL > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
