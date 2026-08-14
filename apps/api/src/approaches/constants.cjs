const SOURCE_APPROACHES = {
  CDE: { id: 'CDE', label: 'CDE', description: 'خواندن سورس CDE، بسته‌بندی Express محلی، اجرای اسکریپت‌های نوشته‌شده در automation-tool' },
  IS: { id: 'IS', label: 'IS', description: 'خواندن test/doc از Integrated Systems و نوشتن گزارش در همان ساختار' },
  GITHUB: { id: 'GITHUB', label: 'GitHub', description: 'سورس پروژه‌های حساب GitHub همان کاربر' },
  GIT_EDUS: { id: 'GIT_EDUS', label: 'git.edus.ir', description: 'سورس پروژه‌های GitLab ایدوس همان کاربر' },
  ZIP: { id: 'ZIP', label: 'ZIP', description: 'آپلود آرشیو زیپ و اجرای تست روی محتوای استخراج‌شده' },
};

const TOOL_KINDS = {
  DANGER: { id: 'DANGER', label: 'Node danger ALL', description: 'سوئیت HTTP fail-closed روی runtime زنده' },
  K6: { id: 'K6', label: 'k6', description: 'تست بار و امنیت HTTP' },
  PLAYWRIGHT: { id: 'PLAYWRIGHT', label: 'Playwright + Chrome', description: 'E2E مرورگر با Chrome/Chromium' },
  VITEST: { id: 'VITEST', label: 'Vitest', description: 'تست واحد منطق سرویس' },
  BIOME: { id: 'BIOME', label: 'Biome', description: 'lint استاتیک سریع بدون ESLint سنگین' },
  GITLEAKS: { id: 'GITLEAKS', label: 'gitleaks', description: 'نشت secret در سورس (باینری روی PATH)' },
  AUDIT: { id: 'AUDIT', label: 'SCA / npm audit', description: 'CVE وابستگی‌ها با npm audit و در صورت وجود osv-scanner/Trivy' },
  SEMGREP: { id: 'SEMGREP', label: 'Semgrep', description: 'تحلیل امنیتی استاتیک (SAST) — باید روی PATH باشد' },
  SPECTRAL: { id: 'SPECTRAL', label: 'Spectral', description: 'lint قرارداد OpenAPI' },
  AXE: { id: 'AXE', label: 'axe-core', description: 'دسترسی‌پذیری WCAG روی UI زنده با Playwright' },
};

const APPROACH_IDS = Object.keys(SOURCE_APPROACHES);
const TOOL_IDS = Object.keys(TOOL_KINDS);
const STATIC_TOOL_IDS = ['BIOME', 'GITLEAKS', 'AUDIT', 'SEMGREP', 'SPECTRAL'];
const LIVE_RUNTIME_TOOL_IDS = ['DANGER', 'K6', 'PLAYWRIGHT', 'AXE'];

function isApproach(value) {
  return APPROACH_IDS.includes(String(value || ''));
}

function isTool(value) {
  return TOOL_IDS.includes(String(value || ''));
}

function isStaticTool(value) {
  return STATIC_TOOL_IDS.includes(String(value || '').toUpperCase());
}

function needsLiveRuntime(value) {
  return LIVE_RUNTIME_TOOL_IDS.includes(String(value || '').toUpperCase());
}

module.exports = {
  SOURCE_APPROACHES,
  TOOL_KINDS,
  APPROACH_IDS,
  TOOL_IDS,
  STATIC_TOOL_IDS,
  LIVE_RUNTIME_TOOL_IDS,
  isApproach,
  isTool,
  isStaticTool,
  needsLiveRuntime,
};
