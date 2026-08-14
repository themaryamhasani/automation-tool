const LOG_EXCERPT_CHARS = 4000;

function excerptLogs(value, max = LOG_EXCERPT_CHARS) {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `[log truncated ${text.length} chars]\n${text.slice(-max)}`;
}

async function notifyRun(pool, runId) {
  if (!pool || !runId) return;
  try { await pool.query('SELECT pg_notify($1, $2)', ['run_events', String(runId)]); }
  catch { /* listener is optional */ }
}

module.exports = { LOG_EXCERPT_CHARS, excerptLogs, notifyRun };
