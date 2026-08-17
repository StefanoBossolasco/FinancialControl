// ============================================================
// AUTH MODULE — password management via SHA-256 + sessionStorage
// ============================================================
const Auth = (() => {
  const HASH_KEY   = 'fc_password_hash';
  const SESSION_KEY = 'fc_session';
  const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 hours

  async function sha256(msg) {
    const buf = new TextEncoder().encode(msg);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function setPassword(password) {
    const hash = await sha256(password);
    localStorage.setItem(HASH_KEY, hash);
  }

  async function checkPassword(password) {
    const stored = localStorage.getItem(HASH_KEY);
    if (!stored) return false;
    const hash = await sha256(password);
    return hash === stored;
  }

  function hasPassword() {
    return !!localStorage.getItem(HASH_KEY);
  }

  function login() {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ loggedIn: true, ts: Date.now() }));
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function isLoggedIn() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const { loggedIn, ts } = JSON.parse(raw);
    if (!loggedIn || Date.now() - ts > SESSION_TTL) { logout(); return false; }
    return true;
  }

  return { setPassword, checkPassword, hasPassword, login, logout, isLoggedIn };
})();
