const { APPROACH_IDS, TOOL_IDS, TOOL_KINDS } = require('../approaches/constants.cjs');

const RUN_STATUSES = ['PREPARING', 'QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'ERROR', 'CANCEL_REQUESTED', 'CANCELLED'];
const SECURITY_TOOLS = ['BIOME', 'GITLEAKS', 'AUDIT', 'SEMGREP', 'SPECTRAL', 'AXE'];
const STATUS_LABELS = {
  PREPARING: 'ساخت Snapshot',
  QUEUED: 'در صف',
  RUNNING: 'در حال اجرا',
  PASSED: 'موفق',
  FAILED: 'ناموفق',
  ERROR: 'خطا',
  CANCEL_REQUESTED: 'در حال لغو',
  CANCELLED: 'لغوشده',
};

const n = (key, label) => ({ key, label, format: 'number' });
const p = (key, label) => ({ key, label, format: 'percent' });
const t = (key, label) => ({ key, label, format: 'text' });
const d = (key, label) => ({ key, label, format: 'datetime' });
const dur = (key, label) => ({ key, label, format: 'duration' });
const st = (key, label) => ({ key, label, format: 'status' });

const REPORTS = [
  {
    id: 'executive',
    audience: 'CEO',
    audienceLabel: 'مدیرعامل / CEO',
    title: 'خلاصه مدیریتی کیفیت',
    subtitle: 'سلامت کلی تست، ریسک محصول و روند کیفیت برای تصمیم‌گیری هیئت‌مدیره',
    tables: [
      {
        id: 'byProject',
        title: 'کیفیت به‌ازای پروژه',
        columns: [
          t('projectName', 'پروژه'), t('projectCode', 'کد'), t('sourceApproach', 'اپروچ'),
          n('totalRuns', 'اجراها'), n('passedRuns', 'موفق'), n('failedRuns', 'ناموفق'),
          n('errorRuns', 'خطا'), p('passRate', 'نرخ موفقیت'), n('failedTests', 'تست ناموفق'),
          dur('avgDurationMs', 'میانگین مدت'),
        ],
      },
      {
        id: 'byDay',
        title: 'روند روزانه',
        columns: [
          t('day', 'روز'), n('totalRuns', 'اجراها'), n('passedRuns', 'موفق'),
          n('failedRuns', 'ناموفق'), n('errorRuns', 'خطا'), p('passRate', 'نرخ موفقیت'),
        ],
      },
      {
        id: 'atRiskProjects',
        title: 'پروژه‌های پرریسک (بدون موفقیت در بازه)',
        columns: [
          t('projectName', 'پروژه'), n('totalRuns', 'اجراها'), n('failedRuns', 'ناموفق'),
          n('errorRuns', 'خطا'), d('lastRunAt', 'آخرین اجرا'),
        ],
      },
      {
        id: 'topFailures',
        title: 'بیشترین شکست‌ها',
        columns: [
          t('projectName', 'پروژه'), t('testFilePath', 'هدف'), t('toolKind', 'ابزار'),
          n('failCount', 'تعداد شکست'), d('lastFailedAt', 'آخرین شکست'),
        ],
      },
    ],
  },
  {
    id: 'engineering',
    audience: 'CTO',
    audienceLabel: 'CTO / فنی',
    title: 'سلامت مهندسی و ابزارها',
    subtitle: 'پوشش اپروچ و ابزار، پایداری محیط، صف اجرا و صدک‌های مدت برای CTO',
    tables: [
      {
        id: 'byApproach',
        title: 'پوشش اپروچ منبع',
        columns: [
          t('sourceApproach', 'اپروچ'), n('totalRuns', 'اجراها'), n('passedRuns', 'موفق'),
          n('failedRuns', 'ناموفق'), p('passRate', 'نرخ موفقیت'), dur('avgDurationMs', 'میانگین مدت'),
          dur('p95DurationMs', 'P95 مدت'), dur('avgQueueMs', 'میانگین انتظار صف'),
        ],
      },
      {
        id: 'byTool',
        title: 'عملکرد ابزارها',
        columns: [
          t('toolKind', 'ابزار'), n('totalRuns', 'اجراها'), n('passedRuns', 'موفق'),
          n('failedRuns', 'ناموفق'), n('errorRuns', 'خطا'), p('passRate', 'نرخ موفقیت'),
          dur('avgDurationMs', 'میانگین مدت'), dur('p50DurationMs', 'P50'), dur('p95DurationMs', 'P95'),
          dur('avgQueueMs', 'انتظار صف'),
        ],
      },
      {
        id: 'byEnvironment',
        title: 'پایداری محیط‌ها',
        columns: [
          t('projectName', 'پروژه'), t('environmentName', 'محیط'), n('totalRuns', 'اجراها'),
          n('passedRuns', 'موفق'), n('failedRuns', 'ناموفق'), p('passRate', 'نرخ موفقیت'),
          dur('avgDurationMs', 'میانگین مدت'), dur('avgQueueMs', 'انتظار صف'),
        ],
      },
      {
        id: 'unusedTools',
        title: 'ابزارهای بدون اجرا در این بازه',
        columns: [t('toolKind', 'ابزار'), t('label', 'نام')],
      },
      {
        id: 'liveQueue',
        title: 'صف و اجرای زنده (همین حالا)',
        columns: [st('status', 'وضعیت'), n('totalRuns', 'تعداد')],
      },
    ],
  },
  {
    id: 'quality',
    audience: 'TEST_LEAD',
    audienceLabel: 'سرپرست تست',
    title: 'کیفیت، شکست و ناپایداری',
    subtitle: 'اهداف شکست‌خورده، تست‌های مشکوک به flaky، پک/فلو و کندترین اجراها',
    tables: [
      {
        id: 'failingTargets',
        title: 'اهداف شکست‌خورده',
        columns: [
          t('projectName', 'پروژه'), t('testFilePath', 'هدف'), t('toolKind', 'ابزار'),
          t('packId', 'پک'), t('flowId', 'فلو'), n('failCount', 'شکست'), n('passCount', 'موفق'),
          n('totalRuns', 'کل'), d('lastFailedAt', 'آخرین شکست'),
        ],
      },
      {
        id: 'flakyTargets',
        title: 'مشکوک به ناپایداری (موفق و ناموفق در یک بازه)',
        columns: [
          t('projectName', 'پروژه'), t('testFilePath', 'هدف'), t('toolKind', 'ابزار'),
          t('packId', 'پک'), t('flowId', 'فلو'), n('passCount', 'موفق'), n('failCount', 'شکست'),
          n('totalRuns', 'کل'), p('failRate', 'نرخ شکست'),
        ],
      },
      {
        id: 'byPackFlow',
        title: 'کیفیت پک و فلو',
        columns: [
          t('projectName', 'پروژه'), t('packId', 'پک'), t('flowId', 'فلو'), t('toolKind', 'ابزار'),
          n('totalRuns', 'اجراها'), n('passedRuns', 'موفق'), n('failedRuns', 'ناموفق'), p('passRate', 'نرخ موفقیت'),
        ],
      },
      {
        id: 'slowestRuns',
        title: 'کندترین اجراها',
        columns: [
          t('projectName', 'پروژه'), t('testFilePath', 'هدف'), t('toolKind', 'ابزار'),
          st('status', 'وضعیت'), dur('durationMs', 'مدت'), d('requestedAt', 'زمان'), t('requestedByName', 'درخواست‌دهنده'),
        ],
      },
    ],
  },
  {
    id: 'team',
    audience: 'TEST_LEAD',
    audienceLabel: 'سرپرست تست / مدیرعامل',
    title: 'عملکرد تیم تست',
    subtitle: 'حجم کار، نرخ موفقیت و آخرین فعالیت هر درخواست‌دهنده اجرا',
    tables: [
      {
        id: 'byRequester',
        title: 'اجرا به‌ازای فرد',
        columns: [
          t('fullName', 'نام'), t('role', 'نقش'), n('totalRuns', 'اجراها'), n('passedRuns', 'موفق'),
          n('failedRuns', 'ناموفق'), n('errorRuns', 'خطا'), p('passRate', 'نرخ موفقیت'),
          n('failedTests', 'تست ناموفق'), d('lastRunAt', 'آخرین اجرا'),
        ],
      },
    ],
  },
  {
    id: 'security',
    audience: 'CTO',
    audienceLabel: 'CTO / کارشناس تست',
    title: 'اسکن امنیت و کیفیت ایستا',
    subtitle: 'gitleaks، SCA، Semgrep، Spectral، Biome و axe-core — یافته‌ها و پوشش اسکن',
    defaultToolKinds: SECURITY_TOOLS,
    tables: [
      {
        id: 'byTool',
        title: 'نتیجه اسکن‌ها',
        columns: [
          t('toolKind', 'ابزار'), n('totalRuns', 'اجراها'), n('passedRuns', 'پاک'),
          n('failedRuns', 'یافته/ناموفق'), n('errorRuns', 'خطا'), p('passRate', 'نرخ پاک بودن'),
          d('lastRunAt', 'آخرین اسکن'),
        ],
      },
      {
        id: 'recentFindings',
        title: 'اسکن‌های ناموفق اخیر',
        columns: [
          t('projectName', 'پروژه'), t('toolKind', 'ابزار'), t('testFilePath', 'هدف'),
          st('status', 'وضعیت'), n('failedTests', 'یافته'), d('requestedAt', 'زمان'), t('requestedByName', 'درخواست‌دهنده'),
        ],
      },
      {
        id: 'unusedTools',
        title: 'اسکنرهای بدون اجرا در این بازه',
        columns: [t('toolKind', 'ابزار'), t('label', 'نام')],
      },
    ],
  },
  {
    id: 'runs',
    audience: 'TESTER',
    audienceLabel: 'کارشناس تست',
    title: 'دفترچه اجراها',
    subtitle: 'فهرست فیلترپذیر همه اجراها با جزئیات لازم برای تحلیل کارشناس تست و خروجی اکسل',
    paginated: true,
    searchable: true,
    tables: [
      {
        id: 'rows',
        title: 'اجراهای مطابق فیلتر',
        columns: [
          d('requestedAt', 'ثبت'), t('projectName', 'پروژه'), t('environmentName', 'محیط'),
          t('sourceApproach', 'اپروچ'), t('toolKind', 'ابزار'), t('testFilePath', 'هدف'),
          t('packId', 'پک'), t('flowId', 'فلو'), st('status', 'وضعیت'),
          n('totalTests', 'کل تست'), n('passedTests', 'موفق'), n('failedTests', 'ناموفق'),
          n('skippedTests', 'ردشده'), dur('durationMs', 'مدت'), t('requestedByName', 'درخواست‌دهنده'),
        ],
      },
    ],
  },
];

const REPORT_BY_ID = Object.fromEntries(REPORTS.map(report => [report.id, report]));

function getReport(id) {
  return REPORT_BY_ID[String(id || '')] || null;
}

function listReports() {
  return REPORTS.map(report => ({
    id: report.id,
    audience: report.audience,
    audienceLabel: report.audienceLabel,
    title: report.title,
    subtitle: report.subtitle,
    paginated: Boolean(report.paginated),
    searchable: Boolean(report.searchable),
  }));
}

module.exports = {
  RUN_STATUSES,
  SECURITY_TOOLS,
  STATUS_LABELS,
  APPROACH_IDS,
  TOOL_IDS,
  TOOL_KINDS,
  getReport,
  listReports,
};
