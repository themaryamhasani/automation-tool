const { asyncRoute } = require('../http.cjs');
const { APPROACH_IDS, TOOL_IDS, RUN_STATUSES, listReports } = require('./catalog.cjs');
const { requireKnownReport, requireProjectAccess } = require('./filters.cjs');
const { loadFacets, loadReport } = require('./queries.cjs');
const { buildWorkbook, excelFileName } = require('./excel.cjs');

function registerReportRoutes(app, { pool, audit, ensureProjectAccess }) {
  app.get('/api/reports', asyncRoute(async (req, res) => {
    const facets = await loadFacets(pool, req.user);
    res.json({
      reports: listReports(),
      approaches: APPROACH_IDS,
      tools: TOOL_IDS,
      statuses: RUN_STATUSES,
      ...facets,
    });
  }));

  app.get('/api/reports/:id', asyncRoute(async (req, res) => {
    const report = requireKnownReport(req.params.id);
    await requireProjectAccess(ensureProjectAccess, req.user, req.query);
    res.json(await loadReport(pool, report, req.user, req.query));
  }));

  app.get('/api/reports/:id/excel', asyncRoute(async (req, res) => {
    const report = requireKnownReport(req.params.id);
    await requireProjectAccess(ensureProjectAccess, req.user, req.query);
    const payload = await loadReport(pool, report, req.user, req.query, { exportAll: true });
    const buffer = await buildWorkbook(payload);
    const fileName = excelFileName(report.id, payload.filters);
    await audit(pool, req.user.id, 'REPORT_EXPORTED', 'REPORT', report.id, {
      from: payload.filters.from || null,
      to: payload.filters.to || null,
      projectId: payload.filters.projectId || null,
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }));
}

module.exports = { registerReportRoutes };
