#!/usr/bin/env node
/**
 * beforeShellExecution safety for automation-tool.
 * Gates credentialed live-check and obvious .env secret dumping.
 * Fail-open on parse errors (failClosed: false in hooks.json).
 */
const fs = require('node:fs');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function allow(extra = {}) {
  process.stdout.write(JSON.stringify({ permission: 'allow', ...extra }));
}

function ask(userMessage, agentMessage) {
  process.stdout.write(JSON.stringify({
    permission: 'ask',
    user_message: userMessage,
    agent_message: agentMessage,
  }));
}

function deny(userMessage, agentMessage) {
  process.stdout.write(JSON.stringify({
    permission: 'deny',
    user_message: userMessage,
    agent_message: agentMessage,
  }));
}

const raw = readStdin();
let payload = {};
try {
  payload = JSON.parse(raw || '{}');
} catch {
  allow();
  process.exit(0);
}

const command = String(payload.command || '');
const lower = command.toLowerCase();

// Block dumping .env secret material to the terminal.
const dumpsEnvSecrets =
  /(\.env\b)/i.test(command)
  && /(type|cat|Get-Content|gc\b|Select-String|findstr|printf|echo\s+\$env:)/i.test(command)
  && !/\.env\.example\b/i.test(command);

if (dumpsEnvSecrets) {
  deny(
    'Blocked: shell command looks like it would print .env secrets. Use .env.example for names only.',
    'Do not read or print .env secret values. Use .env.example variable names only (AGENTS.md).',
  );
  process.exit(0);
}

// Credentialed / external live-check requires explicit human approval.
if (/live-check\.cjs/i.test(command)) {
  ask(
    'Allow live-check? This may hit CDE/git/external endpoints. Approve only if you explicitly want credentialed/live verification.',
    'live-check is gated. Default policy: offline npm test / npm run verify unless the user explicitly requested live verification.',
  );
  process.exit(0);
}

// Writing under IS services/ is never allowed from agent shells.
const touchesIsServices = /(?:^|[/\\])services(?:[/\\]|$)/i.test(command)
  && /(integrated-systems|IS_ROOT|AllApp[/\\]IS)/i.test(command);
const looksLikeWrite = /(out-file|set-content|add-content|remove-item|\brm\b|\bdel\b|move-item|\bni\b|\bmkdir\b|redirection|\btee\b|>|>>)/i.test(lower)
  || /\b(?:write|copy|cp|mv|unlink|rmdir)\b/i.test(lower);
if (touchesIsServices && looksLikeWrite) {
  deny(
    'Blocked: agents must not modify IS services/. Writes are limited to IS test/ (IS_TEST_REL).',
    'External IS writes only under IS_TEST_REL (default test), prefer IS_DOC_REL (test/doc). Never services/.',
  );
  process.exit(0);
}

allow();
