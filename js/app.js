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
    satispayTxs:  null,
    exchangeInfo: null,  // { rate, totalEur, totalUsd, pairs }
    merged:       [],    // all transactions to review
    page:         0,
    PAGE_SIZE:    40,
    manualRate:   null
  },

  // Wallets page: currently selected wallet
  walletId: null,

  // Subscriptions page: active tab, open detail, "add by hand" selection
  subTab: 'subscription',
  subKey: null,
  subAddKey: null,

  // Transactions list
  txFilter: { search: '', category: '', source: '', year: '', wallet: '', page: 0, PAGE_SIZE: 50 },
  txSelected: new Set(),

  // Budget management state
  budgetState: {
    mode: 'month', // 'month' or 'default'
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1
  }
};

const PAGE_TITLES = {
  dashboard:    'Home',
  budget:       'Budget',
  wallets:      'Wallet',
  subscriptions: 'Abbonamenti',
  import:       'Importa',
  transactions: 'Movimenti',
  analytics:    'Analisi',
  settings:     'Impostazioni'
};

// Views reached from the "Altro" sheet on phones
const MORE_VIEWS = ['budget', 'subscriptions', 'analytics', 'import', 'settings'];
const MOBILE_BP = 860;

// ── Helpers ───────────────────────────────────────────────────
const YM = () => `${S.year}-${String(S.month).padStart(2,'0')}`;

