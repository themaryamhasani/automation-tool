const argon2 = require('argon2');
const { ApiError, asyncRoute, camelRow, cleanText } = require('../http.cjs');
const { audit, requireRole, ROLES } = require('../middleware/auth.cjs');

function registerUserRoutes(app, { pool }) {
  app.get('/api/users', requireRole('ADMIN'), asyncRoute(async (_req, res) => {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone_number, u.role, u.is_active, u.created_at, u.updated_at,
              coalesce(array_agg(up.project_id) FILTER (WHERE up.project_id IS NOT NULL), '{}') AS project_ids
         FROM users u LEFT JOIN user_projects up ON up.user_id = u.id
        GROUP BY u.id ORDER BY u.is_active DESC, u.full_name`,
    );
    res.json(result.rows.map(camelRow));
  }));

  app.post('/api/users', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const fullName = cleanText(req.body?.fullName, 255);
    const email = cleanText(req.body?.email, 320).toLowerCase() || null;
    const phone = cleanText(req.body?.phoneNumber, 32) || null;
    const password = String(req.body?.password || '');
    const role = ROLES.has(req.body?.role) ? req.body.role : 'VIEWER';
    if (!fullName || (!email && !phone)) throw new ApiError(422, 'INVALID_USER', 'نام و حداقل ایمیل یا شماره همراه الزامی است.');
    if (password.length < 10) throw new ApiError(422, 'WEAK_PASSWORD', 'رمز عبور باید حداقل ۱۰ کاراکتر باشد.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO users (full_name,email,phone_number,password_hash,role) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [fullName, email, phone, await argon2.hash(password), role],
      );
      const projectIds = Array.isArray(req.body?.projectIds) ? [...new Set(req.body.projectIds)] : [];
      for (const projectId of projectIds) {
        await client.query('INSERT INTO user_projects (user_id,project_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [result.rows[0].id, projectId]);
      }
      await audit(client, req.user.id, 'USER_CREATED', 'USER', result.rows[0].id, { role });
      await client.query('COMMIT');
      delete result.rows[0].password_hash;
      res.status(201).json({ ...camelRow(result.rows[0]), projectIds });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }));

  app.put('/api/users/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const fullName = cleanText(req.body?.fullName, 255);
    const email = cleanText(req.body?.email, 320).toLowerCase() || null;
    const phone = cleanText(req.body?.phoneNumber, 32) || null;
    const role = ROLES.has(req.body?.role) ? req.body.role : 'VIEWER';
    const isActive = req.body?.isActive !== false;
    if (!fullName || (!email && !phone)) throw new ApiError(422, 'INVALID_USER', 'اطلاعات کاربر کامل نیست.');
    if (req.params.id === req.user.id && (!isActive || role !== 'ADMIN')) {
      throw new ApiError(422, 'SELF_ADMIN_REQUIRED', 'نمی‌توانید دسترسی مدیر جاری را حذف کنید.');
    }
    const password = String(req.body?.password || '');
    if (password && password.length < 10) throw new ApiError(422, 'WEAK_PASSWORD', 'رمز عبور باید حداقل ۱۰ کاراکتر باشد.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const passwordClause = password ? ', password_hash=$7' : '';
      const params = [fullName, email, phone, role, isActive, req.params.id];
      if (password) params.push(await argon2.hash(password));
      const result = await client.query(
        `UPDATE users SET full_name=$1,email=$2,phone_number=$3,role=$4,is_active=$5,updated_at=now()${passwordClause}
          WHERE id=$6 RETURNING id,full_name,email,phone_number,role,is_active,created_at,updated_at`,
        params,
      );
      if (!result.rowCount) throw new ApiError(404, 'USER_NOT_FOUND', 'کاربر پیدا نشد.');
      await client.query(
        `DELETE FROM user_projects up
          USING projects p
         WHERE up.user_id = $1 AND up.project_id = p.id AND p.kind = 'NAMED'`,
        [req.params.id],
      );
      const projectIds = Array.isArray(req.body?.projectIds) ? [...new Set(req.body.projectIds)] : [];
      for (const projectId of projectIds) {
        const kind = await client.query(`SELECT kind FROM projects WHERE id = $1`, [projectId]);
        if (!kind.rowCount || kind.rows[0].kind === 'WORKSPACE') continue;
        await client.query('INSERT INTO user_projects (user_id,project_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, projectId]);
      }
      if (!isActive) await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [req.params.id]);
      await audit(client, req.user.id, 'USER_UPDATED', 'USER', req.params.id, { role, isActive });
      await client.query('COMMIT');
      res.json({ ...camelRow(result.rows[0]), projectIds });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }));
}

module.exports = { registerUserRoutes };
