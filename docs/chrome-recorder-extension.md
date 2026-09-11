# Chrome Recorder Extension

`apps/extension` is the Manifest V3 recorder for Automation Tool. It attaches `playwright-crx@0.15.0` to a user-selected Chrome tab through `chrome.debugger`; it does not proxy Playwright objects, cookies, storage state, or browser credentials through the API.

## Architecture

The extension owns tab attachment, Playwright recording/inspection, local replay, and local trace capture. It normalizes Playwright recorder output to `@playwright/test` TypeScript, sanitizes sensitive values, and sends only source/metadata to the existing `/api/files` model. Save & Run calls the existing `/api/runs` creation route. The existing PostgreSQL queue and Runner execute the saved source snapshot; no second runner or browser-control server exists.

The extension has an isolated Vite 6 build and pinned `playwright-crx` dependency. The server Runner remains on its existing `@playwright/test` version. `playwright-crx@0.15.0` currently builds without a repository patch. Its optional `recorder.run(code, page)` argument crosses bundled Playwright type realms in this build, so the service uses the supported `recorder.run(code)` form against its single attached tab. If that pin changes, verify attach, recorder source messages, player and trace APIs before upgrading it.

## Develop and build

```powershell
npm.cmd install
npm.cmd run dev:extension
```

The watch build writes to `apps/extension/dist`. For a production unpacked build:

```powershell
npm.cmd run build:extension
```

Load `D:\AllApp\automation-tool\apps\extension\dist` from `chrome://extensions` → Developer mode → Load unpacked. The directory contains `manifest.json`, `background.js`, `sidepanel.html`, and the UI assets.

The optional headed browser smoke test builds/loads the unpacked extension, verifies its service worker, attaches and detaches a local HTTP tab, and verifies rejection of a restricted extension page:

```powershell
npm.cmd run build:extension
npm.cmd run test:extension-smoke
```

This test is deliberately not part of default CI because unpacked extension support needs a headed Playwright Chromium desktop session. Production acceptance remains in Google Chrome through the manual flow below.

## Permissions

- `debugger`: required by Playwright CRX to connect to an explicit tab.
- `tabs` and `activeTab`: identify the tab selected by the user and track navigation/closure.
- `sidePanel`: primary recorder UI.
- `storage`: settings, scoped API token, and non-secret session metadata.
- `contextMenus`: Record this tab / Inspect locator actions.
- `downloads`: saves a local `trace.zip` after Replay + Trace.
- `offscreen`: creates a bounded-memory Blob URL for trace downloads because MV3 service workers have no DOM URL API.

Only localhost/127.0.0.1 API access is granted at install time. A non-local API origin is requested as an optional Chrome host permission when the user connects it. The recorder can attach to an HTTP(S) page through the debugger permission without an `<all_urls>` content-script grant.

## Secure connection

1. Start Automation Tool and sign in to `http://localhost:5180`.
2. Open **افزونه Chrome** in the web sidebar.
3. Select the allowed projects and create a 90-day extension token.
4. Copy the one-time `atk_…` value into the extension side panel and connect.

The API stores only a SHA-256 token hash. Tokens are user-scoped, project-scoped, expiring, revocable, and limited to profile/project read, test-file read/write, and run create/read. API tokens cannot use the token-management routes to mint broader credentials. Disconnect removes the local token; revoke it in the web app to invalidate it server-side.

## Record, inspect and replay

1. Open a normal HTTP or HTTPS page.
2. Click the extension action and **Attach current tab**.
3. Click **Record** (or `Alt+Shift+R`), interact with the page, then Stop. Pause/Resume uses Playwright recorder standby mode.
4. Click **Inspect** (or `Alt+Shift+C`) and select an element. The selector comes from Playwright's recorder, can be copied, or inserted as a click.
5. Review/edit the generated `@playwright/test` TypeScript.
6. Click **Replay** to use Playwright CRX's player against the attached tab. **Replay + Trace** enables screenshots, snapshots and sources, safely stops tracing even after replay failure, and downloads `trace.zip` locally under `Downloads/automation-tool`.

Playwright CRX does not expose a public cancellable player handle. **Stop replay** closes the CRX application to reliably interrupt work and release `chrome.debugger`, so the panel explicitly asks for reattachment afterward.

## Save and Save & Run

