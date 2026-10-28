// ============================================================
// DATA MODULE — Firestore + in-memory cache
// ============================================================
const Data = (() => {
  const DEFAULTS = {
    version: '1.0.0',
    transactions: [],
    budgets: { default: {} },
    wallets: [],
    exchangeRates: [],
    categories: [
      'Affitto & Casa','Spesa Alimentare','Ristoranti & Bar',
      'Trasporti & Mobilità','Viaggi & Vacanze','Abbigliamento & Shopping',
      'Salute & Farmacia','Sport & Fitness','Streaming & Abbonamenti',
      'Utenze & Domiciliazioni','Imposte & Tasse','Commissioni Bancarie',
      'Intrattenimento','Trasferimenti','Entrate','Altro'
    ],
    settings: { currency: 'EUR', initialBalance: 0 }
  };

  let _data = null;
  let _uid  = null;
  let _unsubTx = null;
  let _unsubWallets = null;

  const metaDoc   = () => fbDb.doc(`users/${_uid}/meta/main`);
  const txCol     = () => fbDb.collection(`users/${_uid}/transactions`);
  const txDoc     = (id) => fbDb.doc(`users/${_uid}/transactions/${id}`);
  const budgetDoc = (key) => fbDb.doc(`users/${_uid}/budgets/${key}`);
  const budgetCol = () => fbDb.collection(`users/${_uid}/budgets`);
  const walletCol = () => fbDb.collection(`users/${_uid}/wallets`);
  const walletDoc = (id) => fbDb.doc(`users/${_uid}/wallets/${id}`);

  function rerenderIfVisible() {
    if (typeof S !== 'undefined' && typeof navigate === 'function' && typeof showScreen !== 'undefined') {
      const screen = document.getElementById('screen-app');
      if (screen && !screen.classList.contains('hidden')) navigate(S.view);
    }
  }

  async function init(uid) {
    _uid  = uid;
    _data = JSON.parse(JSON.stringify(DEFAULTS));

    try {
      const snap = await metaDoc().get();
      if (snap.exists) {
        const d = snap.data();
        if (d.settings)      _data.settings      = { ..._data.settings, ...d.settings };
        if (d.categories)    _data.categories    = d.categories;
        if (d.exchangeRates) _data.exchangeRates = d.exchangeRates;
      }
    } catch(e) { console.warn('meta load failed:', e); }

    try {
      const snap = await txCol().get();
      _data.transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) { console.warn('tx load failed:', e); }

    try {
      const snap = await budgetCol().get();
      snap.docs.forEach(d => { _data.budgets[d.id] = d.data(); });
    } catch(e) { console.warn('budget load failed:', e); }

    try {
      const snap = await walletCol().get();
      _data.wallets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) { console.warn('wallet load failed:', e); }

    if (_unsubTx) _unsubTx();
    _unsubTx = txCol().onSnapshot(snap => {
      snap.docChanges().forEach(change => {
        const tx = { id: change.doc.id, ...change.doc.data() };
        if (change.type === 'added' || change.type === 'modified') {
          const i = _data.transactions.findIndex(t => t.id === tx.id);
          if (i >= 0) _data.transactions[i] = tx;
          else _data.transactions.push(tx);
        } else if (change.type === 'removed') {
          _data.transactions = _data.transactions.filter(t => t.id !== change.doc.id);
        }
      });
      rerenderIfVisible();
    }, err => console.warn('tx snapshot error:', err));

    if (_unsubWallets) _unsubWallets();
    _unsubWallets = walletCol().onSnapshot(snap => {
      if (snap.metadata.hasPendingWrites) return;
      _data.wallets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      rerenderIfVisible();
    }, err => console.warn('wallet snapshot error:', err));

    return _data;
  }

  function cleanup() {
    if (_unsubTx) { _unsubTx(); _unsubTx = null; }
    if (_unsubWallets) { _unsubWallets(); _unsubWallets = null; }
    _data = null;
    _uid  = null;
  }

  async function saveMeta() {
    if (!_uid) return;
    await metaDoc().set({
      settings:      _data.settings,
      categories:    _data.categories,
      exchangeRates: _data.exchangeRates
    });
  }

  function get() { return _data; }

  async function setData(d) {
    _data = { ...JSON.parse(JSON.stringify(DEFAULTS)), ...d };
    await saveMeta();
    let batch = fbDb.batch();
    let count = 0;
    for (const tx of _data.transactions) {
      batch.set(txDoc(tx.id), tx);
      if (++count >= 499) { await batch.commit(); batch = fbDb.batch(); count = 0; }
    }
    if (count > 0) await batch.commit();
    for (const [key, val] of Object.entries(_data.budgets)) {
      await budgetDoc(key).set(val);
    }
    for (const w of _data.wallets || []) {
      const { id, ...rest } = w;
      await walletDoc(id).set(rest);
    }
  }

  function getTransactions(filters = {}) {
    if (!_data) return [];
    let txs = [..._data.transactions];
    if (filters.month)    txs = txs.filter(t => t.month === filters.month);
    if (filters.year)     txs = txs.filter(t => t.year === parseInt(filters.year));
    if (filters.category) txs = txs.filter(t => t.category === filters.category);
    if (filters.source)   txs = txs.filter(t => t.source   === filters.source);
    if (filters.walletId) txs = txs.filter(t => t.walletId === filters.walletId);
    if (filters.search) {
      const s = filters.search.toLowerCase();
      txs = txs.filter(t => t.description.toLowerCase().includes(s) ||
        (t.notes && t.notes.toLowerCase().includes(s)));
    }
    if (filters.type === 'expense') txs = txs.filter(t => t.amountEUR < 0);
    if (filters.type === 'income')  txs = txs.filter(t => t.amountEUR > 0);
    return txs.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  async function addTransactions(transactions) {
    if (!_data) return 0;
    const existing = new Set(_data.transactions.map(t => t.id));
    const added = transactions.filter(t => !existing.has(t.id));
    _data.transactions.push(...added);
    let batch = fbDb.batch();
    let count = 0;
    for (const tx of added) {
      batch.set(txDoc(tx.id), tx);
      if (++count >= 499) { await batch.commit(); batch = fbDb.batch(); count = 0; }
    }
    if (count > 0) await batch.commit();
    return added.length;
  }

  async function updateTransaction(id, updates) {
    if (!_data) return false;
    const idx = _data.transactions.findIndex(t => t.id === id);
    if (idx < 0) return false;
    const merged = { ..._data.transactions[idx], ...updates };
    // An undefined value removes the field (e.g. walletId when unassigning)
    Object.keys(merged).forEach(k => { if (merged[k] === undefined) delete merged[k]; });
    _data.transactions[idx] = merged;
    await txDoc(id).set(merged);
    return true;
  }

  async function deleteTransaction(id) {
    if (!_data) return;
    _data.transactions = _data.transactions.filter(t => t.id !== id);
    await txDoc(id).delete();
  }

  function getAllBudgets(yearMonth) {
    if (!_data) return {};
    const def   = _data.budgets.default || {};
    const month = _data.budgets[yearMonth] || {};
    const result = {};
    (_data.categories || []).forEach(cat => {
      result[cat] = month[cat] !== undefined ? month[cat] : (def[cat] || 0);
    });
    return result;
  }

  async function setDefaultBudgets(map) {
    if (!_data) return;
    _data.budgets.default = { ...(_data.budgets.default || {}), ...map };
    await budgetDoc('default').set(_data.budgets.default);
  }

  async function setDefaultBudget(category, amount) {
    await setDefaultBudgets({ [category]: amount });
  }

  async function setMonthBudgets(yearMonth, map) {
    if (!_data) return;
    _data.budgets[yearMonth] = { ...(_data.budgets[yearMonth] || {}), ...map };
    await budgetDoc(yearMonth).set(_data.budgets[yearMonth]);
  }

  async function resetMonthBudgets(yearMonth) {
    if (!_data || !_data.budgets[yearMonth]) return;
    delete _data.budgets[yearMonth];
    await budgetDoc(yearMonth).delete();
  }

  async function addExchangeRates(rates) {
    if (!_data) return;
    _data.exchangeRates.push(...rates);
    await saveMeta();
  }

  function getExchangeRates() { return _data ? _data.exchangeRates : []; }

  function getWeightedAverageRate() {
    if (!_data) return null;
    const rates = _data.exchangeRates;
    if (!rates.length) return null;
    const totalEur = rates.reduce((s, r) => s + r.eurSpent, 0);
    const totalUsd = rates.reduce((s, r) => s + r.usdReceived, 0);
    return totalEur > 0 ? totalUsd / totalEur : null;
  }

  // ── Wallets ─────────────────────────────────────────────────
  // users/{uid}/wallets/{id}: { name, amount, color, startDate?, endDate?, notes?, createdAt }
  // Transactions reference a wallet through the optional `walletId` field.
  function getWallets() {
    if (!_data) return [];
    return [...(_data.wallets || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  function getWallet(id) {
    return _data ? (_data.wallets || []).find(w => w.id === id) || null : null;
  }

  async function saveWallet(wallet) {
    if (!_data) return null;
    const id = wallet.id || ('w_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6));
    const existing = getWallet(id);
    const doc = { createdAt: existing?.createdAt || new Date().toISOString() };
    for (const [k, v] of Object.entries(wallet)) {
      if (k !== 'id' && v !== undefined && v !== '' && v !== null) doc[k] = v;
    }
    _data.wallets = (_data.wallets || []).filter(w => w.id !== id).concat([{ id, ...doc }]);
    await walletDoc(id).set(doc);
    return id;
  }

  async function deleteWallet(id) {
    if (!_data) return;
    _data.wallets = (_data.wallets || []).filter(w => w.id !== id);
    const assigned = _data.transactions.filter(t => t.walletId === id);
    let batch = fbDb.batch();
    let count = 0;
    for (const tx of assigned) {
      delete tx.walletId;
      batch.update(txDoc(tx.id), { walletId: firebase.firestore.FieldValue.delete() });
      if (++count >= 499) { await batch.commit(); batch = fbDb.batch(); count = 0; }
    }
    batch.delete(walletDoc(id));
    await batch.commit();
  }

  function getWalletStats(id) {
    const wallet = getWallet(id);
    if (!wallet) return null;
    const txs = getTransactions({ walletId: id });
    const allocated = Number(wallet.amount) || 0;
    const spent   = txs.filter(t => t.amountEUR < 0).reduce((s, t) => s + Math.abs(t.amountEUR), 0);
    const credits = txs.filter(t => t.amountEUR > 0).reduce((s, t) => s + t.amountEUR, 0);
    const available = allocated + credits;
    const remaining = available - spent;
    const pctUsed = available > 0 ? (spent / available) * 100 : (spent > 0 ? Infinity : 0);
    const byCategory = {};
    txs.filter(t => t.amountEUR < 0)
      .forEach(t => { byCategory[t.category] = (byCategory[t.category] || 0) + Math.abs(t.amountEUR); });
    const status = remaining > 0.005 ? 'positive' : remaining < -0.005 ? 'negative' : 'zero';
    return { wallet, txs, allocated, spent, credits, available, remaining, pctUsed, byCategory, status };
  }

  function getCategories() { return _data ? _data.categories : []; }

  async function addCategory(name) {
    if (!_data || _data.categories.includes(name)) return;
    _data.categories.push(name);
    await saveMeta();
  }

  async function deleteCategory(name) {
    if (!_data) return;
    _data.categories = _data.categories.filter(c => c !== name);
    await saveMeta();
  }

  function getMonthlyTotals(year) {
    const months = {};
    const yr = parseInt(year);
    for (let m = 1; m <= 12; m++) {
      const k = `${yr}-${String(m).padStart(2,'0')}`;
      months[k] = { income: 0, expenses: 0, net: 0 };
    }
    if (!_data) return months;
    _data.transactions
      .filter(t => t.year === yr && t.category !== '__exchange__')
      .forEach(t => {
        const k = t.month;
        if (!months[k]) months[k] = { income: 0, expenses: 0, net: 0 };
        if (t.amountEUR > 0) months[k].income   += t.amountEUR;
        else                  months[k].expenses += Math.abs(t.amountEUR);
        months[k].net += t.amountEUR;
      });
    return months;
  }

  function getCategoryTotals(yearMonth) {
    const totals = {};
    if (!_data) return totals;
    _data.transactions
      .filter(t => t.month === yearMonth && t.category !== '__exchange__' && t.amountEUR < 0)
      .forEach(t => { totals[t.category] = (totals[t.category] || 0) + Math.abs(t.amountEUR); });
    return totals;
  }

  function getAnnualCategoryTotals(year) {
    const totals = {};
    if (!_data) return totals;
    const yr = parseInt(year);
    _data.transactions
      .filter(t => t.year === yr && t.category !== '__exchange__' && t.amountEUR < 0)
      .forEach(t => { totals[t.category] = (totals[t.category] || 0) + Math.abs(t.amountEUR); });
    return totals;
  }

  function getAvailableYears() {
    if (!_data) return [new Date().getFullYear()];
    const years = new Set(_data.transactions.map(t => t.year));
    const arr = Array.from(years).filter(Boolean).sort((a, b) => b - a);
    if (!arr.length) arr.push(new Date().getFullYear());
    return arr;
  }

  function getAvailableMonths() {
    if (!_data) return [];
    const months = new Set(_data.transactions.map(t => t.month));
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }

  function getSettings() { return _data ? (_data.settings || {}) : {}; }

  async function updateSettings(s) {
    if (!_data) return;
    _data.settings = { ...(_data.settings || {}), ...s };
    await saveMeta();
  }

  function exportJSON() { return JSON.stringify(_data, null, 2); }

  async function importJSON(jsonStr) {
    const parsed = JSON.parse(jsonStr);
    await setData({ ...JSON.parse(JSON.stringify(DEFAULTS)), ...parsed });
  }

  async function clearAllTransactions() {
    if (!_data || !_uid) return;
    _data.transactions = [];
    const snap = await txCol().get();
    let batch = fbDb.batch();
    let count = 0;
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      if (++count >= 499) { await batch.commit(); batch = fbDb.batch(); count = 0; }
    }
    if (count > 0) await batch.commit();
  }

  async function clearAll() {
    await clearAllTransactions();
    if (_data) { _data.budgets = { default: {} }; _data.wallets = []; _data.settings = DEFAULTS.settings; }
    await saveMeta();
    try {
      const snap = await budgetCol().get();
      const batch = fbDb.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    } catch(e) { console.warn('clearAll budgets:', e); }
    try {
      const snap = await walletCol().get();
      const batch = fbDb.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    } catch(e) { console.warn('clearAll wallets:', e); }
  }

  // Legacy compat
  async function save() { await saveMeta(); }
  function load() { return _data; }
  async function resetToDefaultData() { return false; }

  return {
    init, cleanup, get, setData, exportJSON, importJSON, clearAllTransactions, clearAll,
    save, load, resetToDefaultData,
    getTransactions, addTransactions, updateTransaction, deleteTransaction,
    getAllBudgets, setDefaultBudget, setDefaultBudgets, setMonthBudgets, resetMonthBudgets,
    addExchangeRates, getExchangeRates, getWeightedAverageRate,
    getCategories, addCategory, deleteCategory,
    getWallets, getWallet, saveWallet, deleteWallet, getWalletStats,
    getMonthlyTotals, getCategoryTotals, getAnnualCategoryTotals,
    getAvailableYears, getAvailableMonths,
    getSettings, updateSettings
  };
})();
