declare const __AUTOMATION_TOOL_API_ORIGIN__: string;
declare const __AUTOMATION_TOOL_WEB_ORIGIN__: string;

function exactHttpOrigin(value: string): string {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid Automation Tool origin.');
  return parsed.origin;
}

export const BUILD_CONFIG = Object.freeze({
  apiOrigin: exactHttpOrigin(__AUTOMATION_TOOL_API_ORIGIN__),
  webOrigin: exactHttpOrigin(__AUTOMATION_TOOL_WEB_ORIGIN__),
  pairingProtocol: 1,
});