function fmt(v) {
  return new Intl.NumberFormat('it-IT', { style:'currency', currency:'EUR', maximumFractionDigits:2 }).format(v);
}
function fmtCompact(v) {
  return new Intl.NumberFormat('it-IT', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(v);
}
// Signed amount for list rows: "−12,50 €" / "+35,00 €"
function fmtSigned(v) {
  return (v < 0 ? '−' : '+') + fmt(Math.abs(v));
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

  document.querySelectorAll('.nav-link, .tab-link').forEach(l => {
    l.classList.toggle('active', l.dataset.view === view || (l.dataset.view === 'more' && MORE_VIEWS.includes(view)));
  });
  closeMobileSheet();
  if (S.view !== view) window.scrollTo(0, 0);

  S.view = view;
  setText('page-title', PAGE_TITLES[view] || view);
  document.title = `FinancialControl — ${PAGE_TITLES[view] || view}`;
  updateMonthSelector();

  switch (view) {
    case 'dashboard':    renderDashboard();    break;
    case 'budget':       renderBudgetView();   break;
    case 'wallets':      renderWallets();      break;
    case 'subscriptions': renderSubscriptions(); break;
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

  const fx       = Data.shareFactors();
  const totalExp = exp.reduce((s,t) => s + Math.abs(Data.myAmount(t, fx)), 0);
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
  // The empty state replaces the canvas, so it is re-created each time
  if (Object.keys(catTotals).length > 0) {
    set('chart-donut-wrap', '<canvas id="chart-donut"></canvas>');
    Charts.donut('chart-donut', catTotals);
  } else {
    Charts.destroy('chart-donut');
    set('chart-donut-wrap', emptyChart('Nessuna spesa in questo mese'));
  }
  if (Object.values(budgets).some(v => v > 0) || Object.keys(catTotals).length > 0) {
    set('chart-budget-wrap', '<canvas id="chart-budget"></canvas>');
    Charts.budgetBar('chart-budget', budgets, catTotals, Data.getCategories());
  } else {
    Charts.destroy('chart-budget');
    set('chart-budget-wrap', emptyChart('Nessun budget impostato: definiscilo nella sezione Budget'));
  }

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

  setText('dash-tx-count', dashTxs.length === txs.length ? `${txs.length}` : `${dashTxs.length} di ${txs.length}`);
  renderRecentTxTable(dashTxs);
  refreshIcons();
}

function renderTxRow(t, cats, selectable = false) {
  const style    = Charts.categoryStyle(t.category);
  const hasNote  = !!(t.notes && t.notes.trim());
  const wallet   = t.walletId ? Data.getWallet(t.walletId) : null;
  const walletTag = wallet
    ? `<span class="wallet-tag" style="--wc:${safeColor(wallet.color)}" onclick="openWallet('${wallet.id}')" title="Wallet: ${escHtml(wallet.name)}"><span class="wallet-dot"></span>${escHtml(wallet.name)}</span>`
    : '';
  const noteSnippet = hasNote
    ? `<div class="note-text" onclick="openNoteModal('${t.id}')" title="${escHtml(t.notes)}"><i data-lucide="sticky-note" class="lucide-icon icon-xs"></i><span>${escHtml(t.notes.substring(0, 60))}</span></div>`
    : '';
  const selected = selectable && S.txSelected.has(t.id);
  const selectCell = selectable
    ? `<label class="tx-check"><input type="checkbox" class="tx-cb" ${selected ? 'checked' : ''} onchange="toggleTxSelect('${t.id}', this.checked)" aria-label="Seleziona"></label>`
    : '';
  return `<div class="tx-row${selected ? ' selected' : ''}">
    ${selectCell}
    <div class="tx-avatar" style="--c:${style.color}" title="${escHtml(t.category)}"><i data-lucide="${style.icon}" class="lucide-icon"></i></div>
    <div class="tx-main">
      <div class="tx-title"><span class="tx-name" title="${escHtml(t.description)}">${escHtml(t.description)}</span></div>
      <div class="tx-meta">
        <select class="cat-select" onchange="updateTxCategory('${t.id}', this.value)" aria-label="Categoria">
          ${cats.map(c => `<option value="${c}" ${t.category === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
        ${sourceIcon(t.source)}${walletTag}
      </div>
      ${t.details ? `<div class="tx-details" title="${escHtml(t.details)}">${escHtml(shortDetails(t.details))}</div>` : ''}
      ${noteSnippet}
    </div>
    <div class="tx-side">
      <div class="tx-amount${t.amountEUR > 0 ? ' in' : ''}">${fmtSigned(t.amountEUR)}</div>
      <div class="tx-actions">
        <button class="btn-icon" onclick="openEditTxModal('${t.id}')" title="Modifica"><i data-lucide="pencil" class="lucide-icon icon-sm"></i></button>
        <button class="note-btn ${hasNote ? 'has-note' : ''}" onclick="openNoteModal('${t.id}')" title="${hasNote ? 'Modifica nota' : 'Aggiungi nota'}"><i data-lucide="sticky-note" class="lucide-icon icon-sm"></i></button>
        <button class="btn-icon danger" onclick="deleteTx('${t.id}')" title="Elimina"><i data-lucide="trash-2" class="lucide-icon icon-sm"></i></button>
      </div>
    </div>
  </div>`;
}

// Rows grouped under a header per day ("Oggi", "Ieri", "venerdì 24 ottobre")
function renderTxList(txs, cats, selectable = false) {
  const today = new Date();
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const dayLabel = date => {
    if (date === iso(today)) return 'Oggi';
    if (date === iso(yesterday)) return 'Ieri';
    const d = new Date(date + 'T00:00:00');
    return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long',
      ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
  };
  const groups = [];
  txs.forEach(t => {
    const g = groups[groups.length - 1];
    if (g && g.date === t.date) g.txs.push(t); else groups.push({ date: t.date, txs: [t] });
  });
  return groups.map(g => {
    const total = g.txs.reduce((s, t) => s + (t.amountEUR || 0), 0);
    return `<div class="tx-day"><span>${escHtml(dayLabel(g.date))}</span><span class="tx-day-total">${fmtSigned(total)}</span></div>` +
      g.txs.map(t => renderTxRow(t, cats, selectable)).join('');
  }).join('');
}

function emptyState(icon, title, text, action = '') {
  return `<div class="empty-state">
    <div class="empty-icon"><i data-lucide="${icon}" class="lucide-icon"></i></div>
    <strong>${title}</strong>${text ? `<p>${text}</p>` : ''}${action}
  </div>`;
}

function emptyChart(text) {
  return `<div class="empty-chart"><i data-lucide="pie-chart" class="lucide-icon"></i>${text}</div>`;
}

// Bank details without long reference codes (full text stays in the tooltip)
function shortDetails(details) {
  return details.replace(/(?<!@)\b(?=[A-Za-z]*\d)[A-Za-z0-9]{10,}\b/g, '').replace(/^\s*COD\.?\s*DISP\.?/i, '')
    .replace(/\s+/g, ' ').trim().substring(0, 90);
}

function renderRecentTxTable(txs) {
  if (!txs.length) {
    const filtered = S.dashFilter.search || S.dashFilter.category;
    set('recent-tx-body', filtered
      ? emptyState('search-x', 'Nessun risultato', 'Nessun movimento del mese corrisponde ai filtri.')
      : emptyState('receipt', 'Nessun movimento questo mese', 'Aggiungi una spesa a mano o importa un estratto conto.',
          `<button class="btn btn-primary btn-sm" onclick="navigate('import')"><i data-lucide="file-down" class="lucide-icon icon-sm"></i> Importa estratto</button>`));
    return;
  }
  const cats = Data.getCategories();
  set('recent-tx-body', renderTxList(txs, cats));
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
    step: 1, files: [], eurParsed: null, usdParsed: null, intesaTxs: null, satispayTxs: null,
    exchangeInfo: null, merged: [], page: 0, PAGE_SIZE: 40, manualRate: null
  };
}

function showImportStep(step) {
  S.imp.step = step;
  document.querySelectorAll('.imp-step').forEach(s => s.classList.add('hidden'));
  el(`imp-step-${step}`)?.classList.remove('hidden');

  // Step indicators
  document.querySelectorAll('.step-indicators .step').forEach((s, i) => {
    s.classList.toggle('active',   i + 1 === step);
    s.classList.toggle('done',     i + 1 < step);
  });

  if (step === 1) renderImportFiles();
  if (step === 2) buildImportReviewTable();
  if (step === 3) buildImportSummary();
}

// ── Step 1: one upload area, source detected from each file's content ──
function setupImportDropzone() {
  const zone = el('dz-import');
  if (!zone) return;
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    addImportFiles(e.dataTransfer?.files);
  });
  const pick = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.accept = '.csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = () => { addImportFiles(inp.files); document.body.removeChild(inp); };
    inp.click();
  };
  zone.addEventListener('click', pick);
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
}

let impFileSeq = 0;

function addImportFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  Promise.all(files.map(f => f.arrayBuffer().then(buf => ({ f, buf })))).then(loaded => {
    loaded.forEach(({ f, buf }) => {
      const entry = { id: ++impFileSeq, name: f.name, buf, detected: null, source: null, parsed: null, error: '' };
      try {
        entry.detected = Import.detectImportSource(Import.readImportTable(buf));
      } catch (err) {
        console.warn('[import] File non leggibile:', f.name, err);
        entry.detected = { source: null, reason: 'File non leggibile come CSV o Excel' };
      }
      setImportFileSource(entry, entry.detected.source);
      S.imp.files.push(entry);
    });
    rebuildImportSources();
    renderImportFiles();
  }).catch(err => showToast('Errore nella lettura dei file: ' + err.message, 'error'));
}

// Parses the file as `source` (null = not assigned yet)
function setImportFileSource(entry, source) {
  entry.source = source || null;
  entry.parsed = null;
  entry.error  = '';
  if (!entry.source) return;
  try {
    entry.parsed = Import.parseBySource(entry.source, entry.buf);
    if (!entry.parsed.transactions.length) entry.error = 'Nessuna transazione valida trovata con questa fonte';
  } catch (err) {
    console.warn('[import] Parsing fallito:', entry.name, entry.source, err);
    entry.error = 'Il file non è leggibile come ' + Import.SOURCES[entry.source];
  }
}

// Rebuilds the per-source data steps 2–3 use. Several files of the same source are
// concatenated; a row already seen (same id, e.g. overlapping exports) is kept once.
function rebuildImportSources() {
  const by = { revolut_eur: null, revolut_usd: null, intesa: null, satispay: null };
  S.imp.files.forEach(f => {
    if (!f.source || f.error || !f.parsed) return;
    const acc = by[f.source] || (by[f.source] = { transactions: [], exchanges: [], ids: new Set() });
    f.parsed.transactions.forEach(t => {
      if (acc.ids.has(t.id)) return;
      acc.ids.add(t.id);
      acc.transactions.push(t);
      if (t.category === '__exchange__') acc.exchanges.push(t);
    });
  });
  const strip = p => p && { transactions: p.transactions, exchanges: p.exchanges };
  S.imp.eurParsed   = strip(by.revolut_eur);
  S.imp.usdParsed   = strip(by.revolut_usd);
  S.imp.intesaTxs   = by.intesa?.transactions || null;
  S.imp.satispayTxs = by.satispay?.transactions || null;
  S.imp.merged = []; S.imp.page = 0;
}

const IMP_SOURCE_ICON = { revolut_eur: 'euro', revolut_usd: 'dollar-sign', intesa: 'landmark', satispay: 'smartphone' };

function renderImportFiles() {
  const list = el('imp-file-list');
  if (!list) return;
  const files = S.imp.files || [];
  const zone = el('dz-import');
  zone?.classList.toggle('compact', files.length > 0);

  const options = sel => `<option value="" ${sel ? '' : 'selected'}>Scegli la fonte…</option>` +
    Object.entries(Import.SOURCES).map(([id, label]) => `<option value="${id}" ${id === sel ? 'selected' : ''}>${label}</option>`).join('');

  list.innerHTML = files.map(f => {
    const ok = f.source && !f.error;
    const n  = ok ? f.parsed.transactions.filter(t => t.category !== '__exchange__').length : 0;
    const corrected = f.source && f.detected?.source !== f.source;
    let status;
    if (ok) {
      status = `<span class="badge imp-file-chip">${Import.SOURCES[f.source]} · ${n} ${n === 1 ? 'riga' : 'righe'}</span>` +
        (corrected ? '<span class="imp-file-note">scelta a mano</span>' : '');
    } else if (f.source) {
      status = `<span class="imp-file-error">${escHtml(f.error)}</span>`;
    } else {
      status = `<span class="imp-file-error">${escHtml(f.detected?.reason || 'Formato non riconosciuto')}. Scegli la fonte o rimuovi il file.</span>`;
    }
    return `<li class="imp-file ${ok ? '' : 'bad'}" data-id="${f.id}">
      <div class="dz-icon imp-file-icon ${ok ? 'tint-green' : ''}"><i data-lucide="${ok ? IMP_SOURCE_ICON[f.source] : 'file-question'}" class="lucide-icon"></i></div>
      <div class="imp-file-main">
        <div class="imp-file-name" title="${escHtml(f.name)}">${escHtml(f.name)}</div>
        <div class="imp-file-status">${status}</div>
      </div>
      <select class="select-styled imp-file-src" aria-label="Fonte di ${escHtml(f.name)}" onchange="changeImportFileSource(${f.id}, this.value)">${options(f.source)}</select>
      <button class="icon-btn sm imp-file-remove" title="Rimuovi" aria-label="Rimuovi ${escHtml(f.name)}" onclick="removeImportFile(${f.id})"><i data-lucide="x" class="lucide-icon icon-sm"></i></button>
    </li>`;
  }).join('');

  const usable = files.filter(f => f.source && !f.error);
  const hasEur = usable.some(f => f.source === 'revolut_eur');
  const hasUsd = usable.some(f => f.source === 'revolut_usd');
  set('imp-file-hint', hasUsd && !hasEur
    ? '<div class="warn-banner"><i data-lucide="alert-triangle" class="lucide-icon icon-sm"></i> Per calcolare il tasso USD→EUR carica anche l\'estratto Revolut EUR (altrimenti si usa il tasso medio storico).</div>'
    : '');
  refreshIcons();
}

function changeImportFileSource(id, source) {
  const f = S.imp.files.find(x => x.id === id);
  if (!f) return;
  setImportFileSource(f, source);
  rebuildImportSources();
  renderImportFiles();
}

function removeImportFile(id) {
  S.imp.files = S.imp.files.filter(x => x.id !== id);
  rebuildImportSources();
  renderImportFiles();
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
  if (S.imp.satispayTxs) merged.push(...S.imp.satispayTxs);

  // Sort by date, work on copies so going back to step 1 re-parses cleanly
  merged = merged.map(t => ({ ...t }));
  merged.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Suggest categories from your history, then flag rows already on the platform.
  // Duplicates and internal Satispay movements start excluded; you can include them by hand.
  const existing = Data.getTransactions({});
  Import.categorize(merged, existing);
  Import.findDuplicates(merged, existing);
  merged.forEach(t => { t._include = !(t._dup?.level === 'sure' || t._internal); });
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
    set('imp-table-body', `<tr><td colspan="8" class="empty-row">${emptyState('file-question', 'Niente da importare', 'Nessun file caricato o nessuna transazione trovata. Torna allo step 1.')}</td></tr>`);
    refreshIcons();
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
    ? `<div class="warn-banner"><i data-lucide="alert-triangle" class="lucide-icon icon-sm"></i> ${noEur.length} transazioni USD senza conversione EUR. Inserisci il tasso manualmente.</div>`
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

  const rows = slice.map((t, localIdx) => {
    const globalIdx = page * S.imp.PAGE_SIZE + localIdx;
    const amtClass  = t.amountEUR === null ? 'no-eur' : (t.amountEUR < 0 ? 'negative' : 'positive');
    const eurCell   = t.amountEUR !== null ? fmt(t.amountEUR) : '—';
    const fmtAmt    = `${t.amount < 0 ? '' : '+'}${t.amount.toFixed(2)} ${t.currency}`;
    const dup       = t._dup;
    const dupTag    = dup
      ? `<span class="imp-tag ${dup.level === 'sure' ? 'dup' : 'maybe'}" title="${escHtml(`Sulla piattaforma: ${dup.match.date} · ${dup.match.description} · ${fmt(dup.match.amountEUR ?? dup.match.amount)}`)}">${dup.level === 'sure' ? 'Già presente' : 'Possibile duplicato'}</span>`
      : '';
    const internalTag = t._internal ? '<span class="imp-tag maybe" title="Movimento tra Satispay e salvadanaio/banca: escluso di default">Interno</span>' : '';
    const details   = t.details
      ? `<div class="tx-details" title="${escHtml(t.details)}">${escHtml(shortDetails(t.details))}</div>`
      : '';
    const sug       = t._suggest && !t._catEdited
      ? `<div class="cat-suggest ${t._suggest.by}" title="Categoria suggerita da: ${escHtml(t._suggest.label)}">${escHtml(t._suggest.label)}</div>`
      : '';
    const rowClass  = [t._include ? '' : 'imp-excluded', dup ? `imp-row-${dup.level}` : ''].join(' ').trim();
    return `<tr class="${rowClass}">
      <td><input type="checkbox" class="imp-cb" data-idx="${globalIdx}"></td>
      <td><input type="checkbox" class="imp-include" ${t._include ? 'checked' : ''} onchange="toggleImpInclude(${globalIdx}, this.checked)" title="Includi nell'importazione"></td>
      <td class="mono small">${t.date}</td>
      <td class="desc-cell" title="${escHtml(t.description)}">
        <div>${dupTag}${internalTag}${escHtml(t.description.substring(0,55))}</div>
        ${details}
      </td>
      <td class="mono small">${fmtAmt}</td>
      <td class="${amtClass} mono small">${eurCell}</td>
      <td class="source-cell small">${sourceIcon(t.source)}</td>
      <td>
        <select class="cat-select" data-idx="${globalIdx}" onchange="updateImpCategory(${globalIdx}, this.value)">
          <option value="">— Categoria —</option>
          ${cats.map(c => `<option value="${c}" ${t.category === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
        ${sug}
      </td>
    </tr>`;
  }).join('');

  // Duplicate / exclusion banner
  const nSure     = merged.filter(t => t._dup?.level === 'sure').length;
  const nMaybe    = merged.filter(t => t._dup?.level === 'maybe').length;
  const nExcluded = merged.filter(t => !t._include).length;
  const dupBanner = (nSure || nMaybe || nExcluded)
    ? `<div class="warn-banner imp-dup-banner">
        <i data-lucide="copy" class="lucide-icon icon-sm"></i>
        <span style="flex:1;min-width:200px">
        ${nSure ? `<strong>${nSure} già present${nSure === 1 ? 'e' : 'i'}</strong> sulla piattaforma (escluse). ` : ''}
        ${nMaybe ? `<strong>${nMaybe} possibil${nMaybe === 1 ? 'e duplicato' : 'i duplicati'}</strong> (stesso importo e data, descrizione diversa: inclus${nMaybe === 1 ? 'o' : 'i'}, da verificare). ` : ''}
        ${nExcluded} righe escluse in totale: spunta "Importa" per includerle.</span>
        <span style="display:inline-flex;gap:0.4rem;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" onclick="setImpIncludeAll(true)">Includi tutte</button>
          <button class="btn btn-secondary btn-sm" onclick="setImpIncludeAll(false)">Escludi duplicati</button>
        </span>
      </div>`
    : '';
  set('import-exchange-info', rateBanner + noEurBanner + dupBanner);

  set('imp-table-body', rows);
  set('imp-pagination', paginationHtml(page, pages, 'impPage'));
  setText('imp-count-label', `${merged.filter(t => t._include).length} da importare su ${total}`);

  // Bulk category options
  set('bulk-cat-options', catOptions);
  refreshIcons();
}

function updateImpCategory(idx, cat) {
  if (S.imp.merged[idx]) { S.imp.merged[idx].category = cat; S.imp.merged[idx]._catEdited = true; }
}

function toggleImpInclude(idx, on) {
  if (S.imp.merged[idx]) S.imp.merged[idx]._include = on;
  buildImportReviewTable();
}

// true: include every row; false: back to defaults for duplicates (exclude sure ones)
function setImpIncludeAll(on) {
  S.imp.merged.forEach(t => {
    t._include = on ? true : !(t._dup?.level === 'sure' || t._internal);
  });
  buildImportReviewTable();
}

function applyBulkCategory() {
  const cat = el('bulk-cat-select').value;
  if (!cat) { showToast('Seleziona una categoria', 'warning'); return; }
  document.querySelectorAll('.imp-cb:checked').forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    if (S.imp.merged[idx]) { S.imp.merged[idx].category = cat; S.imp.merged[idx]._catEdited = true; }
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
  const toImport = importableRows();
  const expenses = toImport.filter(t => t.amountEUR < 0);
  const income   = toImport.filter(t => t.amountEUR >= 0);
  const totalExp = expenses.reduce((s,t) => s + Math.abs(t.amountEUR), 0);
  const totalInc = income.reduce((s,t) => s + t.amountEUR, 0);

  // Category breakdown
  const catMap = {};
  expenses.forEach(t => { catMap[t.category] = (catMap[t.category]||0) + Math.abs(t.amountEUR); });
  const catRows = Object.entries(catMap).sort((a,b)=>b[1]-a[1])
    .map(([c,v]) => `<tr><td><span class="wallet-dot" style="--wc:${Charts.categoryStyle(c).color};margin-right:0.6rem"></span>${c}</td><td class="mono">${fmt(v)}</td></tr>`).join('');

  const excluded = S.imp.merged.filter(t => !t._include);
  const exclBanner = excluded.length
    ? `<div class="warn-banner">
        <i data-lucide="copy" class="lucide-icon icon-sm"></i>
        <span><strong>${excluded.length} righe escluse</strong> (già presenti o movimenti interni) non verranno importate.
        Torna a "Modifica" per includerle.</span>
      </div>`
    : '';

  const confirmBtn = el('imp-confirm-btn');
  if (confirmBtn) {
    confirmBtn.disabled = !toImport.length;
    confirmBtn.innerHTML = `<i data-lucide="check" class="lucide-icon icon-sm"></i> Importa ${toImport.length} transazioni`;
  }

  set('imp-summary-body', `
    ${exclBanner}
    <div class="summary-grid">
      <div class="summary-card"><span class="summary-label">Da importare</span><span class="summary-val">${toImport.length}</span></div>
      <div class="summary-card negative"><span class="summary-label">Uscite</span><span class="summary-val">${fmtCompact(totalExp)}</span></div>
      <div class="summary-card positive"><span class="summary-label">Entrate</span><span class="summary-val">${fmtCompact(totalInc)}</span></div>
      ${S.imp.exchangeInfo ? `<div class="summary-card"><span class="summary-label">Tasso EUR/USD</span><span class="summary-val">${S.imp.exchangeInfo.rate.toFixed(4)}</span></div>` : ''}
    </div>
    <div class="card summary-section">
      <div class="card-head"><h3 class="card-heading">Uscite per categoria</h3></div>
      ${catRows ? `<table class="summary-table"><tbody>${catRows}</tbody></table>` : '<p class="muted small">Nessuna uscita da importare.</p>'}
    </div>
  `);
  refreshIcons();
}

// Rows the user kept in the preview, ready to save
function importableRows() {
  return S.imp.merged.filter(t => t._include && t.amountEUR !== null && t.category !== '__exchange__');
}

async function confirmImport() {
  // Drop preview-only fields (prefixed with _) before saving
  const toSave = importableRows().map(t => {
    const tx = {};
    Object.keys(t).forEach(k => { if (!k.startsWith('_') && t[k] !== undefined) tx[k] = t[k]; });
    if (!tx.category) tx.category = 'Altro';
    return tx;
  });
  if (!toSave.length) { showToast('Nessuna transazione valida da importare', 'warning'); return; }

  showToast('Salvataggio su Firebase…', 'info');
  // addTransactions skips ids already stored, so existing rows (and their wallet) are never overwritten
  const added = await Data.addTransactions(toSave);

  // Save exchange rates
  if (S.imp.exchangeInfo?.pairs?.length) {
    await Data.addExchangeRates(S.imp.exchangeInfo.pairs);
  }

  showToast(`${added} transazioni salvate su Firebase!`, 'success');
  resetImport();
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
    walletId: f.wallet   || undefined,
  });
  S.txFiltered = txs.map(t => t.id);
  // Keep the selection limited to what the current filters show
  const visible = new Set(S.txFiltered);
  [...S.txSelected].forEach(id => { if (!visible.has(id)) S.txSelected.delete(id); });

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
  el('tx-filter-wallet').innerHTML =
    `<option value="">Tutti i wallet</option><option value="__none__" ${f.wallet === '__none__' ? 'selected' : ''}>Senza wallet</option>` +
    Data.getWallets().map(w => `<option value="${w.id}" ${f.wallet === w.id ? 'selected' : ''}>${escHtml(w.name)}</option>`).join('');

  S.txPageIds = slice.map(t => t.id);
  const filtered = f.search || f.category || f.source || f.wallet;
  const rows = slice.length
    ? renderTxList(slice, cats, true)
    : filtered
      ? emptyState('search-x', 'Nessun risultato', 'Prova a cambiare la ricerca o i filtri.')
      : emptyState('receipt', 'Nessun movimento', f.year ? `Nessun movimento nel ${f.year}.` : 'Nessun movimento in questo mese.');

  set('tx-table-body', rows);
  updateTxBulkBar();
  set('tx-pagination', paginationHtml(f.page, pages, 'txPage'));
  setText('tx-count', `${total} moviment${total === 1 ? 'o' : 'i'}`);
  refreshIcons();
}

async function updateTxCategory(id, cat) {
  await Data.updateTransaction(id, { category: cat });
  if (S.view === 'dashboard') renderDashboard();
  else if (S.view === 'transactions') renderTransactions();
  else if (S.view === 'wallets') renderWallets();
}

async function deleteTx(id) {
  if (!confirm('Eliminare questa transazione?')) return;
  await Data.deleteTransaction(id);
  if (S.view === 'dashboard') renderDashboard();
  else if (S.view === 'transactions') renderTransactions();
  else if (S.view === 'wallets') renderWallets();
  showToast('Transazione eliminata', 'info');
}

// ── WALLETS ───────────────────────────────────────────────────
const WALLET_COLORS = ['#0a84ff','#30d158','#ff9f0a','#ff453a','#bf5af2','#64d2ff','#ff375f','#ffd60a'];

function safeColor(c) {
  return /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#0a84ff';
}

function walletOptionsHtml(selectedId) {
  return `<option value="">Nessun wallet</option>` +
    Data.getWallets().map(w =>
      `<option value="${w.id}" ${w.id === selectedId ? 'selected' : ''}>${escHtml(w.name)}</option>`).join('');
}

function walletPeriodLabel(w) {
  if (w.startDate && w.endDate) return `${fmtDate(w.startDate)} – ${fmtDate(w.endDate)}`;
  if (w.startDate) return `dal ${fmtDate(w.startDate)}`;
  if (w.endDate)   return `fino al ${fmtDate(w.endDate)}`;
  return '';
}

function walletPctLabel(st) {
  return Number.isFinite(st.pctUsed) ? `${st.pctUsed.toFixed(0)}%` : '—';
}

function walletBarClass(st) {
  if (st.status === 'negative') return 'danger';
  return st.pctUsed >= 80 ? 'warning' : 'ok';
}

function openWallet(id) {
  S.walletId = id;
  navigate('wallets');
}

function renderWallets() {
  const wallets = Data.getWallets();
  if (!wallets.some(w => w.id === S.walletId)) S.walletId = wallets[0]?.id || null;

  if (!wallets.length) {
    set('wallet-list', `<div class="card wallet-empty">${emptyState('wallet-cards', 'Nessun wallet ancora',
      'Crea un wallet per stanziare un importo (es. un viaggio o un progetto) e assegnargli le spese.',
      `<button class="btn btn-primary btn-sm" onclick="openWalletModal()"><i data-lucide="plus" class="lucide-icon icon-sm"></i> Crea il primo wallet</button>`)}</div>`);
    el('wallet-detail').classList.add('hidden');
    refreshIcons();
    return;
  }

  set('wallet-list', wallets.map(w => {
    const st = Data.getWalletStats(w.id);
    const pct = Number.isFinite(st.pctUsed) ? Math.min(st.pctUsed, 100) : 100;
    return `<button type="button" class="wallet-card ${w.id === S.walletId ? 'active' : ''}" style="--wc:${safeColor(w.color)}" onclick="openWallet('${w.id}')">
      <div class="wallet-card-head"><span class="wallet-avatar"><i data-lucide="wallet-cards" class="lucide-icon"></i></span><span class="wallet-card-name">${escHtml(w.name)}</span></div>
      <div class="muted small">Saldo disponibile</div>
      <div class="wallet-card-remaining ${st.status}">${fmt(st.remaining)}</div>
      <div class="muted small">base ${fmt(st.allocated)}${st.credits > 0 ? ` + ${fmt(st.credits)} entrate` : ''}</div>
      <div class="bar-track sm"><div class="bar-fill ${walletBarClass(st)}" style="width:${pct}%"></div></div>
      <div class="muted small">${st.txs.length} transazioni · ${walletPctLabel(st)} usato</div>
    </button>`;
  }).join(''));

  renderWalletDetail(S.walletId);
  refreshIcons();
}

function renderWalletDetail(id) {
  const st = Data.getWalletStats(id);
  if (!st) { el('wallet-detail').classList.add('hidden'); return; }
  el('wallet-detail').classList.remove('hidden');
  const w = st.wallet;

  el('wd-dot').style.setProperty('--wc', safeColor(w.color));
  setText('wd-name', w.name);
  setText('wd-meta', [walletPeriodLabel(w), w.notes].filter(Boolean).join(' · '));

  const statusMsg = {
    positive: `<i data-lucide="check-circle-2" class="lucide-icon icon-sm"></i> Disponibile: restano <strong>${fmt(st.remaining)}</strong>`,
    zero:     `<i data-lucide="circle-dot" class="lucide-icon icon-sm"></i> Esaurito: il wallet è stato speso interamente`,
    negative: `<i data-lucide="alert-triangle" class="lucide-icon icon-sm"></i> Sforato: superato di <strong>${fmt(Math.abs(st.remaining))}</strong>`
  }[st.status];
  const statusEl = el('wd-status');
  statusEl.className = `wallet-status ${st.status}`;
  statusEl.innerHTML = statusMsg;

  setText('wd-kpi-allocated', fmt(st.allocated));
  setText('wd-kpi-credits', `+${fmt(st.credits)}`);
  setText('wd-kpi-spent', `−${fmt(st.spent)}`);
  setText('wd-kpi-remaining', fmt(st.remaining));
  setText('wd-kpi-formula', `${fmt(st.allocated)} + ${fmt(st.credits)} − ${fmt(st.spent)}`);
  el('wd-kpi-remaining').className = `kpi-value ${st.status === 'negative' ? 'negative' : st.status === 'positive' ? 'positive' : ''}`;
  el('wd-kpi-remaining-card').className = `kpi-card ${st.status === 'negative' ? 'danger' : st.status === 'positive' ? 'success' : ''}`;

  const pct = Number.isFinite(st.pctUsed) ? st.pctUsed : 100;
  el('wd-bar-fill').style.width = Math.min(pct, 100) + '%';
  el('wd-bar-fill').className = `bar-fill ${walletBarClass(st)}`;
  setText('wd-bar-label', `${walletPctLabel(st)} utilizzato — uscite ${fmt(st.spent)} su ${fmt(st.available)} disponibili (base + entrate)`);

  // Charts: canvases are re-created because the empty state replaces them
  if (Object.keys(st.byCategory).length) {
    set('wd-donut-wrap', '<canvas id="chart-wallet-donut"></canvas>');
    Charts.donut('chart-wallet-donut', st.byCategory);
  } else {
    Charts.destroy('chart-wallet-donut');
    set('wd-donut-wrap', emptyChart('Nessuna spesa assegnata'));
  }
  if (st.txs.length) {
    set('wd-timeline-wrap', '<canvas id="chart-wallet-timeline"></canvas>');
    Charts.walletTimeline('chart-wallet-timeline', st.txs, st.allocated);
  } else {
    Charts.destroy('chart-wallet-timeline');
    set('wd-timeline-wrap', emptyChart('Nessun movimento assegnato'));
  }

  setText('wd-tx-count', `${st.txs.length}`);
  const cats = Data.getCategories();
  set('wd-tx-body', st.txs.length
    ? renderTxList(st.txs, cats)
    : emptyState('list-plus', 'Nessun movimento in questo wallet', 'Aggiungi spese esistenti dai Movimenti o registra un nuovo movimento nel wallet.',
        `<button class="btn btn-primary btn-sm" onclick="pickTxsForWallet(S.walletId)"><i data-lucide="list-checks" class="lucide-icon icon-sm"></i> Aggiungi spese esistenti</button>`));
}

function openWalletModal(id) {
  const w = id ? Data.getWallet(id) : null;
  setText('modal-wallet-title', w ? 'Modifica wallet' : 'Nuovo wallet');
  el('wallet-id').value     = w ? w.id : '';
  el('wallet-name').value   = w ? w.name : '';
  el('wallet-amount').value = w ? (w.amount ?? 0) : '';
  el('wallet-color').value  = w ? safeColor(w.color) : WALLET_COLORS[Data.getWallets().length % WALLET_COLORS.length];
  el('wallet-start').value  = w?.startDate || '';
  el('wallet-end').value    = w?.endDate || '';
  el('wallet-notes').value  = w?.notes || '';
  el('modal-wallet').classList.remove('hidden');
  refreshIcons();
  el('wallet-name').focus();
}

function closeWalletModal() {
  el('modal-wallet').classList.add('hidden');
}

async function handleSaveWallet(e) {
  e.preventDefault();
  const name   = el('wallet-name').value.trim();
  const amount = parseFloat(el('wallet-amount').value);
  const startDate = el('wallet-start').value;
  const endDate   = el('wallet-end').value;
  if (!name || isNaN(amount) || amount < 0) {
    showToast('Inserisci un nome e un importo valido', 'warning');
    return;
  }
  if (startDate && endDate && endDate < startDate) {
    showToast('La data di fine è precedente a quella di inizio', 'warning');
    return;
  }
  const id = await Data.saveWallet({
    id:     el('wallet-id').value || undefined,
    name,
    amount: Math.round(amount * 100) / 100,
    color:  safeColor(el('wallet-color').value),
    startDate,
    endDate,
    notes:  el('wallet-notes').value.trim()
  });
  closeWalletModal();
  showToast(`Wallet "${name}" salvato`, 'success');
  openWallet(id);
}

async function deleteWallet(id) {
  const w = Data.getWallet(id);
  if (!w) return;
  const n = Data.getTransactions({ walletId: id }).length;
  const msg = n
    ? `Eliminare il wallet "${w.name}"? Le ${n} transazioni assegnate resteranno, ma senza wallet.`
    : `Eliminare il wallet "${w.name}"?`;
  if (!confirm(msg)) return;
  await Data.deleteWallet(id);
  S.walletId = null;
  showToast('Wallet eliminato', 'info');
  navigate('wallets');
}

// ── SUBSCRIPTIONS ─────────────────────────────────────────────
const SUB_TABS = [
  { id: 'subscription', label: 'Abbonamenti' },
  { id: 'uncertain',    label: 'Da verificare' },
  { id: 'recurring',    label: 'Spese fisse' },
  { id: 'dismissed',    label: 'Ignorati' }
];
const SUB_KIND_LABEL = { subscription: 'Abbonamento', uncertain: 'Da verificare', recurring: 'Spesa fissa, non abbonamento' };

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// withYear: true always, false only when it is not this year, 'never' for tight spots
function fmtDay(d, withYear = false) {
  const date = new Date(d + 'T00:00:00');
  const year = withYear === true || (withYear !== 'never' && date.getFullYear() !== new Date().getFullYear());
  return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
}

function subTabOf(item) {
  return item.userStatus === 'dismissed' ? 'dismissed' : item.kind;
}

// Lookup by key without touching the DOM (keys go through data-key attributes, never into inline JS)
function findSub(key) {
  return Data.getSubscriptions(todayIso()).find(i => i.key === key) || null;
}

function subStatusPill(item) {
  return item.active
    ? `<span class="sub-pill ok"><span class="sub-pill-dot"></span>Attivo</span>`
    : `<span class="sub-pill stop"><span class="sub-pill-dot"></span>Interrotto</span>`;
}

function subUserPill(item) {
  if (item.userStatus === 'confirmed') return item.detected
    ? `<span class="sub-pill user"><i data-lucide="badge-check" class="lucide-icon icon-xs"></i>Confermato</span>`
    : `<span class="sub-pill user"><i data-lucide="hand" class="lucide-icon icon-xs"></i>A mano</span>`;
  if (item.userStatus === 'dismissed') return `<span class="sub-pill"><i data-lucide="eye-off" class="lucide-icon icon-xs"></i>Ignorato</span>`;
  return '';
}

function subAmountLabel(item) {
  const f = Subscriptions.FREQS[item.frequency];
  return `${item.amountMax - item.amountMin > 0.01 && item.kind === 'recurring' ? '~' : ''}${fmt(item.amount)}<span class="sub-per">/${f.short}</span>`;
}

function renderSubCard(item) {
  const style = Charts.categoryStyle(item.category);
  const f = Subscriptions.FREQS[item.frequency];
  const next = item.active
    ? `<div><span>Prossimo</span><strong>${fmtDay(item.nextDate, 'never')}</strong></div>`
    : `<div class="missed"><span>Atteso</span><strong>${fmtDay(item.nextDate, 'never')}</strong></div>`;
  return `<button type="button" class="sub-card${item.active ? '' : ' stopped'}" data-key="${escHtml(item.key)}" onclick="openSubDetail(this.dataset.key)">
    <div class="sub-card-head">
      <div class="tx-avatar" style="--c:${style.color}"><i data-lucide="${style.icon}" class="lucide-icon"></i></div>
      <div class="sub-card-title">
        <div class="sub-name">${escHtml(item.name)}</div>
        <div class="sub-meta">${f.label} · ${item.count} addebit${item.count === 1 ? 'o' : 'i'}${item.shares > 1 ? ` · diviso in ${item.shares}` : ''}</div>
      </div>
      <div class="sub-card-amount">${subAmountLabel(item)}</div>
    </div>
    <div class="sub-pills">${subStatusPill(item)}${subUserPill(item)}</div>
    <div class="sub-stats">
      ${next}
      <div><span>Ultimo</span><strong>${fmtDay(item.lastDate, 'never')}</strong></div>
      <div><span>${item.shares > 1 ? 'Tua quota/mese' : 'Al mese'}</span><strong>${fmt(item.myMonthly)}</strong></div>
      <div><span>${item.shares > 1 ? 'Tua quota/anno' : "All'anno"}</span><strong>${fmt(item.myYearly)}</strong></div>
    </div>
  </button>`;
}

// Subscription charges per month over the last 12 months (other fixed costs counted apart)
function subMonthlySeries(items) {
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const idx = new Map(months.map((m, i) => [m, i]));
  const subs = months.map(() => 0), rec = months.map(() => 0);
  const byId = new Map(Data.get().transactions.map(t => [t.id, t]));
  const fx = Data.shareFactors();
  items.filter(i => i.userStatus !== 'dismissed').forEach(i => {
    const target = i.kind === 'subscription' ? subs : i.kind === 'recurring' ? rec : null;
    if (!target) return;
    i.txIds.forEach(id => {
      const t = byId.get(id);
      const k = t && idx.get(t.date.substring(0, 7));
      if (k !== undefined) target[k] += Math.abs(Data.myAmount(t, fx));
    });
  });
  return { months, subs, rec };
}

function renderSubscriptions() {
  const items = Data.getSubscriptions(todayIso());
  const tot = Subscriptions.totals(items);

  setText('sub-kpi-monthly', fmt(tot.monthly));
  setText('sub-kpi-yearly', fmtCompact(tot.yearly));
  setText('sub-kpi-count', tot.count);
  setText('sub-kpi-recurring', fmtCompact(tot.recurringMonthly));

  const series = subMonthlySeries(items);
  if (series.subs.some(v => v > 0)) {
    set('sub-chart-wrap', '<canvas id="chart-subs"></canvas>');
    Charts.subscriptionMonths('chart-subs', series.months, series.subs);
  } else {
    Charts.destroy('chart-subs');
    set('sub-chart-wrap', emptyChart('Nessun addebito di abbonamenti negli ultimi 12 mesi'));
  }

  const counts = {};
  items.forEach(i => { const t = subTabOf(i); counts[t] = (counts[t] || 0) + 1; });
  set('sub-tabs', SUB_TABS.map(t =>
    `<button type="button" role="tab" class="sub-tab${S.subTab === t.id ? ' active' : ''}" aria-selected="${S.subTab === t.id}" onclick="setSubTab('${t.id}')">
      ${t.label}<span class="sub-tab-count">${counts[t.id] || 0}</span></button>`).join(''));

  const list = items.filter(i => subTabOf(i) === S.subTab);
  if (!list.length) {
    const empty = {
      subscription: items.length
        ? ['repeat', 'Nessun abbonamento confermato', 'Controlla "Da verificare" o aggiungine uno a mano.']
        : ['repeat', 'Nessun pagamento ricorrente trovato', 'Servono almeno 2–3 addebiti regolari dello stesso esercente. Importa altri estratti conto o aggiungi un abbonamento a mano.'],
      uncertain:  ['circle-help', 'Niente da verificare', 'I pagamenti regolari senza un marchio noto compaiono qui.'],
      recurring:  ['home', 'Nessuna spesa fissa', 'Affitto, bollette, rate e assicurazioni ricorrenti compaiono qui.'],
      dismissed:  ['eye-off', 'Nessun elemento ignorato', 'Ciò che ignori finisce qui e puoi ripristinarlo quando vuoi.']
    }[S.subTab];
    set('sub-list', `<div class="card">${emptyState(empty[0], empty[1], empty[2],
      S.subTab === 'subscription' ? `<button class="btn btn-primary btn-sm" onclick="openSubAddModal()"><i data-lucide="plus" class="lucide-icon icon-sm"></i> Aggiungi a mano</button>` : '')}</div>`);
  } else {
    const active = list.filter(i => i.active), stopped = list.filter(i => !i.active);
    set('sub-list',
      (active.length ? `<div class="sub-grid">${active.map(renderSubCard).join('')}</div>` : '') +
      (stopped.length ? `<div class="sub-section-label">Interrotti · nessun addebito alla data attesa</div><div class="sub-grid">${stopped.map(renderSubCard).join('')}</div>` : ''));
  }

  if (S.subKey && !el('modal-sub').classList.contains('hidden')) renderSubDetail(S.subKey);
  refreshIcons();
}

function setSubTab(tab) {
  S.subTab = tab;
  renderSubscriptions();
}

function openSubDetail(key) {
  S.subKey = key;
  if (!renderSubDetail(key)) return;
  el('modal-sub').classList.remove('hidden');
  refreshIcons();
}

function closeSubModal() {
  el('modal-sub').classList.add('hidden');
  S.subKey = null;
}

function renderSubDetail(key) {
  const item = findSub(key);
  if (!item) { closeSubModal(); return false; }
  const f = Subscriptions.FREQS[item.frequency];
  const style = Charts.categoryStyle(item.category);
  const avatar = el('sub-d-avatar');
  avatar.style.setProperty('--c', style.color);
  avatar.innerHTML = `<i data-lucide="${style.icon}" class="lucide-icon"></i>`;
  setText('sub-d-name', item.name);
  const pref = Data.getSubscriptionPrefs()[item.key];
  const kindText = item.userStatus === 'confirmed' ? (item.detected ? 'Abbonamento confermato da te' : 'Abbonamento aggiunto a mano')
    : item.userStatus === 'dismissed' ? `Ignorato · rilevato come ${SUB_KIND_LABEL[item.kind].toLowerCase()}`
    : `${SUB_KIND_LABEL[item.kind]} · affidabilità ${item.score}%`;
  setText('sub-d-kind', kindText);

  const status = item.active
    ? `<div class="wallet-status positive"><i data-lucide="calendar-check" class="lucide-icon icon-sm"></i> Attivo: prossimo addebito previsto il <strong>${fmtDay(item.nextDate, true)}</strong></div>`
    : `<div class="wallet-status zero"><i data-lucide="calendar-x" class="lucide-icon icon-sm"></i> Sembra interrotto: era atteso il <strong>${fmtDay(item.nextDate, true)}</strong>, nessun addebito dal ${fmtDay(item.lastDate, true)}</div>`;
  const range = item.amountMax - item.amountMin > 0.01 ? `${fmt(item.amountMin)} – ${fmt(item.amountMax)}` : 'sempre uguale';
  const txs = item.txIds.map(id => Data.get().transactions.find(t => t.id === id)).filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date));
  const freqSelect = item.userStatus === 'confirmed'
    ? `<div class="form-group sub-freq-row"><label for="sub-d-freq">Frequenza</label>
        <select id="sub-d-freq" data-key="${escHtml(item.key)}" onchange="changeSubFrequency(this.dataset.key, this.value)">
          ${Subscriptions.FREQ_ORDER.map(k => `<option value="${k}" ${k === item.frequency ? 'selected' : ''}>${Subscriptions.FREQS[k].label}</option>`).join('')}
        </select></div>`
    : '';

  const nameRow = `<form class="sub-name-row" data-key="${escHtml(item.key)}" onsubmit="event.preventDefault(); renameSub(this.dataset.key, this.elements.name.value)">
      <label for="sub-d-rename">Nome</label>
      <div class="sub-name-input">
        <input type="text" id="sub-d-rename" name="name" maxlength="60" value="${escHtml(pref?.name || '')}" placeholder="${escHtml(item.detectedName || item.name)}" autocomplete="off">
        <button type="submit" class="btn btn-secondary btn-sm">Salva nome</button>
      </div>
    </form>`;

  const shareRow = `<form class="sub-name-row" data-key="${escHtml(item.key)}" onsubmit="event.preventDefault(); shareSub(this.dataset.key, this.elements.shares.value)">
      <label for="sub-d-shares">Diviso tra</label>
      <div class="sub-name-input">
        <select id="sub-d-shares" name="shares" onchange="this.form.requestSubmit()">
          ${Array.from({ length: 10 }, (_, i) => i + 1).map(n =>
            `<option value="${n}" ${n === item.shares ? 'selected' : ''}>${n === 1 ? 'Solo io' : `${n} persone (me compreso)`}</option>`).join('')}
        </select>
      </div>
      <div class="sub-share-note">${item.shares > 1
        ? `Paghi ${fmt(item.amount)}, la tua quota è <strong>${fmt(item.amount / item.shares)}</strong>. Nei movimenti resta l'importo pieno; nei totali di spesa conta solo la tua quota.`
        : 'Se lo condividi con altri, nei totali di spesa conterà solo la tua quota.'}</div>
    </form>`;

  set('sub-d-body', `${status}
    ${nameRow}
    ${shareRow}
    <div class="sub-d-grid">
      <div><span>Importo tipico</span><strong>${fmt(item.amount)}</strong><em>${range}</em></div>
      <div><span>Frequenza</span><strong>${f.label}</strong><em>dal ${fmtDay(item.firstDate, true)}</em></div>
      <div><span>${item.shares > 1 ? 'Tua quota/mese' : 'Al mese'}</span><strong>${fmt(item.myMonthly)}</strong><em>${item.shares > 1 ? `${fmt(item.monthly)} in totale` : `${fmt(item.yearly)} all'anno`}</em></div>
      <div><span>Addebiti</span><strong>${item.count}</strong><em>ultimo ${fmtDay(item.lastDate, true)}</em></div>
    </div>
    ${freqSelect}
    <div class="sub-reasons"><div class="card-heading-sm">Perché</div><ul>${item.reasons.map(r => `<li>${escHtml(r)}</li>`).join('')}</ul></div>
    <div class="card-heading-sm">Movimenti (${txs.length})</div>
    <div class="tx-list sub-d-txs">${renderTxList(txs, Data.getCategories())}</div>`);

  const k = escHtml(item.key);
  let actions;
  if (item.userStatus === 'confirmed') {
    actions = `<button class="btn btn-secondary" data-key="${k}" onclick="resetSub(this.dataset.key)"><i data-lucide="rotate-ccw" class="lucide-icon icon-sm"></i> ${item.detected ? 'Annulla conferma' : 'Rimuovi'}</button>`;
  } else if (item.userStatus === 'dismissed') {
    actions = `<button class="btn btn-primary" data-key="${k}" onclick="resetSub(this.dataset.key)"><i data-lucide="rotate-ccw" class="lucide-icon icon-sm"></i> Ripristina</button>`;
  } else {
    actions = `<button class="btn btn-secondary" data-key="${k}" onclick="dismissSub(this.dataset.key)"><i data-lucide="eye-off" class="lucide-icon icon-sm"></i> Ignora</button>
      <button class="btn btn-primary" data-key="${k}" onclick="confirmSub(this.dataset.key)"><i data-lucide="badge-check" class="lucide-icon icon-sm"></i> ${item.kind === 'subscription' ? 'Conferma' : 'È un abbonamento'}</button>`;
  }
  set('sub-d-actions', actions);
  refreshIcons();
  return true;
}

async function confirmSub(key) {
  const item = findSub(key);
  await Data.setSubscriptionPref(key, { status: 'confirmed', manual: !!item && item.kind !== 'subscription' });
  showToast(`"${item ? item.name : key}" confermato come abbonamento`, 'success');
  renderSubscriptions();
}

async function dismissSub(key) {
  const item = findSub(key);
  await Data.setSubscriptionPref(key, { status: 'dismissed' });
  showToast(`"${item ? item.name : key}" ignorato`, 'info');
  closeSubModal();
  renderSubscriptions();
}

async function resetSub(key) {
  const item = findSub(key);
  await Data.clearSubscriptionPref(key);
  showToast(`"${item ? item.name : key}" torna al rilevamento automatico`, 'info');
  if (!findSub(key)) closeSubModal();
  renderSubscriptions();
}

async function renameSub(key, name) {
  await Data.setSubscriptionPref(key, { name });
  const item = findSub(key);
  showToast(name.trim() ? `Rinominato in "${name.trim()}"` : `Nome originale ripristinato: "${item ? item.name : key}"`, 'success');
  renderSubscriptions();
}

async function shareSub(key, shares) {
  const n = parseInt(shares, 10) || 1;
  await Data.setSubscriptionPref(key, { shares: n });
  showToast(n > 1 ? `Diviso tra ${n} persone: conta solo la tua quota` : 'Non più diviso', 'success');
  renderSubscriptions();
  if (['dashboard', 'analytics'].includes(S.view)) navigate(S.view);
}

async function changeSubFrequency(key, freq) {
  const pref = Data.getSubscriptionPrefs()[key];
  if (!pref) return;
  await Data.setSubscriptionPref(key, { ...pref, frequency: freq });
  renderSubscriptions();
}

function openSubAddModal() {
  S.subAddKey = null;
  el('sub-add-search').value = '';
  el('sub-add-name').value = '';
  set('sub-add-freq', Subscriptions.FREQ_ORDER.map(k =>
    `<option value="${k}" ${k === 'monthly' ? 'selected' : ''}>${Subscriptions.FREQS[k].label}</option>`).join(''));
  renderSubAddList();
  el('modal-sub-add').classList.remove('hidden');
  refreshIcons();
}

function closeSubAddModal() {
  el('modal-sub-add').classList.add('hidden');
}

function renderSubAddList() {
  const q = el('sub-add-search').value.trim().toLowerCase();
  const subs = new Set(Data.getSubscriptions(todayIso()).filter(i => i.kind === 'subscription' && i.userStatus !== 'dismissed').map(i => i.key));
  const list = Subscriptions.merchants(Data.get().transactions)
    .filter(m => !subs.has(m.key) && (!q || m.name.toLowerCase().includes(q) || m.key.includes(q)))
    .slice(0, 60);
  set('sub-add-list', list.length ? list.map(m =>
    `<button type="button" role="radio" aria-checked="${m.key === S.subAddKey}" class="sub-pick${m.key === S.subAddKey ? ' selected' : ''}" data-key="${escHtml(m.key)}" onclick="pickSubAdd(this.dataset.key)">
      <span class="sub-pick-main"><strong>${escHtml(m.name)}</strong><span class="muted small">${m.count} addebit${m.count === 1 ? 'o' : 'i'} · ultimo ${fmtDay(m.lastDate)}</span></span>
      <span class="sub-pick-amount">${fmt(m.lastAmount)}</span>
    </button>`).join('')
    : `<div class="muted small sub-pick-empty">Nessun esercente trovato</div>`);
}

function pickSubAdd(key) {
  S.subAddKey = key;
  // Suggest the frequency the charges already follow, if any
  const m = Subscriptions.merchants(Data.get().transactions).find(x => x.key === key);
  const detected = findSub(key);
  if (detected) el('sub-add-freq').value = detected.frequency;
  else if (m && m.count === 1) el('sub-add-freq').value = 'monthly';
  renderSubAddList();
}

async function handleSaveSubAdd(e) {
  e.preventDefault();
  if (!S.subAddKey) { showToast("Scegli prima un esercente", 'warning'); return; }
  const key = S.subAddKey;
  await Data.setSubscriptionPref(key, { status: 'confirmed', manual: true, frequency: el('sub-add-freq').value,
    name: el('sub-add-name').value });
  closeSubAddModal();
  S.subTab = 'subscription';
  renderSubscriptions();
  const item = findSub(key);
  showToast(`"${item ? item.name : key}" aggiunto agli abbonamenti`, 'success');
}

// ── SINGLE EXPENSE MODAL ──────────────────────────────────────
function openAddExpenseModal(walletId) {
  const cats = Data.getCategories();
  set('exp-category', cats.map(c => `<option value="${c}">${c}</option>`).join(''));
  set('exp-wallet', walletOptionsHtml(typeof walletId === 'string' ? walletId : ''));

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
  const walletId = el('exp-wallet').value;

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
  if (walletId) newTx.walletId = walletId;

  await Data.addTransactions([newTx]);
  closeAddExpenseModal();
  showToast('Spesa salvata su Firebase!', 'success');

  if (S.view !== 'wallets') {
    S.year = year;
    S.month = parseInt(dateStr.substring(5, 7));
  }
  navigate(S.view);
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

  await Data.updateTransaction(id, { notes });
  closeNoteModal();
  showToast('Nota salvata!', 'success');
  navigate(S.view);
}


// ── EDIT TX MODAL ────────────────────────────────────────────────
function openEditTxModal(id) {
  const txs = Data.getTransactions({});
  const t = txs.find(item => item.id === id);
  if (!t) return;

  const cats = Data.getCategories();
  set('edit-tx-category', cats.map(c => `<option value="${c}" ${c === t.category ? 'selected' : ''}>${c}</option>`).join(''));

  el('edit-tx-id').value = id;
  el('edit-tx-date').value = t.date;
  el('edit-tx-type').value = t.type || (t.amountEUR < 0 ? 'Expense' : 'Income');
  el('edit-tx-desc').value = t.description;
  el('edit-tx-amount').value = Math.abs(t.amount || t.amountEUR);
  el('edit-tx-currency').value = t.currency || 'EUR';
  el('edit-tx-source').value = t.source;
  el('edit-tx-notes').value = t.notes || '';
  set('edit-tx-wallet', walletOptionsHtml(t.walletId || ''));

  el('modal-edit-tx').classList.remove('hidden');
  el('edit-tx-desc').focus();
}

function closeEditTxModal() {
  el('modal-edit-tx').classList.add('hidden');
}

async function handleEditTx(e) {
  e.preventDefault();
  const id       = el('edit-tx-id').value;
  const dateStr  = el('edit-tx-date').value;
  const type     = el('edit-tx-type').value;
  const desc     = el('edit-tx-desc').value;
  const rawAmt   = parseFloat(el('edit-tx-amount').value);
  const currency = el('edit-tx-currency').value;
  const category = el('edit-tx-category').value;
  const source   = el('edit-tx-source').value;
  const notes    = el('edit-tx-notes').value;
  const walletId = el('edit-tx-wallet').value;

  if (!desc || isNaN(rawAmt) || rawAmt <= 0) return;

  let rate = 1.0;
  if (currency === 'USD') {
    rate = Data.getWeightedAverageRate() || S.imp.manualRate || 1.16;
  }
  const amtEUR = currency === 'EUR' ? rawAmt : parseFloat((rawAmt / rate).toFixed(2));
  const finalAmtEUR = type === 'Income' ? Math.abs(amtEUR) : -Math.abs(amtEUR);
  const finalAmt    = type === 'Income' ? Math.abs(rawAmt) : -Math.abs(rawAmt);

  const year  = parseInt(dateStr.substring(0, 4));
  const month = dateStr.substring(0, 7);

  await Data.updateTransaction(id, {
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
    notes,
    walletId: walletId || undefined
  });

  closeEditTxModal();
  showToast('Transazione modificata!', 'success');

  if (S.view !== 'wallets') {
    S.year = year;
    S.month = parseInt(dateStr.substring(5, 7));
  }
  navigate(S.view);
}

function txPage(p) { S.txFilter.page = p; renderTransactions(); }

function filterTransactions() {
  S.txFilter.search   = el('tx-search').value;
  S.txFilter.category = el('tx-filter-category').value;
  S.txFilter.source   = el('tx-filter-source').value;
  S.txFilter.year     = el('tx-filter-year').value;
  S.txFilter.wallet   = el('tx-filter-wallet').value;
  S.txFilter.page     = 0;
  S.txSelected.clear();
  renderTransactions();
}

// ── Bulk selection / wallet assignment (Transactions view) ────
function toggleTxSelect(id, on) {
  if (on) S.txSelected.add(id); else S.txSelected.delete(id);
  document.querySelectorAll('#tx-table-body .tx-cb').forEach(cb => {
    cb.closest('.tx-row').classList.toggle('selected', cb.checked);
  });
  updateTxBulkBar();
}

function toggleTxSelectPage(on) {
  (S.txPageIds || []).forEach(id => on ? S.txSelected.add(id) : S.txSelected.delete(id));
  renderTransactions();
}

function selectAllFilteredTxs() {
  (S.txFiltered || []).forEach(id => S.txSelected.add(id));
  renderTransactions();
}

function clearTxSelection() {
  S.txSelected.clear();
  renderTransactions();
}

function updateTxBulkBar() {
  const n = S.txSelected.size;
  const pageIds = S.txPageIds || [];
  const pageAll = pageIds.length > 0 && pageIds.every(id => S.txSelected.has(id));
  const head = el('tx-select-page');
  head.checked = pageAll;
  head.indeterminate = !pageAll && pageIds.some(id => S.txSelected.has(id));

  el('tx-bulk-bar').classList.toggle('hidden', n === 0);
  el('view-transactions').classList.toggle('has-selection', n > 0);
  if (!n) return;
  const total = S.txSelected.size;
  const sum = Data.getTransactions({}).filter(t => S.txSelected.has(t.id))
    .reduce((s, t) => s + t.amountEUR, 0);
  setText('tx-bulk-count', `${total} selezionat${total === 1 ? 'a' : 'e'} · ${fmt(sum)}`);

  const filtered = S.txFiltered || [];
  const moreBtn = el('tx-select-all-filtered');
  const allFiltered = filtered.every(id => S.txSelected.has(id));
  moreBtn.classList.toggle('hidden', allFiltered || !pageAll);
  moreBtn.textContent = `Seleziona tutte le ${filtered.length} transazioni filtrate`;

  const sel = el('tx-bulk-wallet');
  const prev = sel.value || S.bulkWalletId || '';
  sel.innerHTML = `<option value="" disabled ${prev ? '' : 'selected'}>Scegli wallet…</option>` +
    Data.getWallets().map(w => `<option value="${w.id}" ${w.id === prev ? 'selected' : ''}>${escHtml(w.name)}</option>`).join('');
}

async function bulkAssignWallet(walletId) {
  const ids = [...S.txSelected];
  if (!ids.length) return;
  if (walletId === undefined) {
    walletId = el('tx-bulk-wallet').value;
    if (!walletId) { showToast('Scegli un wallet', 'warning'); return; }
  }
  const n = await Data.assignWallet(ids, walletId);
  S.txSelected.clear();
  const w = walletId ? Data.getWallet(walletId) : null;
  showToast(w ? `${n} transazioni assegnate a "${w.name}"` : `${n} transazioni rimosse dal wallet`, 'success');
  renderTransactions();
}

// From a wallet page: open Transactions showing unassigned expenses, wallet preselected
function pickTxsForWallet(walletId) {
  S.bulkWalletId = walletId;
  S.txFilter = { ...S.txFilter, wallet: '__none__', year: String(S.year), page: 0 };
  S.txSelected.clear();
  el('tx-filter-year').value = S.txFilter.year;
  navigate('transactions');
  showToast('Seleziona le spese e premi "Assegna al wallet"', 'info');
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
  const fx       = Data.shareFactors();
  const yearExp  = yearTxs.filter(t => t.amountEUR < 0).reduce((s,t) => s+Math.abs(Data.myAmount(t, fx)),0);
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

  // Balance chart with Forecast
  const bMode = S.balanceMode || 'monthly';
  el('balance-mode-monthly')?.classList.toggle('btn-primary', bMode === 'monthly');
  el('balance-mode-monthly')?.classList.toggle('btn-secondary', bMode !== 'monthly');
  el('balance-mode-daily')?.classList.toggle('btn-primary', bMode === 'daily');
  el('balance-mode-daily')?.classList.toggle('btn-secondary', bMode !== 'daily');
  const balForecastData = prepareBalanceForecastData(selYear, bMode);
  Charts.balanceLine('chart-balance', balForecastData, bMode);

  // Annual category table
  const annualCats = Data.getAnnualCategoryTotals(selYear);
  const budgets    = Data.getAllBudgets(`${selYear}-01`); // use Jan budget as reference
  const rows = Object.entries(annualCats).sort((a,b)=>b[1]-a[1]).map(([c,v]) => {
    const monthlyBud = budgets[c] || 0;
    const annualBud  = monthlyBud * 12;
    const pct        = annualBud > 0 ? ((v / annualBud) * 100).toFixed(0) : '—';
    const cls        = annualBud > 0 && v > annualBud ? 'negative' : '';
    return `<tr><td class="ct-cat"><span class="wallet-dot" style="--wc:${Charts.categoryStyle(c).color};margin-right:0.6rem"></span>${c}</td><td class="num" data-label="Speso">${fmtCompact(v)}</td>
      <td class="num" data-label="Budget annuo">${annualBud > 0 ? fmtCompact(annualBud) : '—'}</td>
      <td class="num ${cls}" data-label="Utilizzo">${pct === '—' ? '—' : pct + '%'}</td></tr>`;
  }).join('');
  set('an-cat-table-body', rows || `<tr><td colspan="4" class="empty-row">Nessuna spesa registrata nel ${selYear}</td></tr>`);
}

function prepareBalanceForecastData(year, mode = 'monthly') {
  const yr = parseInt(year);
  const settings = Data.getSettings();
  const initialBal = settings.initialBalance || 0;

  // Tutte le transazioni fino ad oggi (per calcolare saldo reale corrente)
  const allTxs = Data.getTransactions({}).filter(t => t.category !== '__exchange__');

  // Saldo reale al 1 gennaio dell'anno selezionato
  let balAtYearStart = initialBal;
  allTxs.filter(t => t.year < yr).forEach(t => balAtYearStart += t.amountEUR);

  const yearTxs = Data.getTransactions({ year: yr }).filter(t => t.category !== '__exchange__');
  const monthsWithTxs = new Set(yearTxs.map(t => t.month));
  const monthlyData = Data.getMonthlyTotals(yr);

  // Ultimo mese con dati reali
  let lastActualMonth = 0;
  for (let m = 1; m <= 12; m++) {
    const k = `${yr}-${String(m).padStart(2,'0')}`;
    if (monthsWithTxs.has(k)) lastActualMonth = m;
  }

  // Media mensile entrate dai mesi con dati (escluding zero-income months)
  let incSum = 0, incCount = 0;
  for (let m = 1; m <= 12; m++) {
    const k = `${yr}-${String(m).padStart(2,'0')}`;
    if (monthsWithTxs.has(k)) {
      const inc = monthlyData[k]?.income || 0;
      if (inc > 0) { incSum += inc; incCount++; }
    }
  }
  // Fallback: usa media dell'anno precedente se non ci sono entrate quest'anno
  if (incCount === 0) {
    const prevYearTxs = allTxs.filter(t => t.year === yr - 1 && t.amountEUR > 0);
    if (prevYearTxs.length > 0) {
      const prevMonths = new Set(prevYearTxs.map(t => t.month));
      incSum = prevYearTxs.reduce((s, t) => s + t.amountEUR, 0);
      incCount = prevMonths.size;
    }
  }
  const avgIncome = incCount > 0 ? (incSum / incCount) : 0;

  if (mode === 'monthly') {
    const labels = [];
    const realData = [];
    const forecastData = [];

    let currentBalance = balAtYearStart;
    let lastRealVal = null;

    for (let m = 1; m <= 12; m++) {
      const k = `${yr}-${String(m).padStart(2,'0')}`;
      const monthName = new Date(yr, m - 1).toLocaleDateString('it-IT', { month: 'short' });
      labels.push(monthName);

      if (m <= lastActualMonth && lastActualMonth > 0) {
        // Mese con dati reali
        const monthIncome = monthlyData[k]?.income || 0;
        const monthExp    = monthlyData[k]?.expenses || 0;
        currentBalance += (monthIncome - monthExp);
        realData.push(parseFloat(currentBalance.toFixed(2)));
        forecastData.push(null);
        if (m === lastActualMonth) lastRealVal = currentBalance;
      } else {
        // Mese futuro — proiezione da budget
        realData.push(null);
        // Collega la linea reale all'inizio della previsione
        if (forecastData.length > 0 && forecastData[forecastData.length - 1] === null && lastRealVal !== null) {
          forecastData[forecastData.length - 1] = parseFloat(lastRealVal.toFixed(2));
        }
        const monthBudgets = Data.getAllBudgets(k);
        const plannedExpenses = Object.entries(monthBudgets)
          .filter(([cat, v]) => cat !== 'Entrate' && cat !== 'Trasferimenti' && cat !== '__exchange__')
          .reduce((s, [cat, v]) => s + v, 0);
          
        const budgetedIncome = monthBudgets['Entrate'] || avgIncome;
        const projectedNet = budgetedIncome - plannedExpenses;
        
        currentBalance += projectedNet;
        forecastData.push(parseFloat(currentBalance.toFixed(2)));
      }
    }

    // Se tutti i mesi hanno dati reali, aggiunge comunque una proiezione per i mesi futuri
    const hasForecast = lastActualMonth < 12 && lastActualMonth > 0;
    return { labels, realData, forecastData, hasForecast, currentBalance: lastRealVal };
  } else {
    // Daily mode
    const sortedTxs = [...yearTxs].sort((a, b) => new Date(a.date) - new Date(b.date));
    const dateNet = {};
    sortedTxs.forEach(t => {
      dateNet[t.date] = (dateNet[t.date] || 0) + t.amountEUR;
    });

    const labels = [];
    const realData = [];
    const forecastData = [];

    let currentBalance = balAtYearStart;
    let lastRealVal = null;

    const dates = Object.keys(dateNet).sort();
    dates.forEach(d => {
      currentBalance += dateNet[d];
      const parts = d.split('-');
      labels.push(`${parts[2]}/${parts[1]}/${parts[0].slice(2)}`);
      realData.push(parseFloat(currentBalance.toFixed(2)));
      forecastData.push(null);
      lastRealVal = currentBalance;
    });

    for (let m = lastActualMonth + 1; m <= 12; m++) {
      if (m <= 0) continue;
      const k = `${yr}-${String(m).padStart(2,'0')}`;
      const monthName = new Date(yr, m - 1).toLocaleDateString('it-IT', { month: 'short' });
      labels.push(`Fine ${monthName}`);
      realData.push(null);
      if (forecastData.length > 0 && forecastData[forecastData.length - 1] === null && lastRealVal !== null) {
        forecastData[forecastData.length - 1] = parseFloat(lastRealVal.toFixed(2));
      }
      const monthBudgets = Data.getAllBudgets(k);
      const plannedExpenses = Object.entries(monthBudgets)
        .filter(([cat, v]) => cat !== 'Entrate' && cat !== 'Trasferimenti' && cat !== '__exchange__')
        .reduce((s, [cat, v]) => s + v, 0);
        
      const budgetedIncome = monthBudgets['Entrate'] || avgIncome;
      const projectedNet = budgetedIncome - plannedExpenses;
      
      currentBalance += projectedNet;
      forecastData.push(parseFloat(currentBalance.toFixed(2)));
    }

    return { labels, realData, forecastData, hasForecast: lastActualMonth < 12, currentBalance: lastRealVal };
  }
}

function calculateYearForecast(selYear) {
  const yr = parseInt(selYear);
  const monthlyData = Data.getMonthlyTotals(yr);
  const yearTxs = Data.getTransactions({ year: yr }).filter(t => t.category !== '__exchange__');

  const monthsWithTxs = new Set(yearTxs.map(t => t.month));

  let totalActualExp = 0;
  let totalRemainingBudget = 0;
  let totalActualInc = 0;

  const labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthlyExpActual = [];
  const monthlyExpForecast = [];
  const monthlyBalanceForecast = [];

  // Average monthly income from actual recorded months
  let incCount = 0;
  let incSum = 0;
  for (let m = 1; m <= 12; m++) {
    const k = `${yr}-${String(m).padStart(2,'0')}`;
    if (monthsWithTxs.has(k)) {
      const inc = monthlyData[k]?.income || 0;
      if (inc > 0) { incSum += inc; incCount++; }
    }
  }
  const avgIncome = incCount > 0 ? (incSum / incCount) : 0;

  // Track balance starting from settings initial balance
  const settings = Data.getSettings();
  let currentBalance = settings.initialBalance || 0;

  // Add all transactions prior to selected year
  const allPriorTxs = Data.getTransactions({}).filter(t => t.category !== '__exchange__' && t.year < yr);
  allPriorTxs.forEach(t => currentBalance += t.amountEUR);

  for (let m = 1; m <= 12; m++) {
    const k = `${yr}-${String(m).padStart(2,'0')}`;
    const budgets = Data.getAllBudgets(k);
    const monthPlannedBud = Object.values(budgets).reduce((s,v) => s + v, 0);

    const hasData = monthsWithTxs.has(k);
    const actExp = monthlyData[k]?.expenses || 0;
    const actInc = monthlyData[k]?.income || 0;

    let monthExp = 0;
    let monthInc = 0;

    if (hasData) {
      monthExp = actExp;
      monthInc = actInc;
      totalActualExp += actExp;
      totalActualInc += actInc;
      monthlyExpActual.push(actExp);
      monthlyExpForecast.push(null);
    } else {
      monthExp = monthPlannedBud;
      monthInc = avgIncome;
      totalRemainingBudget += monthPlannedBud;
      monthlyExpActual.push(null);
      monthlyExpForecast.push(monthPlannedBud);
    }

    currentBalance += (monthInc - monthExp);
    monthlyBalanceForecast.push(currentBalance);
  }

  const totalForecastExp = totalActualExp + totalRemainingBudget;

  return {
    totalActualExp,
    totalRemainingBudget,
    totalForecastExp,
    eoyBalance: currentBalance,
    labels,
    monthlyExpActual,
    monthlyExpForecast,
    monthlyBalanceForecast
  };
}

function setBalanceMode(mode) {
  S.balanceMode = mode;
  el('balance-mode-monthly')?.classList.toggle('btn-primary', mode === 'monthly');
  el('balance-mode-monthly')?.classList.toggle('btn-secondary', mode !== 'monthly');
  el('balance-mode-daily')?.classList.toggle('btn-primary', mode === 'daily');
  el('balance-mode-daily')?.classList.toggle('btn-secondary', mode !== 'daily');

  const years = Data.getAvailableYears();
  const selYear = parseInt(el('analytics-year')?.value || years[0] || new Date().getFullYear());
  const balForecastData = prepareBalanceForecastData(selYear, mode);
  Charts.balanceLine('chart-balance', balForecastData, mode);
}

// ── BUDGET VIEW ───────────────────────────────────────────────
function renderBudgetView() {
  if (!Data.get()) Data.load();
  const yr = S.year || new Date().getFullYear();
  const mo = S.month || (new Date().getMonth() + 1);
  const bgState = S.bgView || { mode: 'month', year: yr, month: mo };
  S.bgView = bgState;

  const modeSel = el('bg-mode-select');
  if (modeSel) modeSel.value = bgState.mode;

  const monthPicker = el('bg-month-picker');
  const copyBtn = el('bg-copy-def-btn');
  const resetBtn = el('bg-reset-btn');
  const ym = `${bgState.year}-${String(bgState.month).padStart(2,'0')}`;

  let budgets = {};
  let catActuals = {};
  if (bgState.mode === 'default') {
    if (monthPicker) monthPicker.style.display = 'none';
    if (copyBtn) copyBtn.style.display = 'none';
    if (resetBtn) resetBtn.style.display = 'none';
    budgets = Data.get().budgets.default || {};
  } else {
    if (monthPicker) monthPicker.style.display = 'flex';
    if (copyBtn) copyBtn.style.display = 'inline-flex';
    if (resetBtn) resetBtn.style.display = 'inline-flex';
    setText('bg-month-label', monthLabel(bgState.year, bgState.month));
    budgets = Data.getAllBudgets(ym);
    catActuals = Data.getCategoryTotals(ym);
  }

  const cats = Data.getCategories();
  let totalAllocated = 0;
  let totalSpent = 0;
  let overBudgetCount = 0;

  const rows = cats.map(c => {
    const bud = budgets[c] || 0;
    const spent = catActuals[c] || 0;
    const rem = bud - spent;
    totalAllocated += bud;
    totalSpent += spent;

    if (bud > 0 && spent > bud) overBudgetCount++;

    const pct = bud > 0 ? Math.min((spent / bud) * 100, 100).toFixed(0) : 0;
    const barCls = spent > bud && bud > 0 ? 'danger' : pct > 80 ? 'warning' : 'ok';
    const remCls = rem < 0 ? 'negative' : 'positive';

    return `<tr>
      <td class="bt-cat"><span class="wallet-dot" style="--wc:${Charts.categoryStyle(c).color};margin-right:0.6rem"></span><strong>${c}</strong></td>
      <td class="bt-input">
        <input type="number" class="input-sm bg-view-input" id="bg-view-${c.replace(/\s/g,'_')}"
          data-cat="${c}" value="${bud}" min="0" step="10" inputmode="decimal" oninput="updateLiveBgViewTotals()" aria-label="Budget ${c}">
      </td>
      <td class="mono bt-spent" data-label="Speso">${bgState.mode === 'month' ? fmtCompact(spent) : '—'}</td>
      <td class="mono bt-rem ${bgState.mode === 'month' ? remCls : ''}" data-label="Rimanente">${bgState.mode === 'month' ? fmtCompact(rem) : '—'}</td>
      <td class="bt-bar">
        ${bgState.mode === 'month' && bud > 0 ? `
          <div class="bt-bar-wrap">
            <div class="bar-track"><div class="bar-fill ${barCls}" style="width:${pct}%"></div></div>
            <span class="bt-pct">${pct}%</span>
          </div>
        ` : '<span class="muted small">—</span>'}
      </td>
    </tr>`;
  }).join('');

  set('bg-table-body', rows);

  // Update KPI Cards
  const remaining = totalAllocated - totalSpent;
  setText('bg-kpi-total', fmtCompact(totalAllocated));
  setText('bg-kpi-actual', bgState.mode === 'month' ? fmtCompact(totalSpent) : '—');
  setText('bg-kpi-remaining', bgState.mode === 'month' ? fmtCompact(remaining) : '—');
  setText('bg-kpi-over', bgState.mode === 'month' ? overBudgetCount : '—');

  if (el('bg-kpi-remaining')) {
    el('bg-kpi-remaining').className = `kpi-value ${remaining >= 0 ? 'positive' : 'negative'}`;
  }

  refreshIcons();
}

function updateLiveBgViewTotals() {
  let total = 0;
  document.querySelectorAll('.bg-view-input').forEach(inp => {
    total += parseFloat(inp.value) || 0;
  });
  setText('bg-kpi-total', fmtCompact(total));
}

function switchBgMode(mode) {
  if (!S.bgView) S.bgView = { mode: 'month', year: S.year, month: S.month };
  S.bgView.mode = mode;
  renderBudgetView();
}

function prevBgMonth() {
  if (!S.bgView) S.bgView = { mode: 'month', year: S.year, month: S.month };
  if (S.bgView.month === 1) { S.bgView.month = 12; S.bgView.year--; }
  else S.bgView.month--;
  renderBudgetView();
}

function nextBgMonth() {
  if (!S.bgView) S.bgView = { mode: 'month', year: S.year, month: S.month };
  if (S.bgView.month === 12) { S.bgView.month = 1; S.bgView.year++; }
  else S.bgView.month++;
  renderBudgetView();
}

function copyDefaultToCurrentBg() {
  const def = Data.get().budgets.default || {};
  const cats = Data.getCategories();
  cats.forEach(c => {
    const inp = el(`bg-view-${c.replace(/\s/g,'_')}`);
    if (inp) inp.value = def[c] || 0;
  });
  updateLiveBgViewTotals();
  showToast('Budget predefinito inserito nelle caselle', 'info');
}

async function resetCurrentBgMonth() {
  const bgState = S.bgView || { mode: 'month', year: S.year, month: S.month };
  const ym = `${bgState.year}-${String(bgState.month).padStart(2,'0')}`;
  if (!confirm(`Ripristinare il budget di ${monthLabel(bgState.year, bgState.month)} ai valori predefiniti?`)) return;
  await Data.resetMonthBudgets(ym);
  renderBudgetView();
  showToast('Budget mese ripristinato al predefinito', 'info');
}

async function saveBgViewBudgets() {
  const cats = Data.getCategories();
  const map  = {};
  cats.forEach(c => {
    const inp = el(`bg-view-${c.replace(/\s/g,'_')}`);
    if (inp) map[c] = parseFloat(inp.value) || 0;
  });

  const bgState = S.bgView || { mode: 'month', year: S.year, month: S.month };
  const ym = `${bgState.year}-${String(bgState.month).padStart(2,'0')}`;

  if (bgState.mode === 'default') {
    await Data.setDefaultBudgets(map);
    showToast('Budget predefinito salvato su Firebase!', 'success');
  } else {
    await Data.setMonthBudgets(ym, map);
    showToast(`Budget per ${monthLabel(bgState.year, bgState.month)} salvato su Firebase!`, 'success');
  }
}

// ── SETTINGS ──────────────────────────────────────────────────
function renderSettings() {
  const cats     = Data.getCategories();
  // github.js is no longer loaded since the Firebase migration; keep the page working without it
  const ghCfg    = typeof GitHub !== 'undefined' ? GitHub.getConfig() : {};
  const settings = Data.getSettings();

  // Categories list
  const catList = cats.map(c => `
    <div class="cat-item">
      <span>${c}</span>
      <button class="btn-icon danger" onclick="deleteCategory('${c}')" title="Elimina categoria"><i data-lucide="x" class="lucide-icon icon-xs"></i></button>
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
  refreshIcons();
}



