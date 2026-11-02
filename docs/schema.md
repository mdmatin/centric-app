# Centric sheet schema (Money, v1)

Each user has one Google Sheet made from `template/Centric-Money-Template.xlsx`.
The app finds columns by **header name**, not position, so users can add their own columns.

| Tab | Columns | App field (`X.data`) |
|---|---|---|
| Settings | Setting · Value · Notes | `settings` — see keys below |
| Accounts | Name · Type · Opening balance · Credit limit · Bill due day · Cashback mode · Cashback paid into · Hidden · Note · Balance | `accounts[]`: `name, type, opening, limit, dueDay, cbMode, cbTo, hidden, note` (Balance is a sheet formula; the app recomputes it) |
| Expenses | Date · Account · Category · Subcategory · Note · Description · Amount · ID | `entries[]`: `date, account, category, sub, note, desc, amount, row` |
| Income | Date · Account · Type · Company · Tax paid · Note · Description · Amount · ID | `incomes[]`: `date, account, type, source, tax, note, desc, amount, row` |
| Transfers | Date · From · To · Note · Description · Amount · ID | `transfers[]`: `date, from, to, note, desc, amount, row` |
| Categories | Expense category · Sub-categories (comma separated) · Income type | `categories[]: {name, subs[]}`, `inTypes[]` |
| Budgets | Category · Monthly budget · (one column per month override, e.g. `2026-11`) | `budgets: {def:{cat:amt}, by:{ym:{cat:amt}}}` |
| Recurring | ID · Name · Kind · Amount · Category / Type · Subcategory / Company · Account / From · To · Day · Start · End · Auto · Active · Last posted · Note | `recurring[]` (same columns the current Apps Script uses) |

## Settings keys

| Setting (sheet) | Key (`settings`) | Default |
|---|---|---|
| Your name | `name` | — |
| Currency | `currency` | `INR` |
| Locale | `locale` | `en-IN` |
| Time zone | `tz` | `Asia/Kolkata` |
| Default expense account | `defaultExpenseAccount` | last used |
| Default income account | `defaultIncomeAccount` | last used |
| Budget alert at | `budgetAlert` | `0.9` |
| Cashback type | `cashbackType` | `Cashback` |

## Conventions

- Amounts are positive. Expenses reduce an account, income adds, a transfer moves From → To.
- A card's balance is negative while money is owed on it.
- Entries dated after today are planned: they don't count towards balances until their date.
- Cashback modes: `Monthly`, `Per bill` (needs Bill due day), `Running total` (the user types the card app's lifetime total; the app logs the difference and keeps the total in the note as `Cashback · total ₹4,980`).
- IDs are written by the app. Rows typed by hand have none until the app next saves them.
