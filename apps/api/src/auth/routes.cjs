const crypto = require('node:crypto');
const argon2 = require('argon2');
const { rateLimit } = require('express-rate-limit');
const { sessionCookie, clearSessionCookie } = require('../../../../shared/session-cookie.cjs');
const { encryptText, decryptText } = require('../../../../shared/snapshot-crypto.cjs');
const { generateTotpSecret, verifyTotp, otpauthUrl } = require('../../../../shared/totp.cjs');
const { deleteAllRuntimeSessionsForUser } = require('../runtime/session-store.cjs');
const { ApiError, asyncRoute, camelRow, cleanText } = require('../http.cjs');
const {
  SESSION_TTL_HOURS, tokenHash, verifyPassword, clientAddress, audit,
} = require('../middleware/auth.cjs');
const {
  oidcEnabled, oidcConfig, discoverOidc, buildAuthorizeUrl, exchangeCode, fetchUserInfo, decodeJwtPayload,
} = require('./oidc.cjs');

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

async function issueSession(pool, req, res, userRow, auditAction = 'AUTH_LOGIN') {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [userRow.id, tokenHash(token), expiresAt, req.get('user-agent') || null, clientAddress(req)],
  );
  await audit(pool, userRow.id, auditAction, 'USER', userRow.id, { ip: clientAddress(req) });
  const user = { ...userRow };
  delete user.password_hash;
  delete user.totp_secret_enc;
  res.setHeader('Set-Cookie', sessionCookie(token, SESSION_TTL_HOURS * 3600));
  return { token, expiresAt, user: camelRow(user) };
}

