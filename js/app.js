// ============================================================
// APP.JS — Main controller: router, state, view rendering
// ============================================================

// ── State ────────────────────────────────────────────────────
const S = {
  view:  'dashboard',
  year:  new Date().getFullYear(),
  month: new Date().getMonth() + 1,  // 1-12
  balanceMode: 'monthly',

  // Dashboard monthly list filter
  dashFilter: { search: '', category: '' },

  // Import wizard
  imp: {
    step: 1,
    eurParsed:    null,  // { transactions, exchanges }
    usdParsed:    null,
    intesaTxs:    null,
    exchangeInfo: null,  // { rate, totalEur, totalUsd, pairs }
    merged:       [],    // all transactions to review
    page:         0,
    PAGE_SIZE:    40,
    manualRate:   null
  },

  // Transactions list
  txFilter: { search: '', category: '', source: '', year: '', page: 0, PAGE_SIZE: 50 }
};

const PAGE_TITLES = {
  dashboard:    'Dashboard',
  import:       'Importa Estratti Conto',
  transactions: 'Transazioni',
  analytics:    'Analytics',
  settings:     'Impostazioni'
};

// ── Helpers ───────────────────────────────────────────────────
const YM = () => `${S.year}-${String(S.month).padStart(2,'0')}`;

function fmt(v) {
  return new Intl.NumberFormat('it-IT', { style:'currency', currency:'EUR', maximumFractionDigits:2 }).format(v);
}
function fmtCompact(v) {
  return new Intl.NumberFormat('it-IT', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(v);
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('it-IT', { day:'2-digit', month:'short', year:'numeric' });
}
function monthLabel(year, month) {
  return new Date(year, month - 1).toLocaleDateString('it-IT', { month:'long', year:'numeric' });
}
function el(id)  { return document.getElementById(id); }
function qs(sel) { return document.querySelector(sel); }
function set(id, html) { const e = el(id); if (e) e.innerHTML = html; }
function setText(id, t) { const e = el(id); if (e) e.textContent = t; }

function showToast(msg, type = 'info') {
  const c = el('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
}

function showSpinner(id, on = true) {
  const e = el(id);
  if (!e) return;
  if (on) e.classList.add('loading'); else e.classList.remove('loading');
}

// ── Screens ───────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  el(`screen-${name}`).classList.remove('hidden');
}

// ── Navigation ────────────────────────────────────────────────
function navigate(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const target = el(`view-${view}`);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.view === view);
  });

  S.view = view;
  setText('page-title', PAGE_TITLES[view] || view);
  updateMonthSelector();

  switch (view) {
    case 'dashboard':    renderDashboard();    break;
    case 'import':       renderImport();       break;
    case 'transactions': renderTransactions(); break;
    case 'analytics':    renderAnalytics();    break;
    case 'settings':     renderSettings();     break;
  }
  refreshIcons();
}

// ── Month selector ────────────────────────────────────────────
function updateMonthSelector() {
  setText('month-label', monthLabel(S.year, S.month));
  // show month selector only for dashboard/transactions
  const showMonth = ['dashboard','transactions'].includes(S.view);
  el('month-nav').style.display = showMonth ? 'flex' : 'none';
}

function prevMonth() {
  if (S.month === 1) { S.month = 12; S.year--; } else S.month--;
  updateMonthSelector();
  if (['dashboard','transactions'].includes(S.view)) navigate(S.view);
}
function nextMonth() {
  if (S.month === 12) { S.month = 1; S.year++; } else S.month++;
  updateMonthSelector();
  if (['dashboard','transactions'].includes(S.view)) navigate(S.view);
}

// ── DASHBOARD ─────────────────────────────────────────────────
function renderDashboard() {
  const ym     = YM();
  const txs    = Data.getTransactions({ month: ym });
  const exp    = txs.filter(t => t.amountEUR < 0);
  const inc    = txs.filter(t => t.amountEUR > 0);

  const totalExp = exp.reduce((s,t) => s + Math.abs(t.amountEUR), 0);
  const totalInc = inc.reduce((s,t) => s + t.amountEUR, 0);
  const budgets  = Data.getAllBudgets(ym);
  const totalBud = Object.values(budgets).reduce((s,v) => s+v, 0);
  const remaining = totalBud - totalExp;
  const catTotals = Data.getCategoryTotals(ym);
  const overBudget = Object.keys(catTotals).filter(c =>
    (catTotals[c]||0) > (budgets[c]||0) && (budgets[c]||0) > 0
  ).length;

  // KPIs
  setText('kpi-expenses', fmtCompact(totalExp));
  setText('kpi-income', fmtCompact(totalInc));
  setText('kpi-remaining', fmtCompact(remaining));
  setText('kpi-overbudget', overBudget);
  el('kpi-remaining').className = `kpi-value ${remaining >= 0 ? 'positive' : 'negative'}`;

  // Progress bar
  const pct = totalBud > 0 ? Math.min((totalExp / totalBud) * 100, 100) : 0;
  el('budget-bar-fill').style.width = pct + '%';
  el('budget-bar-fill').className = `bar-fill ${pct > 100 ? 'danger' : pct > 80 ? 'warning' : 'ok'}`;
  setText('budget-bar-label', `${pct.toFixed(0)}% del budget mensile`);

  // Charts
  if (Object.keys(catTotals).length > 0) {
    Charts.donut('chart-donut', catTotals);
  } else {
    set('chart-donut-wrap', '<div class="empty-chart">Nessun dato per questo mese</div>');
  }
  Charts.budgetBar('chart-budget', budgets, catTotals, Data.getCategories());

  // Populate Dashboard category filter dropdown
  const cats = Data.getCategories();
  const catSel = el('dash-tx-cat');
  if (catSel) {
    const curVal = S.dashFilter.category;
    catSel.innerHTML = `<option value="">Tutte le categorie</option>` +
      cats.map(c => `<option value="${c}" ${curVal === c ? 'selected' : ''}>${c}</option>`).join('');
  }

  // Filter monthly transactions for Dashboard table
  let dashTxs = [...txs];
  if (S.dashFilter.search) {
    const s = S.dashFilter.search.toLowerCase();
    dashTxs = dashTxs.filter(t => t.description.toLowerCase().includes(s) || (t.notes && t.notes.toLowerCase().includes(s)));
  }
  if (S.dashFilter.category) {
    dashTxs = dashTxs.filter(t => t.category === S.dashFilter.category);
  }

  setText('dash-tx-count', `(${dashTxs.length} di ${txs.length})`);
  renderRecentTxTable(dashTxs);
  refreshIcons();
}

