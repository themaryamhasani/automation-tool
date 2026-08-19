const fs = require('node:fs');
const path = require('node:path');
const { getPack } = require('../../api/src/approaches/is/packs.cjs');
const { packPaths } = require('../../api/src/approaches/is/service.cjs');
const { spawnLogged } = require('./process.cjs');
const {
  enrichSummary,
  formatFindingsSection,
  writeFindingsReport,
} = require('./report-findings.cjs');

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function count(re, text) {
  return (text.match(re) || []).length;
}

function parseCases(out) {
  const details = [];
  let flow = '';
  for (const line of String(out || '').split(/\r?\n/)) {
    const heading = line.match(/^---\s+([A-Z0-9]+)\s+---/);
    if (heading) { flow = heading[1]; continue; }
    const row = line.match(/[✓✗○xX]?\s*(PASS|FAIL|SKIP)\s+(\S+)(?:\s+[—\-]+\s+(.*))?/);
    if (row && !(/PASS=\d+/.test(line) || (/passed|failed|skipped/i.test(line) && !/\bTC-/.test(line)))) {
      details.push({
        title: row[3] ? `${row[2]} — ${row[3].trim()}` : row[2],
        projectName: flow || 'run',
        outcome: row[1] === 'PASS' ? 'expected' : row[1] === 'SKIP' ? 'skipped' : 'unexpected',
        duration: 0,
        error: row[1] === 'FAIL' ? line.trim() : null,
      });
      continue;
    }
    const playwright = line.match(/^\s+([✓✔✘×xX-])\s+(?!(?:PASS|FAIL|SKIP)\b)(.+?)(?:\s+\(\d+(?:\.\d+)?m?s\))?$/);
    if (playwright) {
      const mark = playwright[1];
      const skipped = mark === '-';
      const passed = /[✓✔]/.test(mark);
      details.push({
        title: playwright[2].trim(),
        projectName: flow || 'e2e',
        outcome: passed ? 'expected' : skipped ? 'skipped' : 'unexpected',
        duration: 0,
        error: passed || skipped ? null : line.trim(),
      });
    }
  }
  return details;
}

function parsePlaywrightJson(file) {
  if (!file || !fs.existsSync(file)) return null;
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
  const details = [];
  const walk = (suite) => {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const results = test.results || [];
        const last = results[results.length - 1] || {};
        const skipAnn = (test.annotations || []).find(item => item.type === 'skip' || item.type === 'fixme');
        const status = last.status || test.status || test.expectedStatus;
        const skipped = status === 'skipped' || test.expectedStatus === 'skipped';
        const failed = !skipped && ['failed', 'timedOut', 'interrupted', 'unexpected'].includes(status);
        const title = [spec.file && path.basename(spec.file), spec.title, test.title].filter(Boolean).join(' › ');
        const loc = last.error?.location || last.errors?.[0]?.location || {};
        const file = spec.file || loc.file || null;
        details.push({
          title: title || spec.title || 'test',
          projectName: test.projectName || 'e2e',
          outcome: skipped ? 'skipped' : failed ? 'unexpected' : 'expected',
          duration: last.duration || 0,
          file: file || undefined,
          line: loc.line,
          column: loc.column,
          path: file ? `${String(file).replace(/\\/g, '/')}${loc.line != null ? `:${loc.line}` : ''}` : undefined,
          error: skipped
            ? (skipAnn?.description || last.error?.message || null)
            : (last.error?.message || last.errors?.[0]?.message || null),
        });
      }
    }
    for (const child of suite.suites || []) walk(child);
  };
  for (const suite of data.suites || []) walk(suite);
  if (!details.length) return null;
  const pass = details.filter(item => item.outcome === 'expected').length;
  const fail = details.filter(item => item.outcome === 'unexpected').length;
  const skip = details.filter(item => item.outcome === 'skipped').length;
  return {
    pass,
    fail,
    skip,
    total: pass + fail + skip,
    summary: `${pass} passed, ${fail} failed, ${skip} skipped`,
    details,
  };
}

function parseSummary(out, jsonFile, toolKind) {
  const fromJson = parsePlaywrightJson(jsonFile);
  if (fromJson) return enrichSummary(fromJson, { toolKind, out });
  const details = parseCases(out);
  const pwPass = Number((out.match(/(\d+) passed/) || [0, 0])[1]);
  const pwFail = Number((out.match(/(\d+) failed/) || [0, 0])[1]);
  const pwSkip = Number((out.match(/(\d+) skipped/) || [0, 0])[1]);
  const fromDetails = {
    pass: details.filter(item => item.outcome === 'expected').length,
    fail: details.filter(item => item.outcome === 'unexpected').length,
    skip: details.filter(item => item.outcome === 'skipped').length,
  };
  const pass = fromDetails.pass || count(/✓ PASS/g, out) || pwPass;
  const fail = fromDetails.fail || count(/✗ FAIL/g, out) || pwFail;
  const skip = fromDetails.skip || count(/○ SKIP/g, out) || pwSkip;
  const summary = (out.match(/PASS=\d+[^\n]*/) || out.match(/\d+ passed[^\n]*/) || ['n/a'])[0];
  const total = pass + fail + skip;
  return enrichSummary({ pass, fail, skip, total, summary, details }, { toolKind, out });
}

