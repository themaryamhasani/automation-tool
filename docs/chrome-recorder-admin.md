# Chrome Recorder organization administrator guide

## Distribution choices

Chrome Recorder is temporarily distributed as an unpacked extension while Chrome Web Store publishing is unavailable. Build and verify it, copy the complete `apps/extension/dist` directory to the target workstation, then use **Load unpacked** in `chrome://extensions`. Developer mode must remain enabled and the directory must not be moved or deleted.

Chrome generates the unpacked extension ID. Copy that ID into `VITE_CHROME_EXTENSION_ID` and rebuild the web application before pairing. An unpacked ID can differ when the folder path or workstation changes, so this temporary method is intended for the current controlled installation. If several workstations need one centrally configured ID, move to the Private/Unlisted Chrome Web Store flow.

The preferred long-term managed-organization deployment remains a **Private Chrome Web Store listing** assigned to the organization's Google Workspace domain. The optional Store URL can be added later without changing the recorder protocol.

## Required production configuration

Build the extension with exact origins:

```text
AUTOMATION_TOOL_WEB_ORIGIN=https://automation.example.org
AUTOMATION_TOOL_API_ORIGIN=https://automation-api.example.org
```

Build the web application with:

```text
VITE_CHROME_EXTENSION_ID=<ID shown in chrome://extensions>
VITE_CHROME_WEBSTORE_ITEM_URL=
```

For the temporary manual installation, use the ID shown by `chrome://extensions`; `VITE_CHROME_WEBSTORE_ITEM_URL` is optional. The build generates a single exact `externally_connectable` web-origin pattern and a single API host permission. Do not configure wildcard production origins. The web UI shows administrators a production warning only when the required extension ID is absent.

## Chrome Enterprise policy

- Permit installation of the Store item ID, or add it to `ExtensionInstallForcelist`.
- Do not block the extension's `debugger` permission if browser recording is required.
- Review policies that prevent extension debugging/automation of normal HTTP(S) tabs.
- Keep Chrome Stable current; validate Chrome Beta with a pilot group when practical.
- Chrome system pages, Web Store pages, and tabs controlled by another debugger cannot be recorded by design.

During manual distribution, deliver the rebuilt `dist` directory and use **Reload** in `chrome://extensions`. After Store publication is restored, updates should be delivered by Chrome Web Store and rolled out to a pilot organizational unit before a broad or forced installation.

## Revocation and audit

Users with Admin or Operator roles can open **Security and device connections** on `/extension` and revoke a recorder session. Access credentials expire after 15 minutes, refresh credentials rotate and expire after 30 days, and revocation takes effect immediately. Pairing creation, successful pairing, refresh, revocation, file upsert, and run creation use existing audit logs without secret/source payloads.

Expired pairing rows can be removed by normal database retention operations; creation also removes rows expired for more than one day. Monitor repeated pairing failures and Chrome policy errors through normal API/extension operational logging.