function renderTxRow(t, cats) {
  const amtClass = t.amountEUR < 0 ? 'negative' : 'positive';
  const srcIcon  = sourceIcon(t.source);
  const hasNote  = !!(t.notes && t.notes.trim());
  const noteSnippet = hasNote
    ? `<div class="note-text" onclick="openNoteModal('${t.id}')" title="${escHtml(t.notes)}"><i data-lucide="file-text" class="lucide-icon icon-sm"></i> ${escHtml(t.notes.substring(0, 45))}</div>`
    : '';

  return `<tr>
    <td class="mono small">${fmtDate(t.date)}</td>
    <td class="desc-cell" title="${escHtml(t.description)}">
      <div>${escHtml(t.description.substring(0, 55))}</div>
      ${noteSnippet}
    </td>
    <td>
      <select class="cat-select small" onchange="updateTxCategory('${t.id}', this.value)">
        ${cats.map(c => `<option value="${c}" ${t.category === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
    </td>
    <td class="${amtClass} mono">${fmt(t.amountEUR)}</td>
    <td class="source-cell">${srcIcon}</td>
    <td style="white-space:nowrap">
      <button class="note-btn ${hasNote ? 'has-note' : ''}" onclick="openNoteModal('${t.id}')" title="${hasNote ? 'Modifica nota' : 'Aggiungi nota'}"><i data-lucide="file-text" class="lucide-icon icon-sm"></i></button>
      <button class="btn-icon danger" onclick="deleteTx('${t.id}')" title="Elimina"><i data-lucide="trash-2" class="lucide-icon icon-sm"></i></button>
    </td>
  </tr>`;
}

function renderRecentTxTable(txs) {
  if (!txs.length) {
    set('recent-tx-body', '<tr><td colspan="6" class="empty-row">Nessuna transazione trovata per questo mese</td></tr>');
    return;
  }
  const cats = Data.getCategories();
  set('recent-tx-body', txs.map(t => renderTxRow(t, cats)).join(''));
}

// ── IMPORT WIZARD ─────────────────────────────────────────────
function renderImport() {
  // Reset to step 1 if coming fresh
  resetImportIfNeeded();
  showImportStep(S.imp.step);
}

function resetImportIfNeeded() {
  if (S.imp.step === 1) resetImport();
}

function resetImport() {
  S.imp = {
    step: 1, eurParsed: null, usdParsed: null, intesaTxs: null,
    exchangeInfo: null, merged: [], page: 0, PAGE_SIZE: 40, manualRate: null
  };
}

function showImportStep(step) {
  S.imp.step = step;
  document.querySelectorAll('.imp-step').forEach(s => s.classList.add('hidden'));
  el(`imp-step-${step}`)?.classList.remove('hidden');

  // Step indicators
  document.querySelectorAll('.step-indicator .step').forEach((s, i) => {
    s.classList.toggle('active',   i + 1 === step);
    s.classList.toggle('done',     i + 1 < step);
  });

  if (step === 2) buildImportReviewTable();
  if (step === 3) buildImportSummary();
}

function setupDropzone(id, handler) {
  const zone = el(id);
  if (!zone) return;
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handler(file, zone);
  });
  zone.addEventListener('click', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = id.includes('intesa') ? '.xlsx,.xls' : '.csv';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = () => {
      if (inp.files && inp.files[0]) {
        handler(inp.files[0], zone);
      }
      document.body.removeChild(inp);
    };
    inp.click();
  });
}

function markDropzone(zone, filename) {
  zone.classList.add('loaded');
  zone.querySelector('.dz-label').textContent = filename;
  zone.querySelector('.dz-icon').innerHTML = '<i data-lucide="check-circle" class="lucide-icon lucide-lg" style="color:var(--success)"></i>';
  refreshIcons();
}

function handleRevolutEUR(file, zone) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      S.imp.eurParsed = Import.parseRevolutCSV(e.target.result, 'EUR');
      if (!S.imp.eurParsed || !S.imp.eurParsed.transactions.length) {
        showToast('Nessuna transazione valida trovata in ' + file.name, 'warning');
        return;
      }
      markDropzone(zone, file.name);
      showToast(`Revolut EUR: ${S.imp.eurParsed.transactions.length} righe caricate`, 'success');
    } catch (err) { showToast('Errore nel file Revolut EUR: ' + err.message, 'error'); }
  };
  reader.readAsText(file);
}

function handleRevolutUSD(file, zone) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      S.imp.usdParsed = Import.parseRevolutCSV(e.target.result, 'USD');
      if (!S.imp.usdParsed || !S.imp.usdParsed.transactions.length) {
        showToast('Nessuna transazione valida trovata in ' + file.name, 'warning');
        return;
      }
      markDropzone(zone, file.name);
      showToast(`Revolut USD: ${S.imp.usdParsed.transactions.length} righe caricate`, 'success');
    } catch (err) { showToast('Errore nel file Revolut USD: ' + err.message, 'error'); }
  };
  reader.readAsText(file);
}

function handleIntesa(file, zone) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      S.imp.intesaTxs = Import.parseIntesaXLSX(e.target.result);
      if (!S.imp.intesaTxs || !S.imp.intesaTxs.length) {
        showToast('Nessuna transazione valida trovata in ' + file.name, 'warning');
        return;
      }
      markDropzone(zone, file.name);
      showToast(`Intesa: ${S.imp.intesaTxs.length} righe caricate`, 'success');
    } catch (err) { showToast('Errore nel file Intesa: ' + err.message, 'error'); }
  };
  reader.readAsArrayBuffer(file);
}

function processImportFiles() {
  let merged = [];
  let exchangeInfo = null;

  // If both EUR and USD Revolut → calculate exchange rates
  if (S.imp.eurParsed && S.imp.usdParsed) {
    exchangeInfo = Import.matchExchanges(
      S.imp.eurParsed.exchanges,
      S.imp.usdParsed.exchanges
    );
    S.imp.exchangeInfo = exchangeInfo;
  }

  // Determine effective rate
  let rate = exchangeInfo?.rate || Data.getWeightedAverageRate() || S.imp.manualRate;

  // Revolut EUR transactions (exclude exchange rows)
  if (S.imp.eurParsed) {
    const txs = S.imp.eurParsed.transactions.filter(t => t.category !== '__exchange__');
    merged.push(...txs);
  }

  // Revolut USD transactions (exclude exchange rows)
  if (S.imp.usdParsed) {
    let txs = S.imp.usdParsed.transactions.filter(t => t.category !== '__exchange__');
    if (rate) {
      txs = Import.applyEURConversion(txs, rate);
    }
    merged.push(...txs);
  }

  // Intesa
  if (S.imp.intesaTxs) merged.push(...S.imp.intesaTxs);

  // Sort by date
  merged.sort((a, b) => new Date(b.date) - new Date(a.date));
  S.imp.merged = merged;

  if (!rate && merged.some(t => t.currency === 'USD')) {
    // No rate available — ask for manual rate
    const row = el('manual-rate-row');
    if (row) row.classList.remove('hidden');
    showToast('Nessun tasso USD/EUR trovato: inseriscilo manualmente', 'warning');
  }

  return merged;
}

function buildImportReviewTable() {
  const merged = S.imp.merged.length ? S.imp.merged : processImportFiles();
  if (!merged.length) {
    set('imp-table-body', '<tr><td colspan="7" class="empty-row">Nessun file caricato o nessuna transazione trovata. Torna allo step 1.</td></tr>');
    return;
  }

  // Exchange rate info banner
  let rateBanner = '';
  if (S.imp.exchangeInfo) {
    const { rate, totalEur, totalUsd, pairs } = S.imp.exchangeInfo;
    rateBanner = `<div class="info-banner">
      <span class="info-icon"><i data-lucide="arrow-left-right" class="lucide-icon"></i></span>
      <div>Tasso medio ponderato calcolato: <strong>1 EUR = ${rate.toFixed(4)} USD</strong>
      &nbsp;·&nbsp; ${pairs.length} exchange(s) &nbsp;·&nbsp; ${fmt(totalEur)} → $${totalUsd.toFixed(2)}</div>
    </div>`;
  }

  const noEur = merged.filter(t => t.amountEUR === null);
  const noEurBanner = noEur.length
    ? `<div class="warn-banner"><i data-lucide="alert-triangle" class="lucide-icon icon-sm" style="margin-right:0.4rem"></i> ${noEur.length} transazioni USD senza conversione EUR. Inserisci il tasso manualmente.</div>`
    : '';

  const cats = Data.getCategories();
  const catOptions = cats.map(c => `<option value="${c}">${c}</option>`).join('');

  // Populate bulk category select
  const bulkSel = el('bulk-cat-select');
  if (bulkSel) {
    bulkSel.innerHTML = `<option value="">Assegna categoria ai selezionati…</option>${catOptions}`;
  }

  const total = merged.length;
  const pages = Math.ceil(total / S.imp.PAGE_SIZE);
  const page  = S.imp.page;
  const slice = merged.slice(page * S.imp.PAGE_SIZE, (page + 1) * S.imp.PAGE_SIZE);

  set('import-exchange-info', rateBanner + noEurBanner);

  const rows = slice.map((t, localIdx) => {
    const globalIdx = page * S.imp.PAGE_SIZE + localIdx;
    const amtClass  = t.amountEUR === null ? 'no-eur' : (t.amountEUR < 0 ? 'negative' : 'positive');
    const eurCell   = t.amountEUR !== null ? fmt(t.amountEUR) : '—';
    const fmtAmt    = `${t.amount < 0 ? '' : '+'}${t.amount.toFixed(2)} ${t.currency}`;
    return `<tr>
      <td><input type="checkbox" class="imp-cb" data-idx="${globalIdx}"></td>
      <td class="mono small">${t.date}</td>
      <td class="desc-cell" title="${escHtml(t.description)}">${escHtml(t.description.substring(0,55))}</td>
      <td class="mono small">${fmtAmt}</td>
      <td class="${amtClass} mono small">${eurCell}</td>
      <td class="source-cell small">${sourceIcon(t.source)}</td>
      <td>
        <select class="cat-select" data-idx="${globalIdx}" onchange="updateImpCategory(${globalIdx}, this.value)">
          <option value="">— Categoria —</option>
          ${cats.map(c => `<option value="${c}" ${t.category === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </td>
    </tr>`;
  }).join('');

  set('imp-table-body', rows);
  set('imp-pagination', paginationHtml(page, pages, 'impPage'));
  setText('imp-count-label', `${total} transazioni`);

  // Bulk category options
  set('bulk-cat-options', catOptions);
  refreshIcons();
}

function updateImpCategory(idx, cat) {
  if (S.imp.merged[idx]) S.imp.merged[idx].category = cat;
}

function applyBulkCategory() {
  const cat = el('bulk-cat-select').value;
  if (!cat) { showToast('Seleziona una categoria', 'warning'); return; }
  document.querySelectorAll('.imp-cb:checked').forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    if (S.imp.merged[idx]) S.imp.merged[idx].category = cat;
  });
  buildImportReviewTable();
  showToast('Categoria applicata', 'success');
}

