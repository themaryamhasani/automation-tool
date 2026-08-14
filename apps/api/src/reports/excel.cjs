const JSZip = require('jszip');
const { STATUS_LABELS } = require('./catalog.cjs');

function xmlEscape(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colLetter(index) {
  let n = index + 1;
  let text = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    text = String.fromCharCode(65 + rem) + text;
    n = Math.floor((n - 1) / 26);
  }
  return text;
}

function sheetName(name, used) {
  let base = String(name || 'Sheet').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let candidate = base;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` ${i}`;
    candidate = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    i += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function cellXml(ref, value) {
  if (value == null || value === '') return `<c r="${ref}"/>`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" t="n"><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function excelValue(column, row) {
  const value = row?.[column.key];
  if (value == null || value === '') return '';
  if (column.format === 'status') return STATUS_LABELS[value] || String(value);
  if (column.format === 'datetime') {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }
  if (column.format === 'percent') {
    const num = Number(value);
    return Number.isFinite(num) ? num : String(value);
  }
  if (column.format === 'number' || column.format === 'duration') {
    const num = Number(value);
    return Number.isFinite(num) ? num : String(value);
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function worksheetXml(columns, rows) {
  const header = columns.map((column, index) => cellXml(`${colLetter(index)}1`, column.label)).join('');
  const body = rows.map((row, rowIndex) => {
    const r = rowIndex + 2;
    const cells = columns.map((column, index) => cellXml(`${colLetter(index)}${r}`, excelValue(column, row))).join('');
    return `<row r="${r}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${header}</row>${body}</sheetData></worksheet>`;
}

function twoColSheet(rows) {
  return worksheetXml(
    [{ key: 'label', label: 'شاخص', format: 'text' }, { key: 'value', label: 'مقدار', format: 'text' }],
    rows,
  );
}

async function buildWorkbook({ title, generatedAt, filters, kpis, tables }) {
  const zip = new JSZip();
  const used = new Set();
  const sheets = [];
  const filterText = Object.entries(filters || {})
    .filter(([, value]) => value != null && value !== '' && !(Array.isArray(value) && !value.length))
    .map(([key, value]) => ({ label: key, value: Array.isArray(value) ? value.join(', ') : String(value) }));
  sheets.push({
    name: sheetName('شاخص‌ها', used),
    xml: twoColSheet([
      { label: 'گزارش', value: title || '' },
      { label: 'زمان تولید', value: generatedAt || new Date().toISOString() },
      ...filterText,
      ...(kpis || []).map(item => ({
        label: item.label,
        value: item.value == null ? '' : item.unit === 'percent' ? `${item.value}` : item.value,
      })),
    ]),
  });
  for (const table of tables || []) {
    sheets.push({
      name: sheetName(table.title || table.id, used),
      xml: worksheetXml(table.columns || [], table.rows || []),
    });
  }

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}
</Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}
</sheets>
</workbook>`);
  sheets.forEach((sheet, index) => zip.file(`xl/worksheets/sheet${index + 1}.xml`, sheet.xml));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function excelFileName(reportId, applied = {}) {
  const from = applied.from || 'all';
  const to = applied.to || 'now';
  return `report-${reportId}-${from}-${to}.xlsx`;
}

module.exports = { buildWorkbook, excelFileName };
