#!/usr/bin/env node
/**
 * stop: soft gate — if the agent is stopping after substantial work without
 * mentioning verification, request one follow-up turn (loop_limit in hooks.json).
 * Fail-open; never infinite-loop.
 */
const fs = require('node:fs');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

const raw = readStdin();
let payload = {};
try {
  payload = JSON.parse(raw || '{}');
} catch {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

const status = String(payload.status || payload.reason || '').toLowerCase();
const text = String(
  payload.last_assistant_message
  || payload.assistant_message
  || payload.message
  || payload.transcript_summary
  || '',
).toLowerCase();

// Only nudge on completed-looking stops with implementation claims and no verify evidence.
const claimsDone = /(?:done|fixed|implemented|complete|آماده|انجام شد)/i.test(text)
  || status === 'completed'
  || status === 'complete';
const mentionsVerify = /npm test|npm run verify|platform-verifier|platform-verify|node --test|test:ui|verify:extension|verification:/i.test(text);
const trivial = /typo|import only|one-liner|documentation only|no code change/i.test(text);

if (claimsDone && !mentionsVerify && !trivial && text.length > 40) {
  process.stdout.write(JSON.stringify({
    followup_message:
      'Before finalizing: confirm verification. Run skill platform-verify (or platform-verifier) for MEDIUM+ changes, or explicitly state why tests were skipped (trivial/LOW). Then reply to the user.',
  }));
  process.exit(0);
}

process.stdout.write(JSON.stringify({}));
