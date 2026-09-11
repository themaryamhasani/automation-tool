# Automation Tool

سامانه مستقل مدیریت و اجرای تست با چند اپروچ منبع و چند ابزار است. وب، API، احراز هویت، مدیریت کاربران، پروژه‌ها، محیط‌ها، فایل‌های تست، Runner و دیتابیس همگی مستقل‌اند.

## اپروچ‌های منبع

هر پروژه یکی از این منابع را دارد؛ ابزارهای تست روی همان منبع اجرا می‌شوند.

| اپروچ | رفتار |
|--------|--------|
| **IS** | خواندن `test/doc` از `D:\AllApp\IS\integrated-systems` (قابل تنظیم با `IS_ROOT`). اجرای تست فقط وقتی سرویس‌های IS بالا باشند. گزارش‌ها همان‌جا نوشته می‌شوند: `reports/by-flow`، `reports/by-tool`، `history` و بازسازی تخته با `build-report-boards.mjs`. |
| **CDE** | ورود به CDE، Catalog، Snapshot رمزنگاری‌شده و Playwright (رفتار قبلی). |
| **GitHub** | ورود با Personal Access Token همان کاربر؛ فقط ریپوهای همان حساب لود می‌شود. |
| **git.edus.ir** | ورود با حساب GitLab ایدوس یا PAT همان کاربر؛ پروژه‌ها از API Membership لود می‌شوند. رمز در دیتابیس ذخیره نمی‌شود. |
| **ZIP** | آپلود آرشیو، استخراج روی سرور، مرور و اجرا. |

## ابزارهای تست

- **Node danger ALL** — `run.mjs` / `run-by-flow.mjs` روی runtime زنده IS
- **k6** — اسکریپت‌های `k6-*-security-perf.js` (باید `k6` روی PATH باشد)
- **Playwright + Chrome** — harness داخل `scripts/e2e` با `PW_CHANNEL=chrome`
- **Vitest** — unit همان سرویس محصول (بدون ویرایش `services/`)
- **Biome** — lint استاتیک سریع (باینری داخل Runner)
- **gitleaks** — نشت secret؛ باید `gitleaks` روی PATH باشد
- **SCA / npm audit** — CVE وابستگی‌ها؛ در صورت وجود `osv-scanner` و `trivy` همان اجرا آن‌ها را هم صدا می‌زند
- **Semgrep** — SAST؛ باید `semgrep` روی PATH باشد
- **Spectral** — lint قرارداد OpenAPI (`openapi.yaml` / `swagger.json`)
- **axe-core** — دسترسی‌پذیری WCAG روی UI زنده با همان Playwright

ابزارهای استاتیک (Biome، gitleaks، audit، Semgrep، Spectral) بدون بالا بودن runtime اجرا می‌شوند. k6، gitleaks و Semgrep مثل هم روی PATH نصب می‌شوند؛ Biome و Spectral و axe همراه Runner هستند.

برای IS، بعد از هر اجرا فایل raw ابزار و در صورت danger گزارش فلو طبق قرارداد موجود در `test/doc` ذخیره می‌شود.

## اتصال کامل CDE

- ورود دومرحله‌ای با شماره همراه و رمز CDE، `who-am-i` و مدیریت انقضای نشست
- نگه‌داری Cookie/Session فقط به‌شکل AES-256-GCM در PostgreSQL مستقل؛ رمز عبور ذخیره نمی‌شود
- فهرست پروژه‌های قابل دسترس، لینک Editorهای Front/Data Service/Gateway
- Catalog کامل `Web UI`، `Data Service`، `API Module` و `Message Consumer`
- انتخاب و ماندگارکردن Branch عمومی/شخصی، نمایش فایل و نسخه، و دانلود ZIP کل سورس
- Mapping مستقل هر پروژه و اعتبارسنجی دسترسی Repositoryها
- Store فایل‌های Playwright روی PostgreSQL مستقل به‌جای CouchDB/UTMS
- پروفایل کامل محیط شامل Web/API/Gateway، زمان‌بندی دسترسی و Secret referenceهای مبتنی بر ENV خود Runner
- ساخت Snapshot کامل و رمزنگاری‌شده از چهار Repository و همه فایل‌های Playwright پیش از هر Run
- کامپایل TypeScript/JavaScript مربوط به Data Service، ثبت SHA-256 و کنترل یکپارچگی در Runner

در صفحه‌های «Playwright»، «فایل تست Playwright» و «پروژه‌ها، CDE و محیط‌ها» ابتدا «اتصال به CDE» را بزنید. برای اجرای تست، تمام Packageهایی که بیش از یک Branch دارند باید یک‌بار در مرورگر Catalog باز و Branch آنها انتخاب شود؛ سپس همان انتخاب در Snapshot اجرا ثبت می‌شود.

