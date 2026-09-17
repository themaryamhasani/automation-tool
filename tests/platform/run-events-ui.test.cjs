const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

test('useRunPoll keeps one EventSource per live run and ignores setter identity', () => {
  const poll = fs.readFileSync(path.join(root, 'apps/web/src/useRunPoll.ts'), 'utf8');
  assert.match(poll, /useRef\(setLastRun\)/);
  assert.match(poll, /setRef\.current = setLastRun/);
  assert.match(poll, /new EventSource\(runEventsUrl\(runId\)/);
  assert.match(poll, /\[lastRun\?\.id, lastRun\?\.status\]/);
  assert.doesNotMatch(poll, /\[lastRun\?\.id, lastRun\?\.status, setLastRun\]/);
  assert.match(poll, /5_000/);
});

test('RunsPage list SSE keys only on live run ids and uses a stable detail setter', () => {
  const page = fs.readFileSync(path.join(root, 'apps/web/src/pages/RunsPage.tsx'), 'utf8');
  assert.match(page, /const onLiveDetail = useCallback/);
  assert.match(page, /useRunPoll\([\s\S]*onLiveDetail/);
  assert.match(page, /liveListKey/);
  assert.doesNotMatch(page, /data\?\.data\.map\(run => `\$\{run\.id\}:\$\{run\.status\}`\)\.join/);
  assert.doesNotMatch(page, /useRunPoll\([^,]+,\s*run => setDetail\(run\)\)/);
});

test('runner expires stale RUNNING heartbeats on every tick and notifies SSE listeners', () => {
  const runner = fs.readFileSync(path.join(root, 'apps/runner/src/main.cjs'), 'utf8');
  assert.match(runner, /async function expireStaleRunningRuns/);
  assert.match(runner, /await expireStaleRunningRuns\(\)/);
  assert.match(runner, /last_heartbeat_at < now\(\) - interval '3 minutes'/);
  assert.match(runner, /notifyRun\(pool, row\.id\)/);
  assert.match(runner, /run-heartbeat-expired/);
});
