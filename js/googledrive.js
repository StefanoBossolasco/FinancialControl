// ============================================================
// GOOGLE DRIVE MODULE — Read/Write via Apps Script Web App
// ============================================================
const GoogleDrive = (() => {
  const CFG_KEY = 'fc_gdrive_config';

  function getConfig() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch { return {}; }
  }

  function setConfig(cfg) {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  }

  function isConfigured() {
    const cfg = getConfig();
    return !!(cfg.webAppUrl && cfg.webAppUrl.includes('script.google.com'));
  }

  async function ping() {
    const cfg = getConfig();
    if (!cfg.webAppUrl) throw new Error('Google Drive non configurato');
    const url = `${cfg.webAppUrl}?action=ping${cfg.token ? '&token=' + encodeURIComponent(cfg.token) : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  async function pull() {
    const cfg = getConfig();
    if (!cfg.webAppUrl) throw new Error('Google Drive non configurato');
    const url = `${cfg.webAppUrl}?action=read${cfg.token ? '&token=' + encodeURIComponent(cfg.token) : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return { data };
  }

  async function push(financialData) {
    const cfg = getConfig();
    if (!cfg.webAppUrl) throw new Error('Google Drive non configurato');
    const body = { action: 'write', data: financialData };
    if (cfg.token) body.token = cfg.token;
    const res = await fetch(cfg.webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    if (result.error) throw new Error(result.error);
    return result;
  }

  return { getConfig, setConfig, isConfigured, ping, pull, push };
})();
