const crypto = require('node:crypto');

const TERMINAL_STATUSES = new Set(['PASSED', 'FAILED', 'ERROR', 'CANCELLED']);

function eventsForStatus(status) {
  const normalized = String(status || '').toUpperCase();
  const events = ['run.completed'];
  if (normalized === 'PASSED') events.push('run.passed');
  if (normalized === 'FAILED') events.push('run.failed');
  if (normalized === 'ERROR') events.push('run.error');
  if (normalized === 'CANCELLED') events.push('run.cancelled');
  return events;
}

function signPayload(secret, body) {
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function recordDelivery(pool, row) {
  await pool.query(
    `INSERT INTO webhook_deliveries (webhook_id, channel_id, run_id, status, response_status, error_message)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [row.webhookId || null, row.channelId || null, row.runId, row.status, row.responseStatus || null, row.errorMessage || null],
  );
}

async function postJson(url, payload, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(Number(process.env.WEBHOOK_TIMEOUT_MS || 15000)),
  });
  return response;
}

async function deliverWebhook(pool, webhook, runId, payload) {
  const body = JSON.stringify({ event: payload.event, run: payload });
  const headers = { 'User-Agent': 'automation-tool-webhook/1.0' };
  const signature = signPayload(webhook.secret, body);
  if (signature) headers['X-Automation-Signature'] = `sha256=${signature}`;
  try {
    const response = await postJson(webhook.url, JSON.parse(body), headers);
    await recordDelivery(pool, {
      webhookId: webhook.id,
      runId,
      status: response.ok ? 'DELIVERED' : 'FAILED',
      responseStatus: response.status,
      errorMessage: response.ok ? null : `HTTP ${response.status}`,
    });
  } catch (error) {
    await recordDelivery(pool, {
      webhookId: webhook.id,
      runId,
      status: 'FAILED',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

async function deliverSlack(config, payload) {
  const url = config.webhookUrl || config.url;
  if (!url) throw new Error('Slack webhook URL is required.');
  const text = [
    `*${payload.projectName}* — ${payload.status}`,
    `Run: ${payload.runId}`,
    `Tool: ${payload.toolKind || '-'}`,
    `Passed: ${payload.passed ?? 0} / Failed: ${payload.failed ?? 0}`,
  ].join('\n');
  await postJson(url, { text });
}

async function deliverTeams(config, payload) {
  const url = config.webhookUrl || config.url;
  if (!url) throw new Error('Teams webhook URL is required.');
  await postJson(url, {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary: `Run ${payload.status}`,
    themeColor: payload.status === 'PASSED' ? '2E7D32' : 'C62828',
    sections: [{
      activityTitle: `${payload.projectName} — ${payload.status}`,
      facts: [
        { name: 'Run', value: payload.runId },
        { name: 'Tool', value: payload.toolKind || '-' },
        { name: 'Duration (ms)', value: String(payload.durationMs || 0) },
      ],
    }],
  });
}

async function deliverEmail(config, payload) {
  const nodemailer = require('nodemailer');
  const host = config.smtpHost || process.env.SMTP_HOST;
  const port = Number(config.smtpPort || process.env.SMTP_PORT || 587);
  const user = config.smtpUser || process.env.SMTP_USER;
  const pass = config.smtpPass || process.env.SMTP_PASS;
  const from = config.from || process.env.SMTP_FROM || 'automation-tool@localhost';
  const recipients = Array.isArray(config.to) ? config.to : [];
  if (!host || !recipients.length) throw new Error('SMTP host and recipients are required for email notifications.');
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  });
  await transport.sendMail({
    from,
    to: recipients.join(','),
    subject: `[${payload.projectName}] Run ${payload.status}`,
    text: [
      `Project: ${payload.projectName}`,
      `Run: ${payload.runId}`,
      `Status: ${payload.status}`,
      `Tool: ${payload.toolKind || '-'}`,
      `Passed: ${payload.passed ?? 0}`,
      `Failed: ${payload.failed ?? 0}`,
      `Duration (ms): ${payload.durationMs || 0}`,
    ].join('\n'),
  });
}

async function deliverNotification(pool, channel, runId, payload) {
  const config = typeof channel.config === 'object' && channel.config ? channel.config : JSON.parse(channel.config || '{}');
  try {
    if (channel.kind === 'SLACK') await deliverSlack(config, payload);
    else if (channel.kind === 'TEAMS') await deliverTeams(config, payload);
    else if (channel.kind === 'EMAIL') await deliverEmail(config, payload);
    else if (channel.kind === 'WEBHOOK') {
      const url = config.url;
      if (!url) throw new Error('Webhook URL is required.');
      await postJson(url, { event: payload.event, run: payload });
    } else throw new Error(`Unsupported notification kind: ${channel.kind}`);
    await recordDelivery(pool, { channelId: channel.id, runId, status: 'DELIVERED' });
  } catch (error) {
    await recordDelivery(pool, {
      channelId: channel.id,
      runId,
      status: 'FAILED',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

const { evaluateQualityGate, persistGateResult } = require('./quality-gate.cjs');
const { postScmStatusForRun } = require('./scm-status-dispatch.cjs');

async function dispatchRunCompleted(pool, runId) {
  if (!pool || !runId) return;
  const result = await pool.query(
    `SELECT r.id, r.project_id, r.status, r.tool_kind, r.duration_ms, r.passed_tests, r.failed_tests,
            r.total_tests, r.test_file_path, r.pack_id, r.flow_id, scm.commit_sha, scm.git_ref,
            r.source_approach, src.source_snapshot, r.requested_by, p.name AS project_name
       FROM runs r
       JOIN projects p ON p.id = r.project_id
       LEFT JOIN run_scm scm ON scm.run_id = r.id
       LEFT JOIN run_sources src ON src.run_id = r.id
      WHERE r.id = $1`,
    [runId],
  );
  if (!result.rowCount) return;
  const row = result.rows[0];
  if (!TERMINAL_STATUSES.has(String(row.status || '').toUpperCase())) return;

  let gateEvaluation = null;
  try {
    gateEvaluation = await evaluateQualityGate(pool, row);
    await persistGateResult(pool, row, gateEvaluation);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'quality-gate-failed',
      runId,
      message: error instanceof Error ? error.message : String(error),
    }));
  }

  if (gateEvaluation?.postScmStatus !== false) {
    await postScmStatusForRun(pool, row, { gatePassed: gateEvaluation?.passed }).catch(error => console.error(JSON.stringify({
      event: 'scm-status-failed',
      runId,
      message: error instanceof Error ? error.message : String(error),
    })));
  }

  const events = eventsForStatus(row.status);
  const payload = {
    event: events[events.length - 1],
    runId: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    status: row.status,
    toolKind: row.tool_kind,
    durationMs: row.duration_ms,
    passed: row.passed_tests,
    failed: row.failed_tests,
    commitSha: row.commit_sha,
    gitRef: row.git_ref,
    gatePassed: gateEvaluation?.passed ?? null,
    gateReasons: gateEvaluation?.reasons || [],
  };

  const webhooks = await pool.query(
    `SELECT id, url, secret, events FROM webhooks
      WHERE project_id = $1 AND enabled = true AND events && $2::text[]`,
    [row.project_id, events],
  );
  for (const webhook of webhooks.rows) {
    await deliverWebhook(pool, webhook, runId, payload);
  }

  const channels = await pool.query(
    `SELECT id, kind, config, events FROM notification_channels
      WHERE enabled = true AND (project_id = $1 OR project_id IS NULL) AND events && $2::text[]`,
    [row.project_id, events],
  );
  for (const channel of channels.rows) {
    await deliverNotification(pool, channel, runId, payload);
  }
}

module.exports = {
  TERMINAL_STATUSES,
  eventsForStatus,
  signPayload,
  dispatchRunCompleted,
  deliverWebhook,
  deliverNotification,
};