async function createChallenge(pool, userId, kind, metadata = {}) {
  const challengeToken = crypto.randomBytes(24).toString('base64url');
  await pool.query(
    `INSERT INTO auth_challenges (user_id, kind, token_hash, expires_at, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [userId, kind, tokenHash(challengeToken), new Date(Date.now() + CHALLENGE_TTL_MS), JSON.stringify(metadata)],
  );
  return challengeToken;
}

function publicUserColumns() {
  return `id, full_name, email, phone_number, password_hash, role, is_active, totp_enabled, totp_secret_enc, sso_provider, sso_subject`;
}

function registerPublicAuthRoutes(app, { pool }) {
  const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

  app.get('/api/auth/sso/status', (_req, res) => {
    res.json({
      enabled: oidcEnabled(),
      provider: oidcEnabled() ? 'oidc' : null,
      issuer: oidcEnabled() ? oidcConfig().issuer : null,
    });
  });

  app.get('/api/auth/sso/start', asyncRoute(async (req, res) => {
    if (!oidcEnabled()) throw new ApiError(404, 'SSO_DISABLED', 'ورود سازمانی پیکربندی نشده است.');
    const discovery = await discoverOidc();
    const state = crypto.randomBytes(16).toString('base64url');
    const nonce = crypto.randomBytes(16).toString('base64url');
    await pool.query(
      `INSERT INTO auth_challenges (user_id, kind, token_hash, expires_at, metadata)
       VALUES (NULL, 'SSO', $1, $2, $3::jsonb)`,
      [tokenHash(state), new Date(Date.now() + CHALLENGE_TTL_MS), JSON.stringify({ nonce, state })],
    );
    res.redirect(buildAuthorizeUrl(discovery, { state, nonce }));
  }));

  app.get('/api/auth/sso/callback', asyncRoute(async (req, res) => {
    if (!oidcEnabled()) throw new ApiError(404, 'SSO_DISABLED', 'ورود سازمانی پیکربندی نشده است.');
    const code = cleanText(req.query?.code, 2000);
    const state = cleanText(req.query?.state, 200);
    if (!code || !state) throw new ApiError(422, 'SSO_CODE_REQUIRED', 'کد بازگشت SSO نامعتبر است.');
    const challenge = await pool.query(
      `SELECT id, metadata FROM auth_challenges
        WHERE token_hash = $1 AND kind = 'SSO' AND consumed_at IS NULL AND expires_at > now()`,
      [tokenHash(state)],
    );
    if (!challenge.rowCount) throw new ApiError(401, 'SSO_STATE_INVALID', 'وضعیت SSO منقضی یا نامعتبر است.');
    await pool.query('UPDATE auth_challenges SET consumed_at = now() WHERE id = $1', [challenge.rows[0].id]);

    const discovery = await discoverOidc();
    const tokens = await exchangeCode(discovery, code);
    const claims = decodeJwtPayload(tokens.id_token) || {};
    const userInfo = tokens.access_token ? await fetchUserInfo(discovery, tokens.access_token) : null;
    const subject = String(claims.sub || userInfo?.sub || '').trim();
    const email = String(claims.email || userInfo?.email || '').trim().toLowerCase();
    if (!subject) throw new ApiError(401, 'SSO_SUBJECT_MISSING', 'شناسه کاربر SSO دریافت نشد.');

    let user = await pool.query(
      `SELECT ${publicUserColumns()} FROM users WHERE sso_provider = 'oidc' AND sso_subject = $1 LIMIT 1`,
      [subject],
    );
    if (!user.rowCount && email) {
      user = await pool.query(
        `SELECT ${publicUserColumns()} FROM users WHERE lower(email) = lower($1) LIMIT 1`,
        [email],
      );
      if (user.rowCount) {
        await pool.query(
          `UPDATE users SET sso_provider = 'oidc', sso_subject = $2, updated_at = now() WHERE id = $1`,
          [user.rows[0].id, subject],
        );
        user.rows[0].sso_provider = 'oidc';
        user.rows[0].sso_subject = subject;
      }
    }
    if (!user.rowCount) {
      throw new ApiError(403, 'SSO_USER_NOT_PROVISIONED', 'کاربر SSO در سامانه تعریف نشده است. ابتدا کاربر را با همان ایمیل بسازید.');
    }
    if (!user.rows[0].is_active) throw new ApiError(401, 'INVALID_CREDENTIALS', 'حساب کاربری غیرفعال است.');

    if (user.rows[0].totp_enabled) {
      const challengeToken = await createChallenge(pool, user.rows[0].id, 'TOTP', { via: 'sso' });
      return res.redirect(`/?sso=challenge&challengeToken=${encodeURIComponent(challengeToken)}`);
    }
    const session = await issueSession(pool, req, res, user.rows[0], 'AUTH_SSO_LOGIN');
    const redirect = `/?sso=ok&token=${encodeURIComponent(session.token)}`;
    res.redirect(redirect);
  }));

  app.post('/api/auth/login', loginLimiter, asyncRoute(async (req, res) => {
    const identity = cleanText(req.body?.identity, 320);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!identity || !password) throw new ApiError(422, 'CREDENTIALS_REQUIRED', 'نام کاربری و رمز عبور الزامی است.');
    const result = await pool.query(
      `SELECT ${publicUserColumns()} FROM users WHERE lower(email) = lower($1) OR phone_number = $1 LIMIT 1`,
      [identity],
    );
    const row = result.rows[0];
    const valid = row ? await verifyPassword(row.password_hash, password) : false;
    if (!valid || !row?.is_active) throw new ApiError(401, 'INVALID_CREDENTIALS', 'نام کاربری یا رمز عبور نادرست است.');
    if (!row.password_hash.startsWith('$argon2')) {
      await pool.query('UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2', [await argon2.hash(password), row.id]);
    }
    if (row.totp_enabled) {
      const challengeToken = await createChallenge(pool, row.id, 'TOTP');
      return res.status(202).json({
        requires2fa: true,
        challengeToken,
        message: 'کد تأیید دو مرحله‌ای را وارد کنید.',
      });
    }
    res.json(await issueSession(pool, req, res, row));
  }));

  app.post('/api/auth/2fa/verify', loginLimiter, asyncRoute(async (req, res) => {
    const challengeToken = cleanText(req.body?.challengeToken, 200);
    const code = cleanText(req.body?.code, 12);
    if (!challengeToken || !code) throw new ApiError(422, 'TOTP_REQUIRED', 'کد تأیید دو مرحله‌ای الزامی است.');
    const challenge = await pool.query(
      `SELECT c.id, c.user_id, u.password_hash, u.full_name, u.email, u.phone_number, u.role, u.is_active,
              u.totp_enabled, u.totp_secret_enc, u.sso_provider, u.sso_subject, u.id
         FROM auth_challenges c
         JOIN users u ON u.id = c.user_id
        WHERE c.token_hash = $1 AND c.kind = 'TOTP' AND c.consumed_at IS NULL AND c.expires_at > now()`,
      [tokenHash(challengeToken)],
    );
    if (!challenge.rowCount) throw new ApiError(401, 'CHALLENGE_EXPIRED', 'نشست تأیید منقضی شده است. دوباره وارد شوید.');
    const row = challenge.rows[0];
    if (!row.totp_enabled || !row.totp_secret_enc) throw new ApiError(409, 'TOTP_NOT_ENABLED', 'تأیید دو مرحله‌ای برای این کاربر فعال نیست.');
    const secret = decryptText(row.totp_secret_enc);
    if (!verifyTotp(secret, code)) throw new ApiError(401, 'TOTP_INVALID', 'کد تأیید نادرست است.');
    await pool.query('UPDATE auth_challenges SET consumed_at = now() WHERE id = $1', [row.id]);
    res.json(await issueSession(pool, req, res, row));
  }));
}

function registerSessionAuthRoutes(app, { pool }) {
  app.get('/api/auth/me', asyncRoute(async (req, res) => {
    const projects = await pool.query(
      req.user.role === 'ADMIN'
        ? 'SELECT id FROM projects ORDER BY name'
        : 'SELECT project_id AS id FROM user_projects WHERE user_id = $1 ORDER BY created_at',
      req.user.role === 'ADMIN' ? [] : [req.user.id],
    );
    const profile = await pool.query(
      'SELECT totp_enabled, sso_provider FROM users WHERE id = $1',
      [req.user.id],
    );
    res.json({
      user: {
        ...req.user,
        totpEnabled: Boolean(profile.rows[0]?.totp_enabled),
        ssoProvider: profile.rows[0]?.sso_provider || null,
      },
      projectIds: projects.rows.map(row => row.id),
    });
  }));

  app.post('/api/auth/logout', asyncRoute(async (req, res) => {
    await pool.query('DELETE FROM cde_sessions WHERE session_id = $1', [req.user.sessionId]);
    await deleteAllRuntimeSessionsForUser(pool, req.user.id);
    await pool.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [req.user.sessionId]);
    await audit(pool, req.user.id, 'AUTH_LOGOUT', 'USER', req.user.id);
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.status(204).end();
  }));

  app.post('/api/auth/change-password', asyncRoute(async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (newPassword.length < 10) throw new ApiError(422, 'WEAK_PASSWORD', 'رمز جدید باید حداقل ۱۰ کاراکتر باشد.');
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!await verifyPassword(result.rows[0].password_hash, currentPassword)) {
      throw new ApiError(422, 'INVALID_CURRENT_PASSWORD', 'رمز عبور فعلی صحیح نیست.');
    }
    const hash = await argon2.hash(newPassword);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, req.user.id]);
    await pool.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2', [req.user.id, req.user.sessionId]);
    await audit(pool, req.user.id, 'AUTH_PASSWORD_CHANGED', 'USER', req.user.id);
    res.status(204).end();
  }));

  app.post('/api/auth/2fa/setup', asyncRoute(async (req, res) => {
    const secret = generateTotpSecret();
    await pool.query(
      `UPDATE users SET totp_secret_enc = $2, totp_enabled = false, totp_confirmed_at = NULL, updated_at = now() WHERE id = $1`,
      [req.user.id, encryptText(secret)],
    );
    const account = req.user.email || req.user.phoneNumber || req.user.id;
    res.json({
      secret,
      otpauthUrl: otpauthUrl({ secret, accountName: account }),
    });
  }));

  app.post('/api/auth/2fa/enable', asyncRoute(async (req, res) => {
    const code = cleanText(req.body?.code, 12);
    const current = await pool.query('SELECT totp_secret_enc FROM users WHERE id = $1', [req.user.id]);
    if (!current.rows[0]?.totp_secret_enc) throw new ApiError(409, 'TOTP_SETUP_REQUIRED', 'ابتدا راه‌اندازی ۲FA را شروع کنید.');
    const secret = decryptText(current.rows[0].totp_secret_enc);
    if (!verifyTotp(secret, code)) throw new ApiError(401, 'TOTP_INVALID', 'کد تأیید نادرست است.');
    await pool.query(
      `UPDATE users SET totp_enabled = true, totp_confirmed_at = now(), updated_at = now() WHERE id = $1`,
      [req.user.id],
    );
    await audit(pool, req.user.id, 'AUTH_2FA_ENABLED', 'USER', req.user.id);
    res.json({ enabled: true });
  }));

  app.post('/api/auth/2fa/disable', asyncRoute(async (req, res) => {
    const code = cleanText(req.body?.code, 12);
    const password = String(req.body?.password || '');
    const current = await pool.query('SELECT password_hash, totp_secret_enc, totp_enabled FROM users WHERE id = $1', [req.user.id]);
    if (!current.rows[0]?.totp_enabled) throw new ApiError(409, 'TOTP_NOT_ENABLED', 'تأیید دو مرحله‌ای فعال نیست.');
    if (!await verifyPassword(current.rows[0].password_hash, password)) {
      throw new ApiError(401, 'INVALID_CURRENT_PASSWORD', 'رمز عبور فعلی صحیح نیست.');
    }
    if (!verifyTotp(decryptText(current.rows[0].totp_secret_enc), code)) {
      throw new ApiError(401, 'TOTP_INVALID', 'کد تأیید نادرست است.');
    }
    await pool.query(
      `UPDATE users SET totp_enabled = false, totp_secret_enc = NULL, totp_confirmed_at = NULL, updated_at = now() WHERE id = $1`,
      [req.user.id],
    );
    await audit(pool, req.user.id, 'AUTH_2FA_DISABLED', 'USER', req.user.id);
    res.json({ enabled: false });
  }));
}

module.exports = { registerPublicAuthRoutes, registerSessionAuthRoutes, issueSession };
