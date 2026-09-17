/**
 * Harden Chrome-recorder Playwright sources for MUI Autocomplete / Select.
 * Live CRX replay often succeeds with exact option names; headless Runner runs
 * are flaky unless options are scoped to the open listbox and matched loosely
 * after a filter fill.
 *
 * Runner mode (`withOptionHelper: true`) also injects a helper that filters,
 * loosely matches, scrolls virtualized lists, and lists visible options on failure.
 */

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unquote(raw) {
  return String(raw || '').replace(/\\(['"\\])/g, '$1');
}

function optionMatcherFromLine(line) {
  const regex = line.match(
    /getByRole\(\s*['"]option['"]\s*,\s*\{\s*name:\s*\/((?:\\\/|[^/])+)\/([gimsuy]*)\s*(?:,\s*exact:\s*\w+)?\s*\}\s*\)/,
  );
  if (regex) {
    return { kind: 'regex', pattern: regex[1], flags: regex[2] || '' };
  }
  const literal = line.match(
    /getByRole\(\s*['"]option['"]\s*,\s*\{\s*name:\s*(['"])((?:\\.|(?!\1).)*)\1(?:\s*,\s*exact:\s*\w+)?\s*\}\s*\)/,
  );
  if (literal) {
    return { kind: 'literal', value: unquote(literal[2]) };
  }
  return null;
}

function nameExprFromMatcher(matcher) {
  if (!matcher) return 'undefined';
  if (matcher.kind === 'regex') return `/${matcher.pattern}/${matcher.flags || ''}`;
  return JSON.stringify(matcher.value);
}

function expectedLabelFromMatcher(matcher) {
  if (!matcher) return 'option';
  if (matcher.kind === 'regex') return matcher.pattern.replace(/\\(.)/g, '$1');
  return matcher.value;
}

function filterTokenFromLabel(label) {
  const text = String(label || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const words = text.split(/[\s،,()（）/\-_|]+/).map(item => item.trim()).filter(item => item.length >= 3);
  if (words.length) return words[0].slice(0, 24);
  return text.slice(0, 16);
}

function optionClickHelperSource() {
  return [
    'async function __automationClickOption(page, name, expectedLabel) {',
    "  const label = String(expectedLabel || name || 'option');",
    "  const listbox = page.getByRole('listbox');",
    '  try {',
    "    await listbox.waitFor({ state: 'visible', timeout: 8_000 });",
    '  } catch {',
    '    throw new Error(',
    "      'لیست گزینه‌ها باز نشد. روی سرور فرم از صفر شروع می‌شود — کل فرم را از صفحهٔ تازه ضبط کنید (نه وسط فرم قبلی).',",
    '    );',
    '  }',
    '',
    '  const normalize = (value) => String(value || \'\')',
    "    .replace(/[ي]/g, 'ی')",
    "    .replace(/[ك]/g, 'ک')",
    "    .replace(/\\s+/g, ' ')",
    '    .trim()',
    '    .toLowerCase();',
    '',
    '  const readLabels = async () => {',
    '    try {',
    "      return (await listbox.getByRole('option').allTextContents())",
    '        .map(item => String(item || \'\').trim())',
    '        .filter(Boolean);',
    '    } catch {',
    '      return [];',
    '    }',
    '  };',
    '',
    '  const clickMatcher = async (matcher, timeout = 4_000) => {',
    "    await listbox.getByRole('option', { name: matcher }).first().click({ timeout });",
    '  };',
    '',
    '  const clickByIncludes = async (wantedRaw, tokenRaw = \'\') => {',
    '    const wanted = normalize(wantedRaw);',
    '    const token = normalize(tokenRaw);',
    "    const options = listbox.getByRole('option');",
    '    const count = await options.count();',
    '    for (let i = 0; i < count; i += 1) {',
    '      const option = options.nth(i);',
    "      const text = normalize(await option.innerText().catch(() => ''));",
    '      if (!text) continue;',
    '      if (text === wanted || text.includes(wanted) || wanted.includes(text) || (token && text.includes(token))) {',
    '        await option.scrollIntoViewIfNeeded().catch(() => undefined);',
    '        await option.click({ timeout: 4_000 });',
    '        return true;',
    '      }',
    '    }',
    '    return false;',
    '  };',
    '',
    '  try {',
    '    await clickMatcher(name, 3_500);',
    '    return;',
    '  } catch {',
    '    /* filter + loose match */',
    '  }',
    '',
    '  const filter = (() => {',
    "    const text = label.replace(/\\s+/g, ' ').trim();",
    '    const words = text.split(/[\\s،,()（）\\/\\-_|]+/).map(item => item.trim()).filter(item => item.length >= 3);',
    '    return (words[0] || text).slice(0, 24);',
    '  })();',
    '',
    '  if (filter) {',
    '    try {',
    "      const expanded = page.locator('[role=\"combobox\"][aria-expanded=\"true\"]').first();",
    '      if (await expanded.count()) {',
    '        await expanded.click({ timeout: 2_000 }).catch(() => undefined);',
    "        await expanded.fill('');",
    '        await expanded.fill(filter);',
    '      } else {',
    '        await page.keyboard.type(filter, { delay: 35 });',
    '      }',
    '      await page.waitForTimeout(700);',
    '    } catch {',
    '      /* keep trying options */',
    '    }',
    '  }',
    '',
    '  try {',
    '    const looseSource = filter || label;',
    "    const escaped = String(looseSource).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&').replace(/\\\\s+/g, '\\\\s+').replace(/\\s+/g, '\\\\s+');",
    '    await clickMatcher(new RegExp(escaped, \'i\'), 5_000);',
    '    return;',
    '  } catch {',
    '    /* fall through */',
    '  }',
    '',
    '  if (await clickByIncludes(label, filter)) return;',
    '',
    '  try {',
    '    for (let i = 0; i < 16; i += 1) {',
    '      if (await clickByIncludes(label, filter)) return;',
    "      await page.keyboard.press('ArrowDown');",
    '      await page.waitForTimeout(120);',
    '    }',
    '  } catch {',
    '    /* ignore */',
    '  }',
    '',
    '  const visible = (await readLabels()).slice(0, 40);',
    '  throw new Error(',
    '    visible.length',
    '      ? `گزینه "${label}" پیدا نشد؛ گزینه‌های موجود: ${visible.join(\' | \')}. اگر لیست وابسته است، فیلدهای قبلی (نوع مدرسه/جنسیت/تعداد) را درست انتخاب کنید یا گزینه را با تایپ فیلتر کنید.`',
    '      : `گزینه "${label}" پیدا نشد؛ لیست گزینه‌ها خالی بود. سرور با فرم خالی شروع می‌کند — کل فرم را از ابتدا ضبط کنید.`,',
    '  );',
    '}',
  ].join('\n');
}

function gotoHelperSource() {
  return [
    'async function __automationGoto(page, url, options) {',
    "  const target = String(url || '');",
    '  await page.goto(url, options);',
    "  try { await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }); } catch { /* ignore */ }",
    '  try { await page.waitForTimeout(800); } catch { /* ignore */ }',
    "  let landed = '';",
    "  try { landed = page.url(); } catch { landed = ''; }",
    '  if (!target || !landed) return;',
    '  let wanted;',
    '  let got;',
    '  try { wanted = new URL(target, landed); } catch { return; }',
    '  try { got = new URL(landed); } catch { return; }',
    "  const wantedPath = wanted.pathname.replace(/\\/+$/, '') || '/';",
    "  const landedPath = got.pathname.replace(/\\/+$/, '') || '/';",
    '  const loginHost = /(^|\\.)soha\\.(m\\.)?(edus|medu)\\.ir$/i.test(got.hostname)',
    "    || /\\/(login|signin|sso|auth|devlogin)(\\/|$)/i.test(landedPath);",
    '  const collapsedHome = landedPath !== wantedPath',
    "    && !landedPath.startsWith(wantedPath + '/')",
    '    && landedPath.split(\'/\').filter(Boolean).length < wantedPath.split(\'/\').filter(Boolean).length;',
    '  if (!loginHost && !collapsedHome) {',
    "    if (landedPath === wantedPath || landedPath.startsWith(wantedPath + '/')) return;",
    '    return;',
    '  }',
    '  throw new Error(',
    "    'نشست ورود روی سرور ناقص بود و صفحه به ورود/خانه برگشت (' + got.hostname + landedPath + ' به جای ' + wanted.hostname + wantedPath + '). '",
    "    + 'در افزونه روی تب لاگین‌شدهٔ adib بمانید، Reload کنید، دوباره Save & Run بزنید تا کوکی‌های soha هم ارسال شوند.',",
    '  );',
    '}',
  ].join('\n');
}

function injectAfterImports(source, helper) {
  const importMatch = source.match(/^(import[\s\S]*?;\s*\n)/m);
  if (importMatch) {
    const start = importMatch[0].length;
    return `${source.slice(0, start)}\n${helper}\n${source.slice(start)}`;
  }
  return `${helper}\n\n${source}`;
}

function injectRunnerHelpers(source) {
  let next = source;
  if (!/async function __automationClickOption/.test(next)) {
    next = injectAfterImports(next, optionClickHelperSource());
  }
  if (!/async function __automationGoto/.test(next)) {
    next = injectAfterImports(next, gotoHelperSource());
  }
  return next;
}

function rewriteGotos(source) {
  return source.replace(
    /await\s+page\.goto\(([\s\S]*?)\);/g,
    (match, args) => {
      if (/__automationGoto/.test(match)) return match;
      return `await __automationGoto(page, ${String(args).trim()});`;
    },
  );
}

function rewriteOptionClicks(source) {
  return source.replace(
    /await\s+(?:page\.)?getByRole\(\s*['"]listbox['"]\s*\)\.getByRole\(\s*['"]option['"]\s*,\s*\{[^}]*\}\s*\)(?:\.first\(\))?\s*\.click\(\s*(?:\{[^}]*\}\s*)?\);/g,
    (match) => {
      const matcher = optionMatcherFromLine(match);
      if (!matcher) return match;
      return `await __automationClickOption(page, ${nameExprFromMatcher(matcher)}, ${JSON.stringify(expectedLabelFromMatcher(matcher))});`;
    },
  ).replace(
    /await\s+page\.getByRole\(\s*['"]option['"]\s*,\s*\{[^}]*\}\s*\)(?:\.first\(\))?\s*\.click\(\s*(?:\{[^}]*\}\s*)?\);/g,
    (match) => {
      if (/listbox/.test(match) || /__automationClickOption/.test(match)) return match;
      const matcher = optionMatcherFromLine(match);
      if (!matcher) return match;
      return `await __automationClickOption(page, ${nameExprFromMatcher(matcher)}, ${JSON.stringify(expectedLabelFromMatcher(matcher))});`;
    },
  );
}

/**
 * For combobox.click() → option without fill, inject a filter fill so MUI Autocomplete
 * loads/filters the long dependent option lists (e.g. اردو frameworks).
 */
function injectFilterFillsBeforeOptions(source) {
  return source.replace(
    /await\s+page\.getByRole\(\s*['"]combobox['"]\s*,\s*(\{[\s\S]*?\})\s*\)\.click\(\s*\);\s*\n(\s*)await __automationClickOption\(page,\s*([\s\S]*?)\);/g,
    (match, comboOpts, indent, args) => {
      const parts = String(args || '').match(/^\s*([\s\S]*?)\s*,\s*((['"])(?:\\.|(?!\3).)*\3|\S+)\s*$/);
      if (!parts) return match;
      const nameExpr = parts[1].trim();
      const labelExpr = parts[2].trim();
      const labelLiteral = labelExpr.match(/^(['"])([\s\S]*)\1$/);
      const label = labelLiteral ? unquote(labelLiteral[2]) : '';
      const token = filterTokenFromLabel(label);
      if (!token) return match;
      return [
        `await page.getByRole('combobox', ${comboOpts}).click();`,
        `${indent}await page.getByRole('combobox', ${comboOpts}).fill(${JSON.stringify(token)});`,
        `${indent}await __automationClickOption(page, ${nameExpr}, ${labelExpr});`,
      ].join('\n');
    },
  );
}

function hardenRecordedSource(source, options = {}) {
  const withOptionHelper = Boolean(options.withOptionHelper);
  const text = String(source || '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return text;
  const lines = text.split('\n');
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] || '';
    const fill = line.match(
      /getByRole\(\s*['"]combobox['"]\s*,\s*\{[^}]*\}\s*\)\.fill\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*\)/,
    );
    const optionNext = next.match(
      /page\.getByRole\(\s*['"]option['"]\s*,\s*\{\s*name:\s*(['"])((?:\\.|(?!\1).)*)\1/,
    );
    if (fill && optionNext && !/listbox/.test(next) && !/__automationClickOption/.test(next)) {
      out.push(line);
      const filter = unquote(fill[2]).trim();
      const pattern = escapeRegExp(filter).replace(/\\\s+/g, '\\s+').replace(/\s+/g, '\\s+');
      out.push(
        next.replace(
          /page\.getByRole\(\s*['"]option['"]\s*,\s*\{[^}]*\}\s*\)/,
          `page.getByRole('listbox').getByRole('option', { name: /${pattern}/ })`,
        ),
      );
      index += 1;
      continue;
    }
    if (/page\.getByRole\(\s*['"]option['"]/.test(line)
      && !/listbox/.test(line)
      && !/__automationClickOption/.test(line)) {
      out.push(line.replace(
        /page\.getByRole\(\s*['"]option['"]/,
        "page.getByRole('listbox').getByRole('option'",
      ));
      continue;
    }
    out.push(line);
  }
  let hardened = out.join('\n');
  if (withOptionHelper) {
    hardened = rewriteOptionClicks(hardened);
    hardened = injectFilterFillsBeforeOptions(hardened);
    hardened = rewriteGotos(hardened);
    hardened = injectRunnerHelpers(hardened);
  }
  return hardened;
}

module.exports = {
  hardenRecordedSource,
  escapeRegExp,
  filterTokenFromLabel,
  injectRunnerHelpers,
  injectOptionHelper: injectRunnerHelpers,
  injectFilterFillsBeforeOptions,
  rewriteOptionClicks,
  rewriteGotos,
};