function impPage(p) { S.imp.page = p; buildImportReviewTable(); }

function applyManualRate() {
  const v = parseFloat(el('manual-rate-input').value);
  if (!v || v <= 0) { showToast('Inserisci un tasso valido (es. 1.09)', 'warning'); return; }
  S.imp.manualRate = v;
  S.imp.merged = Import.applyEURConversion(S.imp.merged, v);
  el('manual-rate-row').classList.add('hidden');
  buildImportReviewTable();
  showToast(`Tasso ${v} USD/EUR applicato`, 'success');
}

function buildImportSummary() {
  const valid = S.imp.merged.filter(t => t.amountEUR !== null);
  const expenses = valid.filter(t => t.amountEUR < 0);
  const income   = valid.filter(t => t.amountEUR >= 0);
  const totalExp = expenses.reduce((s,t) => s + Math.abs(t.amountEUR), 0);
  const totalInc = income.reduce((s,t) => s + t.amountEUR, 0);

  // Category breakdown
  const catMap = {};
  expenses.forEach(t => { catMap[t.category] = (catMap[t.category]||0) + Math.abs(t.amountEUR); });
  const catRows = Object.entries(catMap).sort((a,b)=>b[1]-a[1])
    .map(([c,v]) => `<tr><td>${c}</td><td class="mono">${fmt(v)}</td></tr>`).join('');

  set('imp-summary-body', `
    <div class="summary-grid">
      <div class="summary-card"><span class="summary-label">Transazioni</span><span class="summary-val">${valid.length}</span></div>
      <div class="summary-card negative"><span class="summary-label">Uscite</span><span class="summary-val">${fmtCompact(totalExp)}</span></div>
      <div class="summary-card positive"><span class="summary-label">Entrate</span><span class="summary-val">${fmtCompact(totalInc)}</span></div>
      ${S.imp.exchangeInfo ? `<div class="summary-card"><span class="summary-label">Tasso EUR/USD</span><span class="summary-val">${S.imp.exchangeInfo.rate.toFixed(4)}</span></div>` : ''}
    </div>
    <h4 style="margin: 1.5rem 0 0.75rem">Per categoria</h4>
    <table class="summary-table"><tbody>${catRows}</tbody></table>
  `);
}

