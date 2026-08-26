const {
  RuntimeClientError,
  createRuntimeState,
  fetchFollowingRedirects,
  normalizedProfile,
  publicRuntimeStatus,
  runtimeWhoAmI,
} = require('./runtime-core-client.cjs');
const { importStorageStateIntoState, cookieHeaderFromState } = require('../../../../shared/runtime/cookie-export.cjs');
const { AUTH_MODE_SOHA_HANDOFF, buildHandoffUrl, resolveAppTarget } = require('../../../../shared/runtime/app-targets.cjs');

function resultOf(response) {
  return response?.Result || {};
}

function profileForHandoff(projectKey, overrides = {}) {
  const target = resolveAppTarget(projectKey, {
    authMode: overrides.authMode || AUTH_MODE_SOHA_HANDOFF,
    ...overrides,
  });
  return normalizedProfile({
    id: overrides.profileId || 'handoff',
    origin: target.appOrigin,
    authOrigin: target.authOrigin,
    appOrigin: target.appOrigin,
    runtimeServiceId: new URL(target.appOrigin).host,
    projectServiceId: target.projectServiceId || '',
    loginPath: target.loginPath,
    coreBasePath: process.env.RUNTIME_DEFAULT_CORE_BASE_PATH || '/core-api/v1',
    appRefererPath: target.appPath || '/',
    userSource: process.env.RUNTIME_DEFAULT_USER_SOURCE || 'medugovir',
    authMode: target.authMode,
    prostage: overrides.prostage !== undefined ? overrides.prostage : target.prostage,
    originAllowlist: target.originAllowlist,
    readyCheck: target.readyCheck,
    handoff: target.handoff,
  });
}

async function runHandoff(state, profile, { handoffUrl, tokenId } = {}, options = {}) {
  const url = buildHandoffUrl({
    authOrigin: profile.authOrigin,
    handoff: profile.handoff,
  }, { handoffUrl, tokenId });
  if (!url) {
    throw new RuntimeClientError(
      'RUNTIME_HANDOFF_REQUIRED',
      'برای handoff باید handoffUrl یا tokenId بدهید (یا کوکی دامنه اپ را مستقیم import کنید).',
      422,
    );
  }
  state.phase = 'HANDOFF';
  const result = await fetchFollowingRedirects(state, url, {
    ...options,
    allowlist: profile.originAllowlist,
    referer: `${profile.authOrigin}/`,
    headers: {
      ...(profile.prostage ? { prostage: String(profile.prostage) } : {}),
      ...(options.headers || {}),
    },
  });
  state.handoffFinalUrl = result.url.toString();
  return { state, result };
}

async function verifyAppReady(state, profile, options = {}) {
  const verified = await runtimeWhoAmI(state, profile, options);
  const result = resultOf(verified.response);
  if (result.IsUserLogin !== true) {
    throw new RuntimeClientError(
      'RUNTIME_LOGIN_NOT_VERIFIED',
      'who-am-i روی دامنه اپ IsUserLogin=true برنگرداند؛ کوکی/handoff را بررسی کنید.',
      401,
    );
  }
  if (profile.prostage && result.prostage && String(result.prostage) !== String(profile.prostage)) {
    throw new RuntimeClientError(
      'RUNTIME_PROSTAGE_MISMATCH',
      `prostage مورد انتظار ${profile.prostage} بود، دریافت شد: ${result.prostage}`,
      409,
    );
  }
  state.phase = 'CONNECTED';
  state.runtimeUser = result.LoginUser || {};
  state.connectedAt = new Date().toISOString();
  state.origin = profile.appOrigin;
  state.authOrigin = profile.authOrigin;
  state.appOrigin = profile.appOrigin;
  state.authMode = profile.authMode;
  state.prostage = profile.prostage || result.prostage || null;
  return { state, whoAmI: result, status: publicRuntimeStatus(state) };
}

/**
 * Connect via captured Playwright storageState / cookies (+ optional SOHA→app handoff).
 * Gov SSO captcha/OTP is out of band; this only reuses hub session and verifies app readyCheck.
 */
async function connectFromImport(projectKey, input = {}, options = {}) {
  const profile = profileForHandoff(projectKey, input);
  const state = createRuntimeState(profile.id || projectKey || 'import');
  state.projectKey = projectKey || null;
  state.authMode = profile.authMode;
  state.authOrigin = profile.authOrigin;
  state.appOrigin = profile.appOrigin;
  state.prostage = profile.prostage;

  const storageState = input.storageState || null;
  const cookies = input.cookies || storageState?.cookies || [];
  if (!cookies.length && !input.handoffUrl && !input.tokenId) {
    throw new RuntimeClientError(
      'RUNTIME_IMPORT_EMPTY',
      'cookies/storageState یا handoffUrl/tokenId برای برقراری نشست چنددامنه‌ای لازم است.',
      422,
    );
  }
  if (cookies.length) await importStorageStateIntoState(state, { cookies });

  const appCookie = await cookieHeaderFromState(state, profile.appOrigin);
  const needsHandoff = Boolean(input.handoffUrl || input.tokenId || input.forceHandoff || !appCookie);
  if (needsHandoff && (input.handoffUrl || input.tokenId || input.forceHandoff)) {
    await runHandoff(state, profile, {
      handoffUrl: input.handoffUrl,
      tokenId: input.tokenId,
    }, options);
  } else if (needsHandoff && !appCookie) {
    throw new RuntimeClientError(
      'RUNTIME_HANDOFF_REQUIRED',
      'کوکی دامنه اپ موجود نیست؛ handoffUrl یا tokenId بدهید، یا storageState شامل کوکی tavan.medu.ir را import کنید.',
      422,
    );
  }

  return verifyAppReady(state, profile, options);
}

module.exports = {
  connectFromImport,
  profileForHandoff,
  runHandoff,
  verifyAppReady,
};
