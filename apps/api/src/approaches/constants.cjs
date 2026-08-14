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
};

const APPROACH_IDS = Object.keys(SOURCE_APPROACHES);
const TOOL_IDS = Object.keys(TOOL_KINDS);

function isApproach(value) {
  return APPROACH_IDS.includes(String(value || ''));
}

function isTool(value) {
  return TOOL_IDS.includes(String(value || ''));
}

module.exports = { SOURCE_APPROACHES, TOOL_KINDS, APPROACH_IDS, TOOL_IDS, isApproach, isTool };
