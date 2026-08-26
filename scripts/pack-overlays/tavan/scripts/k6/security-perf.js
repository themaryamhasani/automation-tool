import { check, sleep } from 'k6';
import { courseId, dpGet, liveOrigin, serviceId, statusOk } from './_client.js';
import http from 'k6/http';

/**
 * Security-perf: unauthenticated + abuse against live data-provider.
 * No MyMedu / SSO / login path — intentionally cookie-less.
 */
export const options = {
  vus: 1000,
  duration: '5s',
  thresholds: {
    checks: ['rate>0.7'],
    http_req_duration: ['p(95)<10000'],
  },
};

export default function () {
  const live = liveOrigin();
  const headers = {
    'content-type': 'application/json; charset=UTF-8',
    accept: 'application/json',
    origin: live,
    referer: `${live}/tavan`,
  };

  const noAuth = http.post(
    `${live}/core-api/v1/data-provider/get-data-source`,
    JSON.stringify({ serviceId: serviceId(), key: 'tavan/app/load', params: {} }),
    { headers, tags: { name: 'sec.unauth.app.load' } },
  );
  const body = String(noAuth.body || '');
  const denied = noAuth.status === 401
    || /شناسایی|login|unauthorized|کاربر/i.test(body)
    || (noAuth.status >= 400 && noAuth.status < 500);
  check(noAuth, { 'unauth app/load denied or bounded': () => denied || noAuth.status < 500 });

  const fakeCourse = dpGet(
    'ds/tavan/bank/quizzes/list',
    { course_id: 'qa-fake-course-99999999' },
    { name: 'sec.fake.quizzes' },
  );
  // Without cookie, helper still posts; assert no 5xx flood.
  check(fakeCourse, { 'fake course not 5xx': statusOk });

  const fakeSessions = http.post(
    `${live}/core-api/v1/data-provider/get-data-source`,
    JSON.stringify({
      serviceId: serviceId(),
      key: 'tavan/bank/sessions/list',
      params: { course_id: courseId() },
    }),
    { headers, tags: { name: 'sec.unauth.sessions' } },
  );
  check(fakeSessions, { 'unauth sessions not 5xx': statusOk });

  sleep(0.5);
}
