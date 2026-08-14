const PACKS = {
  PR: {
    id: 'PR',
    title: 'پیش‌ثبت‌نام',
    docPath: 'assessment/pre-registration',
    serviceRoot: 'services/assessment/02-student-pre-registration',
    health: [
      { name: 'pre-registration', url: 'http://127.0.0.1:4011/health' },
      { name: 'gateway', url: 'http://127.0.0.1:4000/health', optional: true },
    ],
    e2eBaseUrl: 'http://localhost:3014/student-pre-registration/',
    flows: ['G01', 'G07', 'G10', 'MID', 'CAP', 'XCUT', 'SEC'],
    danger: {
      cwd: 'scripts/api/g10-mid-danger',
      entry: 'run.mjs',
      runByFlow: 'scripts/run-by-flow.mjs',
      rawFile: 'danger-run-raw.txt',
    },
    k6: {
      cwd: 'scripts/api/g10-mid-danger',
      script: 'k6-g10-mid-security-perf.js',
      rawFile: 'k6-g10-mid-raw.txt',
    },
    e2e: {
      cwd: 'scripts/e2e',
      npmScript: 'e2e:g10-mid',
      rawFile: 'e2e-raw.txt',
      channel: 'chrome',
    },
    unit: {
      cwdFromRepo: 'services/assessment/02-student-pre-registration',
      command: ['npx', 'vitest', 'run', 'src/lib/grade10*.test.ts'],
      rawFile: 'prereg-vitest-raw.txt',
    },
  },
  PL: {
    id: 'PL',
    title: 'برنامه‌ریزی',
    docPath: 'assessment/planning',
    serviceRoot: 'services/assessment/08-planning',
    health: [
      { name: 'planning', url: 'http://127.0.0.1:4018/health' },
      { name: 'gateway', url: 'http://127.0.0.1:4000/health', optional: true },
    ],
    e2eBaseUrl: 'http://localhost:3028/planning/',
    flows: ['NGH', 'XCUT', 'SEC'],
    danger: {
      cwd: 'scripts/api/planning-danger',
      entry: 'run.mjs',
      runByFlow: 'scripts/run-by-flow.mjs',
      rawFile: 'planning-danger-run-raw.txt',
    },
    k6: {
      cwd: 'scripts/api/planning-danger',
      script: 'k6-planning-security-perf.js',
      rawFile: 'planning-k6-raw.txt',
    },
    e2e: {
      cwd: 'scripts/e2e',
      npmScript: 'e2e',
      rawFile: 'planning-e2e-raw.txt',
      channel: 'chrome',
    },
    unit: {
      cwdFromRepo: 'services/assessment/08-planning',
      command: ['npx', 'vitest', 'run'],
      rawFile: 'planning-vitest-raw.txt',
    },
  },
  INT: {
    id: 'INT',
    title: 'کارورزی / کارآموزی',
    alias: 'KR',
    docPath: 'education/internship',
    serviceRoot: 'services/assessment/03-internship',
    health: [
      { name: 'internship', url: 'http://127.0.0.1:4012/health' },
      { name: 'gateway', url: 'http://127.0.0.1:4000/health', optional: true },
    ],
    e2eBaseUrl: 'http://localhost:3022/internship/',
    flows: ['REQ', 'LOC', 'CLS', 'STF', 'GRD', 'XCUT', 'SEC'],
    automatedFlows: ['REQ', 'LOC', 'CLS', 'STF', 'XCUT', 'SEC'],
    danger: {
      cwd: 'scripts/api/internship-danger',
      entry: 'run.mjs',
      runByFlow: 'scripts/run-by-flow.mjs',
      rawFile: 'internship-danger-run-raw.txt',
    },
    k6: {
      cwd: 'scripts/api/internship-danger',
      script: 'k6-internship-security-perf.js',
      rawFile: 'internship-k6-raw.txt',
    },
    e2e: {
      cwd: 'scripts/e2e',
      npmScript: 'e2e',
      rawFile: 'internship-e2e-raw.txt',
      channel: 'chrome',
    },
    unit: {
      cwdFromRepo: 'services/assessment/03-internship',
      command: ['node', '--import', 'tsx', '--test', 'src/routes/dailyReports.sanitize.test.ts'],
      rawFile: 'internship-vitest-raw.txt',
    },
  },
  BRN: {
    id: 'BRN',
    title: 'برون‌سپاری (outsourcing)',
    docPath: 'education/broonsepari',
    serviceRoot: 'services/assessment/07-outsourcing',
    health: [
      { name: 'outsourcing', url: 'http://127.0.0.1:4014/health' },
      { name: 'gateway', url: 'http://127.0.0.1:4000/health', optional: true },
    ],
    e2eBaseUrl: 'http://localhost:3025/outsourcing/',
    flows: ['BUD', 'CTR', 'REQ', 'PAY', 'STD', 'INS', 'XCUT', 'SEC'],
    danger: {
      cwd: 'scripts/api/broonsepari-danger',
      entry: 'run.mjs',
      runByFlow: 'scripts/run-by-flow.mjs',
      rawFile: 'broonsepari-danger-run-raw.txt',
    },
    k6: {
      cwd: 'scripts/api/broonsepari-danger',
      script: 'k6-broonsepari-security-perf.js',
      rawFile: 'broonsepari-k6-raw.txt',
    },
    e2e: {
      cwd: 'scripts/e2e',
      npmScript: 'e2e',
      rawFile: 'broonsepari-e2e-raw.txt',
      channel: 'chrome',
    },
    unit: {
      cwdFromRepo: 'services/assessment/07-outsourcing',
      command: ['npm', 'run', 'test:unit'],
      rawFile: 'broonsepari-vitest-raw.txt',
    },
  },
};

function listPacks() {
  return Object.values(PACKS).map(pack => ({
    id: pack.id,
    title: pack.title,
    alias: pack.alias || null,
    docPath: pack.docPath,
    flows: pack.flows,
    automatedFlows: pack.automatedFlows || pack.flows,
    tools: ['DANGER', 'K6', 'PLAYWRIGHT', 'VITEST'],
    e2eBaseUrl: pack.e2eBaseUrl,
    health: pack.health.map(item => ({ name: item.name, url: item.url, optional: Boolean(item.optional) })),
  }));
}

function getPack(id) {
  const key = String(id || '').toUpperCase();
  if (key === 'KR') return PACKS.INT;
  return PACKS[key] || null;
}

module.exports = { PACKS, listPacks, getPack };
