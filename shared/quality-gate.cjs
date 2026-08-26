async function evaluateQualityGate(pool, run) {
  const gates = await pool.query(
    `SELECT * FROM quality_gates WHERE project_id = $1 AND enabled = true ORDER BY created_at ASC LIMIT 1`,
    [run.project_id],
  );
  if (!gates.rowCount) {
    const passed = String(run.status).toUpperCase() === 'PASSED';
    return {
      gateId: null,
      passed,
      reasons: passed ? [] : [`Run status is ${run.status}`],
      postScmStatus: true,
    };
  }
  const gate = gates.rows[0];
  const reasons = [];
  const status = String(run.status || '').toUpperCase();
  const requireStatus = String(gate.require_status || 'PASSED').toUpperCase();
  if (status !== requireStatus) reasons.push(`وضعیت اجرا ${status} است؛ انتظار ${requireStatus}`);

  if (gate.max_failed_tests != null && Number(run.failed_tests || 0) > Number(gate.max_failed_tests)) {
    reasons.push(`تعداد شکست ${run.failed_tests} از سقف ${gate.max_failed_tests} بیشتر است`);
  }

  const total = Number(run.total_tests || 0);
  const failed = Number(run.failed_tests || 0);
  if (gate.max_fail_rate != null && total > 0) {
    const rate = failed / total;
    if (rate > Number(gate.max_fail_rate)) {
      reasons.push(`نرخ شکست ${(rate * 100).toFixed(1)}٪ از سقف ${(Number(gate.max_fail_rate) * 100).toFixed(1)}٪ بیشتر است`);
    }
  }

  if (gate.block_on_flaky) {
    const flaky = await pool.query(
      `SELECT fail_rate FROM flaky_test_stats
        WHERE project_id = $1
          AND test_file_path = $2
          AND coalesce(tool_kind,'') = coalesce($3,'')
          AND coalesce(pack_id,'') = coalesce($4,'')
          AND coalesce(flow_id,'') = coalesce($5,'')
        LIMIT 1`,
      [run.project_id, run.test_file_path, run.tool_kind, run.pack_id, run.flow_id],
    );
    if (flaky.rowCount && Number(flaky.rows[0].fail_rate) >= Number(gate.max_flaky_fail_rate || 0.5)) {
      reasons.push(`هدف اجرا flaky است (fail_rate=${flaky.rows[0].fail_rate})`);
    }
  }

  return {
    gateId: gate.id,
    passed: reasons.length === 0,
    reasons,
    postScmStatus: gate.post_scm_status !== false,
    gateName: gate.name,
  };
}

const { setGateOutcome } = require('./db/run-store.cjs');

async function persistGateResult(pool, run, evaluation) {
  if (evaluation.gateId) {
    await pool.query(
      `INSERT INTO quality_gate_results (gate_id, run_id, project_id, passed, reasons)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [evaluation.gateId, run.id, run.project_id, evaluation.passed, JSON.stringify(evaluation.reasons)],
    );
  }
  await setGateOutcome(pool, run.id, evaluation.passed ? 'PASSED' : 'FAILED', {
    reasons: evaluation.reasons,
    gateId: evaluation.gateId,
    gateName: evaluation.gateName || null,
  });
}

module.exports = { evaluateQualityGate, persistGateResult };
