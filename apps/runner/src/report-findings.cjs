'use strict';

/**
 * Unified failure findings for every approach (IS / CDE / Git / Zip / classic).
 * Each FAIL gets: clear error, source path, and an actionable solution hint.
 */

const fs = require('node:fs');
const path = require('node:path');

const PATH_RE = /(?:[A-Za-z]:)?(?:[\\/][\w.@+-]+)+\.(?:ts|tsx|js|jsx|mjs|cjs|py|yaml|yml|json|md)(?::\d+(?::\d+)?)?/g;
const REL_SPEC_RE = /(?:specs|scripts|tests|e2e|src)[\\/][\w.@/\\+-]+\.(?:spec|test)\.(?:ts|js|mjs|cjs)/i;

function firstMatch(re, text) {
  const m = String(text || '').match(re);
  return m ? m[0] : null;
}

function normalizePath(value) {
  if (!value) return null;
  return String(value).replace(/\\/g, '/').trim();
}

function extractErrorPath(detail = {}, out = '') {
  if (detail.path) return normalizePath(detail.path);
  if (detail.file) {
    const line = detail.line != null ? `:${detail.line}` : '';
    const col = detail.column != null ? `:${detail.column}` : '';
    return normalizePath(`${detail.file}${line}${col}`);
  }
  const blob = [detail.error, detail.title, out].filter(Boolean).join('\n');
  const fromStack = firstMatch(/(?:at\s+)?((?:[A-Za-z]:)?(?:[\\/][\w.@+-]+)+\.(?:ts|tsx|js|jsx|mjs|cjs)(?::\d+(?::\d+)?))/i, blob);
  if (fromStack) return normalizePath(fromStack.replace(/^at\s+/, ''));
  const abs = firstMatch(PATH_RE, blob);
  if (abs) return normalizePath(abs);
  const rel = firstMatch(REL_SPEC_RE, blob);
  if (rel) return normalizePath(rel);
  const titleFile = firstMatch(/([\w.-]+\.(?:spec|test)\.(?:ts|js|mjs|cjs))/i, detail.title || '');
  return titleFile ? normalizePath(titleFile) : null;
}