async function addCategory() {
  const name = el('new-cat-input').value.trim();
  if (!name) { showToast('Inserisci un nome valido','warning'); return; }
  await Data.addCategory(name);
  el('new-cat-input').value = '';
  renderSettings();
  showToast(`Categoria "${name}" aggiunta`,'success');
}

async function deleteCategory(name) {
  if (!confirm(`Eliminare la categoria "${name}"? Le transazioni associate manterranno il vecchio valore.`)) return;
  await Data.deleteCategory(name);
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
  const btn = el('sync-pull-btn');
  if (btn) btn.disabled = true;
  try {
    if (GoogleDrive.isConfigured()) {
      const res = await GoogleDrive.pull();
      if (res && res.data) {
        Data.set(res.data);
        showToast('Dati aggiornati da Google Drive', 'success');
        navigate(S.view);
      }
    } else if (GitHub.isConfigured()) {
      const result = await GitHub.pull();
      if (result) {
        Data.setData(result.data);
        showToast('Dati aggiornati da GitHub', 'success');
        navigate(S.view);
      } else {
        showToast('File data.json non trovato su GitHub', 'warning');
      }
    } else {
      showToast('Nessuna opzione di sincronizzazione (GitHub o Drive) configurata', 'warning');
    }
  } catch(e) { showToast('Pull fallito: ' + e.message, 'error'); }
  finally { if (btn) btn.disabled = false; }
}

