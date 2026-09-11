# Chrome Recorder developer guide

## Local development

```powershell
npm.cmd install
npm.cmd run db:setup
npm.cmd run dev
npm.cmd run dev:extension
```

For local development and the current temporary manual deployment, open `chrome://extensions`, enable Developer mode, and load `apps/extension/dist`. Local defaults trust `http://localhost:5180` and call `http://localhost:4280`. Obtain the generated extension ID from Chrome, set `VITE_CHROME_EXTENSION_ID` in the repository-root `.env`, and restart or rebuild the web application so external detection works.

`VITE_CHROME_WEBSTORE_ITEM_URL` is optional. Leave it empty for manual deployment; when empty, the web UI displays Load unpacked instructions instead of a Store button.

## Build and package

```powershell
npm.cmd run build:extension
npm.cmd run package:extension
npm.cmd run verify:extension
```

`package:extension` creates deterministic `artifacts/extension/extension.zip`. Entries are sorted, timestamps and permissions are fixed, source maps are rejected, and the manifest is validated. The manifest version comes from `apps/extension/package.json`; API and external web patterns come from `AUTOMATION_TOOL_API_ORIGIN` and `AUTOMATION_TOOL_WEB_ORIGIN`.

The publishing workflow also sets `EXTENSION_REQUIRE_PRODUCTION_ORIGINS=1`, which rejects local or non-HTTPS origins before upload. Local CI can continue to package the localhost development build for smoke testing.

## Components

- `src/auth/credentials.ts`: pairing, credential storage, proactive renewal, single-flight rotation, revocation.
- `src/background/automation-adapter.ts`: stable application boundary.
- `src/background/playwright-service.ts`: `PlaywrightCrxAdapter` and upstream compatibility notes.
- `src/sidepanel/workflow.ts`: user state, action summaries, assertions, browser-login inference.
- `src/recorder`: Playwright Test normalization and first-pass secret protection.
- API `extension/routes.cjs`: one-time pairing and extension sessions.
- API `files/source-validation.cjs`: non-executing AST validation.
- API `files/recorder-routes.cjs`: validation and atomic upsert.

The Runner's Playwright dependency is intentionally independent and must not be changed for the CRX package.

## Tests

```powershell
npm.cmd run verify
npm.cmd run test:extension-smoke
```

The headed smoke test loads the unpacked CI artifact in Playwright Chromium, prints the browser version, verifies the service worker, automatic current-tab connection, navigation/click/fill recording, source generation, local testing, trace download, cleanup, and restricted-page handling. Real Chrome Stable remains the release acceptance browser because automation builds cannot prove enterprise policy behavior.

## Chrome Web Store publishing

The optional `Publish Chrome Recorder` GitHub Actions workflow uses Chrome Web Store API v2. Configure the protected `chrome-web-store` environment with:

Variables:

```text
AUTOMATION_TOOL_WEB_ORIGIN
AUTOMATION_TOOL_API_ORIGIN
CHROME_WEBSTORE_PUBLISHER_ID
CHROME_EXTENSION_ID
```

Secrets:

```text
CHROME_WEBSTORE_CLIENT_ID
CHROME_WEBSTORE_CLIENT_SECRET
CHROME_WEBSTORE_REFRESH_TOKEN
```

Enable the Chrome Web Store API in Google Cloud, create OAuth credentials owned by the Store publisher, obtain a refresh token with the `https://www.googleapis.com/auth/chromewebstore` scope, and store it only in GitHub environment secrets. The workflow can upload without submitting, or explicitly submit the existing listing for review. It cannot create the initial listing or configure its privacy/distribution metadata.

## Real Chrome Stable acceptance

1. Build with exact production origins and confirm the ZIP manifest contains only those origins.
2. Until Store publishing is available, copy `apps/extension/dist`, install it with Load unpacked, copy its ID into `VITE_CHROME_EXTENSION_ID`, and rebuild the web application. After Store publishing is restored, use the Private/Unlisted pilot listing instead.
3. Sign in on the real organization domain; confirm detection, pairing, and opening the side panel.
4. Select a project, name a test, and record navigation, click, fill, pause/resume, and an assertion.
5. Finish and verify the summary and protected-value notice without opening Advanced.
6. Test locally, save twice to confirm one file/revision increment, then Save & Run and follow both deep links.
7. Confirm local login state was not transferred to Runner.
8. Revoke the device in the web UI and confirm the recorder requests reconnection.
9. Validate restricted pages, a DevTools-owned tab, worker restart, closed tab, and organization policy denial messages.
10. Record the actual Chrome Stable version; repeat the smoke subset on Beta before broad rollout when available.
