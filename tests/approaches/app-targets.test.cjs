const assert = require('node:assert/strict');
const test = require('node:test');
const {
  configuredOrigins,
  resolveAppTarget,
  landingPathForRole,
  normalizeSourceId,
  getApiFixture,
} = require('../../shared/runtime/app-targets.cjs');

test('configuredOrigins always includes adib and soha', () => {
  const origins = configuredOrigins();
  assert.ok(origins.includes('https://adib.m.edus.ir'));
  assert.ok(origins.includes('https://soha.m.edus.ir'));
});

test('medu-camp resolves adib login + school app path + host serviceId', () => {
  const target = resolveAppTarget('medu-camp');
  assert.equal(target.origin, 'https://adib.m.edus.ir');
  assert.equal(target.loginPath, '/devlogin');
  assert.equal(target.appPath, '/camp/school');
  assert.equal(target.projectServiceId, 'adib.m.edus.ir');
  assert.equal(target.useOriginHostAsServiceId, true);
  const roles = getApiFixture('medu-camp', 'roles.and.organs');
  assert.equal(roles.sourceId, 'ds/medu-camp/roles-and-organs');
  assert.equal(roles.params.appName, 'camp');
  assert.equal(getApiFixture('medu-camp', 'organ.camps.load').sourceId, 'ds/medu-camp/organ/camps/load');
  assert.equal(getApiFixture('medu-camp', 'camp.status.counts').sourceId, 'ds/medu-camp/camp/status-counts');
  assert.equal(getApiFixture('medu-camp', 'ostan.reports.camps.load').sourceId, 'ds/medu-camp/ostan/reports/camps/load');
});

test('medu-community resolves API-CONSOLE serviceId and repository fixture', () => {
  const target = resolveAppTarget('medu-community');
  assert.equal(target.origin, 'https://soha.m.edus.ir');
  assert.equal(target.projectServiceId, 'medu-community.medu.ir');
  const fixture = getApiFixture('medu-community', 'repository.load.all');
  assert.equal(fixture.sourceId, 'ds/medu-community/repository/load/all');
  assert.equal(fixture.params.viewerRole, 'hq');
  assert.equal(fixture.params.limit, 20);
});

test('normalizeSourceId matches API-CONSOLE key stripping rules', () => {
  assert.equal(normalizeSourceId('ds/medu-community/auth/load/profile'), 'ds/medu-community/auth/load/profile');
  assert.equal(normalizeSourceId('medu-community/repository/load/all'), 'ds/medu-community/repository/load/all');
  assert.equal(normalizeSourceId('fr/medu-camp/camp', { command: true }), 'fr/medu-camp/camp');
});

test('role switch maps to different camp paths', () => {
  assert.equal(landingPathForRole('medu-camp', 'apps.camp.roles.admin'), '/camp/school');
  assert.equal(landingPathForRole('medu-camp', 'apps.camp.roles.camp:region-expert'), '/camp/mantaghe');
  assert.equal(landingPathForRole('medu-camp', 'apps.camp.roles.camp:province-expert'), '/camp/ostan');
  assert.equal(landingPathForRole('medu-camp', 'apps.camp.roles.camp:app-manager', 2), '/camp/setad');
  assert.equal(landingPathForRole('medu-camp', 'roles.parent'), '/camp/parent');
});

test('tavan resolves soha login + tavan app path + serviceId', () => {
  const target = resolveAppTarget('tavan');
  assert.equal(target.origin, 'https://soha.m.edus.ir');
  assert.equal(target.loginPath, '/devlogin');
  assert.equal(target.appPath, '/tavan');
  assert.equal(target.projectServiceId, 'tavan.medu.ir');
  assert.equal(target.authMode, 'devlogin');
  const appLoad = getApiFixture('tavan', 'app.load');
  assert.equal(appLoad.sourceId, 'ds/tavan/app/load');
  const bank = getApiFixture('tavan', 'bank.folder.load');
  assert.equal(bank.sourceId, 'ds/tavan/bank/folder/load');
  assert.equal(bank.params.app, 'tavan');
  assert.equal(bank.params.course_id, 'CC05110111PL1IM1');
  const who = getApiFixture('tavan', 'who.am.i');
  assert.equal(who.sourceId, 'pages-app/who-am-i');
  assert.equal(target.preferredCourseId, 'CC05110111PL1IM1');
  assert.equal(target.preferredOrganPath, 'IR2O2');
});

test('tavan soha-gov-sso-handoff resolves medu app origin and handoff', () => {
  const {
    AUTH_MODE_SOHA_HANDOFF,
    buildHandoffUrl,
  } = require('../../shared/runtime/app-targets.cjs');
  const target = resolveAppTarget('tavan', { authMode: AUTH_MODE_SOHA_HANDOFF });
  assert.equal(target.authMode, AUTH_MODE_SOHA_HANDOFF);
  assert.equal(target.authOrigin, 'https://soha.medu.ir');
  assert.equal(target.appOrigin, 'https://tavan.medu.ir');
  assert.equal(target.origin, 'https://tavan.medu.ir');
  assert.equal(target.appPath, '/landing');
  assert.equal(target.prostage, 'develop');
  assert.equal(target.handoff?.clientAccessId, 'tavan_soha');
  assert.deepEqual(target.cookieScopes, ['https://soha.medu.ir', 'https://tavan.medu.ir']);
  assert.ok(target.originAllowlist.includes('*.medu.ir'));
  const url = buildHandoffUrl(target, { tokenId: 'IpBeQyqzYjcHxdUHB1nmjEbspkLqHzhI' });
  assert.match(url, /soha\.medu\.ir\/core-api\/v1\/data-provider\/g\/pwsp--medu--sso--get-token/);
  assert.match(url, /clientAccessId=tavan_soha/);
});
