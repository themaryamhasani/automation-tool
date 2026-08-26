import http from 'k6/http';
import { check } from 'k6';
import { expressBase, BUSINESS_PACK_IDS, hitExpressStructure } from './_client.js';

/**
 * P0 smoke: CDE express runtime of this automation tool (structure only).
 * No live login / MyMedu / cookie required.
 */
export const options = {
  vus: 1,
  duration: '8s',
  thresholds: {
    checks: ['rate>0.9'],
    http_req_failed: ['rate<0.2'],
  },
};

export default function () {
  hitExpressStructure(BUSINESS_PACK_IDS.slice(0, 3));
  const base = expressBase();
  const health = http.get(`${base}/health`);
  check(health, {
    'health.ok true': (r) => {
      try {
        return r.json('ok') === true;
      } catch {
        return false;
      }
    },
    'health.projectKey tavan': (r) => {
      try {
        return String(r.json('projectKey') || '') === 'tavan';
      } catch {
        return false;
      }
    },
  });
}
