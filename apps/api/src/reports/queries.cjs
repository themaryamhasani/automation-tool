const { TOOL_IDS, TOOL_KINDS, SECURITY_TOOLS } = require('./catalog.cjs');
const { andWhere, buildRunFilters, mapRows, nextParams, pageFor, TABLE_LIMIT, EXPORT_LIMIT } = require('./filters.cjs');

const FROM_RUNS = `FROM runs r JOIN projects p ON p.id=r.project_id JOIN environments e ON e.id=r.environment_id JOIN users u ON u.id=r.requested_by`;
const PASS_RATE = `CASE WHEN count(*) FILTER (WHERE r.status IN ('PASSED','FAILED','ERROR')) = 0 THEN NULL ELSE round((100.0 * count(*) FILTER (WHERE r.status='PASSED') / count(*) FILTER (WHERE r.status IN ('PASSED','FAILED','ERROR')))::numeric, 1) END`;
const COUNTS = `
  count(*)::int AS total_runs,
  count(*) FILTER (WHERE r.status='PASSED')::int AS passed_runs,
  count(*) FILTER (WHERE r.status='FAILED')::int AS failed_runs,
  count(*) FILTER (WHERE r.status='ERROR')::int AS error_runs,
  count(*) FILTER (WHERE r.status='CANCELLED')::int AS cancelled_runs,
  count(*) FILTER (WHERE r.status IN ('PREPARING','QUEUED','RUNNING','CANCEL_REQUESTED'))::int AS in_flight,
  coalesce(sum(r.total_tests),0)::int AS total_tests,
  coalesce(sum(r.passed_tests),0)::int AS passed_tests,
  coalesce(sum(r.failed_tests),0)::int AS failed_tests,
  coalesce(sum(r.skipped_tests),0)::int AS skipped_tests,
  round(avg(r.duration_ms) FILTER (WHERE r.duration_ms IS NOT NULL))::int AS avg_duration_ms,
  ${PASS_RATE} AS pass_rate,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.duration_ms) FILTER (WHERE r.duration_ms IS NOT NULL))::int AS p50_duration_ms,
  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY r.duration_ms) FILTER (WHERE r.duration_ms IS NOT NULL))::int AS p95_duration_ms,
  round(avg(EXTRACT(EPOCH FROM (r.started_at - r.requested_at)) * 1000) FILTER (WHERE r.started_at IS NOT NULL))::int AS avg_queue_ms`;

function kpi(key, label, value, unit) {
  return { key, label, value: value == null ? null : value, unit: unit || (typeof value === 'number' ? 'number' : 'text') };
}

