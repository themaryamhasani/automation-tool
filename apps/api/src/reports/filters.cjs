const { ApiError, camelRow, cleanText, pagination } = require('../http.cjs');
const { isApproach, isTool } = require('../approaches/constants.cjs');
const { getReport, RUN_STATUSES } = require('./catalog.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPORT_LIMIT = 5_000;
const TABLE_LIMIT = 200;

function optionalUuid(value, field) {
  const text = cleanText(value, 80);
  if (!text) return null;
  if (!UUID.test(text)) throw new ApiError(422, 'INVALID_FILTER', `مقدار ${field} معتبر نیست.`);
  return text;
}

function dateOnly(value, field) {
  const text = cleanText(value, 32);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ApiError(422, 'INVALID_DATE', `تاریخ ${field} باید به‌صورت YYYY-MM-DD باشد.`);
  return text;
}

function buildRunFilters(user, query = {}, options = {}) {
  const values = [];
  const clauses = [];
  const applied = {};
  const push = (clause, value) => {
    values.push(value);
    clauses.push(clause.replace(/\$idx/g, `$${values.length}`));
  };

  if (user.role !== 'ADMIN') {
    push('EXISTS (SELECT 1 FROM user_projects up WHERE up.project_id=r.project_id AND up.user_id=$idx)', user.id);
  }

  const projectId = optionalUuid(query.projectId, 'projectId');
  if (projectId) {
    push('r.project_id=$idx', projectId);
    applied.projectId = projectId;
  }
  const environmentId = optionalUuid(query.environmentId, 'environmentId');
  if (environmentId) {
    push('r.environment_id=$idx', environmentId);
    applied.environmentId = environmentId;
  }
  const requestedBy = optionalUuid(query.requestedBy, 'requestedBy');
  if (requestedBy) {
    push('r.requested_by=$idx', requestedBy);
    applied.requestedBy = requestedBy;
  }

  const from = dateOnly(query.from, 'from');
  const to = dateOnly(query.to, 'to');
  if (from && to && to < from) throw new ApiError(422, 'INVALID_DATE_RANGE', 'پایان بازه باید بعد از شروع باشد.');
  if (!options.ignoreDates) {
    if (from) {
      push('r.requested_at>=$idx::date', from);
      applied.from = from;
    }
    if (to) {
      push('r.requested_at<($idx::date + interval \'1 day\')', to);
      applied.to = to;
    }
  }

  const status = cleanText(query.status, 30);
  if (status) {
    if (!RUN_STATUSES.includes(status)) throw new ApiError(422, 'INVALID_STATUS', 'وضعیت اجرا معتبر نیست.');
    push('r.status=$idx', status);
    applied.status = status;
  }
  const sourceApproach = cleanText(query.sourceApproach, 30).toUpperCase();
  if (sourceApproach) {
    if (!isApproach(sourceApproach)) throw new ApiError(422, 'INVALID_APPROACH', 'اپروچ منبع معتبر نیست.');
    push('r.source_approach=$idx', sourceApproach);
    applied.sourceApproach = sourceApproach;
  }
  const toolKind = cleanText(query.toolKind, 32).toUpperCase();
  const defaultTools = options.defaultToolKinds;
  if (toolKind) {
    if (!isTool(toolKind)) throw new ApiError(422, 'INVALID_TOOL', 'ابزار معتبر نیست.');
    push('r.tool_kind=$idx', toolKind);
    applied.toolKind = toolKind;
  } else if (Array.isArray(defaultTools) && defaultTools.length) {
    push('r.tool_kind = ANY($idx::text[])', defaultTools);
    applied.toolKindDefault = defaultTools;
  }
  const packId = cleanText(query.packId, 80);
  if (packId) {
    push('r.pack_id=$idx', packId);
    applied.packId = packId;
  }
  const search = cleanText(query.search, 500);
  if (search) {
    push('(r.test_file_path ILIKE $idx OR p.name ILIKE $idx OR coalesce(r.pack_id,\'\') ILIKE $idx OR coalesce(r.flow_id,\'\') ILIKE $idx)', `%${search}%`);
    applied.search = search;
  }

  return {
    values,
    clauses,
    sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    applied,
  };
}

function andWhere(filters, extraSql) {
  if (!extraSql) return filters.sql;
  return filters.sql ? `${filters.sql} AND ${extraSql}` : `WHERE ${extraSql}`;
}

function nextParams(filters, extras = []) {
  return [...filters.values, ...extras];
}

async function requireProjectAccess(ensureProjectAccess, user, query) {
  const projectId = optionalUuid(query.projectId, 'projectId');
  if (projectId) await ensureProjectAccess(user, projectId);
}

function mapRows(rows) {
  return rows.map(camelRow);
}

function requireKnownReport(id) {
  const report = getReport(id);
  if (!report) throw new ApiError(404, 'REPORT_NOT_FOUND', 'گزارش درخواستی پیدا نشد.');
  return report;
}

function pageFor(query) {
  return pagination(query);
}

module.exports = {
  EXPORT_LIMIT,
  TABLE_LIMIT,
  buildRunFilters,
  andWhere,
  nextParams,
  requireProjectAccess,
  mapRows,
  requireKnownReport,
  pageFor,
};
