# FLOW PERF — فشار بیزنس توان (k6)

## پیش‌فرض
- توکن/کوکی از **Runtime Login** همین ابزار (`PREREG_COOKIE`).
- بدون مسیر مای‌مدیو در اسکریپت.

## نگاشت بیزنس → ماژول CDE

| بیزنس | ماژول | اسکریپت |
|-------|--------|---------|
| زمینه / محتوای دوره | `ds/tavan/bank/folder/load` + `similar-implements-list` | `load.js` → course-context |
| برگزاری / لیست جلسات | `ds/tavan/bank/sessions/list` | `load.js` → hold-sessions |
| شرکت در کلاس | `ds/tavan/classroom/announcements-section-load` | `load.js` → join-classroom |
| شرکت در آزمون | `ds/tavan/bank/quizzes/list` (+ `quizzes/one`) | `load.js` → join-exam |
| رانتایم CDE همین سیستم | Express `/health` + `/__runtime/*` | `health.js` + گروه cde-express |

> ماژول FR «ایجاد دوره» در snapshot فعلی نیست؛ مسیر بار روی کشف/محتوای دوره و جلسات واقعی است. Write کلاس با `K6_ALLOW_WRITES=1`.

## TC فشار
| TC | موضوع |
|----|--------|
| TC-TAVAN-PERF-001 | express structure under load |
| TC-TAVAN-PERF-010 | course + sessions + classroom + quizzes with runtime cookie |
| TC-TAVAN-PERF-090 | unauth / fake course bounded (`security-perf.js`) |
