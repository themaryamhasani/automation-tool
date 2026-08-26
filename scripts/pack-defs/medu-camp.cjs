/** Pack definition for سامانه اردو — thin data; danger scripts in pack-overlays/medu-camp. */
module.exports = {
  key: 'medu-camp',
  approach: 'CDE',
  title: 'سامانه اردو (medu-camp)',
  target: {
    preferredOrigin: 'https://adib.m.edus.ir',
    loginPath: '/devlogin',
    loginUrl: 'https://adib.m.edus.ir/devlogin',
    appPath: '/camp/school',
    appUrl: 'https://adib.m.edus.ir/camp/school',
    useOriginHostAsServiceId: true,
    projectServiceId: 'adib.m.edus.ir',
    docs: { businessRules: 'docs/business-rules/' },
  },
  extraDirs: [
    'cases/AUTH/happy', 'cases/SCH/happy', 'cases/SCH/negative', 'cases/SCH/security',
    'cases/REG/happy', 'cases/XCUT/happy', 'cases/XCUT/security',
    'runbooks/by-flow/SCH', 'data/personas',
  ],
  files: {
    '00-readme.md': `---
product: CAMP
slug: medu-camp
---

# QA Map — سامانه اردو (\`medu-camp\`)

Scaffold مشترک · اسکریپت danger در \`scripts/pack-overlays/medu-camp/\`.

هدف زنده: \`https://adib.m.edus.ir/camp/school\`
`,
    '04-id-map.md': `# ID Map — medu-camp

| FLOW | معنی |
|------|------|
| AUTH | ورود و نقش |
| SCH | مدرسه / admin |
| REG | کارشناس منطقه |
| OST | استان |
| SET | ستاد |
| PAR | والدین |
| XCUT | برش عرضی |
`,
    '03-matrix.md': `# ماتریس پوشش — CAMP

| FLOW | موضوع | P |
|------|--------|---|
| AUTH | devlogin | P0 |
| SCH | لود اردو | P0 |
| SCH | fail-closed | P0 |
`,
    'cases/_index.md': `# Cases — CAMP\n`,
    'runbooks/_index.md': `# Runbooks — CAMP\n`,
    'scripts/RUN-BY-FLOW.md': `# اجرای فلو‌محور — medu-camp\n\n\`node scripts/api/run.mjs --flow=ALL\`\n`,
    'checklists/CK-CAMP-QA-001-checklist-map.md': `# CK-CAMP-QA-001\n\nنگاشت بند ۱–۲۶ به TCهای pack.\n`,
    'data/personas/PN-CAMP-001.md': `# PN-CAMP-001\n\nحساب از ENV \`CAMP_LOGIN_PHONE\` / runtime session.\n`,
  },
};
