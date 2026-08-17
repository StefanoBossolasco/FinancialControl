// ============================================================
// DATA MODULE — localStorage persistence + all data helpers
// ============================================================
const Data = (() => {
  const KEY = 'fc_data';

  const DEFAULTS = {
    version: '1.0.0',
    transactions: [],
    budgets: { default: {} },
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

  // ── Load / Save ──────────────────────────────────────────
  function load() {
    const raw = localStorage.getItem(KEY);
    _data = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(DEFAULTS));
    return _data;
  }

  async function init() {
    load();
    // If localStorage has no transactions, fetch data.json from server
    if (!_data.transactions || _data.transactions.length === 0) {
      try {
        const res = await fetch('data.json?v=' + Date.now());
        if (res.ok) {
          const json = await res.json();
          if (json && json.transactions && json.transactions.length > 0) {
            _data = { ...DEFAULTS, ...json };
            save();
          }
        }
      } catch(e) {
        console.warn('Impossibile caricare data.json automaticamente:', e);
      }
    }
    return _data;
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(_data));
  }

  function get() { return _data; }

  function setData(d) { _data = d; save(); }

  function exportJSON() {
    return JSON.stringify(_data, null, 2);
  }

  function importJSON(jsonStr) {
    const parsed = JSON.parse(jsonStr);
    _data = { ...DEFAULTS, ...parsed };
    save();
  }

  function clearAll() {
    _data = JSON.parse(JSON.stringify(DEFAULTS));
    save();
  }

  // ── Transactions ─────────────────────────────────────────
  function getTransactions(filters = {}) {
    let txs = [..._data.transactions];
    if (filters.month)    txs = txs.filter(t => t.month === filters.month);
    if (filters.year)     txs = txs.filter(t => t.year  === parseInt(filters.year));
    if (filters.category) txs = txs.filter(t => t.category === filters.category);
    if (filters.source)   txs = txs.filter(t => t.source   === filters.source);
    if (filters.search) {
      const s = filters.search.toLowerCase();
      txs = txs.filter(t => t.description.toLowerCase().includes(s));
    }
    if (filters.type === 'expense') txs = txs.filter(t => t.amountEUR < 0);
    if (filters.type === 'income')  txs = txs.filter(t => t.amountEUR > 0);
    return txs.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  function addTransactions(transactions) {
    const existing = new Set(_data.transactions.map(t => t.id));
    const added = transactions.filter(t => !existing.has(t.id));
    _data.transactions.push(...added);
    save();
    return added.length;
  }

  function updateTransaction(id, updates) {
    const idx = _data.transactions.findIndex(t => t.id === id);
    if (idx >= 0) { _data.transactions[idx] = { ..._data.transactions[idx], ...updates }; save(); return true; }
    return false;
  }

  function deleteTransaction(id) {
    _data.transactions = _data.transactions.filter(t => t.id !== id);
    save();
  }

  // ── Budgets ──────────────────────────────────────────────
  function getAllBudgets(yearMonth) {
    const def   = _data.budgets.default || {};
    const month = _data.budgets[yearMonth] || {};
    const result = {};
    _data.categories.forEach(cat => {
      result[cat] = month[cat] !== undefined ? month[cat] : (def[cat] || 0);
    });
    return result;
  }

  function setDefaultBudget(category, amount) {
    if (!_data.budgets.default) _data.budgets.default = {};
    _data.budgets.default[category] = amount;
    save();
  }

  function setDefaultBudgets(map) {
    _data.budgets.default = { ...(_data.budgets.default || {}), ...map };
    save();
  }

  // ── Exchange Rates ────────────────────────────────────────
  function addExchangeRates(rates) {
    _data.exchangeRates.push(...rates);
    save();
  }

  function getExchangeRates() { return _data.exchangeRates; }

  // Weighted average of ALL stored exchange rates (USD per 1 EUR)
  function getWeightedAverageRate() {
    const rates = _data.exchangeRates;
    if (!rates.length) return null;
    const totalEur = rates.reduce((s, r) => s + r.eurSpent, 0);
    const totalUsd = rates.reduce((s, r) => s + r.usdReceived, 0);
    return totalEur > 0 ? totalUsd / totalEur : null;
  }

  // ── Categories ────────────────────────────────────────────
  function getCategories() { return _data.categories; }

  function addCategory(name) {
    if (!_data.categories.includes(name)) { _data.categories.push(name); save(); }
  }

  function deleteCategory(name) {
    _data.categories = _data.categories.filter(c => c !== name);
    save();
  }

  // ── Analytics helpers ─────────────────────────────────────
  function getMonthlyTotals(year) {
    const months = {};
    for (let m = 1; m <= 12; m++) {
      const k = `${year}-${String(m).padStart(2,'0')}`;
      months[k] = { income: 0, expenses: 0, net: 0 };
    }
    _data.transactions
      .filter(t => t.year === year)
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
    _data.transactions
      .filter(t => t.month === yearMonth && t.amountEUR < 0)
      .forEach(t => { totals[t.category] = (totals[t.category] || 0) + Math.abs(t.amountEUR); });
    return totals;
  }

  function getAnnualCategoryTotals(year) {
    const totals = {};
    _data.transactions
      .filter(t => t.year === year && t.amountEUR < 0)
      .forEach(t => { totals[t.category] = (totals[t.category] || 0) + Math.abs(t.amountEUR); });
    return totals;
  }

  function getAvailableYears() {
    const years = new Set(_data.transactions.map(t => t.year));
    const arr = Array.from(years).filter(Boolean).sort((a, b) => b - a);
    if (!arr.length) arr.push(new Date().getFullYear());
    return arr;
  }

  function getAvailableMonths() {
    const months = new Set(_data.transactions.map(t => t.month));
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }

  function getSettings() { return _data.settings || {}; }
  function updateSettings(s) { _data.settings = { ...(_data.settings || {}), ...s }; save(); }

  return {
    init, load, save, get, setData, exportJSON, importJSON, clearAll,
    getTransactions, addTransactions, updateTransaction, deleteTransaction,
    getAllBudgets, setDefaultBudget, setDefaultBudgets,
    addExchangeRates, getExchangeRates, getWeightedAverageRate,
    getCategories, addCategory, deleteCategory,
    getMonthlyTotals, getCategoryTotals, getAnnualCategoryTotals,
    getAvailableYears, getAvailableMonths,
    getSettings, updateSettings
  };
})();
