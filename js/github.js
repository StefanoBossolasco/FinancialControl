// ============================================================
// GITHUB MODULE — read/write data.json via GitHub Contents API
// PAT is stored only in localStorage (never committed)
// ============================================================
const GitHub = (() => {
  const BASE = 'https://api.github.com';

  function getConfig() {
    return {
      pat:    localStorage.getItem('fc_gh_pat')    || '',
      owner:  localStorage.getItem('fc_gh_owner')  || '',
      repo:   localStorage.getItem('fc_gh_repo')   || '',
      branch: localStorage.getItem('fc_gh_branch') || 'main',
      path:   localStorage.getItem('fc_gh_path')   || 'data.json',
    };
  }

  function setConfig({ pat, owner, repo, branch, path }) {
    if (pat    !== undefined) localStorage.setItem('fc_gh_pat',    pat);
    if (owner  !== undefined) localStorage.setItem('fc_gh_owner',  owner);
    if (repo   !== undefined) localStorage.setItem('fc_gh_repo',   repo);
    if (branch !== undefined) localStorage.setItem('fc_gh_branch', branch);
    if (path   !== undefined) localStorage.setItem('fc_gh_path',   path);
  }

  function isConfigured() {
    const c = getConfig();
    return !!(c.pat && c.owner && c.repo);
  }

  function headers(pat) {
    return {
      'Authorization': `token ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };
  }

  async function testConnection() {
    const { pat, owner, repo } = getConfig();
    if (!pat || !owner || !repo) throw new Error('Configurazione GitHub incompleta');
    const res = await fetch(`${BASE}/repos/${owner}/${repo}`, { headers: headers(pat) });
    if (!res.ok) throw new Error(`Errore ${res.status}: impossibile accedere alla repo`);
    const d = await res.json();
    return { name: d.full_name, isPrivate: d.private };
  }

  async function pull() {
    const { pat, owner, repo, branch, path } = getConfig();
    const res = await fetch(`${BASE}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
      { headers: headers(pat) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Pull failed: ${res.status}`);
    const file = await res.json();
    const content = JSON.parse(atob(file.content.replace(/\s/g, '')));
    return { data: content, sha: file.sha };
  }

  async function push(dataObj) {
    const { pat, owner, repo, branch, path } = getConfig();

    // Get current SHA (required for updates)
    let sha = undefined;
    const check = await fetch(`${BASE}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
      { headers: headers(pat) });
    if (check.ok) {
      const f = await check.json();
      sha = f.sha;
    }

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(dataObj, null, 2))));
    const body = {
      message: `chore: update ${path} [${new Date().toISOString()}]`,
      content,
      branch,
      ...(sha ? { sha } : {})
    };

    const res = await fetch(`${BASE}/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: headers(pat),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Push failed: ${res.status}`);
    }
    return await res.json();
  }

  return { getConfig, setConfig, isConfigured, testConnection, pull, push };
})();