function solutionHint({ toolKind, error, title, path: errorPath, outcome } = {}) {
  if (outcome === 'skipped') {
    if (/storageState|PREREG_COOKIE|E2E_STORAGE|لاگین|auth/i.test(`${error || ''} ${title || ''}`)) {
      return 'فایل احراز هویت Playwright را بسازید (`scripts/e2e/.auth` یا `E2E_STORAGE_STATE` / `PREREG_COOKIE`) و دوباره setup را اجرا کنید.';
    }
    if (/INSTANCE_ID|G10_INSTANCE|MID_INSTANCE/i.test(`${error || ''} ${title || ''}`)) {
      return 'شناسه instance را در `.env` پک تنظیم کنید (`E2E_G10_INSTANCE_ID` / `E2E_MID_INSTANCE_ID`)؛ بدون آن TC مربوطه SKIP می‌شود.';
    }
    return 'SKIP معمولاً به‌خاطر نبود پیش‌نیاز است؛ عنوان/توضیح skip را بخوانید و env یا دادهٔ لازم را تکمیل کنید.';
  }
  if (outcome !== 'unexpected' && !error) return null;

  const text = `${error || ''}\n${title || ''}\n${errorPath || ''}`;
  const kind = String(toolKind || '').toUpperCase();

  if (/Requiring @playwright\/test second time|two different versions of @playwright\/test/i.test(text)) {
    return 'دو نصب Playwright دارید (معمولاً `scripts/e2e/node_modules` و ریشهٔ monorepo). با رانر automation اجرا کنید یا یکی از نصب‌ها را حذف/همسان کنید.';
  }
  if (/Named export .+ is a CommonJS module|CommonJS modules can always be imported/i.test(text)) {
    return 'برای پوشهٔ shared که named import می‌شود `package.json` با `"type":"module"` بگذارید (مثلاً `test/doc/_shared/package.json`) تا Playwright helpers را ESM کند.';
  }
  if (/Executable doesn't exist|browserType\.launch|Please run npx playwright install/i.test(text)) {
    return 'مرورگر Playwright نصب نیست: در پوشهٔ e2e دستور `npx playwright install chromium` (یا `PW_CHANNEL=chrome`) را اجرا کنید.';
  }
  if (/ECONNREFUSED|net::ERR_CONNECTION_REFUSED|connect ECONNREFUSED/i.test(text)) {
    return 'سرویس هدف بالا نیست. URL پایه (`E2E_BASE_URL` / gateway / MF) و سلامت پورت را چک کنید؛ بعد دوباره ران بگیرید.';
  }
  if (/Timeout|exceeded|waiting for/i.test(text) && /locator|getBy|selector|visible/i.test(text)) {
    return 'سلکتور/متن UI پیدا نشد یا دیر لود شد. مسیر فایل تست را باز کنید، loading را صبر کنید، و با storageState معتبر صفحهٔ واقعی را ببینید.';
  }
  if (/صفحه نباید خالی|در حال بارگذاری|meaningfulBody|assertBodyAlive|assertLoggedInShell/i.test(text)) {
    return 'داشبورد قبل از اتمام loading assert شده یا سشن ناقص است. auth setup را تازه کنید و `waitAppIdle` را با timeout کافی نگه دارید.';
  }
  if (/No tests found/i.test(text)) {
    return 'هیچ تستی با فیلتر فعلی match نشد یا لود spec شکست خورد. مسیر `tool_target`/spec و خطای Syntax بالای لاگ را بررسی کنید.';
  }
  if (kind === 'K6' && /level=error|thresholds|status 5\d\d/i.test(text)) {
    return 'k6 به endpoint خطا یا threshold شکست خورده. اسکریپت و `BASE_URL` را با پاسخ واقعی API تطبیق دهید.';
  }
  if (kind === 'VITEST' && /FAIL|AssertionError|Cannot find module/i.test(text)) {
    return 'تست واحد fail شده یا ماژول resolve نشده. مسیر فایل تست/import را از stack بخوانید و وابستگی را نصب کنید.';
  }
  if (kind === 'DANGER' && /\bFAIL\b/.test(text)) {
    return 'TC خطر (API) قرمز است. همان شناسهٔ TC را در raw danger پیدا کنید؛ معمولاً env، instance یا قرارداد API اشتباه است.';
  }
  if (/ENOENT|not found|پیدا نشد/i.test(text)) {
    return errorPath
      ? `مسیر \`${errorPath}\` در دسترس نیست؛ وجود فایل و cwd اجرا را چک کنید.`
      : 'فایل یا باینری پیدا نشد؛ مسیر نسبی را نسبت به cwd پک/ریپو اصلاح کنید.';
  }
  if (errorPath) {
    return `ابتدا فایل \`${errorPath}\` را باز کنید، assertion/لاگ همان تست را بخوانید، پیش‌نیاز env و سرویس را درست کنید، سپس همان spec را جداگانه rerun کنید.`;
  }
  return 'لاگ خام و stack را بخوانید؛ علت را در assertion یا پیش‌نیاز env/سرویس رفع کنید و همان دستور اجرا را تکرار کنید.';
}

function enrichDetail(detail, { toolKind, out } = {}) {
  const next = { ...detail };
  const errorPath = extractErrorPath(next, out);
  if (errorPath) next.path = errorPath;
  const hint = solutionHint({
    toolKind,
    error: next.error,
    title: next.title,
    path: errorPath,
    outcome: next.outcome,
  });
  if (hint) next.hint = hint;
  return next;
}

function enrichSummary(stats, { toolKind, out } = {}) {
  const base = stats || { pass: 0, fail: 0, skip: 0, total: 0, summary: 'n/a', details: [] };
  const details = Array.isArray(base.details)
    ? base.details.map(item => enrichDetail(item, { toolKind, out }))
    : [];
  return { ...base, details };
}

function failedFindings(details = []) {
  return details.filter(item => item && (item.outcome === 'unexpected' || (item.error && item.outcome !== 'skipped' && item.outcome !== 'expected')));
}

