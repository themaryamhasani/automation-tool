class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function camelRow(row) {
  if (!row) return row;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()),
    value,
  ]));
}

function cleanText(value, max = 10_000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function parsePositiveInt(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function pagination(query) {
  const page = parsePositiveInt(query.page, 1, 1, 100_000);
  const limit = parsePositiveInt(query.limit, 10, 1, 100);
  return { page, limit, offset: (page - 1) * limit };
}

function paged(data, total, page, limit) {
  return { data, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

module.exports = { ApiError, asyncRoute, camelRow, cleanText, parsePositiveInt, pagination, paged };
