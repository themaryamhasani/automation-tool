const fs = require('node:fs');
const path = require('node:path');
const { parseSummary, stamp } = require('./is-reports.cjs');
const {
  enrichSummary,
  formatFindingsSection,
  writeFindingsReport,
  failedFindings,
} = require('./report-findings.cjs');

const TOOL_META = {
  DANGER: { key: 'danger', label: 'Node danger', raw: 'danger-run-raw.txt' },
  K6: { key: 'k6', label: 'k6', raw: 'k6-raw.txt' },
  PLAYWRIGHT: { key: 'e2e', label: 'Playwright', raw: 'e2e-raw.txt' },
  VITEST: { key: 'unit', label: 'Unit', raw: 'unit-raw.txt' },
  BIOME: { key: 'biome', label: 'Biome', raw: 'biome-raw.txt' },
  GITLEAKS: { key: 'gitleaks', label: 'gitleaks', raw: 'gitleaks-raw.txt' },
  AUDIT: { key: 'audit', label: 'SCA / npm audit', raw: 'audit-raw.txt' },
  SEMGREP: { key: 'semgrep', label: 'Semgrep', raw: 'semgrep-raw.txt' },
  SPECTRAL: { key: 'spectral', label: 'Spectral', raw: 'spectral-raw.txt' },
  AXE: { key: 'axe', label: 'axe-core', raw: 'axe-raw.txt' },
};

function reportsRoot() {
  return path.resolve(__dirname, '..', '..', '..', process.env.SOURCE_REPORT_ROOT || 'runtime/reports');
}

function safeSegment(value) {
  return String(value || 'project').replace(/[^\w.-]+/g, '_').slice(0, 80);
}

function looksLikeIsDoc(root) {
  const board = path.join(root, 'test', 'doc', 'build-report-boards.mjs');
  return fs.existsSync(board);
}

function taxonomyRoot(run, productRoot) {
  if (productRoot) return path.resolve(productRoot);
  const approach = String(run.source_approach || 'CDE').toLowerCase();
  const key = safeSegment(run.pack_id || run.cde_project_key || run.project_id);
  return path.join(reportsRoot(), approach, key, 'reports');
}

function approachLabel(run) {
  return run.source_approach || 'CDE';
}

function toolMeta(run) {
  return TOOL_META[String(run.tool_kind || 'PLAYWRIGHT').toUpperCase()] || TOOL_META.PLAYWRIGHT;
}

function toolBadge(stats, exists) {
  if (!exists) return '⚫ MISSING';
  if (stats.fail) return '🔴 ISSUE';
  if (stats.pass) return '🟢 PASS';
  return '📄 RAW';
}

function listFlowFiles(root) {
  const dir = path.join(root, 'by-flow');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.md') && name !== '_index.md')
    .map(name => name.replace(/\.md$/, ''))
    .sort();
}

function parseFlowFile(file) {
  if (!fs.existsSync(file)) return { status: 'missing', pass: 0, fail: 0, skip: 0, summary: 'فایل نیست' };
  const text = fs.readFileSync(file, 'utf8');
  const summary = (text.match(/\|\s*خلاصه\s*\|\s*([^|\n]+)\|/) || text.match(/(PASS=\d+\s+FAIL=\d+[^\n]*)/) || ['', 'n/a'])[1].trim();
  const pass = Number((text.match(/\|\s*PASS\s*\|\s*(\d+)\s*\|/) || [0, '0'])[1]);
  const fail = Number((text.match(/\|\s*FAIL\s*\|\s*(\d+)\s*\|/) || [0, '0'])[1]);
  const skip = Number((text.match(/\|\s*SKIP\s*\|\s*(\d+)\s*\|/) || [0, '0'])[1]);
  const status = fail > 0 ? 'fail' : pass > 0 ? 'pass' : skip > 0 ? 'skip' : 'empty';
  return { status, pass, fail, skip, summary };
}

function flowBadge(status) {
  return { pass: '🟢 PASS', fail: '🔴 FAIL', skip: '🟡 SKIP', empty: '⚫ EMPTY', missing: '⚫ MISSING' }[status] || '⚫ EMPTY';
}