## راه‌اندازی

```powershell
npm.cmd install
npm.cmd run db:setup
npm.cmd run db:seed
npx.cmd playwright install chromium
npm.cmd run dev
```

- وب: `http://localhost:5180`
- API: `http://localhost:4280`
- حساب اولیه: `admin@automation.local`
- رمز اولیه: `Admin@12345` (پس از اولین ورود تغییر دهید.)

تنظیمات اتصال در `.env` قرار دارد. اجرای `db:import` اختیاری است و داده‌های موجود را فقط یک‌بار از `SOURCE_DATABASE_URL` کپی می‌کند؛ هیچ اتصال runtime به منبع نگه نمی‌دارد.

پیش از production مقدار `CDE_SESSION_ENCRYPTION_KEY` را با یک secret تصادفی حداقل ۳۲ کاراکتری جایگزین کنید. این کلید هم Sessionهای CDE و هم فایل‌های Snapshot را در حالت ذخیره‌شده محافظت می‌کند و باید در API و Runner یکسان باشد.

در Secret reference محیط، سمت چپ نام متغیری است که تست دریافت می‌کند و سمت راست نام متغیر موجود روی Runner است؛ برای مثال `{"TEST_USER_PASSWORD":"AUTOMATION_STAGING_PASSWORD"}`. خود مقدار secret هرگز از Runner خارج یا در PostgreSQL ثبت نمی‌شود.

اگر دانلود Chromium در شبکه داخلی کامل نشد، Runner روی ویندوز به Chrome یا Edge نصب‌شده سیستم fallback می‌کند. مسیر صریح مرورگر را می‌توان با `CHROMIUM_EXECUTABLE_PATH` تعیین کرد. برای Firefox و WebKit باید browser bundle متناظر Playwright نصب باشد.

## اجرای Docker

```powershell
docker compose up --build
```

Compose چهار container مستقل `web`، `api`، `runner` و `postgres` را بالا می‌آورد. API در شروع schema و حساب مدیر اولیه را به‌صورت idempotent آماده می‌کند و API/Runner از volume مشترک Artifact استفاده می‌کنند.

## معماری

- `apps/web`: رابط فارسی RTL مبتنی بر React و ساختار صفحه/سایدبار سازمانی
- `apps/api`: REST API، کلاینت رمزنگاری‌شده CDE، session مستقل، Mapping، Catalog و Snapshot worker
- `apps/runner`: مصرف صف PostgreSQL، بازکردن امن Snapshot و اجرای Playwright
- `apps/extension`: افزونه Manifest V3 مبتنی بر `playwright-crx` برای ضبط، Inspect، Replay، Trace، Save و Save & Run
- `database`: schema مستقل PostgreSQL شامل کاربران، تست‌ها، CDE و Snapshotها
- `shared`: رمزنگاری authenticated مشترک API و Runner
- `artifacts`: گزارش‌ها، logها و traceهای هر اجرا

Runner کد تست را اجرا می‌کند و باید در محیط production داخل container/host محدود، بدون secret اضافی و با دسترسی شبکه کنترل‌شده اجرا شود.

## افزونه Chrome Recorder

ساخت افزونه با `npm.cmd run build:extension` انجام می‌شود و خروجی قابل Load unpacked در `apps/extension/dist` است. پس از ورود به وب، از صفحه «افزونه Chrome» یک توکن محدود پروژه بسازید، آن را در Side Panel وارد کنید، تب HTTP(S) را Attach و ضبط را شروع کنید. کد خروجی به‌صورت Playwright Test TypeScript در مدل موجود `test_files` ذخیره می‌شود و Save & Run همان صف و Runner اصلی را صدا می‌زند.

رمزها، token/headerهای احراز هویت، cookie و storage state ذخیره یا به API ارسال نمی‌شوند؛ مقادیر ورودی حساس با ENV placeholder جایگزین می‌شوند. راهنمای کامل مجوزها، اتصال، تست دستی، tracing، صفحات محدود Chrome و troubleshooting در [docs/chrome-recorder-extension.md](docs/chrome-recorder-extension.md) است.

## بررسی سلامت

```powershell
npm.cmd run verify
node scripts/live-check.cjs
node scripts/ui-check.cjs
```

`verify` بدون نیاز به حساب CDE اجرا می‌شود. `live-check` بدون credential، حفاظت endpointهای CDE را بررسی و بخش Runner را skip می‌کند. برای تست end-to-end واقعی، `CDE_SELF_CHECK_PHONE`، `CDE_SELF_CHECK_PASSWORD` و در صورت نیاز `CDE_SELF_CHECK_PROJECT` را موقتاً در محیط اجرا تنظیم کنید؛ این مقادیر در دیتابیس ذخیره نمی‌شوند.