async function confirmImport() {
  const toSave = S.imp.merged.filter(t => t.amountEUR !== null && t.category !== '__exchange__');
  if (!toSave.length) { showToast('Nessuna transazione valida da importare', 'warning'); return; }

  const added = Data.addTransactions(toSave);

  // Save exchange rates
  if (S.imp.exchangeInfo?.pairs?.length) {
    Data.addExchangeRates(S.imp.exchangeInfo.pairs);
  }

  showToast(`${added} transazioni importate con successo!`, 'success');
  resetImport();

  // Sync to GitHub if configured
  if (GitHub.isConfigured()) {
    try {
      await GitHub.push(Data.get());
      showToast('Dati sincronizzati su GitHub', 'success');
    } catch (e) { showToast('Sincronizzazione GitHub fallita: ' + e.message, 'error'); }
  }

  navigate('dashboard');
}

// ── TRANSACTIONS ──────────────────────────────────────────────
function renderTransactions() {
  const ym    = YM();
  const f     = S.txFilter;
  const txs   = Data.getTransactions({
    month:    f.year ? undefined : ym,
    year:     f.year || undefined,
    category: f.category || undefined,
    source:   f.source   || undefined,
    search:   f.search   || undefined,
  });

  const total = txs.length;
  const pages = Math.ceil(total / f.PAGE_SIZE);
  const slice = txs.slice(f.page * f.PAGE_SIZE, (f.page + 1) * f.PAGE_SIZE);
  const cats  = Data.getCategories();

  // Category filter options
  const catOpts = ['','Affitto & Casa','Spesa Alimentare','Ristoranti & Bar','Trasporti & Mobilità',
    'Viaggi & Vacanze','Abbigliamento & Shopping','Salute & Farmacia','Sport & Fitness',
    'Streaming & Abbonamenti','Utenze & Domiciliazioni','Imposte & Tasse','Commissioni Bancarie',
    'Intrattenimento','Trasferimenti','Entrate','Altro']
    .map(c => `<option value="${c}" ${f.category===c?'selected':''}>${c||'Tutte le categorie'}</option>`).join('');

  el('tx-filter-category').innerHTML = catOpts;

  const rows = slice.map(t => renderTxRow(t, cats)).join('') || '<tr><td colspan="6" class="empty-row">Nessuna transazione trovata</td></tr>';

  set('tx-table-body', rows);
  set('tx-pagination', paginationHtml(f.page, pages, 'txPage'));
  setText('tx-count', `${total} transazioni`);
}

function updateTxCategory(id, cat) {
  Data.updateTransaction(id, { category: cat });
  if (S.view === 'dashboard') renderDashboard();
  else if (S.view === 'transactions') renderTransactions();
}

function deleteTx(id) {
  if (!confirm('Eliminare questa transazione?')) return;
  Data.deleteTransaction(id);
  if (S.view === 'dashboard') renderDashboard();
  else if (S.view === 'transactions') renderTransactions();
  showToast('Transazione eliminata', 'info');
}

