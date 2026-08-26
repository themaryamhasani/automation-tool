# FLOW TBL — بانک / پوشه / جلسه / آزمون

## ماژول‌های واقعی
| Fixture | sourceId |
|---------|----------|
| bank.folder.load | `ds/tavan/bank/folder/load` |
| bank.sessions.list | `ds/tavan/bank/sessions/list` |
| bank.quizzes.list | `ds/tavan/bank/quizzes/list` |
| bank.quizzes.one | `ds/tavan/bank/quizzes/one` |

## TC
| TC | موضوع |
|----|--------|
| TC-TAVAN-TBL-001 | bank folder root |
| TC-TAVAN-TBL-010 | bank folder + course_id |
| TC-TAVAN-TBL-080 | quizzes without course_id rejected |

فشار همان مسیرها: `scripts/k6/load.js` (گروه‌های course / sessions / classroom / exam).
