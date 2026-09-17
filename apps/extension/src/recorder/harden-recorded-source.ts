/**
 * Harden Chrome-recorder Playwright sources for MUI Autocomplete / Select.
 * Kept in TypeScript so the side panel never depends on Node `require`.
 */

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unquote(raw: string): string {
  return String(raw || '').replace(/\\(['"\\])/g, '$1');
}

export function hardenRecordedSource(source: string): string {
  const text = String(source || '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return text;
  const lines = text.split('\n');
  const out: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] || '';
    const fill = line.match(
      /getByRole\(\s*['"]combobox['"]\s*,\s*\{[^}]*\}\s*\)\.fill\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*\)/,
    );
    const optionNext = next.match(
      /page\.getByRole\(\s*['"]option['"]\s*,\s*\{\s*name:\s*(['"])((?:\\.|(?!\1).)*)\1/,
    );
    const comboClick = line.match(
      /await\s+page\.getByRole\(\s*['"]combobox['"]\s*,\s*(\{[\s\S]*?\})\s*\)\.click\(\s*\);/,
    );
    const optionClick = next.match(
      /await\s+(?:page\.)?(?:getByRole\(\s*['"]listbox['"]\s*\)\.)?getByRole\(\s*['"]option['"]\s*,\s*\{\s*name:\s*(['"])((?:\\.|(?!\1).)*)\1/,
    );
    if (comboClick && optionClick && !/\.fill\(/.test(line)) {
      const label = unquote(optionClick[2] || '').trim();
      const token = label.split(/[\s،,()（）/\-_|]+/).map(item => item.trim()).find(item => item.length >= 3) || label.slice(0, 16);
      out.push(line);
      if (token) {
        out.push(`await page.getByRole('combobox', ${comboClick[1]}).fill(${JSON.stringify(token)});`);
      }
      if (/page\.getByRole\(\s*['"]option['"]/.test(next) && !/listbox/.test(next)) {
        out.push(next.replace(
          /page\.getByRole\(\s*['"]option['"]/,
          "page.getByRole('listbox').getByRole('option'",
        ));
      } else {
        out.push(next);
      }
      index += 1;
      continue;
    }
    if (fill && optionNext && !/listbox/.test(next)) {
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
    if (/page\.getByRole\(\s*['"]option['"]/.test(line) && !/listbox/.test(line)) {
      out.push(line.replace(
        /page\.getByRole\(\s*['"]option['"]/,
        "page.getByRole('listbox').getByRole('option'",
      ));
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}
