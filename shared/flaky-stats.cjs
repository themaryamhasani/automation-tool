async function refreshFlakyStats(pool, projectId = null) {
  const values = [];
  const projectClause = projectId
    ? (values.push(projectId), 'AND r.project_id = $1')
    : '';
  await pool.query(
    `INSERT INTO flaky_test_stats (
        project_id, test_key, test_file_path, tool_kind, pack_id, flow_id,
        pass_count, fail_count, total_runs, fail_rate, last_status, last_run_id, last_seen_at, updated_at
     )
     SELECT
        r.project_id,
        concat_ws('::', coalesce(r.test_file_path,''), coalesce(r.tool_kind,''), coalesce(r.pack_id,''), coalesce(r.flow_id,'')) AS test_key,
        coalesce(r.test_file_path, '—'),
        r.tool_kind,
        r.pack_id,
        r.flow_id,
        count(*) FILTER (WHERE r.status = 'PASSED')::int,
        count(*) FILTER (WHERE r.status IN ('FAILED','ERROR'))::int,
        count(*)::int,
        CASE WHEN count(*) = 0 THEN 0
             ELSE (count(*) FILTER (WHERE r.status IN ('FAILED','ERROR'))::numeric / count(*)::numeric)
        END,
        (ARRAY_AGG(r.status ORDER BY r.requested_at DESC))[1],
        (ARRAY_AGG(r.id ORDER BY r.requested_at DESC))[1],
        max(r.requested_at),
        now()
       FROM runs r
      WHERE r.status IN ('PASSED','FAILED','ERROR')
        ${projectClause}
      GROUP BY r.project_id, r.test_file_path, r.tool_kind, r.pack_id, r.flow_id
     HAVING count(*) FILTER (WHERE r.status = 'PASSED') > 0
        AND count(*) FILTER (WHERE r.status IN ('FAILED','ERROR')) > 0
        AND count(*) >= 2
     ON CONFLICT (project_id, test_key) DO UPDATE SET
        pass_count = EXCLUDED.pass_count,
        fail_count = EXCLUDED.fail_count,
        total_runs = EXCLUDED.total_runs,
        fail_rate = EXCLUDED.fail_rate,
        last_status = EXCLUDED.last_status,
        last_run_id = EXCLUDED.last_run_id,
        last_seen_at = EXCLUDED.last_seen_at,
        updated_at = now()`,
    values,
  );
}

module.exports = { refreshFlakyStats };
