# ماتریس پوشش — tavan

| FLOW | موضوع | P | ابزار |
|------|--------|---|--------|
| AUTH | who-am-i / roles | P0 | DANGER |
| TBL | grid + pagination | P0 | DANGER · k6 load |
| SEC | unauth / IDOR / abuse / mass-assign | P0 | DANGER SEC-090..096 · k6 security-perf |
| CRU | create fail-closed | P0 | DANGER |
| XCUT | health | P0 | DANGER · k6 health |
| RPT | summary | P1 | DANGER |
| APR | update-status | P2 | DANGER |
| ADM | records scope | P1 | DANGER |
| CK | checklist 1–26 | P1 | Playwright |
| — | a11y | P1 | axe |
| — | unit pagination | P2 | Vitest |
