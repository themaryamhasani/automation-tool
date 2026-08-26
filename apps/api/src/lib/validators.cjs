const { ApiError, cleanText } = require('../http.cjs');

const FILE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.spec\.(?:ts|js)|\.test\.(?:ts|js)|\.js)$/;
const FOLDER_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;
const TRACE_MODES = new Set(['off', 'on', 'retain-on-failure', 'on-first-retry']);
const REPORTERS = new Set(['html', 'json', 'junit']);

function validHttpUrl(value, required = false) {
  const text = cleanText(value, 2000);
  if (!text && !required) return null;
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    return parsed.toString().replace(/\/$/, '');
  } catch { throw new ApiError(422, 'INVALID_URL', 'آدرس محیط باید یک URL معتبر HTTP یا HTTPS باشد.'); }
}

function environmentAvailability(body) {
  const parse = (value, field) => {
    if (value == null || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ApiError(422, 'ENVIRONMENT_AVAILABILITY_INVALID', `مقدار ${field} معتبر نیست.`);
    return date;
  };
  const availableFrom = parse(body?.availableFrom, 'availableFrom');
  const availableUntil = parse(body?.availableUntil, 'availableUntil');
  if (availableFrom && availableUntil && availableUntil <= availableFrom) {
    throw new ApiError(422, 'ENVIRONMENT_AVAILABILITY_INVALID', 'پایان دسترسی باید بعد از شروع دسترسی باشد.');
  }
  return { availableFrom, availableUntil };
}

function environmentSecretReferences(value) {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(422, 'SECRET_REFERENCES_INVALID', 'Secret referenceها باید یک شیء JSON باشند.');
  }
  const entries = Object.entries(value);
  if (entries.length > 50) throw new ApiError(422, 'SECRET_REFERENCES_INVALID', 'حداکثر ۵۰ Secret reference مجاز است.');
  const result = {};
  for (const [targetName, sourceName] of entries) {
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(targetName)) {
      throw new ApiError(422, 'SECRET_REFERENCES_INVALID', 'نام متغیر مقصد باید با الگوی ENV_VARIABLE سازگار باشد.');
    }
    const source = String(sourceName || '');
    const envOk = /^[A-Z_][A-Z0-9_]{0,127}$/.test(source);
    const vaultOk = /^vault:[A-Za-z0-9._/-]+(?:#[A-Za-z0-9._-]+)?$/i.test(source);
    if (!envOk && !vaultOk) {
      throw new ApiError(422, 'SECRET_REFERENCES_INVALID', 'منبع Secret باید ENV یا vault:path#field باشد.');
    }
    result[targetName] = source;
  }
  return result;
}

module.exports = {
  FILE_NAME_PATTERN,
  FOLDER_PATTERN,
  TRACE_MODES,
  REPORTERS,
  validHttpUrl,
  environmentAvailability,
  environmentSecretReferences,
};