function asNumber(value) {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function fetchRows(pool, sql, values) {
  const result = await pool.query(sql, values);
  return mapRows(result.rows);
}

async function summary(pool, filters) {
  const rows = await fetchRows(pool, `SELECT ${COUNTS}, count(DISTINCT r.project_id)::int AS project_count, count(DISTINCT r.environment_id)::int AS environment_count ${FROM_RUNS} ${filters.sql}`, filters.values);
  return rows[0] || {};
}

function unusedTools(usedKinds, catalog = TOOL_IDS) {
  const used = new Set(usedKinds);
  return catalog.filter(id => !used.has(id)).map(toolKind => ({
    toolKind,
    label: TOOL_KINDS[toolKind]?.label || toolKind,
  }));
}

async function groupBy(pool, filters, select, groupBySql, order, limit) {
  const params = nextParams(filters, limit ? [limit] : []);
  const limitSql = limit ? ` LIMIT $${params.length}` : '';
  return fetchRows(
    pool,
    `SELECT ${select} ${FROM_RUNS} ${filters.sql} GROUP BY ${groupBySql} ORDER BY ${order}${limitSql}`,
    params,
  );
}

async function loadExecutive(pool, filters) {
  const totals = await summary(pool, filters);
  const byProject = await groupBy(
    pool, filters,
    `p.name AS project_name, p.code AS project_code, p.source_approach, ${COUNTS}`,
    'p.id, p.name, p.code, p.source_approach',
    'total_runs DESC',
  );
  const byDay = await fetchRows(
    pool,
    `SELECT r.requested_at::date::text AS day, ${COUNTS} ${FROM_RUNS} ${filters.sql} GROUP BY 1 ORDER BY 1`,
    filters.values,
  );
  const atRiskProjects = byProject.filter(row => (row.passedRuns || 0) === 0 && ((row.failedRuns || 0) + (row.errorRuns || 0)) > 0);
  const topFailures = await fetchRows(
    pool,
    `SELECT p.name AS project_name, r.test_file_path, r.tool_kind,
            count(*) FILTER (WHERE r.status IN ('FAILED','ERROR'))::int AS fail_count,
            max(r.requested_at) FILTER (WHERE r.status IN ('FAILED','ERROR')) AS last_failed_at
       ${FROM_RUNS} ${filters.sql}
      GROUP BY p.name, r.test_file_path, r.tool_kind
     HAVING count(*) FILTER (WHERE r.status IN ('FAILED','ERROR')) > 0
      ORDER BY fail_count DESC, last_failed_at DESC NULLS LAST
      LIMIT ${TABLE_LIMIT}`,
    filters.values,
  );
  return {
    kpis: [
      kpi('totalRuns', 'کل اجراها', totals.totalRuns || 0),
      kpi('passRate', 'نرخ موفقیت', asNumber(totals.passRate), 'percent'),
      kpi('failedRuns', 'اجرای ناموفق', totals.failedRuns || 0),
      kpi('errorRuns', 'خطای سیستمی', totals.errorRuns || 0),
      kpi('failedTests', 'تست ناموفق', totals.failedTests || 0),
      kpi('avgDurationMs', 'میانگین مدت اجرا', totals.avgDurationMs, 'duration'),
      kpi('projectCount', 'پروژه‌های پوشش‌داده‌شده', totals.projectCount || 0),
      kpi('inFlight', 'در صف یا در حال اجرا', totals.inFlight || 0),
    ],
    charts: [
      { id: 'passRateByProject', title: 'نرخ موفقیت پروژه‌ها', items: byProject.map(row => ({ label: row.projectName, value: asNumber(row.passRate) || 0 })) },
      { id: 'runsByDay', title: 'حجم اجرای روزانه', items: byDay.map(row => ({ label: row.day, value: row.totalRuns || 0 })) },
    ],
    tables: { byProject, byDay, atRiskProjects, topFailures },
  };
}

async function loadEngineering(pool, user, query, filters) {
  const totals = await summary(pool, filters);
  const byApproach = await groupBy(
    pool, filters,
    `r.source_approach, ${COUNTS}`,
    'r.source_approach',
    'total_runs DESC',
  );
  const byTool = await groupBy(
    pool, filters,
    `r.tool_kind, ${COUNTS}`,
    'r.tool_kind',
    'total_runs DESC',
  );
  const byEnvironment = await groupBy(
    pool, filters,
    `p.name AS project_name, e.name AS environment_name, ${COUNTS}`,
    'p.name, e.name',
    'total_runs DESC',
    TABLE_LIMIT,
  );
  const liveFilters = buildRunFilters(user, query, { ignoreDates: true, defaultToolKinds: null });
  const liveQueue = await fetchRows(
    pool,
    `SELECT r.status, count(*)::int AS total_runs ${FROM_RUNS} ${andWhere(liveFilters, "r.status IN ('PREPARING','QUEUED','RUNNING','CANCEL_REQUESTED')")}
      GROUP BY r.status ORDER BY total_runs DESC`,
    liveFilters.values,
  );
  return {
    kpis: [
      kpi('totalRuns', 'کل اجراها', totals.totalRuns || 0),
      kpi('passRate', 'نرخ موفقیت', asNumber(totals.passRate), 'percent'),
      kpi('avgQueueMs', 'میانگین انتظار صف', totals.avgQueueMs, 'duration'),
      kpi('p95DurationMs', 'P95 مدت اجرا', totals.p95DurationMs, 'duration'),
      kpi('toolsUsed', 'ابزار استفاده‌شده', byTool.length),
      kpi('inFlight', 'صف زنده', liveQueue.reduce((sum, row) => sum + (row.totalRuns || 0), 0)),
    ],
    charts: [
      { id: 'runsByTool', title: 'حجم اجرا به‌ازای ابزار', items: byTool.map(row => ({ label: row.toolKind, value: row.totalRuns || 0 })) },
      { id: 'runsByApproach', title: 'حجم اجرا به‌ازای اپروچ', items: byApproach.map(row => ({ label: row.sourceApproach, value: row.totalRuns || 0 })) },
    ],
    tables: {
      byApproach,
      byTool,
      byEnvironment,
      unusedTools: unusedTools(byTool.map(row => row.toolKind)),
      liveQueue,
    },
  };
}

const TARGET_STATS = `p.name AS project_name, r.test_file_path, r.tool_kind, r.pack_id, r.flow_id,
            count(*)::int AS total_runs,
            count(*) FILTER (WHERE r.status='PASSED')::int AS pass_count,
            count(*) FILTER (WHERE r.status IN ('FAILED','ERROR'))::int AS fail_count,
            CASE WHEN count(*) = 0 THEN NULL ELSE round((100.0 * count(*) FILTER (WHERE r.status IN ('FAILED','ERROR')) / count(*))::numeric, 1) END AS fail_rate,
            max(r.requested_at) FILTER (WHERE r.status IN ('FAILED','ERROR')) AS last_failed_at`;

async function loadQuality(pool, filters) {
  const failingTargets = await fetchRows(
    pool,
    `SELECT ${TARGET_STATS}
       ${FROM_RUNS} ${filters.sql}
      GROUP BY p.name, r.test_file_path, r.tool_kind, r.pack_id, r.flow_id
     HAVING count(*) FILTER (WHERE r.status IN ('FAILED','ERROR')) > 0
      ORDER BY fail_count DESC, last_failed_at DESC NULLS LAST
      LIMIT ${TABLE_LIMIT}`,
    filters.values,
  );
  const flakyTargets = await fetchRows(
    pool,
    `SELECT ${TARGET_STATS}
       ${FROM_RUNS} ${filters.sql}
      GROUP BY p.name, r.test_file_path, r.tool_kind, r.pack_id, r.flow_id
     HAVING count(*) FILTER (WHERE r.status='PASSED') > 0
        AND count(*) FILTER (WHERE r.status IN ('FAILED','ERROR')) > 0
        AND count(*) >= 2
      ORDER BY fail_rate DESC NULLS LAST
      LIMIT ${TABLE_LIMIT}`,
    filters.values,
  );
  const byPackFlow = await fetchRows(
    pool,
    `SELECT p.name AS project_name, coalesce(r.pack_id, '—') AS pack_id, coalesce(r.flow_id, '—') AS flow_id, r.tool_kind, ${COUNTS}
       ${FROM_RUNS} ${filters.sql}
      GROUP BY p.name, coalesce(r.pack_id, '—'), coalesce(r.flow_id, '—'), r.tool_kind
      ORDER BY total_runs DESC
      LIMIT ${TABLE_LIMIT}`,
    filters.values,
  );
  const slowestRuns = await fetchRows(
    pool,
    `SELECT p.name AS project_name, r.test_file_path, r.tool_kind, r.status, r.duration_ms, r.requested_at, u.full_name AS requested_by_name
       ${FROM_RUNS} ${andWhere(filters, 'r.duration_ms IS NOT NULL')}
      ORDER BY r.duration_ms DESC
      LIMIT 50`,
    filters.values,
  );
  return {
    kpis: [
      kpi('failingTargets', 'اهداف شکست‌خورده', failingTargets.length),
      kpi('flakyTargets', 'مشکوک به flaky', flakyTargets.length),
      kpi('failCount', 'کل شکست هدف', failingTargets.reduce((sum, row) => sum + (row.failCount || 0), 0)),
      kpi('slowestMs', 'کندترین اجرا', slowestRuns[0]?.durationMs ?? null, 'duration'),
    ],
    charts: [
      { id: 'topFailing', title: 'بیشترین شکست', items: failingTargets.slice(0, 8).map(row => ({ label: row.testFilePath, value: row.failCount || 0 })) },
    ],
    tables: { failingTargets, flakyTargets, byPackFlow, slowestRuns },
  };
}

async function loadTeam(pool, filters) {
  const byRequester = await fetchRows(
    pool,
    `SELECT u.id AS user_id, u.full_name, u.role, ${COUNTS}, max(r.requested_at) AS last_run_at
       ${FROM_RUNS} ${filters.sql}
      GROUP BY u.id, u.full_name, u.role
      ORDER BY total_runs DESC`,
    filters.values,
  );
  const totals = byRequester.reduce((acc, row) => ({
    people: acc.people + 1,
    runs: acc.runs + (row.totalRuns || 0),
  }), { people: 0, runs: 0 });
  return {
    kpis: [
      kpi('people', 'افراد فعال', totals.people),
      kpi('totalRuns', 'کل اجراهای تیم', totals.runs),
      kpi('passRate', 'نرخ موفقیت نفر اول', asNumber(byRequester[0]?.passRate), 'percent'),
      kpi('topName', 'پرکارترین فرد', byRequester[0]?.fullName || '—', 'text'),
    ],
    charts: [
      { id: 'runsByPerson', title: 'حجم اجرا به‌ازای فرد', items: byRequester.map(row => ({ label: row.fullName, value: row.totalRuns || 0 })) },
    ],
    tables: { byRequester },
  };
}

async function loadSecurity(pool, filters) {
  const byTool = await groupBy(
    pool, filters,
    `r.tool_kind, ${COUNTS}, max(r.requested_at) AS last_run_at`,
    'r.tool_kind',
    'total_runs DESC',
  );
  const recentFindings = await fetchRows(
    pool,
    `SELECT p.name AS project_name, r.tool_kind, r.test_file_path, r.status, r.failed_tests, r.requested_at, u.full_name AS requested_by_name
       ${FROM_RUNS} ${andWhere(filters, "r.status IN ('FAILED','ERROR')")}
      ORDER BY r.requested_at DESC
      LIMIT 100`,
    filters.values,
  );
  const totals = await summary(pool, filters);
  return {
    kpis: [
      kpi('totalRuns', 'اسکن‌های بازه', totals.totalRuns || 0),
      kpi('failedRuns', 'اسکن ناموفق', (totals.failedRuns || 0) + (totals.errorRuns || 0)),
      kpi('passRate', 'نرخ پاک بودن', asNumber(totals.passRate), 'percent'),
      kpi('toolsUsed', 'اسکنر فعال', byTool.length),
    ],
    charts: [
      { id: 'securityByTool', title: 'اسکن به‌ازای ابزار', items: byTool.map(row => ({ label: row.toolKind, value: row.totalRuns || 0 })) },
    ],
    tables: {
      byTool,
      recentFindings,
      unusedTools: unusedTools(byTool.map(row => row.toolKind), SECURITY_TOOLS),
    },
  };
}

async function loadRuns(pool, filters, query, { exportAll = false } = {}) {
  const { page, limit, offset } = pageFor(query);
  const take = exportAll ? EXPORT_LIMIT : limit;
  const skip = exportAll ? 0 : offset;
  const count = await pool.query(`SELECT count(*)::int AS total ${FROM_RUNS} ${filters.sql}`, filters.values);
  const total = count.rows[0].total;
  const rows = await fetchRows(
    pool,
    `SELECT r.id, r.requested_at, r.started_at, r.completed_at, r.status,
            p.name AS project_name, e.name AS environment_name,
            r.source_approach, r.tool_kind, r.test_file_path, r.pack_id, r.flow_id,
            r.total_tests, r.passed_tests, r.failed_tests, r.skipped_tests, r.duration_ms,
            u.full_name AS requested_by_name
       ${FROM_RUNS} ${filters.sql}
      ORDER BY r.requested_at DESC
      LIMIT $${filters.values.length + 1} OFFSET $${filters.values.length + 2}`,
    [...filters.values, take, skip],
  );
  const passed = rows.filter(row => row.status === 'PASSED').length;
  const failed = rows.filter(row => row.status === 'FAILED' || row.status === 'ERROR').length;
  return {
    kpis: [
      kpi('total', 'رکورد مطابق فیلتر', total),
      kpi('pagePassed', 'موفق در این صفحه', passed),
      kpi('pageFailed', 'ناموفق در این صفحه', failed),
    ],
    charts: [],
    tables: { rows },
    pagination: { page: exportAll ? 1 : page, limit: take, total, totalPages: Math.max(1, Math.ceil(total / take)) },
  };
}

async function loadFacets(pool, user) {
  const projectSql = user.role === 'ADMIN'
    ? "SELECT p.id, p.name, p.code FROM projects p WHERE p.is_active=true AND p.kind='NAMED' ORDER BY p.name"
    : `SELECT p.id, p.name, p.code FROM projects p
        JOIN user_projects up ON up.project_id=p.id AND up.user_id=$1
       WHERE p.is_active=true AND p.kind='NAMED' ORDER BY p.name`;
  const projects = await fetchRows(pool, projectSql, user.role === 'ADMIN' ? [] : [user.id]);
  const envSql = user.role === 'ADMIN'
    ? `SELECT e.id, e.name, e.project_id, p.name AS project_name
         FROM environments e JOIN projects p ON p.id=e.project_id
        WHERE p.kind='NAMED' ORDER BY p.name, e.name`
    : `SELECT e.id, e.name, e.project_id, p.name AS project_name
         FROM environments e JOIN projects p ON p.id=e.project_id
         JOIN user_projects up ON up.project_id=e.project_id AND up.user_id=$1
        WHERE p.kind='NAMED'
        ORDER BY p.name, e.name`;
  const environments = await fetchRows(pool, envSql, user.role === 'ADMIN' ? [] : [user.id]);
  const runAccess = buildRunFilters(user, {}, { ignoreDates: true });
  const requesters = await fetchRows(
    pool,
    `SELECT DISTINCT u.id, u.full_name ${FROM_RUNS} ${runAccess.sql} ORDER BY u.full_name`,
    runAccess.values,
  );
  return { projects, environments, requesters };
}

async function loadReport(pool, report, user, query, options = {}) {
  const filters = buildRunFilters(user, query, { defaultToolKinds: report.defaultToolKinds });
  const builders = {
    executive: () => loadExecutive(pool, filters),
    engineering: () => loadEngineering(pool, user, query, filters),
    quality: () => loadQuality(pool, filters),
    team: () => loadTeam(pool, filters),
    security: () => loadSecurity(pool, filters),
    runs: () => loadRuns(pool, filters, query, options),
  };
  const payload = await builders[report.id]();
  const tables = (report.tables || []).map(table => ({
    id: table.id,
    title: table.title,
    columns: table.columns,
    rows: payload.tables[table.id] || [],
  }));
  return {
    id: report.id,
    title: report.title,
    subtitle: report.subtitle,
    audience: report.audience,
    audienceLabel: report.audienceLabel,
    generatedAt: new Date().toISOString(),
    filters: filters.applied,
    kpis: payload.kpis || [],
    charts: payload.charts || [],
    tables,
    pagination: payload.pagination || null,
  };
}

module.exports = { loadReport, loadFacets };