function formatFindingsMarkdown(details, { approach, toolKind, command, when } = {}) {
  const fails = failedFindings(details);
  const skips = (details || []).filter(item => item.outcome === 'skipped' && item.error);
  const lines = [];
  lines.push('# گزارش یافته‌ها و راهنمای رفع');
  lines.push('');
  lines.push('| فیلد | مقدار |');
  lines.push('|------|--------|');
  lines.push(`| تاریخ | ${when || new Date().toISOString()} |`);
  if (approach) lines.push(`| اپروچ | \`${approach}\` |`);
  if (toolKind) lines.push(`| ابزار | \`${toolKind}\` |`);
  if (command) lines.push(`| دستور | \`${command}\` |`);
  lines.push(`| FAIL | **${fails.length}** |`);
  lines.push(`| SKIP با توضیح | ${skips.length} |`);
  lines.push('');

  if (!fails.length && !skips.length) {
    lines.push('## نتیجه');
    lines.push('');
    lines.push('یافتهٔ FAIL ثبت نشد. برای جزئیات به raw و تخته وضعیت مراجعه کنید.');
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  if (fails.length) {
    lines.push('## FAILها — مسیر خطا و راهنمای رفع');
    lines.push('');
    fails.forEach((item, index) => {
      lines.push(`### ${index + 1}. ${item.title || 'بدون عنوان'}`);
      lines.push('');
      lines.push('- **وضعیت:** FAIL');
      lines.push(`- **مسیر ایجاد خطا:** \`${item.path || 'نامشخص — stack/لاگ را ببینید'}\``);
      if (item.projectName) lines.push(`- **پروژه/فلو:** \`${item.projectName}\``);
      lines.push('- **خطا (شفاف):**');
      lines.push('');
      lines.push('```');
      lines.push(String(item.error || 'پیام خطا در خروجی نبود.').trim());
      lines.push('```');
      lines.push('');
      lines.push(`- **Hint / راه‌حل پیشنهادی:** ${item.hint || solutionHint({ toolKind, error: item.error, title: item.title, path: item.path, outcome: 'unexpected' })}`);
      lines.push('');
    });
  }

  if (skips.length) {
    lines.push('## SKIPهای توضیح‌دار');
    lines.push('');
    skips.forEach((item, index) => {
      lines.push(`### S${index + 1}. ${item.title || 'skip'}`);
      lines.push('');
      lines.push(`- **مسیر/زمینه:** \`${item.path || item.title || '—'}\``);
      lines.push(`- **توضیح:** ${item.error}`);
      lines.push(`- **Hint:** ${item.hint || solutionHint({ toolKind, error: item.error, title: item.title, path: item.path, outcome: 'skipped' })}`);
      lines.push('');
    });
  }

  lines.push('## قرارداد گزارش');
  lines.push('');
  lines.push('این فایل برای **همهٔ اپروچ‌ها** یکسان است: خطا شفاف، مسیر فایل/تستی که باعث FAIL شده، و Hint عملی برای رفع.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function formatFindingsSection(details, { toolKind } = {}) {
  const fails = failedFindings(details);
  if (!fails.length) {
    return `## یافته‌های FAIL و راهنمای رفع

یافتهٔ FAIL در این اجرا نبود.
`;
  }
  const blocks = fails.map((item, index) => `### ${index + 1}. ${item.title || 'FAIL'}

| فیلد | مقدار |
|------|--------|
| مسیر ایجاد خطا | \`${item.path || 'نامشخص'}\` |
| فلو/پروژه | \`${item.projectName || '—'}\` |

**خطا**

\`\`\`
${String(item.error || '').trim() || '—'}
\`\`\`

**Hint / راه‌حل:** ${item.hint || solutionHint({ toolKind, error: item.error, title: item.title, path: item.path, outcome: 'unexpected' })}
`);
  return `## یافته‌های FAIL و راهنمای رفع

${blocks.join('\n')}
`;
}

function writeFindingsReport(root, {
  approach, toolKind, command, when, stats, out,
} = {}) {
  const enriched = enrichSummary(stats, { toolKind, out });
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, '02-findings.md');
  fs.writeFileSync(target, formatFindingsMarkdown(enriched.details, {
    approach, toolKind, command, when,
  }), 'utf8');
  return { file: target, stats: enriched };
}

module.exports = {
  extractErrorPath,
  solutionHint,
  enrichDetail,
  enrichSummary,
  failedFindings,
  formatFindingsMarkdown,
  formatFindingsSection,
  writeFindingsReport,
};
