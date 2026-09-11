# Chrome Recorder organization administrator guide

## Distribution choices

The preferred managed-organization deployment is a **Private Chrome Web Store listing** assigned to the organization's Google Workspace domain. Use Google Admin to force-install it for required users or allow normal installation for selected organizational units.

For unmanaged users, publish the same package as an **Unlisted Chrome Web Store listing** and configure Automation Tool's install button with that direct listing URL. Do not distribute a self-hosted CRX or require Developer Mode for production users.

Visibility is controlled in the Chrome Developer Dashboard. Chrome Web Store API v2 uploads preserve the listing's existing visibility; make visibility changes and their first publish in the dashboard.

## Required production configuration

Build the extension with exact origins:

```text
AUTOMATION_TOOL_WEB_ORIGIN=https://automation.example.org
AUTOMATION_TOOL_API_ORIGIN=https://automation-api.example.org
```

Build the web application with:

```text
VITE_CHROME_EXTENSION_ID=<Chrome Web Store item ID>
VITE_CHROME_WEBSTORE_ITEM_URL=https://chromewebstore.google.com/detail/<item-slug>/<item-id>
```

The build generates a single exact `externally_connectable` web-origin pattern and a single API host permission. Do not configure wildcard production origins. The web UI shows administrators a production warning when its ID or Store URL is absent.

## Chrome Enterprise policy

- Permit installation of the Store item ID, or add it to `ExtensionInstallForcelist`.
- Do not block the extension's `debugger` permission if browser recording is required.
- Review policies that prevent extension debugging/automation of normal HTTP(S) tabs.
- Keep Chrome Stable current; validate Chrome Beta with a pilot group when practical.
- Chrome system pages, Web Store pages, and tabs controlled by another debugger cannot be recorded by design.

Extension updates are delivered by Chrome Web Store. Roll out to a pilot organizational unit before force-installing a major recorder update.

## Revocation and audit

Users with Admin or Operator roles can open **Security and device connections** on `/extension` and revoke a recorder session. Access credentials expire after 15 minutes, refresh credentials rotate and expire after 30 days, and revocation takes effect immediately. Pairing creation, successful pairing, refresh, revocation, file upsert, and run creation use existing audit logs without secret/source payloads.

Expired pairing rows can be removed by normal database retention operations; creation also removes rows expired for more than one day. Monitor repeated pairing failures and Chrome policy errors through normal API/extension operational logging.