// ── SINGLE EXPENSE MODAL ──────────────────────────────────────
function openAddExpenseModal() {
  const cats = Data.getCategories();
  set('exp-category', cats.map(c => `<option value="${c}">${c}</option>`).join(''));

  // Default date: today if current month, else 1st of selected month
  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let defaultDate = '';
  if (currentYM === YM()) {
    defaultDate = now.toISOString().split('T')[0];
  } else {
    defaultDate = `${S.year}-${String(S.month).padStart(2, '0')}-01`;
  }

  el('exp-date').value = defaultDate;
  el('exp-type').value = 'Expense';
  el('exp-desc').value = '';
  el('exp-amount').value = '';
  el('exp-currency').value = 'EUR';
  el('exp-source').value = 'revolut_eur';
  el('exp-notes').value = '';

  el('modal-add-expense').classList.remove('hidden');
  el('exp-desc').focus();
}

function closeAddExpenseModal() {
  el('modal-add-expense').classList.add('hidden');
}

async function handleSaveSingleExpense(e) {
  e.preventDefault();

  const dateStr  = el('exp-date').value;
  const type     = el('exp-type').value;
  const desc     = el('exp-desc').value.trim();
  const rawAmt   = parseFloat(el('exp-amount').value);
  const currency = el('exp-currency').value;
  const category = el('exp-category').value;
  const source   = el('exp-source').value;
  const notes    = el('exp-notes').value.trim();

  if (!dateStr || !desc || isNaN(rawAmt) || rawAmt <= 0) {
    showToast('Compila tutti i campi obbligatori', 'warning');
    return;
  }

  // Calculate EUR amount
  let rate = 1;
  if (currency === 'USD') {
    rate = Data.getWeightedAverageRate() || S.imp.manualRate || 1.16;
  }
  const amtEUR = currency === 'EUR' ? rawAmt : parseFloat((rawAmt / rate).toFixed(2));
  const finalAmtEUR = type === 'Income' ? Math.abs(amtEUR) : -Math.abs(amtEUR);
  const finalAmt    = type === 'Income' ? Math.abs(rawAmt) : -Math.abs(rawAmt);

  const year  = parseInt(dateStr.substring(0, 4));
  const month = dateStr.substring(0, 7);

  const newTx = {
    id: 'tx_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
    date: dateStr,
    month,
    year,
    description: desc,
    amount: finalAmt,
    currency,
    amountEUR: finalAmtEUR,
    category,
    source,
    type,
    balance: 0,
    importedAt: new Date().toISOString(),
    notes
  };

  Data.addTransactions([newTx]);
  closeAddExpenseModal();
  showToast('Spesa aggiunta con successo!', 'success');

  // Update view month if adding expense for a different month
  S.year = year;
  S.month = parseInt(dateStr.substring(5, 7));

  navigate(S.view);

  if (GitHub.isConfigured()) {
    try {
      await GitHub.push(Data.get());
      showToast('Sincronizzato su GitHub', 'success');
    } catch (err) {
      showToast('Sync GitHub fallito: ' + err.message, 'error');
    }
  }
}

// ── NOTE MODAL ────────────────────────────────────────────────
function openNoteModal(id) {
  const txs = Data.getTransactions({});
  const t = txs.find(item => item.id === id);
  if (!t) return;

  el('note-tx-id').value = id;
  setText('note-tx-info', `${fmtDate(t.date)} — ${t.description} (${fmt(t.amountEUR)})`);
  el('note-text').value = t.notes || '';
  el('modal-edit-note').classList.remove('hidden');
  el('note-text').focus();
}

function closeNoteModal() {
  el('modal-edit-note').classList.add('hidden');
}

async function handleSaveNote(e) {
  e.preventDefault();
  const id    = el('note-tx-id').value;
  const notes = el('note-text').value.trim();

  Data.updateTransaction(id, { notes });
  closeNoteModal();
  showToast('Nota salvata!', 'success');
  navigate(S.view);

  if (GitHub.isConfigured()) {
    try {
      await GitHub.push(Data.get());
    } catch (err) {
      console.warn('Sync failed:', err);
    }
  }
}

function txPage(p) { S.txFilter.page = p; renderTransactions(); }

function filterTransactions() {
  S.txFilter.search   = el('tx-search').value;
  S.txFilter.category = el('tx-filter-category').value;
  S.txFilter.source   = el('tx-filter-source').value;
  S.txFilter.year     = el('tx-filter-year').value;
  S.txFilter.page     = 0;
  renderTransactions();
}