async function syncPush() {
  const btn = el('sync-push-btn');
  if (btn) btn.disabled = true;
  try {
    if (GoogleDrive.isConfigured()) {
      await GoogleDrive.push(Data.get());
      showToast('Dati inviati a Google Drive', 'success');
    } else if (GitHub.isConfigured()) {
      await GitHub.push(Data.get());
      showToast('Dati inviati a GitHub', 'success');
    } else {
      showToast('Nessuna opzione di sincronizzazione (GitHub o Drive) configurata', 'warning');
    }
  } catch(e) { showToast('Push fallito: ' + e.message, 'error'); }
  finally { if (btn) btn.disabled = false; }
}

async function headerSync() {
  const btn = el('header-sync-btn');
  if (btn) btn.classList.add('spinning');
  try {
    if (GoogleDrive.isConfigured()) {
      await GoogleDrive.push(Data.get());
      showToast('Sync su Drive completato', 'success');
    } else if (GitHub.isConfigured()) {
      await GitHub.push(Data.get());
      showToast('Sync su GitHub completato', 'success');
    } else {
      showToast('Nessun cloud configurato', 'warning');
    }
  } catch(e) { showToast('Sync fallito: ' + e.message, 'error'); }
  finally { if (btn) btn.classList.remove('spinning'); }
}

