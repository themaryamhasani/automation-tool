/** Pack definition for سامانه توان — thin data; danger/k6/flows in pack-overlays/tavan. */
module.exports = {
  key: 'tavan',
  approach: 'CDE',
  title: 'سامانه توان (tavan)',
  target: {
    preferredOrigin: 'https://soha.m.edus.ir',
    loginPath: '/devlogin',
    loginUrl: 'https://soha.m.edus.ir/devlogin',
    appPath: '/tavan',
    appUrl: 'https://soha.m.edus.ir/tavan',
    projectServiceId: 'tavan.medu.ir',
    useOriginHostAsServiceId: false,
    appName: 'tavan',
    preferredOrganPath: 'IR2O2',
    preferredCourseId: 'CC05110111PL1IM1',
    docs: { businessRules: 'docs/business-rules/', testStrategy: 'docs/test-strategy/' },
    catalog: 'data/catalog.json',
  },
  extraDirs: [
    'cases/AUTH/happy', 'cases/AUTH/security',
    'cases/TBL/happy', 'cases/TBL/negative', 'cases/TBL/security',
    'cases/CRU/happy', 'cases/CRU/negative',
    'cases/RPT/happy', 'cases/APR/happy', 'cases/ADM/happy',
    'cases/SEC/security', 'cases/XCUT/happy', 'cases/XCUT/security',
    'cases/CAT/happy', 'cases/CK/happy',
    'runbooks/by-flow/AUTH', 'runbooks/by-flow/TBL', 'runbooks/by-flow/SEC',
    'runbooks/smoke', 'runbooks/release',
    'scripts/k6',
    'flows',
  ],
  files: {
    '00-readme.md': `---
product: TAVAN
slug: tavan
---

# QA Map — سامانه توان (\`tavan\`)

Scaffold از \`scripts/lib/cde-pack-scaffold.cjs\` · اسکریپت‌ها در \`scripts/pack-overlays/tavan/\`.

| لایه | ابزار | مسیر |
|------|--------|------|
| API | DANGER | \`scripts/api/run.mjs\` |
| بار | k6 | \`scripts/k6/{health,load,security-perf}.js\` |
| E2E | Playwright | \`scripts/e2e/\` |
| واحد | Vitest / node:test | \`scripts/vitest/\` · \`scripts/unit/\` |
| امنیت | DANGER SEC + k6 security-perf | \`flows/SEC__*.md\` |
| فلو / کیس / ران‌بوک / چک‌لیست | Markdown | \`flows/\` · \`cases/\` · \`runbooks/\` · \`checklists/\` |
| گزارش | taxonomy | \`reports/\` |
`,
    '04-id-map.md': `# ID Map — tavan

| FLOW | معنی |
|------|------|
| AUTH | ورود + نقش |
| TBL | Gtable / pagination |
| CRU | ایجاد/ویرایش |
| RPT | گزارش |
| APR | کارتابل / status |
| ADM | محدوده ادمین |
| SEC | امنیت |
| XCUT | health / fail-closed |
| CAT | catalog-probe |
| CK | چک‌لیست ۱–۲۶ |
`,
    '03-matrix.md': `# ماتریس پوشش — tavan

| FLOW | موضوع | P | ابزار |
|------|--------|---|--------|
| AUTH | who-am-i / roles | P0 | DANGER |
| TBL | grid + pagination | P0 | DANGER · k6 load |
| SEC | IDOR / unauth / abuse | P0 | DANGER · k6 security-perf |
| CRU | create fail-closed | P0 | DANGER |
| XCUT | health | P0 | DANGER · k6 health |
| RPT | summary | P1 | DANGER |
| APR | update-status | P2 | DANGER |
| ADM | records scope | P1 | DANGER |
`,
    'docs/test-strategy/01-pyramid.md': `# استراتژی تست — tavan\n\nهرم: واحد → API (DANGER) → E2E → پرفورمنس/امنیت (k6).\n`,
    'docs/business-rules/auth-and-roles.md': `# احراز هویت — tavan\n\ndevlogin روی soha + serviceId \`tavan.medu.ir\`.\n\nشناسه دوره از URL کلاس:\n\`/classroom/<ORGAN>/<ROLE>/sessions-list/<COURSE_ID>\`\nمثال: \`IR2O2\` / \`emis:fragier\` / \`CC05110111PL1IM1\`\n\nEnv اختیاری: \`TAVAN_COURSE_ID\`، \`TAVAN_ORGAN_PATH\`.\n`,
    'data/catalog.json': {
      product: 'tavan',
      sources: [],
      updatedAt: null,
    },
    'cases/_index.md': `# Cases — TAVAN\n\nکیس‌ها زیر \`cases/<FLOW>/{happy|negative|security}/\`.\n`,
    'scripts/RUN-BY-FLOW.md': `# اجرای فلو‌محور — tavan\n\n\`\`\`bash\nnode scripts/api/run.mjs --flow=ALL\nnode scripts/api/run.mjs --flow=SEC\nk6 run scripts/k6/load.js\nk6 run scripts/k6/security-perf.js\n\`\`\`\n`,
    'scripts/k6.js': `/** Compat entry — re-export business load (no MyMedu/devlogin). */
export { options, default } from './k6/load.js';
`,
    'checklists/CK-TAVAN-QA-001-checklist-map.md': `# CK-TAVAN-QA-001\n\nنگاشت چک‌لیست QA به TCهای pack — SEC تا 096 · k6 بیزنس در \`scripts/k6/load.js\` (کوکی رانتایم).\n`,
    'runbooks/smoke/RB-TAVAN-SMOKE-001.md': `# RB-TAVAN-SMOKE-001\n\n1. Runtime login (کوکی برای k6/Danger)\n2. DANGER \`--flow=XCUT\`\n3. k6 health (Express CDE)\n4. k6 load (دوره/جلسه/آزمون با PREREG_COOKIE)\n5. Playwright health.spec\n`,
  },
};