// ── ANALYTICS ─────────────────────────────────────────────────
function renderAnalytics() {
  const years = Data.getAvailableYears();
  const selYear = parseInt(el('analytics-year')?.value || years[0] || new Date().getFullYear());

  // Year selector
  set('analytics-year-wrap', `
    <select id="analytics-year" class="select-styled" onchange="renderAnalytics()">
      ${years.map(y => `<option value="${y}" ${y===selYear?'selected':''}>${y}</option>`).join('')}
    </select>
  `);

  const allTxs   = Data.getTransactions({});
  const yearTxs  = Data.getTransactions({ year: selYear }).filter(t => t.category !== '__exchange__');
  const monthly  = Data.getMonthlyTotals(selYear);

  // Annual KPIs
  const yearExp  = yearTxs.filter(t => t.amountEUR < 0).reduce((s,t) => s+Math.abs(t.amountEUR),0);
  const yearInc  = yearTxs.filter(t => t.amountEUR > 0).reduce((s,t) => s+t.amountEUR,0);
  const yearNet  = yearInc - yearExp;
  setText('an-total-exp',  fmtCompact(yearExp));
  setText('an-total-inc',  fmtCompact(yearInc));
  setText('an-total-net',  fmtCompact(yearNet));
  el('an-total-net').className = `kpi-value ${yearNet >= 0 ? 'positive' : 'negative'}`;

  // Charts
  Charts.monthlyTrend('chart-trend', selYear, monthly);
  Charts.annualStacked('chart-annual', selYear, yearTxs);

  // Year comparison
  if (years.length > 1) {
    const yearsData = {};
    years.forEach(y => { yearsData[y] = Data.getMonthlyTotals(y); });
    Charts.yearComparison('chart-year-compare', yearsData);
    el('year-compare-section').classList.remove('hidden');
  } else {
    el('year-compare-section')?.classList.add('hidden');
  }

  // Balance chart
  const settings = Data.getSettings();
  const bMode = S.balanceMode || 'monthly';
  el('balance-mode-monthly')?.classList.toggle('btn-primary', bMode === 'monthly');
  el('balance-mode-monthly')?.classList.toggle('btn-secondary', bMode !== 'monthly');
  el('balance-mode-daily')?.classList.toggle('btn-primary', bMode === 'daily');
  el('balance-mode-daily')?.classList.toggle('btn-secondary', bMode !== 'daily');
  Charts.balanceLine('chart-balance', allTxs, settings.initialBalance || 0, bMode);

  // Annual category table
  const annualCats = Data.getAnnualCategoryTotals(selYear);
  const budgets    = Data.getAllBudgets(`${selYear}-01`); // use Jan budget as reference
  const rows = Object.entries(annualCats).sort((a,b)=>b[1]-a[1]).map(([c,v]) => {
    const monthlyBud = budgets[c] || 0;
    const annualBud  = monthlyBud * 12;
    const pct        = annualBud > 0 ? ((v / annualBud) * 100).toFixed(0) : '—';
    const cls        = annualBud > 0 && v > annualBud ? 'negative' : '';
    return `<tr><td>${c}</td><td class="mono">${fmtCompact(v)}</td>
      <td class="mono">${annualBud > 0 ? fmtCompact(annualBud) : '—'}</td>
      <td class="${cls}">${pct}%</td></tr>`;
  }).join('');
  set('an-cat-table-body', rows || '<tr><td colspan="4" class="empty-row">Nessun dato</td></tr>');
}

function setBalanceMode(mode) {
  S.balanceMode = mode;
  el('balance-mode-monthly')?.classList.toggle('btn-primary', mode === 'monthly');
  el('balance-mode-monthly')?.classList.toggle('btn-secondary', mode !== 'monthly');
  el('balance-mode-daily')?.classList.toggle('btn-primary', mode === 'daily');
  el('balance-mode-daily')?.classList.toggle('btn-secondary', mode !== 'daily');

  const allTxs = Data.getTransactions({});
  const settings = Data.getSettings();
  Charts.balanceLine('chart-balance', allTxs, settings.initialBalance || 0, mode);
}

// ── SETTINGS ──────────────────────────────────────────────────
function renderSettings() {
  const cats    = Data.getCategories();
  const budgets = Data.getAllBudgets(`${new Date().getFullYear()}-01`);
  const ghCfg   = GitHub.getConfig();
  const settings = Data.getSettings();

  // Budget table
  const budgetRows = cats.map(c => `
    <tr>
      <td>${c}</td>
      <td><input type="number" class="input-sm" id="bud-${c.replace(/\s/g,'_')}"
        value="${budgets[c] || 0}" min="0" step="10"></td>
    </tr>`).join('');
  set('budget-table-body', budgetRows);

  // Categories list
  const catList = cats.map(c => `
    <div class="cat-item">
      <span>${c}</span>
      <button class="btn-icon danger small" onclick="deleteCategory('${c}')">×</button>
    </div>`).join('');
  set('categories-list', catList);

  // GitHub config
  el('gh-owner').value  = ghCfg.owner  || '';
  el('gh-repo').value   = ghCfg.repo   || '';
  el('gh-branch').value = ghCfg.branch || 'main';
  el('gh-path').value   = ghCfg.path   || 'data.json';
  el('gh-pat').value    = ghCfg.pat    || '';

  // Account settings
  el('initial-balance').value = settings.initialBalance || 0;
}

async function saveBudgets() {
  const cats = Data.getCategories();
  const map  = {};
  cats.forEach(c => {
    const inp = el(`bud-${c.replace(/\s/g,'_')}`);
    if (inp) map[c] = parseFloat(inp.value) || 0;
  });
  Data.setDefaultBudgets(map);
  showToast('Budget salvati!', 'success');
  if (GitHub.isConfigured()) {
    try { await GitHub.push(Data.get()); showToast('Sync GitHub completato','success'); }
    catch(e) { showToast('Sync GitHub fallito: '+e.message,'error'); }
  }
}

function addCategory() {
  const name = el('new-cat-input').value.trim();
  if (!name) { showToast('Inserisci un nome valido','warning'); return; }
  Data.addCategory(name);
  el('new-cat-input').value = '';
  renderSettings();
  showToast(`Categoria "${name}" aggiunta`,'success');
}

function deleteCategory(name) {
  if (!confirm(`Eliminare la categoria "${name}"? Le transazioni associate manterranno il vecchio valore.`)) return;
  Data.deleteCategory(name);
  renderSettings();
}

function saveGitHubConfig() {
  GitHub.setConfig({
    pat:    el('gh-pat').value.trim(),
    owner:  el('gh-owner').value.trim(),
    repo:   el('gh-repo').value.trim(),
    branch: el('gh-branch').value.trim() || 'main',
    path:   el('gh-path').value.trim()   || 'data.json',
  });
  showToast('Configurazione GitHub salvata','success');
}