Select a project, existing/new folder, filename, test name and optional environment. **Save** creates or revision-updates the existing `test_files` row. **Save & Run** performs normalize → sanitize → validate → save → `/api/runs`; the existing Runner consumes the immutable source snapshot. Use **Open saved test** for `/files/:id` and **Open run** for `/runs?runId=:id`.

Recorded tests use absolute `page.goto` URLs by default. The selected project environment is still supplied to Runner as `baseURL` and provides existing secret references.

## Sensitive data

The extension never requests or uploads cookies/storage state. Password-, passcode-, PIN-, token-, authorization-, API-key-, session- and payment-related fills are replaced with placeholders such as `process.env.TEST_PASSWORD ?? ''`. Authorization/API-key header literals are replaced. Cookie/storage-state code is removed. Sanitized source shows a warning and lists required environment variables; map these through the project's existing environment Secret references. Raw captured values remain transient in the recorder message and are never written to Chrome storage or sent to the API.

## Service-worker and tab recovery

Only serializable tab/session metadata is stored in `chrome.storage.session`. A restarted service worker never claims its former Playwright `Page` survived: the UI reports **Reattach required**. Closing the tab, debugger detach, restricted navigation, replay stop/failure, manual detach, and recorder close all have cleanup/retry paths.

Chrome blocks attachment to `chrome://` pages, the Chrome Web Store's protected targets, extension pages, and browser internals. Opening `chrome://settings` and clicking Attach produces a friendly unsupported-page message. If DevTools or another debugger owns the tab, close/detach it and retry.

## Configuration and troubleshooting

The side panel/options page stores API URL, web URL, selected project/environment/folder, filename, test name, Test ID attribute (default `data-testid`) and replay `slowMo`. Development defaults use the repository's `API_PORT=4280` and `WEB_PORT=5180`; production URLs are never compiled into source. Detach/reattach after changing Test ID or slowMo.

- **API unavailable**: start `npm run dev`, verify the API URL, and grant the requested origin permission.
- **Authentication expired**: create a new scoped token or check whether the token was revoked/expired.
- **Revision conflict**: reload the saved test in the web editor and retry.
- **Debugger busy**: close DevTools or another debugger using the tab.
- **Runner secret missing**: configure the listed environment-variable Secret references on the selected environment/Runner.

## Manual Chrome acceptance test

1. Run `npm.cmd install` and `npm.cmd run db:setup` from the repository root.
2. Start Automation Tool with `npm.cmd run dev` and sign in at `http://localhost:5180`.
3. Build with `npm.cmd run build:extension`.
4. Open `chrome://extensions`, enable Developer mode, load `D:\AllApp\automation-tool\apps\extension\dist`, and pin it.
5. In the web sidebar open **افزونه Chrome**, create a project-scoped token, and copy its one-time value.
6. Open the extension side panel, enter the API/Web URLs and token, connect, and confirm projects/environments load.
7. Select the destination project, folder, test name, filename, and optional environment.
8. Open `https://example.com` or another safe HTTP(S) target and click **Attach current tab**.
9. Click **Record**, navigate/interact with the target, exercise click/fill/select/check where available, and pause/resume once.
10. Click **Stop** and confirm the editor contains ordinary `@playwright/test` TypeScript.
11. Click **Inspect**, select an element, copy its Playwright locator, insert a click, and leave inspection cleanly.
12. Record a password/token-like input and confirm the editor contains an environment placeholder—not the literal secret.
13. Edit/copy the source and click **Replay**; confirm the actions run against the attached tab.
14. Click **Replay + Trace** and confirm a non-empty `Downloads/automation-tool/trace-*.zip` is created.
15. Click **Save**, follow **Open saved test**, and confirm the source/revision at `/files/:id`.
16. Edit and Save again; confirm the same file revision increments and no duplicate file is created.
17. Click **Save & Run** and confirm the existing PostgreSQL queue/Runner executes the immutable saved source snapshot.
18. Follow **Open run**, confirm `/runs?runId=:id` opens that run, and inspect its report/artifacts.
19. Detach, close an attached tab, reload the extension worker, and confirm clean detach, closed-tab recovery, and **Reattach required** states.
20. Try `chrome://settings`, the Chrome Web Store, and a DevTools-owned tab; confirm friendly restricted/debugger-busy errors. Finally disconnect/revoke the token and confirm further API requests are rejected.
