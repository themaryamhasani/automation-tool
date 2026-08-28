import { check, sleep } from 'k6';
import {
  coreBase,
  courseId,
  dpGet,
  liveAppPath,
  liveOrigin,
  runtimeProstage,
  runtimeClientId,
  serviceId,
  statusOk,
} from './_client.js';
import http from 'k6/http';

/**
 * Security-perf: unauthenticated + abuse against live data-provider.
 * Intentionally omits Cookie (same path/headers shape as live, without session).
 */
export const options = {
  vus: 1000,
  duration: '5s',
  thresholds: {
    checks: ['rate>0.7'],
    http_req_duration: ['p(95)<10000'],
  },
};

function unauthHeaders() {
  const origin = liveOrigin();
  const headers = {
    'Content-Type': 'application/json; charset=UTF-8',
    Accept: 'application/json',
    Origin: origin,
    Referer: `${origin}${liveAppPath()}`,
  };
  const clientId = runtimeClientId();
  if (clientId) headers['Client-Id'] = clientId;
  const prostage = runtimeProstage();
  if (prostage) headers.prostage = prostage;
  return headers;
}

export default function () {
  const live = liveOrigin();
  const headers = unauthHeaders();

  const noAuth = http.post(
    `${live}${coreBase()}/data-provider/get-data-source`,
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
  check(fakeCourse, { 'fake course not 5xx': statusOk });

  const fakeSessions = http.post(
    `${live}${coreBase()}/data-provider/get-data-source`,
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