async function testGitHub() {
  const btn = el('gh-test-btn');
  btn.disabled = true; btn.textContent = 'Test...';
  try {
    saveGitHubConfig();
    const info = await GitHub.testConnection();
    showToast(`Connesso a ${info.name} (${info.isPrivate ? 'privata':'pubblica'})`, 'success');
  } catch(e) {
    showToast('Errore: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Testa connessione';
  }
}

async function syncPull() {
  if (!GitHub.isConfigured()) { showToast('GitHub non configurato', 'warning'); return; }
  const btn = el('sync-pull-btn');
  btn.disabled = true;
  try {
    const result = await GitHub.pull();
    if (result) {
      Data.setData(result.data);
      showToast('Dati aggiornati da GitHub', 'success');
      navigate(S.view);
    } else {
      showToast('File data.json non trovato su GitHub', 'warning');
    }
  } catch(e) { showToast('Pull fallito: ' + e.message, 'error'); }
  finally { btn.disabled = false; }
}

async function syncPush() {
  if (!GitHub.isConfigured()) { showToast('Configura GitHub prima', 'warning'); return; }
  const btn = el('sync-push-btn');
  btn.disabled = true;
  try {
    await GitHub.push(Data.get());
    showToast('Dati inviati a GitHub', 'success');
  } catch(e) { showToast('Push fallito: ' + e.message, 'error'); }
  finally { btn.disabled = false; }
}

async function headerSync() {
  if (!GitHub.isConfigured()) { showToast('GitHub non configurato — configura in Impostazioni', 'warning'); return; }
  const btn = el('header-sync-btn');
  btn.classList.add('spinning');
  try {
    await GitHub.push(Data.get());
    showToast('Sync completato', 'success');
  } catch(e) { showToast('Sync fallito: ' + e.message, 'error'); }
  finally { btn.classList.remove('spinning'); }
}

function saveAccountSettings() {
  const bal = parseFloat(el('initial-balance').value) || 0;
  Data.updateSettings({ initialBalance: bal });
  showToast('Impostazioni salvate', 'success');
}

function exportData() {
  const json = Data.exportJSON();
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'financial-data.json'; a.click();
  URL.revokeObjectURL(url);
}

function importDataFile() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = e => {
      try {
        Data.importJSON(e.target.result);
        showToast('Dati importati con successo!', 'success');
        navigate(S.view);
      } catch(err) { showToast('File non valido: ' + err.message, 'error'); }
    };
    r.readAsText(f);
  };
  inp.click();
}

function clearAllData() {
  if (!confirm('Eliminare TUTTI i dati? Questa azione non è reversibile.')) return;
  Data.clearAll();
  showToast('Tutti i dati eliminati', 'info');
  navigate('dashboard');
}

// ── Password ──────────────────────────────────────────────────
async function changePassword() {
  const curr = el('curr-password').value;
  const nw   = el('new-password').value;
  const conf = el('conf-password').value;
  if (!curr || !nw || !conf) { showToast('Compila tutti i campi', 'warning'); return; }
  if (nw !== conf) { showToast('Le password non corrispondono', 'warning'); return; }
  const ok = await Auth.checkPassword(curr);
  if (!ok) { showToast('Password attuale errata', 'error'); return; }
  await Auth.setPassword(nw);
  el('curr-password').value = el('new-password').value = el('conf-password').value = '';
  showToast('Password aggiornata', 'success');
}

// ── LOGIN & SETUP ─────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const pw   = el('login-pw').value;
  const btn  = el('login-btn');
  btn.disabled = true;
  const ok = await Auth.checkPassword(pw);
  if (ok) {
    Auth.login();
    showScreen('app');
    navigate('dashboard');
  } else {
    showToast('Password errata', 'error');
    el('login-pw').value = '';
    el('login-pw').classList.add('shake');
    setTimeout(() => el('login-pw').classList.remove('shake'), 500);
  }
  btn.disabled = false;
}

async function handleSetup(e) {
  e.preventDefault();
  const pw   = el('setup-pw').value;
  const conf = el('setup-confirm').value;
  if (!pw) { showToast('Inserisci una password', 'warning'); return; }
  if (pw !== conf) { showToast('Le password non corrispondono', 'warning'); return; }
  if (pw.length < 6) { showToast('Password troppo corta (min 6 caratteri)', 'warning'); return; }
  await Auth.setPassword(pw);
  Auth.login();
  showScreen('app');
  navigate('dashboard');
  showToast('Benvenuto! Importa i tuoi estratti conto per iniziare.', 'success');
}

function logout() {
  Auth.logout();
  showScreen('login');
  el('login-pw').value = '';
}

// ── Pagination ────────────────────────────────────────────────
function paginationHtml(current, total, fnName) {
  if (total <= 1) return '';
  const btns = [];
  for (let i = 0; i < total; i++) {
    btns.push(`<button class="page-btn${i===current?' active':''}" onclick="${fnName}(${i})">${i+1}</button>`);
  }
  return `<div class="pagination">${btns.join('')}</div>`;
}

// ── Utilities ─────────────────────────────────────────────────
function sourceIcon(source) {
  switch (source) {
    case 'revolut_eur': return '<span class="src-badge rev" title="Revolut EUR">R€</span>';
    case 'revolut_usd': return '<span class="src-badge rev-usd" title="Revolut USD">R$</span>';
    case 'intesa':      return '<span class="src-badge intesa" title="Intesa San Paolo">IS</span>';
    default:            return '<span class="src-badge other">—</span>';
  }
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Sidebar toggle ────────────────────────────────────────────
function toggleSidebar() {
  el('sidebar').classList.toggle('collapsed');
  el('main-content').classList.toggle('sidebar-collapsed');
}

// ── Theme toggle ──────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('fc-theme');
  const theme = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('fc-theme', theme);
  updateThemeButton(theme);
  // Update Chart.js colors on theme change
  if (typeof Chart !== 'undefined') {
    Chart.defaults.color = theme === 'light' ? '#636366' : '#8e8e93';
    Chart.defaults.borderColor = theme === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)';
  }
}

