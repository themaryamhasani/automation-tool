# Chrome Recorder production architecture

Chrome Recorder is the organization-managed Manifest V3 extension in `apps/extension`. Production users install it from a Private or Unlisted Chrome Web Store listing, pair it from the authenticated Automation Tool `/extension` page, and never handle API URLs or credentials.

Audience-specific guides:

- [End-user guide](chrome-recorder-user.md)
- [Organization administrator guide](chrome-recorder-admin.md)
- [Developer guide](chrome-recorder-developer.md)

## Architecture and trust boundaries

```text
Automation Tool Web --one-time external message--> Chrome Extension <--> current Chrome tab
                                                        |
                                               HTTPS access credential
                                                        |
                                                       API
                                              /         |          \
                                      source validation files       runs
                                                                    |
                                                              existing Runner
```

The extension owns capture, element selection, local testing, and local trace creation. The API owns authentication, authorization, source validation, file persistence, and run creation. The existing Runner executes immutable saved source snapshots. No Chrome cookies, storage state, Playwright objects, or personal profile data are sent to the API or Runner.

## Pairing and credentials

The authenticated web session creates a 256-bit, SHA-256-hashed pairing code with a 90-second lifetime. The web page delivers it to the configured extension ID with Chrome external messaging. The extension exchanges it once through a request body. A successful exchange atomically consumes the code and returns:

- a 15-minute access credential;
- a rotating 30-day refresh credential;
- the user's current accessible named-project scope.

Only credential hashes are stored by the API. Raw values are centralized in the extension credential module and stored in `chrome.storage.local`; they never appear in a query string, UI, source log, or audit metadata. Refresh rotates both credentials. Web revocation or extension disconnect invalidates the server session.

An empty `project_ids` array is an explicit no-access scope. All project, environment, file, and run authorization checks are deny-by-default.

## Save and run pipeline

```text
record → normalize → client protection → API AST validation
       → atomic file upsert → optional existing run creation → existing Runner
```

The API parser detects clear literal passwords/tokens in sensitive fills, simple variable indirection, authentication/cookie headers, cookie writes, storage-state use, JWT-like values, and common credential prefixes. It returns line/category/severity/message/remediation without returning the detected value. This is defense in depth, not a claim of perfect secret detection.

`PUT /api/files/upsert` uses the existing `(project_id, folder_path, file_name)` unique key in one PostgreSQL statement. Optional revisions provide optimistic conflict detection without a paginated client lookup.

## Compatibility

| Channel | Support | Validation |
| --- | --- | --- |
| Chrome Stable | Required | Manual production acceptance plus headed Chromium smoke |
| Chrome Beta | Best effort | Scheduled/manual organization check before broad rollout |
| Playwright Chromium | CI/smoke harness | Browser version is printed by `test:extension-smoke` |

The application depends on `playwright-crx@0.15.0` behind `BrowserAutomationAdapter` / `PlaywrightCrxAdapter`. No vendor patch is currently required. The package's optional `recorder.run(code, page)` crosses its bundled Playwright realms, so the adapter uses the supported one-attached-tab `recorder.run(code)` form. Revalidate this behavior before upgrading.

MV3 recovery persists only safe serializable metadata. If the worker restarts, the UI never represents an in-memory Playwright session as live; it reconnects only through an explicit safe user action.
