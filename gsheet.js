/* Centric · Google data layer (phase 2)
   Sign in with Google, then read and write the user's own "Centric – Money" spreadsheet with the
   Sheets API. Permission is drive.file: the app can only see the spreadsheet it created.
   The app's existing api() / apiPost() calls are routed here when cfg.mode === 'google'. */
const GS = (() => {
  const CLIENT_ID = '905416512877-cak70o2j739ctr10240nq6grqaiahgjq.apps.googleusercontent.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';
  const APPKEY = 'centricMoney', APPVER = '1';            // marks the user's sheet in Drive, so any device finds it
  const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets', DRIVE = 'https://www.googleapis.com/drive/v3/files';

  // tab → header row (the app reads columns by these names, so users may add columns of their own)
  const TABS = {
    Settings:   ['Setting', 'Value', 'Notes'],
    Accounts:   ['Name', 'Type', 'Opening balance', 'Credit limit', 'Bill due day', 'Cashback mode', 'Cashback paid into', 'Hidden', 'Note', 'Balance'],
    Expenses:   ['Date', 'Account', 'Category', 'Subcategory', 'Note', 'Description', 'Amount', 'ID'],
    Income:     ['Date', 'Account', 'Type', 'Company', 'Tax paid', 'Note', 'Description', 'Amount', 'ID'],
    Transfers:  ['Date', 'From', 'To', 'Note', 'Description', 'Amount', 'ID'],
    Categories: ['Expense category', 'Sub-categories (comma separated)', 'Income type'],
    Budgets:    ['Category', 'Monthly budget'],
    Recurring:  ['ID', 'Name', 'Kind', 'Amount', 'Category / Type', 'Subcategory / Company', 'Account / From', 'To', 'Day', 'Start', 'End', 'Auto', 'Active', 'Last posted', 'Note'],
  };
  const SETTINGS = [   // sheet label → settings key
    ['Your name', 'name'], ['Currency', 'currency'], ['Locale', 'locale'], ['Time zone', 'tz'],
    ['Default expense account', 'defaultExpenseAccount'], ['Default income account', 'defaultIncomeAccount'],
    ['Budget alert at', 'budgetAlert'], ['Cashback type', 'cashbackType'],
  ];
  const CATS = [['Food', 'Groceries, Eating out, Delivery'], ['Household', 'Rent, Maintenance, Help, Supplies'],
    ['Bills', 'Electricity, Mobile, Internet, Gas, Water'], ['Transport', 'Fuel, Cab, Metro, Parking'],
    ['Shopping', 'Clothes, Electronics, Home'], ['Health', 'Doctor, Medicines, Insurance'], ['Subscriptions', 'OTT, Music, Apps'],
    ['Travel', 'Flights, Hotels, Trains'], ['Education', 'Fees, Books, Courses'], ['Gifts & Donations', 'Gifts, Charity'],
    ['Personal care', ''], ['Investments', 'SIP, Stocks, Deposits'], ['Other', '']];
  const IN_TYPES = ['Salary', 'Freelancing', 'Interest', 'Cashback', 'Dividends', 'Gift / transfer', 'Refund', 'Other'];

  /* ---------------- sign-in ---------------- */
  let token = null, exp = 0;
  try { const t = JSON.parse(LSX.getItem('gs.tok') || 'null'); if (t && t.exp > Date.now()) { token = t.token; exp = t.exp; } } catch (e) {}
  function gisReady() {
    return new Promise((ok, no) => {
      if (window.google && google.accounts && google.accounts.oauth2) return ok();
      const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => ok(); s.onerror = () => no(new Error('Could not load Google sign-in. Check your connection.'));
      document.head.appendChild(s);
    });
  }
  // interactive: from a tap (the sign-in popup is allowed). Otherwise Google tries quietly; a blocked popup asks for a tap.
  async function getToken(interactive) {
    if (token && Date.now() < exp - 60000) return token;
    await gisReady();
    return new Promise((ok, no) => {
      const c = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID, scope: SCOPE, login_hint: (typeof cfg !== 'undefined' && cfg && cfg.email) || undefined,
        callback: r => {
          if (r.error) return no(new Error(r.error_description || r.error));
          token = r.access_token; exp = Date.now() + (Number(r.expires_in) || 3600) * 1000;
          try { LSX.setItem('gs.tok', JSON.stringify({ token, exp })); } catch (e) {}
          ok(token);
        },
        error_callback: e => { const err = new Error(e && e.type === 'popup_closed' ? 'Sign-in was closed' : 'Google needs you to sign in again'); err.reconnect = true; no(err); },
      });
      c.requestAccessToken({ prompt: interactive ? 'select_account' : '' });
    });
  }
  function dropToken() { token = null; exp = 0; try { LSX.removeItem('gs.tok'); } catch (e) {} }

  async function g(url, opt, again) {
    const t = await getToken(false);
    const r = await fetch(url, Object.assign({}, opt, { headers: Object.assign({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, (opt && opt.headers) || {}) }));
    if (r.status === 401 && !again) { dropToken(); return g(url, opt, true); }
    const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || ('Google returned ' + r.status));
    return j;
  }
  const sid = () => cfg.sheetId;
  const vals = (ranges, opt) => g(`${SHEETS}/${sid()}/values:batchGet?${ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&')}&valueRenderOption=${opt || 'UNFORMATTED_VALUE'}&dateTimeRenderOption=SERIAL_NUMBER`);
  const put = data => g(`${SHEETS}/${sid()}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
  const batch = requests => g(`${SHEETS}/${sid()}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
  const appendRow = (tab, row) => g(`${SHEETS}/${sid()}/values/${encodeURIComponent(tab + '!A1')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: 'POST', body: JSON.stringify({ values: [row] }) });
  let tabIds = null;
  async function tabId(tab) {
    if (!tabIds) { const j = await g(`${SHEETS}/${sid()}?fields=sheets.properties(sheetId,title)`); tabIds = {}; j.sheets.forEach(s => { tabIds[s.properties.title] = s.properties.sheetId; }); }
    return tabIds[tab];
  }

  /* ---------------- the user's spreadsheet ---------------- */
  async function findSheet() {
    const q = encodeURIComponent(`appProperties has { key='${APPKEY}' and value='${APPVER}' } and trashed=false`);
    const j = await g(`${DRIVE}?q=${q}&fields=files(id,name)&orderBy=createdTime`);
    return (j.files || [])[0] || null;
  }
  async function createSheet(name) {
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Asia/Kolkata';
    const names = Object.keys(TABS);
    const s = await g(SHEETS, { method: 'POST', body: JSON.stringify({
      properties: { title: 'Centric – Money', locale: 'en_IN', timeZone: tz },
      sheets: names.map((t, i) => ({ properties: { sheetId: i + 1, title: t, index: i, gridProperties: { frozenRowCount: 1, rowCount: t === 'Expenses' ? 2000 : 500, columnCount: Math.max(TABS[t].length, t === 'Budgets' ? 26 : 1) } } })),
    }) });
    cfg.sheetId = s.spreadsheetId; tabIds = null;
    await g(`${DRIVE}/${s.spreadsheetId}`, { method: 'PATCH', body: JSON.stringify({ appProperties: { [APPKEY]: APPVER } }) });
    const A = 'Accounts!$A$2:$A$300';
    const settings = [['Your name', name || ''], ['Currency', 'INR'], ['Locale', 'en-IN'], ['Time zone', tz], ['Default expense account', ''],
      ['Default income account', ''], ['Budget alert at', 0.9], ['Cashback type', 'Cashback']];
    const data = names.map(t => ({ range: `${t}!A1`, values: [TABS[t]] }));
    data.push({ range: 'Settings!A2', values: settings });
    data.push({ range: 'Categories!A2', values: CATS.map((c, i) => [c[0], c[1], IN_TYPES[i] || '']) });
    data.push({ range: 'Budgets!A2', values: CATS.map(c => [c[0], '']) });
    // Balance: opening + income − expenses ± transfers, counting entries dated up to today (future ones are planned)
    data.push({ range: 'Accounts!J1', values: [['={"Balance";MAP(A2:A,C2:C,LAMBDA(n,o,IF(n="","",o'
      + '+SUMIFS(Income!H:H,Income!B:B,n,Income!A:A,"<="&TODAY())-SUMIFS(Expenses!G:G,Expenses!B:B,n,Expenses!A:A,"<="&TODAY())'
      + '+SUMIFS(Transfers!F:F,Transfers!C:C,n,Transfers!A:A,"<="&TODAY())-SUMIFS(Transfers!F:F,Transfers!B:B,n,Transfers!A:A,"<="&TODAY()))))}']] });
    await put(data);
    const id = t => names.indexOf(t) + 1;
    const list = (t, c0, c1, r1, values) => ({ setDataValidation: { range: { sheetId: id(t), startRowIndex: 1, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 },
      rule: { condition: values ? { type: 'ONE_OF_LIST', values: values.map(v => ({ userEnteredValue: v })) } : { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=' + A }] }, showCustomUi: true, strict: false } } });
    const rng = (t, c0, c1, r1, ref) => ({ setDataValidation: { range: { sheetId: id(t), startRowIndex: 1, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 },
      rule: { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=' + ref }] }, showCustomUi: true, strict: false } } });
    const fmt = (t, c0, c1, pattern, type) => ({ repeatCell: { range: { sheetId: id(t), startRowIndex: 1, startColumnIndex: c0, endColumnIndex: c1 },
      cell: { userEnteredFormat: { numberFormat: { type: type || 'NUMBER', pattern } } }, fields: 'userEnteredFormat.numberFormat' } });
    const bold = names.map(t => ({ repeatCell: { range: { sheetId: id(t), startRowIndex: 0, endRowIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } }));
    const money = '[$₹-4009]#,##0.00', date = 'd mmm yyyy';
    await batch(bold.concat([
      list('Accounts', 1, 2, 300, ['Bank', 'Card', 'Wallet', 'Cash']), list('Accounts', 5, 6, 300, ['Monthly', 'Per bill', 'Running total']),
      list('Accounts', 6, 7, 300), list('Accounts', 7, 8, 300, ['TRUE', 'FALSE']),
      list('Expenses', 1, 2, 2000), rng('Expenses', 2, 3, 2000, 'Categories!$A$2:$A$100'),
      list('Income', 1, 2, 500), rng('Income', 2, 3, 500, 'Categories!$C$2:$C$50'), list('Transfers', 1, 3, 500),
      list('Recurring', 2, 3, 500, ['Expense', 'Income', 'Transfer']), list('Recurring', 6, 8, 500), list('Recurring', 11, 13, 500, ['TRUE', 'FALSE']),
      fmt('Expenses', 0, 1, date, 'DATE'), fmt('Income', 0, 1, date, 'DATE'), fmt('Transfers', 0, 1, date, 'DATE'),
      fmt('Expenses', 6, 7, money), fmt('Income', 4, 5, money), fmt('Income', 7, 8, money), fmt('Transfers', 5, 6, money),
      fmt('Accounts', 2, 4, money), fmt('Accounts', 9, 10, money), fmt('Budgets', 1, 26, money), fmt('Recurring', 3, 4, money),
      fmt('Recurring', 9, 11, '@', 'TEXT'), fmt('Recurring', 13, 14, '@', 'TEXT'),
    ]));
    return s.spreadsheetId;
  }

  /* ---------------- reading ---------------- */
  const iso = v => {
    if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? m[0] : '';
  };
  const ymOf = v => { if (typeof v === 'number') return iso(v).slice(0, 7); const m = /^(\d{4})-(\d{1,2})/.exec(String(v || '').trim()); return m ? m[1] + '-' + ('0' + m[2]).slice(-2) : ''; };
  const num = v => { const n = typeof v === 'number' ? v : Number(String(v || '').replace(/[,\s₹]/g, '')); return isFinite(n) ? n : 0; };
  const str = v => String(v == null ? '' : v).trim();
  const bool = (v, d) => v === '' || v == null ? d : v === true || /^(true|yes|1)$/i.test(String(v));
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function table(values) {   // [{header: value}] with the sheet row number kept
    const rows = values || [], h = (rows[0] || []).map(str), out = [];
    for (let i = 1; i < rows.length; i++) { const r = rows[i], o = { _r: i + 1 }; let any = false;
      h.forEach((k, j) => { o[k] = r[j] === undefined ? '' : r[j]; if (o[k] !== '') any = true; }); if (any) out.push(o); }
    out.h = h; return out;
  }
  const RANGES = ['Settings!A:B', 'Accounts!A:J', 'Expenses!A:H', 'Income!A:I', 'Transfers!A:G', 'Categories!A:C', 'Budgets!A:ZZ', 'Recurring!A:O'];
  async function readAll() {
    const j = await vals(RANGES), v = {};
    RANGES.forEach((r, i) => { v[r.split('!')[0]] = table((j.valueRanges[i] || {}).values); });
    // rows typed by hand have no ID yet: give them one, so the app can edit them like any other
    const fix = [];
    [['Expenses', 'H'], ['Income', 'I'], ['Transfers', 'G']].forEach(([t, col]) => v[t].forEach(o => { if (!str(o.ID)) { o.ID = newId(); fix.push({ range: `${t}!${col}${o._r}`, values: [[o.ID]] }); } }));
    v.Recurring.forEach(o => { if (!str(o.ID)) { o.ID = newId(); fix.push({ range: `Recurring!A${o._r}`, values: [[o.ID]] }); } });
    if (fix.length) await put(fix);
    return v;
  }
  function toData(v) {
    const settings = {}, defaults = {};
    v.Settings.forEach(o => { const k = str(o.Setting), m = SETTINGS.find(s => s[0] === k); if (m) settings[m[1]] = o.Value; else if (k) defaults[k] = o.Value; });
    const accounts = v.Accounts.filter(o => str(o.Name)).map(o => ({ name: str(o.Name), type: str(o.Type) || 'Bank', opening: num(o['Opening balance']),
      limit: num(o['Credit limit']) || null, dueDay: num(o['Bill due day']) || null, cbMode: str(o['Cashback mode']), cbTo: str(o['Cashback paid into']) || null,
      active: !bool(o.Hidden, false), hidden: bool(o.Hidden, false), note: str(o.Note) }));
    const entries = v.Expenses.filter(o => o.Date !== '').map(o => ({ row: str(o.ID), date: iso(o.Date), account: str(o.Account), category: str(o.Category),
      sub: str(o.Subcategory), note: str(o.Note), remark: str(o.Note), desc: str(o.Description), amount: num(o.Amount) }));
    const incomes = v.Income.filter(o => o.Date !== '').map(o => ({ row: str(o.ID), date: iso(o.Date), account: str(o.Account), type: str(o.Type), source: str(o.Company),
      tax: num(o['Tax paid']), note: str(o.Note), remark: str(o.Note), desc: str(o.Description), amount: num(o.Amount) }));
    const transfers = v.Transfers.filter(o => o.Date !== '').map(o => ({ row: str(o.ID), date: iso(o.Date), from: str(o.From), to: str(o.To),
      note: str(o.Note), desc: str(o.Description), amount: num(o.Amount) }));
    const byDate = (a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    [entries, incomes, transfers].forEach(l => l.sort(byDate));
    const categories = v.Categories.filter(o => str(o['Expense category'])).map(o => ({ name: str(o['Expense category']),
      subs: str(o['Sub-categories (comma separated)']).split(',').map(str).filter(Boolean) }));
    const inTypes = v.Categories.map(o => str(o['Income type'])).filter(Boolean);
    const def = {}, by = {}, months = v.Budgets.h.filter(k => /^\d{4}-\d{2}$/.test(k));
    v.Budgets.forEach(o => { const c = str(o.Category); if (!c) return; if (o['Monthly budget'] !== '') def[c] = num(o['Monthly budget']);
      months.forEach(m => { if (o[m] !== '') (by[m] = by[m] || {})[c] = num(o[m]); }); });
    const recurring = v.Recurring.filter(o => str(o.Name)).map(o => { const day = /^last$/i.test(str(o.Day)) ? 'Last' : Math.min(31, Math.max(1, num(o.Day) || 1));
      return { id: str(o.ID), name: str(o.Name), kind: (str(o.Kind) || 'Expense').toLowerCase(), amount: Math.abs(num(o.Amount)), cat: str(o['Category / Type']),
        sub: str(o['Subcategory / Company']), account: str(o['Account / From']), to: str(o.To), day, start: ymOf(o.Start), end: ymOf(o.End),
        auto: bool(o.Auto, true), active: bool(o.Active, true), last: ymOf(o['Last posted']), note: str(o.Note) }; });
    return { settings, defaults, accounts, entries, incomes, transfers, categories, inTypes, budgets: { def, by }, recurring,
      monthly: {}, entriesFrom: '0000-00', drafts: [], recErr: null, books: null, bankBal: null };
  }

  /* ---------------- writing ---------------- */
  async function findRow(tab, idCol, id) {   // the row an ID sits on right now (rows move when the user sorts)
    const j = await vals([`${tab}!${idCol}:${idCol}`]), col = (j.valueRanges[0].values || []);
    for (let i = 1; i < col.length; i++) if (str((col[i] || [])[0]) === str(id)) return i + 1;
    throw new Error('That entry is no longer in your sheet. Pull down to refresh.');
  }
  const ROW = {
    expense:  { tab: 'Expenses',  id: 'H', row: (d, id) => [d.date, d.account, d.category, d.sub || '', d.note || '', d.desc || '', Number(d.amount), id] },
    income:   { tab: 'Income',    id: 'I', row: (d, id) => [d.date, d.account, d.type, d.source || '', Number(d.tax) || 0, d.note || d.remark || '', d.desc || '', Number(d.amount), id] },
    transfer: { tab: 'Transfers', id: 'G', row: (d, id) => [d.date, d.from, d.to, d.note || '', d.desc || '', Number(d.amount), id] },
  };
  async function deleteRows(tab, rows) {
    if (!rows.length) return; const sh = await tabId(tab);
    rows.sort((a, b) => b - a);
    await batch(rows.map(r => ({ deleteDimension: { range: { sheetId: sh, dimension: 'ROWS', startIndex: r - 1, endIndex: r } } })));
  }
  async function accountRow(name) {
    const j = await vals(['Accounts!A:A']), col = j.valueRanges[0].values || [];
    for (let i = 1; i < col.length; i++) if (str((col[i] || [])[0]) === name) return i + 1;
    return 0;
  }
  async function post(action, d) {
    d = d || {};
    let m = /^(add|edit)(Expense|Income|Transfer)$/.exec(action);
    if (m) {
      const k = ROW[m[2].toLowerCase()];
      if (m[1] === 'add') { const id = newId(); await appendRow(k.tab, k.row(d, id)); return { row: id }; }
      const r = await findRow(k.tab, k.id, d.row); const row = k.row(d, d.row);
      await put([{ range: `${k.tab}!A${r}`, values: [row] }]); return { row: d.row };
    }
    if (action === 'deleteMany') {
      const by = {};
      for (const it of d.items || []) { const k = ROW[it.kind] || ROW.expense; (by[k.tab] = by[k.tab] || { k, ids: [] }).ids.push(it.row); }
      for (const t of Object.keys(by)) {
        const { k, ids } = by[t], j = await vals([`${t}!${k.id}:${k.id}`]), col = j.valueRanges[0].values || [], rows = [];
        for (let i = 1; i < col.length; i++) if (ids.indexOf(str((col[i] || [])[0])) >= 0) rows.push(i + 1);
        await deleteRows(t, rows);
      }
      return { ok: true };
    }
    if (action === 'addAccount' || action === 'editAccount') {
      const name = str(d.newName || d.name);
      const row = [name, d.type || 'Bank', Number(d.opening) || 0, d.limit || '', d.dueDay || '', d.cbMode || '', d.cbTo || '', d.active === false ? 'TRUE' : '', d.note || ''];
      if (action === 'addAccount') { if (await accountRow(name)) throw new Error('There is already an account called ' + name); await appendRow('Accounts', row); return { ok: true }; }
      const r = await accountRow(str(d.name)); if (!r) throw new Error('That account is no longer in your sheet');
      await put([{ range: `Accounts!A${r}:I${r}`, values: [row] }]);
      let renamed = 0;
      if (name !== str(d.name)) {   // carry a rename into every entry, rule and setting that names the account
        const reqs = [];
        for (const t of ['Expenses', 'Income', 'Transfers', 'Recurring', 'Settings', 'Accounts'])
          reqs.push({ findReplace: { find: str(d.name), replacement: name, matchEntireCell: true, matchCase: true, sheetId: await tabId(t) } });
        const res = await batch(reqs); (res.replies || []).forEach(x => { renamed += (x.findReplace && x.findReplace.occurrencesChanged) || 0; });
      }
      return { ok: true, renamed };
    }
    if (action === 'removeAccount') {
      const r = await accountRow(str(d.name)); if (!r) return { ok: true };
      const x = await readAll(), n = str(d.name), used = x.Expenses.some(o => str(o.Account) === n) || x.Income.some(o => str(o.Account) === n)
        || x.Transfers.some(o => str(o.From) === n || str(o.To) === n);
      if (used) { await put([{ range: `Accounts!H${r}`, values: [['TRUE']] }]); return { hidden: true }; }   // has history: hide it, keep the entries
      await deleteRows('Accounts', [r]); return { ok: true };
    }
    if (action === 'setBudget') {
      const j = await vals(['Budgets!A:ZZ']), rows = j.valueRanges[0].values || [[]], h = (rows[0] || []).map(str);
      let c = d.month ? h.indexOf(d.month) : 1; const reqs = [];
      if (c < 0) { c = Math.max(h.length, 2); reqs.push({ range: `Budgets!${colA(c)}1`, values: [[d.month]] }); }
      let r = rows.findIndex((x, i) => i > 0 && str((x || [])[0]) === d.category) + 1;
      if (r <= 0) { r = rows.length + 1; reqs.push({ range: `Budgets!A${r}`, values: [[d.category]] }); }
      reqs.push({ range: `Budgets!${colA(c)}${r}`, values: [[d.amount === '' || d.amount == null ? '' : Number(d.amount)]] });
      await put(reqs); return { ok: true };
    }
    if (action === 'setDefault') {
      const label = (SETTINGS.find(s => s[1] === d.key) || [d.key])[0];
      const j = await vals(['Settings!A:A']), col = j.valueRanges[0].values || [];
      let r = col.findIndex((x, i) => i > 0 && str((x || [])[0]) === label) + 1;
      if (r <= 0) r = col.length + 1;
      await put([{ range: `Settings!A${r}:B${r}`, values: [[label, d.value == null ? '' : d.value]] }]); return { ok: true };
    }
    m = /^(add|edit|delete|mark)Recurring$/.exec(action);
    if (m) {
      if (m[1] === 'delete') { await deleteRows('Recurring', [await findRow('Recurring', 'A', d.id)]); return { id: d.id }; }
      if (m[1] === 'mark') { const r = await findRow('Recurring', 'A', d.id), j = await vals([`Recurring!N${r}`]), cur = ymOf(((j.valueRanges[0].values || [[]])[0] || [])[0]);
        if (!cur || d.ym > cur) await put([{ range: `Recurring!N${r}`, values: [["'" + d.ym]] }]); return { id: d.id }; }
      const id = m[1] === 'add' ? newId() : d.id, kind = (d.kind || 'expense');
      const row = [id, d.name, kind[0].toUpperCase() + kind.slice(1), Number(d.amount), d.cat || '', d.sub || '', d.account || '', d.to || '', d.day,
        "'" + (d.start || ''), d.end ? "'" + d.end : '', d.auto ? 'TRUE' : 'FALSE', d.active === false ? 'FALSE' : 'TRUE'];
      if (m[1] === 'add') { await appendRow('Recurring', row.concat(['', d.note || ''])); return { id }; }
      const r = await findRow('Recurring', 'A', id); await put([{ range: `Recurring!A${r}:M${r}`, values: [row] }, { range: `Recurring!O${r}`, values: [[d.note || '']] }]);
      return { id };
    }
    throw new Error('Not available in this version yet');
  }
  const colA = i => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

  return {
    // the setup screen's button: sign in, find this user's sheet (or make it), remember it on this device
    async connect() {
      await getToken(true);
      const who = await g('https://openidconnect.googleapis.com/v1/userinfo').catch(() => ({}));
      cfg = { mode: 'google', email: who.email || '', sheetId: null };
      const f = await findSheet();
      cfg.sheetId = f ? f.id : await createSheet((who.given_name || who.name || '').trim());
      return cfg;
    },
    async get(params) {
      if (params.action === 'expenses') return { ok: true, data: toData(await readAll()) };
      if (params.action === 'ping') { await g(`${SHEETS}/${sid()}?fields=spreadsheetId`); return { ok: true }; }
      return { ok: true, data: {} };   // investments and other v1-off features
    },
    post,
    reconnect: () => getToken(true),
    signOut() { try { if (token && window.google) google.accounts.oauth2.revoke(token, () => {}); } catch (e) {} dropToken(); },
    sheetUrl: () => cfg && cfg.sheetId ? `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/edit` : '',
    _toData: toData, _table: table,   // for tests
  };
})();
