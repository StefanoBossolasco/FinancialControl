const fs = require('fs');
const path = '/Users/stefanobossolasco/Documents/GitHub/FinancialControl/js/app.js';
let content = fs.readFileSync(path, 'utf8');

const startStr = "document.addEventListener('DOMContentLoaded',";
const startIdx = content.indexOf(startStr);

if (startIdx === -1) {
  console.log("Could not find start");
  process.exit(1);
}

// Just slice off everything from startIdx to the end, since DOMContentLoaded is the last thing.
// Wait, is it the last thing?
let newBlock = `document.addEventListener('DOMContentLoaded', () => {
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

  // Import dropzones
  setupDropzone('dz-rev-eur', handleRevolutEUR);
  setupDropzone('dz-rev-usd', handleRevolutUSD);
  setupDropzone('dz-intesa',  handleIntesa);

  // Import controls
  el('imp-next-1')?.addEventListener('click', () => {
    const hasEur = S.imp.eurParsed?.transactions?.length > 0;
    const hasUsd = S.imp.usdParsed?.transactions?.length > 0;
    const hasInt = S.imp.intesaTxs?.length > 0;
    if (!hasEur && !hasUsd && !hasInt) { showToast('Carica almeno un file valido prima di proseguire', 'warning'); return; }
    showImportStep(2);
  });
  el('imp-back-2')?.addEventListener('click', () => showImportStep(1));
  el('imp-next-2')?.addEventListener('click', () => {
    const noEur = S.imp.merged.filter(t => t.amountEUR === null);
    if (noEur.length > 0) { showToast(\`\${noEur.length} transazioni senza EUR. Inserisci il tasso.\`, 'warning'); return; }
    showImportStep(3);
  });
  el('imp-back-3')?.addEventListener('click', () => showImportStep(2));
  el('imp-confirm-btn')?.addEventListener('click', confirmImport);
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
  el('change-pw-btn')?.addEventListener('click', handleChangePassword);
  el('export-data-btn')?.addEventListener('click', exportData);
  el('import-data-btn')?.addEventListener('click', importDataFile);
  el('clear-all-btn')?.addEventListener('click', clearAllData);
  el('save-account-btn')?.addEventListener('click', saveAccountSettings);
});
`;

let beforeContent = content.substring(0, startIdx);
fs.writeFileSync(path, beforeContent + newBlock);
console.log("Replaced DOMContentLoaded");
