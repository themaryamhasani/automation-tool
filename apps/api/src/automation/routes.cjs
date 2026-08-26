const { registerTokenRoutes } = require('./tokens/routes.cjs');
const { registerSuiteRoutes } = require('./suites/routes.cjs');
const { registerWebhookRoutes } = require('./webhooks/routes.cjs');
const { registerNotificationRoutes } = require('./notifications/routes.cjs');

function registerAutomationRoutes(app, deps) {
  registerTokenRoutes(app, deps);
  registerSuiteRoutes(app, deps);
  registerWebhookRoutes(app, deps);
  registerNotificationRoutes(app, deps);
}

module.exports = { registerAutomationRoutes };