async function saveAccountSettings() {
  const bal = parseFloat(el('initial-balance').value) || 0;
  await Data.updateSettings({ initialBalance: bal });
  showToast('Impostazioni salvate su Firebase!', 'success');
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
    r.onload = async e => {
      try {
        showToast('Importazione su Firebase in corso…', 'info');
        await Data.importJSON(e.target.result);
        showToast('Dati importati su Firebase!', 'success');
        navigate(S.view);
      } catch(err) { showToast('File non valido: ' + err.message, 'error'); }
    };
    r.readAsText(f);
  };
  inp.click();
}

async function clearAllData() {
  if (!confirm('Eliminare TUTTI i dati? Questa azione non è reversibile.')) return;
  showToast('Eliminazione in corso…', 'info');
  await Data.clearAll();
  showToast('Tutti i dati eliminati', 'info');
  navigate('dashboard');
}

async function migrateFromDataJson() {
  if (!confirm('Caricare le 416 transazioni da data.json su Firebase?\n\nQuesto aggiungerà i dati mantenendo quelli già presenti (nessuna sovrascrittura di transazioni duplicate).')) return;

  const btn = el('migrate-data-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Caricamento…'; }

  try {
    showToast('Recupero data.json…', 'info');
    const res = await fetch('data.json?v=' + Date.now());
    if (!res.ok) throw new Error('data.json non trovato (status ' + res.status + ')');
    const json = await res.json();

    if (!json.transactions || !json.transactions.length) {
      throw new Error('Nessuna transazione trovata in data.json');
    }

    showToast(`Caricamento di ${json.transactions.length} transazioni su Firebase…`, 'info');

    // Add transactions without overwriting existing ones (dedup by id)
    const added = await Data.addTransactions(json.transactions);

    // Save categories, exchange rates and settings if not already set
    if (json.exchangeRates && json.exchangeRates.length) {
      await Data.addExchangeRates(json.exchangeRates);
    }

    // Merge budgets
    if (json.budgets && json.budgets.default) {
      await Data.setDefaultBudgets(json.budgets.default);
    }

    showToast(`✅ ${added} transazioni caricate su Firebase!`, 'success');
    navigate(S.view);
  } catch (e) {
    showToast('Errore migrazione: ' + e.message, 'error');
    console.error('migrateFromDataJson error:', e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Carica da data.json → Firebase'; }
  }
}

// ── Password ──────────────────────────────────────────────────
async function handleChangePassword() {
  const curr = el('curr-password').value;
  const nw   = el('new-password').value;
  const conf = el('conf-password').value;
  if (!curr || !nw || !conf) { showToast('Compila tutti i campi', 'warning'); return; }
  if (nw !== conf) { showToast('Le password non corrispondono', 'warning'); return; }
  try {
    await Auth.changePassword(curr, nw);
    el('curr-password').value = el('new-password').value = el('conf-password').value = '';
    showToast('Password aggiornata con successo', 'success');
  } catch (err) {
    showToast('Errore: ' + err.message, 'error');
  }
}

// ── LOGIN & SETUP ─────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const email = el('login-email').value.trim();
  const pw    = el('login-pw').value;
  const btn   = el('login-btn');
  btn.disabled = true;
  btn.textContent = 'Accesso...';
  try {
    await Auth.login(email, pw);
    // onAuthStateChanged handles navigation
  } catch (err) {
    const msgs = {
      'auth/user-not-found':     'Account non trovato',
      'auth/wrong-password':     'Password errata',
      'auth/invalid-email':      'Email non valida',
      'auth/invalid-credential': 'Credenziali errate'
    };
    showToast(msgs[err.code] || 'Login fallito: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Accedi';
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const email = el('setup-email').value.trim();
  const pw    = el('setup-pw').value;
  const conf  = el('setup-confirm').value;
  if (!email)        { showToast('Inserisci la tua email', 'warning'); return; }
  if (!pw)           { showToast('Inserisci una password', 'warning'); return; }
  if (pw !== conf)   { showToast('Le password non corrispondono', 'warning'); return; }
  if (pw.length < 6) { showToast('Password troppo corta (min 6 caratteri)', 'warning'); return; }
  try {
    await Auth.signup(email, pw);
    showToast('Account creato! Benvenuto 🎉', 'success');
  } catch (err) {
    const msgs = {
      'auth/email-already-in-use': 'Email già registrata — prova ad accedere',
      'auth/invalid-email':        'Email non valida',
      'auth/weak-password':        'Password troppo debole'
    };
    showToast(msgs[err.code] || 'Registrazione fallita: ' + err.message, 'error');
  }
}

async function logout() {
  Data.cleanup();
  await Auth.logout();
  // onAuthStateChanged automatically switches to login screen
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
    case 'satispay':    return '<span class="src-badge satispay" title="Satispay">SP</span>';
    default:            return '<span class="src-badge other">—</span>';
  }
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Sidebar toggle ────────────────────────────────────────────
function toggleSidebar() {
  const sidebar  = el('sidebar');
  const overlay  = el('sidebar-overlay');
  const isMobile = window.innerWidth <= MOBILE_BP;

  if (isMobile) {
    sidebar.classList.toggle('mobile-open');
    overlay?.classList.toggle('visible');
  } else {
    sidebar.classList.toggle('collapsed');
    el('main-content').classList.toggle('sidebar-collapsed');
  }
}

function closeMobileSheet() {
  el('sidebar')?.classList.remove('mobile-open');
  el('sidebar-overlay')?.classList.remove('visible');
}

// Close the top-most open modal (or the mobile sheet)
function closeTopLayer() {
  const open = [...document.querySelectorAll('.modal-overlay:not(.hidden)')];
  if (open.length) { open[open.length - 1].classList.add('hidden'); return; }
  closeMobileSheet();
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
  // Chart.js colours follow the CSS theme
  if (typeof Charts !== 'undefined') Charts.applyTheme();
}

function updateThemeButton(theme) {
  const lightIcon = el('theme-icon-light');
  const darkIcon  = el('theme-icon-dark');
  const toggleBtn = el('theme-toggle-btn');
  if (!toggleBtn) return;
  if (theme === 'dark') {
    if (lightIcon) lightIcon.style.display = 'inline-block';
    if (darkIcon)  darkIcon.style.display  = 'none';
    toggleBtn.querySelector('span:not(.nav-icon)').textContent = 'Tema chiaro';
  } else {
    if (lightIcon) lightIcon.style.display = 'none';
    if (darkIcon)  darkIcon.style.display  = 'inline-block';
    toggleBtn.querySelector('span:not(.nav-icon)').textContent = 'Tema scuro';
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
document.addEventListener('DOMContentLoaded', () => {
  if (typeof lucide !== 'undefined') lucide.createIcons();
  initTheme();

  // Show loading screen while Firebase determines auth state
  showScreen('loading');

  // Firebase auth state listener — drives all navigation
  fbAuth.onAuthStateChanged(async (user) => {
    if (user) {
      // Signed in — load user data
      showScreen('loading');
      try {
        await Data.init(user.uid);
      } catch(e) {
        console.error('Data init failed:', e);
        showToast('Errore nel caricamento dati', 'error');
      }

      // Set default view to latest month with transactions
      const months = Data.getAvailableMonths();
      if (months.length > 0) {
        const parts = months[0].split('-');
        if (parts.length === 2) {
          S.year  = parseInt(parts[0]);
          S.month = parseInt(parts[1]);
        }
      }

      showScreen('app');
      navigate('dashboard');
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } else {
      // Signed out
      Data.cleanup();
      showScreen('login');
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  });

  // ── Event bindings ──────────────────────────────────────
  // Auth
  el('login-form')?.addEventListener('submit', handleLogin);
  el('show-setup-link')?.addEventListener('click', e => { e.preventDefault(); showScreen('setup'); if (typeof lucide !== 'undefined') lucide.createIcons(); });
  el('setup-form')?.addEventListener('submit', handleSignup);
  el('show-login-link')?.addEventListener('click', e => { e.preventDefault(); showScreen('login'); });
  el('forgot-pw-link')?.addEventListener('click', async e => {
    e.preventDefault();
    const email = el('login-email').value.trim() || prompt('Inserisci la tua email per il reset password:');
    if (!email) return;
    try {
      await Auth.sendPasswordReset(email);
      showToast('Email di reset inviata! Controlla la tua casella.', 'success');
    } catch(err) {
      showToast('Errore: ' + err.message, 'error');
    }
  });
  el('logout-btn')?.addEventListener('click', logout);

  // Theme & sidebar
  el('theme-toggle-btn')?.addEventListener('click', toggleTheme);
  el('sidebar-toggle')?.addEventListener('click', toggleSidebar);
  el('sidebar-overlay')?.addEventListener('click', toggleSidebar);

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

  // Mobile tab bar: "Altro" opens the full menu as a bottom sheet
  document.querySelectorAll('.tab-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      if (link.dataset.view === 'more') toggleSidebar();
      else navigate(link.dataset.view);
    });
  });

  // Modals: close on backdrop click and Escape
  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('mousedown', e => { if (e.target === ov) ov.classList.add('hidden'); });
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTopLayer(); });
  window.addEventListener('resize', () => { if (window.innerWidth > MOBILE_BP) closeMobileSheet(); });

  // Import dropzones
  setupImportDropzone();

  // Import controls
  el('imp-next-1')?.addEventListener('click', () => {
    const hasEur = S.imp.eurParsed?.transactions?.length > 0;
    const hasUsd = S.imp.usdParsed?.transactions?.length > 0;
    const hasInt = S.imp.intesaTxs?.length > 0;
    const hasSat = S.imp.satispayTxs?.length > 0;
    // Re-run parsing merge, categories and duplicate check with the files now loaded
    S.imp.merged = []; S.imp.page = 0;
    if (S.imp.files.some(f => !f.source || f.error)) { showToast('Alcuni file non sono riconosciuti: scegli la fonte o rimuovili', 'warning'); return; }
    if (!hasEur && !hasUsd && !hasInt && !hasSat) { showToast('Carica almeno un file valido prima di proseguire', 'warning'); return; }
    showImportStep(2);
  });
  el('imp-back-2')?.addEventListener('click', () => showImportStep(1));
  el('imp-next-2')?.addEventListener('click', () => {
    const noEur = S.imp.merged.filter(t => t._include && t.amountEUR === null);
    if (noEur.length > 0) { showToast(`${noEur.length} transazioni senza EUR. Inserisci il tasso.`, 'warning'); return; }
    showImportStep(3);
  });
  el('imp-back-3')?.addEventListener('click', () => showImportStep(2));
  el('imp-confirm-btn')?.addEventListener('click', () => confirmImport());
  el('imp-reset-btn')?.addEventListener('click', () => { resetImport(); showImportStep(1); });

  // Bulk category & manual rate
  el('apply-bulk-cat')?.addEventListener('click', applyBulkCategory);
  el('select-all-imp')?.addEventListener('change', e => {
    document.querySelectorAll('.imp-cb').forEach(cb => cb.checked = e.target.checked);
  });
  el('apply-manual-rate')?.addEventListener('click', applyManualRate);

  // Dashboard filters
  el('dash-tx-search')?.addEventListener('input', e => { S.dashFilter.search = e.target.value; renderDashboard(); });
  el('dash-tx-cat')?.addEventListener('change', e => { S.dashFilter.category = e.target.value; renderDashboard(); });

  // Modal forms
  el('add-expense-form')?.addEventListener('submit', handleSaveSingleExpense);
  el('edit-note-form')?.addEventListener('submit', handleSaveNote);
  el('edit-tx-form')?.addEventListener('submit', handleEditTx);
  el('wallet-form')?.addEventListener('submit', handleSaveWallet);
  el('sub-add-form')?.addEventListener('submit', handleSaveSubAdd);
  el('sub-add-search')?.addEventListener('input', renderSubAddList);

  // Transactions filters
  el('tx-search')?.addEventListener('input', filterTransactions);
  el('tx-filter-category')?.addEventListener('change', filterTransactions);
  el('tx-filter-source')?.addEventListener('change', filterTransactions);
  el('tx-filter-year')?.addEventListener('change', filterTransactions);
  el('tx-filter-wallet')?.addEventListener('change', filterTransactions);
  el('tx-select-page')?.addEventListener('change', e => toggleTxSelectPage(e.target.checked));
  el('tx-select-all-filtered')?.addEventListener('click', selectAllFilteredTxs);

  // Settings
  el('save-budget-btn')?.addEventListener('click', saveBudgets);
  el('add-cat-btn')?.addEventListener('click', addCategory);
  el('new-cat-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') addCategory(); });
  el('save-gh-btn')?.addEventListener('click', saveGitHubConfig);
  el('gh-test-btn')?.addEventListener('click', testGitHub);
  el('sync-pull-btn')?.addEventListener('click', syncPull);
  el('sync-push-btn')?.addEventListener('click', syncPush);
  el('change-pw-btn')?.addEventListener('click', handleChangePassword);
  el('export-data-btn')?.addEventListener('click', exportData);
  el('import-data-btn')?.addEventListener('click', importDataFile);
  el('clear-all-btn')?.addEventListener('click', clearAllData);
  el('save-account-btn')?.addEventListener('click', saveAccountSettings);
});