function writeFlowReport(root, { title, id, flow, code, out, when, stats, command }) {
  const repDir = path.join(root, 'by-flow');
  const rawDir = path.join(repDir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  const tool = String(command?.toolKey || 'danger');
  fs.writeFileSync(path.join(rawDir, `${flow}-${tool}.txt`), out || '', 'utf8');
  const detail = String(out || '')
    .split(/\r?\n/)
    .filter(line => /PASS|FAIL|SKIP|SUMMARY|--- |✓|✘|passed|failed|skipped/i.test(line) && !/CategoryInfo|FullyQualified|RemoteException/.test(line))
    .join('\n');
  const findings = formatFindingsSection(stats.details || [], { toolKind: command?.toolKind || tool });
  const md = `# گزارش فلو \`${flow}\` — ${title} (${id})

| فیلد | مقدار |
|------|--------|
| تاریخ | ${when} |
| FLOW | \`${flow}\` |
| دستور | \`${command?.label || tool}\` |
| exit | ${code} |
| خلاصه | ${stats.summary} |

## نتایج

| نتیجه | تعداد |
|--------|------:|
| PASS | ${stats.pass} |
| FAIL | ${stats.fail} |
| SKIP | ${stats.skip} |

### جزئیات

\`\`\`
${detail || 'خروجی قابل استخراج نبود.'}
\`\`\`

${findings}
Raw: [raw/${flow}-${tool}.txt](raw/${flow}-${tool}.txt)

فهرست اجرا: [../../scripts/RUN-BY-FLOW.md](../../scripts/RUN-BY-FLOW.md)
`;
  fs.writeFileSync(path.join(repDir, `${flow}.md`), md, 'utf8');
}

function writeByFlowIndex(root, { id, when, flows }) {
  const idx = `# گزارش‌های فلو‌محور — ${id}

تاریخ تولید: ${when}

> تخته وضعیت: [../01-status-board.md](../01-status-board.md) · راهنما: [../00-readme.md](../00-readme.md)

| FLOW | فایل |
|------|------|
${flows.map(flow => `| \`${flow}\` | [${flow}.md](${flow}.md) |`).join('\n')}
`;
  fs.mkdirSync(path.join(root, 'by-flow'), { recursive: true });
  fs.writeFileSync(path.join(root, 'by-flow', '_index.md'), idx, 'utf8');
}

function writeToolPage(root, meta, { title, id, code, stats, flows, exists }) {
  const status = toolBadge(stats, exists);
  const md = `# ${meta.label} — ${title} (\`${id}\`)

| فیلد | مقدار |
|------|--------|
| وضعیت | ${status} |
| شواهد | \`${meta.raw}\` |
| exit | ${exists ? code : '—'} |
| خلاصه | ${exists ? stats.summary : 'هنوز ران نشده'} |

## Raw

- [${meta.raw}](../${meta.raw})

## ارتباط با فلوها

${flows.map(flow => `- [\`${flow}\`](../by-flow/${flow}.md)`).join('\n') || '- هنوز فلوئی ثبت نشده'}

بازگشت: [../01-status-board.md](../01-status-board.md) · [_index](_index.md)
`;
  fs.writeFileSync(path.join(root, 'by-tool', `${meta.key}.md`), md, 'utf8');
}

function writeStatusBoard(root, { title, id, when, flows, tools, latest }) {
  const openFails = tools.filter(item => item.stats.fail).length + flows.filter(item => item.parsed.fail).length;
  const findings = failedFindings(latest.details || []);
  const findingsBlock = findings.length
    ? findings.slice(0, 12).map((item, index) => `| ${index + 1} | ${String(item.title || '').replace(/\|/g, '/')} | \`${item.path || '—'}\` | ${String(item.hint || '').replace(/\|/g, '/')} |`).join('\n')
    : '| — | یافتهٔ FAIL نیست | — | — |';
  const board = `# تخته وضعیت — ${title} (\`${id}\`)

| فیلد | مقدار |
|------|--------|
| به‌روز رسانی | ${when} |
| منبع فلو | [by-flow/_index.md](by-flow/_index.md) |
| یافته باز | **${openFails}** |
| گزارش یافته‌ها | [02-findings.md](02-findings.md) |

## ۱) فلوها

| FLOW | وضعیت | PASS | FAIL | SKIP | خلاصه | جزئیات |
|------|--------|-----:|-----:|-----:|--------|--------|
${flows.map(item => `| \`${item.flow}\` | ${flowBadge(item.parsed.status)} | ${item.parsed.pass} | ${item.parsed.fail} | ${item.parsed.skip} | ${item.parsed.summary} | [${item.flow}.md](by-flow/${item.flow}.md) |`).join('\n')}

## ۲) ابزارها

| ابزار | وضعیت | شواهد |
|--------|--------|--------|
${tools.map(item => `| ${item.meta.label} (\`${item.meta.key}\`) | ${toolBadge(item.stats, item.exists)} | \`${item.meta.raw}\` · [by-tool/${item.meta.key}.md](by-tool/${item.meta.key}.md) |`).join('\n')}

## ۳) نتایج آخرین اجرا

| نتیجه | تعداد |
|--------|------:|
| PASS | ${latest.pass} |
| FAIL | ${latest.fail} |
| SKIP | ${latest.skip} |
| TOTAL | ${latest.total} |

## ۴) لینک‌های سریع

- راهنما: [00-readme.md](00-readme.md)
- یافته‌ها + Hint: [02-findings.md](02-findings.md)
- فلوها: [by-flow/_index.md](by-flow/_index.md)
- ابزارها: [by-tool/_index.md](by-tool/_index.md)
- اجرای فلو‌محور: از \`scripts/RUN-BY-FLOW.md\`

## ۵) FAILها — مسیر و راهنمای رفع

| # | تست | مسیر ایجاد خطا | Hint |
|---|------|----------------|------|
${findingsBlock}
`;
  fs.writeFileSync(path.join(root, '01-status-board.md'), board, 'utf8');
  const day = String(when).slice(0, 10);
  fs.mkdirSync(path.join(root, 'history'), { recursive: true });
  fs.writeFileSync(path.join(root, 'history', `${day}-status.md`), board, 'utf8');
  return path.join(root, '01-status-board.md');
}

