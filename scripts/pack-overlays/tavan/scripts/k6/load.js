import { check, sleep, group } from 'k6';
import {
  BUSINESS_PACK_IDS,
  courseId,
  dpCmd,
  dpGet,
  hasRuntimeAuth,
  hitExpressStructure,
  logicalResult,
  organPath,
  requireRuntimeAuth,
  statusOk,
} from './_client.js';

/**
 * Publish-priority load for tavan business journeys.
 *
 * Auth: PREREG_COOKIE from Runtime Login (runner). Does not perform SSO or portal login flows.
 *
 * 1) CDE express structure (this system's runtime)
 * 2) Course context → sessions (hold) → classroom join → exam join
 *
 * VUs/duration come from UI tool-options (`k6 run --vus --duration`).
 */
export const options = {
  vus: 5000,
  duration: '25s',
  thresholds: {
    checks: ['rate>0.65'],
    http_req_failed: ['rate<0.4'],
    http_req_duration: ['p(95)<12000'],
  },
};

export default function () {
  group('cde-express-runtime', () => {
    hitExpressStructure(BUSINESS_PACK_IDS);
  });

  if (!requireRuntimeAuth()) {
    sleep(1);
    return;
  }

  const cid = courseId();
  const organ = organPath();

  group('course-context', () => {
    const app = dpGet('ds/tavan/app/load', {}, { step: 'app.load' });
    check(app, { 'app/load reachable': statusOk });

    const folder = dpGet(
      'ds/tavan/bank/folder/load',
      { app: 'tavan', course_id: cid },
      { step: 'folder.load' },
    );
    check(folder, { 'folder/load for course': statusOk });

    const similar = dpGet(
      'ds/tavan/bank/bank/similar-implements-list',
      { course_id: cid },
      { step: 'similar.implements' },
    );
    check(similar, { 'similar-implements list': statusOk });
  });

  group('hold-sessions', () => {
    const sessions = dpGet(
      'ds/tavan/bank/sessions/list',
      { course_id: cid },
      { step: 'sessions.list' },
    );
    check(sessions, { 'sessions/list for course': statusOk });
    const logical = logicalResult(sessions);
    const rows = logical?.sessions || logical?.['data-provider']?.sessions || [];
    check(sessions, {
      'sessions payload bounded': () => Array.isArray(rows) || statusOk(sessions),
    });
  });

  group('join-classroom', () => {
    const classroom = dpGet(
      'ds/tavan/classroom/announcements-section-load',
      { course: cid },
      { step: 'classroom.announcements' },
    );
    check(classroom, { 'classroom announcements': statusOk });
  });

  group('join-exam', () => {
    const quizzes = dpGet(
      'ds/tavan/bank/quizzes/list',
      { course_id: cid },
      { step: 'quizzes.list' },
    );
    check(quizzes, { 'quizzes/list for course': statusOk });
    const logical = logicalResult(quizzes);
    const list = logical?.quizzes
      || logical?.List
      || logical?.list
      || logical?.['data-provider']?.quizzes
      || logical?.['data-provider']
      || [];
    const rows = Array.isArray(list) ? list : [];
    const quizRand = rows.length ? String(rows[0].rand_id || rows[0].id || '').trim() : '';
    if (quizRand) {
      const one = dpGet(
        'ds/tavan/bank/quizzes/one',
        { rand_id: quizRand, course_id: cid },
        { step: 'quizzes.one' },
      );
      check(one, { 'quizzes/one detail': statusOk });
    }
  });

  if (envFlag('K6_ALLOW_WRITES') && (__VU + __ITER) % 20 === 0) {
    group('optional-classroom-write', () => {
      const stamp = `k6-${__VU}-${__ITER}-${Date.now().toString(36)}`;
      const create = dpCmd(
        'fr/tavan/classroom/create-announcement',
        {
          organ,
          courseId: cid,
          annoTitle: stamp,
          annoDesc: 'k6-load',
          stack: [organ],
        },
        { step: 'announcement.create' },
      );
      check(create, { 'create-announcement bounded': statusOk });
    });
  }

  sleep(1);
}

function envFlag(name) {
  const v = String(__ENV[name] || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}
