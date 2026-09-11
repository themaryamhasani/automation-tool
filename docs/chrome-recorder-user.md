# Chrome Recorder user guide

## Install and connect

1. Sign in to Automation Tool.
2. Open **Chrome Recorder** from the navigation.
3. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
4. Select the supplied `apps/extension/dist` folder. Do not select `extension.zip` directly; unzip it first if that is the artifact you received.
5. Return to Automation Tool and choose **Connect Recorder**.
6. Choose **Open Recorder**.

Connection is automatic. Automation Tool never asks you to copy a token or enter a server address.

This manual installation is temporary while Chrome Web Store publishing is unavailable. Keep the extension folder in place. After receiving a new build, replace its contents and choose **Reload** for the extension in `chrome://extensions`.

## Record a test

1. Open the website you want to test.
2. In the Recorder, choose a project and enter a clear test name.
3. Choose **Start Recording** and use the website normally.
4. Optionally choose **Add assertion**, select something on the page, and choose what should be verified.
5. Pause if needed, then choose **Finish**.

The activity list describes clicks, navigation, input, and checks in everyday language. A lock indicates that a sensitive value was replaced with a project environment reference.

## Test and save

- **Test locally** runs in your current Chrome session and can see its existing login state.
- **Save** stores or updates the test in Automation Tool.
- **Save & Run** stores the test and runs it in Automation Tool's separate, isolated browser environment.

If a flow began while you were already signed in, include login steps or ask an administrator to configure test credentials before Save & Run. Your personal Chrome cookies are never uploaded.

Technical source, locator, trace, destination, and troubleshooting controls are available under **Advanced** when needed.