function writeLocalTaxonomy(run, { code, out, stats, title, productRoot }) {
  const root = taxonomyRoot(run, productRoot);
  const id = String(run.pack_id || run.cde_project_key || run.project_id || 'project');
  const heading = title || run.project_name || approachLabel(run);
  const when = stamp();
  const current = toolMeta(run);
  const summary = enrichSummary(stats || parseSummary(out, null, run.tool_kind), {
    toolKind: run.tool_kind,
    out,
  });
  const flow = String(run.flow_id || 'ALL').toUpperCase();

  fs.mkdirSync(path.join(root, 'by-flow', 'raw'), { recursive: true });
  fs.mkdirSync(path.join(root, 'by-tool'), { recursive: true });
  fs.mkdirSync(path.join(root, 'history'), { recursive: true });

  fs.writeFileSync(path.join(root, current.raw), out || '', 'utf8');
  fs.writeFileSync(path.join(root, `${current.key}-run-raw.txt`), out || '', 'utf8');

  writeFlowReport(root, {
    title: heading, id, flow, code, out, when, stats: summary,
    command: { toolKey: current.key, label: current.label, toolKind: run.tool_kind },
  });

  const findings = writeFindingsReport(root, {
    approach: approachLabel(run),
    toolKind: run.tool_kind,
    command: current.label,
    when,
    stats: summary,
    out,
  });

  const flows = listFlowFiles(root);
  writeByFlowIndex(root, { id, when, flows });

  fs.writeFileSync(path.join(root, '00-readme.md'), `# گزارش‌ها — ${heading} (\`${id}\`)

## چطور بخوانیم؟

| فایل / پوشه | سؤال |
|-------------|------|
| [01-status-board.md](01-status-board.md) | **الان** وضعیت چیست؟ (نقطهٔ ورود روزانه) |
| [02-findings.md](02-findings.md) | FAILها با **مسیر خطا** و **Hint راه‌حل** |
| [by-flow/](by-flow/_index.md) | جزئیات هر FLOW |
| [by-tool/](by-tool/_index.md) | نتیجه به تفکیک ابزار |
| [history/](history/) | آرشیو زمانی تخته وضعیت |

## قرارداد وضعیت

| نشان | معنی |
|------|------|
| 🟢 PASS | همه TCهای اتومات آن لایه سبز |
| 🔴 FAIL | حداقل یک FAIL — باید بررسی شود |
| 🟡 SKIP / PARTIAL | ناقص یا بخشی |
| ⚫ EMPTY | هنوز ران/فایل نیست |

## قرارداد یافته‌ها (همه اپروچ‌ها)

هر FAIL باید داشته باشد: پیام شفاف، مسیر فایل/تست ایجادکننده، و Hint عملی برای رفع.

## بازتولید

اسکریپت‌ها در \`scripts/\` همین بسته اجرا می‌شوند؛ سورس CDE دست نمی‌خورد. پس از هر اجرا همین تخته بازسازی می‌شود.
`, 'utf8');

  fs.writeFileSync(path.join(root, 'by-tool', '_index.md'), `# ابزارها — ${heading} (\`${id}\`)

نقطهٔ ورود وضعیت: [../01-status-board.md](../01-status-board.md)

| ابزار | فایل |
|--------|------|
${Object.values(TOOL_META).map(meta => `| \`${meta.key}\` | [${meta.key}.md](${meta.key}.md) |`).join('\n')}
`, 'utf8');

  const tools = Object.values(TOOL_META).map(meta => {
    const rawPath = path.join(root, meta.raw);
    const exists = fs.existsSync(rawPath);
    const toolStats = meta.key === current.key ? summary : (exists ? parseSummary(fs.readFileSync(rawPath, 'utf8'), null, meta.key.toUpperCase()) : { pass: 0, fail: 0, skip: 0, total: 0, summary: 'n/a', details: [] });
    writeToolPage(root, meta, {
      title: heading, id, code: meta.key === current.key ? code : '—', stats: toolStats, flows, exists,
    });
    return { meta, stats: toolStats, exists };
  });

  const flowRows = flows.map(name => ({ flow: name, parsed: parseFlowFile(path.join(root, 'by-flow', `${name}.md`)) }));
  writeStatusBoard(root, { title: heading, id, when, flows: flowRows, tools, latest: findings.stats });

  return {
    product: root,
    board: path.join(root, '01-status-board.md'),
    findings: findings.file,
    raw: path.join(root, current.raw),
  };
}

module.exports = { reportsRoot, looksLikeIsDoc, taxonomyRoot, writeLocalTaxonomy, TOOL_META };
