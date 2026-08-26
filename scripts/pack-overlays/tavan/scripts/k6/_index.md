# scripts/k6 — سامانه توان (CDE)

## مدل احراز
- Runner کوکی نشست رانتایم را با `PREREG_COOKIE` تزریق می‌کند.
- اسکریپت‌ها **مسیر مای‌مدیو / SSO / `/devlogin` را نمی‌زنند**.
- بدون کوکی رانتایم فقط گروه Express محلی معنا دارد؛ مسیر بیزنس skip/fail-check می‌شود.

## فایل‌ها

| فایل | نقش | اولویت |
|------|------|--------|
| [_client.js](_client.js) | کلاینت مشترک (express + data-provider + course/organ) | — |
| [health.js](health.js) | smoke ساختار CDE express همین سیستم | P0 |
| [load.js](load.js) | بار بیزنس: دوره → جلسه → کلاس → آزمون + ساختار express | P0 publish |
| [security-perf.js](security-perf.js) | بدون نشست + abuse | P0 |

## گروه‌های `load.js`

| group | معنی بیزنس | ماژول‌ها |
|-------|------------|---------|
| `cde-express-runtime` | فشار روی رانتایم Express پکیج CDE | `/health`, `/__runtime/*` |
| `course-context` | زمینه / محتوای دوره | `app/load`, `folder/load`, `similar-implements` |
| `hold-sessions` | برگزاری / لیست جلسات | `sessions/list` |
| `join-classroom` | شرکت در کلاس | `announcements-section-load` |
| `join-exam` | شرکت در آزمون | `quizzes/list`, `quizzes/one` |

شناسه دوره پیش‌فرض: `TAVAN_COURSE_ID=CC05110111PL1IM1`.

Write اختیاری: `K6_ALLOW_WRITES=1` → `create-announcement` با نرخ پایین.

## اجرا

```bash
# از UI: Runtime Login → ابزار K6 روی پک tavan
k6 run scripts/k6/health.js
k6 run -e PREREG_COOKIE="…" -e AUTOMATION_RUNTIME_URL=http://127.0.0.1:4558 scripts/k6/load.js
```

VUs / duration از پنل تنظیمات K6 استودیوی CDE.
