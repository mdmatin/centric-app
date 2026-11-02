# Centric (Money)

A personal-finance PWA where your data lives in your own Google Sheet.

**Status: phase 1 of 5** — sheet template, settings, and the app freed of one-person setup.
The app still talks to the original Apps Script backend; phase 2 replaces that with
Sign in with Google and the Sheets API (`drive.file` scope).

## Layout

- `index.html`, `sw.js`, `manifest.json` — the app (single file, as before)
- `template/Centric-Money-Template.xlsx` — the sheet every user starts from
- `docs/schema.md` — tabs, columns and the fields the app reads
- `docs/personal-values.md` — what was hard-coded and what replaced it

## Version 1 scope

Accounts, expenses, income, transfers, budgets and the monthly view, recurring entries, card cashback.
Out of v1 (code kept, switched off in `MODULES`): investments, construction fund, Zakat, bank interest, books check, SMS drafts.

## Phases

1. Template and settings (this)
2. Sign in with Google; the app creates the user's sheet and reads/writes it through the Sheets API
3. Books, recurring catch-up and cashback logic in the app
4. Google verification (home page, privacy policy), then open to others
5. Later: investments as an optional module, a background server if needed