function updateThemeButton(theme) {
  const lightIcon = el('theme-icon-light');
  const darkIcon  = el('theme-icon-dark');
  const toggleBtn = el('theme-toggle-btn');
  if (!toggleBtn) return;
  if (theme === 'dark') {
    if (lightIcon) lightIcon.style.display = 'inline-block';
    if (darkIcon)  darkIcon.style.display  = 'none';
    toggleBtn.querySelector('span:not(.nav-icon)').textContent = 'Tema Chiaro';
  } else {
    if (lightIcon) lightIcon.style.display = 'none';
    if (darkIcon)  darkIcon.style.display  = 'inline-block';
    toggleBtn.querySelector('span:not(.nav-icon)').textContent = 'Tema Scuro';
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  // Refresh current view to re-render charts with new colors
  navigate(S.view);
}

// ── Refresh Lucide icons after dynamic HTML insertion ─────────
function refreshIcons() {
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Lucide icons
  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Initialize theme
  initTheme();

  await Data.init();

  // Set default view month to the latest available month with transactions
  const months = Data.getAvailableMonths();
  if (months.length > 0) {
    const latest = months[0]; // e.g. "2026-07"
    const parts = latest.split('-');
    if (parts.length === 2) {
      S.year  = parseInt(parts[0]);
      S.month = parseInt(parts[1]);
    }
  }

  // Login / Setup / App routing
  if (!Auth.hasPassword()) {
    showScreen('setup');
  } else if (!Auth.isLoggedIn()) {
    showScreen('login');
  } else {
    showScreen('app');
    navigate('dashboard');
  }

  // ── Event bindings ──────────────────────────────────────
  // Login
  el('login-form')?.addEventListener('submit', handleLogin);
  el('show-setup-link')?.addEventListener('click', e => { e.preventDefault(); showScreen('setup'); });
  // Setup
  el('setup-form')?.addEventListener('submit', handleSetup);
  // Logout
  el('logout-btn')?.addEventListener('click', logout);
  // Theme toggle
  el('theme-toggle-btn')?.addEventListener('click', toggleTheme);
  // Sidebar toggle
  el('sidebar-toggle')?.addEventListener('click', toggleSidebar);
  // Month nav
  el('prev-month-btn')?.addEventListener('click', prevMonth);
  el('next-month-btn')?.addEventListener('click', nextMonth);
  // Header sync
  el('header-sync-btn')?.addEventListener('click', headerSync);

  // Nav links
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      navigate(link.dataset.view);
    });
  });

  // Import — step 1 dropzones setup (done after DOM ready)
  setupDropzone('dz-rev-eur', handleRevolutEUR);
  setupDropzone('dz-rev-usd', handleRevolutUSD);
  setupDropzone('dz-intesa',  handleIntesa);

  // Import — step controls
  el('imp-next-1')?.addEventListener('click', () => {
    const hasEur = S.imp.eurParsed && S.imp.eurParsed.transactions && S.imp.eurParsed.transactions.length > 0;
    const hasUsd = S.imp.usdParsed && S.imp.usdParsed.transactions && S.imp.usdParsed.transactions.length > 0;
    const hasInt = S.imp.intesaTxs && S.imp.intesaTxs.length > 0;
    if (!hasEur && !hasUsd && !hasInt) {
      showToast('Carica almeno un file valido prima di proseguire', 'warning'); return;
    }
    showImportStep(2);
  });
  el('imp-back-2')?.addEventListener('click', () => showImportStep(1));
  el('imp-next-2')?.addEventListener('click', () => {
    const noEur = S.imp.merged.filter(t => t.amountEUR === null);
    if (noEur.length > 0) { showToast(`${noEur.length} transazioni senza EUR. Inserisci il tasso.`, 'warning'); return; }
    showImportStep(3);
  });
  el('imp-back-3')?.addEventListener('click', () => showImportStep(2));
  el('imp-confirm-btn')?.addEventListener('click', confirmImport);
  el('imp-reset-btn')?.addEventListener('click', () => { resetImport(); showImportStep(1); });

  // Bulk category
  el('apply-bulk-cat')?.addEventListener('click', applyBulkCategory);
  el('select-all-imp')?.addEventListener('change', e => {
    document.querySelectorAll('.imp-cb').forEach(cb => cb.checked = e.target.checked);
  });

  // Manual rate
  el('apply-manual-rate')?.addEventListener('click', applyManualRate);

  // Dashboard quick filters
  el('dash-tx-search')?.addEventListener('input', e => {
    S.dashFilter.search = e.target.value;
    renderDashboard();
  });
  el('dash-tx-cat')?.addEventListener('change', e => {
    S.dashFilter.category = e.target.value;
    renderDashboard();
  });

  // Modal forms
  el('add-expense-form')?.addEventListener('submit', handleSaveSingleExpense);
  el('edit-note-form')?.addEventListener('submit', handleSaveNote);

  // Transactions filters
  el('tx-search')?.addEventListener('input', filterTransactions);
  el('tx-filter-category')?.addEventListener('change', filterTransactions);
  el('tx-filter-source')?.addEventListener('change', filterTransactions);
  el('tx-filter-year')?.addEventListener('change', filterTransactions);

  // Settings
  el('save-budget-btn')?.addEventListener('click', saveBudgets);
  el('add-cat-btn')?.addEventListener('click', addCategory);
  el('new-cat-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') addCategory(); });
  el('save-gh-btn')?.addEventListener('click', saveGitHubConfig);
  el('gh-test-btn')?.addEventListener('click', testGitHub);
  el('sync-pull-btn')?.addEventListener('click', syncPull);
  el('sync-push-btn')?.addEventListener('click', syncPush);
  el('change-pw-btn')?.addEventListener('click', changePassword);
  el('export-data-btn')?.addEventListener('click', exportData);
  el('import-data-btn')?.addEventListener('click', importDataFile);
  el('clear-all-btn')?.addEventListener('click', clearAllData);
  el('save-account-btn')?.addEventListener('click', saveAccountSettings);
});