function writeFlowReport(pack, flow, { code, out, toolKind }, when) {
  const { reportsRoot } = packPaths(pack.id);
  const repDir = path.join(reportsRoot, 'by-flow');
  const rawDir = path.join(repDir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(path.join(rawDir, `${flow}-danger.txt`), out, 'utf8');
  const stats = parseSummary(out, null, toolKind || 'DANGER');
  const detail = out
    .split(/\r?\n/)
    .filter(line => /PASS|FAIL|SKIP|SUMMARY|--- /.test(line) && !/CategoryInfo|FullyQualified|RemoteException|At D:\\/.test(line))
    .join('\n');
  const findings = formatFindingsSection(stats.details, { toolKind: toolKind || 'DANGER' });
  const md = `# گزارش فلو \`${flow}\` — ${pack.title} (${pack.id})

| فیلد | مقدار |
|------|--------|
| تاریخ | ${when} |
| FLOW | \`${flow}\` |
| دستور | \`node --env-file=.env run.mjs --flow=${flow}\` |
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
${detail}
\`\`\`

${findings}
Raw: [raw/${flow}-danger.txt](raw/${flow}-danger.txt)

فهرست اجرا: [../../scripts/RUN-BY-FLOW.md](../../scripts/RUN-BY-FLOW.md)
`;
  fs.writeFileSync(path.join(repDir, `${flow}.md`), md, 'utf8');
  return stats;
}

function writeToolRaw(pack, toolKey, out) {
  const { reportsRoot, pack: full } = packPaths(pack.id);
  fs.mkdirSync(reportsRoot, { recursive: true });
  const rawName = toolKey === 'DANGER' ? full.danger.rawFile
    : toolKey === 'K6' ? full.k6.rawFile
      : toolKey === 'PLAYWRIGHT' ? full.e2e.rawFile
        : toolKey === 'VITEST' ? full.unit.rawFile
          : `${String(toolKey || 'tool').toLowerCase()}-raw.txt`;
  const target = path.join(reportsRoot, rawName);
  fs.writeFileSync(target, out, 'utf8');
  return { rawName, target };
}

function writeByFlowIndex(pack, when) {
  const { reportsRoot } = packPaths(pack.id);
  const flows = pack.automatedFlows || pack.flows.filter(flow => flow !== 'GRD');
  const idx = `# گزارش‌های فلو‌محور — ${pack.id}

تاریخ تولید: ${when}

> تخته وضعیت: [../01-status-board.md](../01-status-board.md) · راهنما: [../00-readme.md](../00-readme.md)

| FLOW | فایل |
|------|------|
${flows.map(flow => `| \`${flow}\` | [${flow}.md](${flow}.md) |`).join('\n')}
`;
  fs.mkdirSync(path.join(reportsRoot, 'by-flow'), { recursive: true });
  fs.writeFileSync(path.join(reportsRoot, 'by-flow', '_index.md'), idx, 'utf8');
}

async function rebuildBoards(docsRoot) {
  const script = path.join(docsRoot, 'build-report-boards.mjs');
  if (!fs.existsSync(script)) return { skipped: true };
  return spawnLogged(process.execPath, [script], { cwd: docsRoot, env: process.env, windowsHide: true });
}

async function persistIsReports({ packId, toolKind, flowId, code, out, jsonFile }) {
  const pack = getPack(packId);
  if (!pack) throw new Error(`Unknown IS pack: ${packId}`);
  const when = stamp();
  const { docRoot, reportsRoot } = packPaths(pack.id);
  let stats = parseSummary(out, jsonFile, toolKind);
  if (toolKind === 'DANGER' && flowId && flowId !== 'ALL') {
    stats = writeFlowReport(pack, flowId, { code, out, toolKind }, when);
    writeByFlowIndex(pack, when);
  } else if (flowId) {
    // Playwright/k6/vitest: همان قرارداد فلو + یافته‌ها
    const repDir = path.join(reportsRoot, 'by-flow');
    const rawDir = path.join(repDir, 'raw');
    fs.mkdirSync(rawDir, { recursive: true });
    const tool = String(toolKind || 'tool').toLowerCase();
    fs.writeFileSync(path.join(rawDir, `${flowId}-${tool}.txt`), out || '', 'utf8');
    const findings = formatFindingsSection(stats.details, { toolKind });
    const md = `# گزارش فلو \`${flowId}\` — ${pack.title} (${pack.id})

| فیلد | مقدار |
|------|--------|
| تاریخ | ${when} |
| FLOW | \`${flowId}\` |
| ابزار | \`${toolKind}\` |
| exit | ${code} |
| خلاصه | ${stats.summary} |

## نتایج

| نتیجه | تعداد |
|--------|------:|
| PASS | ${stats.pass} |
| FAIL | ${stats.fail} |
| SKIP | ${stats.skip} |

${findings}
Raw: [raw/${flowId}-${tool}.txt](raw/${flowId}-${tool}.txt)
`;
    fs.writeFileSync(path.join(repDir, `${flowId}.md`), md, 'utf8');
    writeByFlowIndex(pack, when);
  }
  const raw = writeToolRaw(pack, toolKind, out);
  const findings = writeFindingsReport(reportsRoot, {
    approach: 'IS',
    toolKind,
    command: `${toolKind}${flowId ? ` · ${flowId}` : ''}`,
    when,
    stats,
    out,
  });
  stats = findings.stats;
  const board = await rebuildBoards(docRoot);
  return { when, raw, boardOut: board.out || '', boardCode: board.code, stats, findings: findings.file };
}

module.exports = {
  stamp, parseSummary, parsePlaywrightJson, parseCases, writeFlowReport, writeToolRaw, writeByFlowIndex,
  spawnLogged, rebuildBoards, persistIsReports, getPack,
};
