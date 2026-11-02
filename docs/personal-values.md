# Phase 1 audit: one-person values in the app

What was hard-coded for the original single user, and what replaced it in this repo.

## Changed in the code

| Was | Now |
|---|---|
| ICICI cards always used "running total" cashback | Accounts › Cashback mode; otherwise a card with a due day is "per bill", else "monthly" |
| ICICI cashback went to an "Amazon Pay" wallet | Accounts › Cashback paid into (blank = the card itself) |
| Split payment / cashback defaulted to an Amazon wallet | the card's own cashback destination, else the first other account |
| "Everyday" accounts were SBI and Jupiter Bank | Settings › Default expense / income account lead the list; with none set, all banks show under "Banks" |
| Profile showed the name "Matin" | Settings › Your name (falls back to "You") |
| Company placeholder "e.g. Finlens" | "e.g. Acme Ltd" |
| Investment account row "Sent to Kite / INDmoney" | hidden while `MODULES.investments` is off |
| Bank logos for Deel and INDmoney, ~30 stock logos | removed; SBI, ICICI and Jupiter logos kept (matched by account name) |
| App opened on Overview with Overview / Holdings tabs | Money only: Accounts and Spend tabs; opens on Spend |
| SMS draft bubble and its dot on Spend | hidden while `MODULES.sms` is off |

## Switched off by module flag (`MODULES` near the top of `index.html`)

`investments`, `construction`, `zakat`, `interest`, `books`, `sms` — all `false` for v1.
Construction, Zakat, Interest, Books and bank-text features also only appear when their data
exists, and the v1 sheet has none of their tabs, so they stay hidden either way.

## Still to do in phase 2 (they belong to the data layer being replaced)

- Connection screen asks for an Apps Script URL and passcode → becomes Sign in with Google.
- `loadExpenses()` / `saveMove()` call the Apps Script web app → become Sheets API reads and writes.
- Investments code (Overview, Holdings, FIFO, EPF/NPS, tax) is still in the file, switched off. Remove it once the Money build is stable, to cut the file size (≈845 KB today).
