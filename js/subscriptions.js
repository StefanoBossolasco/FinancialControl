// ============================================================
// SUBSCRIPTIONS MODULE — rule-based detection of recurring payments
// Groups expenses by a normalised merchant, looks for a regular interval
// (weekly / monthly / bimonthly / quarterly / yearly) and a stable amount, then labels
// each candidate: 'subscription', 'recurring' (rent, bills, loans) or 'uncertain'.
// No AI: keywords, categories and arithmetic only. Detections are recomputed on every render;
// only the user's choices are stored (users/{uid}/subscriptions, see Data.setSubscriptionPref).
// ============================================================
const Subscriptions = (() => {
  const DAY = 86400000;

  // days: nominal period; tol: allowed drift in days; grace: days after the expected
  // date before an item counts as stopped; minCount: charges needed without other evidence
  const FREQS = {
    weekly:    { label: 'Settimanale', short: 'sett.',  days: 7,      months: 0,  tol: 2,  grace: 6,  perMonth: 52 / 12, minCount: 4 },
    monthly:   { label: 'Mensile',     short: 'mese',   days: 30.44,  months: 1,  tol: 5,  grace: 12, perMonth: 1,       minCount: 3 },
    bimonthly: { label: 'Bimestrale',  short: 'bim.',   days: 60.88,  months: 2,  tol: 8,  grace: 18, perMonth: 1 / 2,   minCount: 3 },
    quarterly: { label: 'Trimestrale', short: 'trim.',  days: 91.31,  months: 3,  tol: 12, grace: 25, perMonth: 1 / 3,   minCount: 3 },
    yearly:    { label: 'Annuale',     short: 'anno',   days: 365.25, months: 12, tol: 25, grace: 40, perMonth: 1 / 12,  minCount: 2 }
  };
  const FREQ_ORDER = ['weekly', 'monthly', 'bimonthly', 'quarterly', 'yearly'];

  // Subscription brands: the 'Streaming & Abbonamenti' hints from the import rules, plus more
  const BASE_SUB_KW = (typeof Import !== 'undefined' && Import.KW_MAP && Import.KW_MAP['Streaming & Abbonamenti']) ||
    ['netflix', 'spotify', 'apple', 'amazon prime', 'discoveryplus', 'youtube', 'hulu', 'disney', 'origin financial', 'paramount'];
  const SUB_KW = [...new Set([...BASE_SUB_KW,
    'discovery plus', 'prime video', 'primevideo', 'icloud', 'google one', 'google storage', 'google play',
    'dazn', 'now tv', 'nowtv', 'sky', 'infinity', 'timvision', 'crunchyroll', 'twitch', 'deezer', 'tidal',
    'audible', 'kindle', 'storytel', 'chatgpt', 'openai', 'perplexity', 'anthropic', 'claude ai', 'midjourney',
    'github', 'notion', 'dropbox', 'adobe', 'microsoft', 'office 365', 'xbox', 'playstation', 'psn', 'nintendo',
    'patreon', 'substack', 'duolingo', 'headspace', 'strava', 'linkedin', 'canva', '1password', 'nordvpn',
    'expressvpn', 'proton', 'abbonamento', 'subscription', 'membership', 'palestra', 'gym', 'virgin active', 'mcfit'
  ])];

  // Regular payments that are not subscriptions: housing, loans, utilities, telecom, insurance, taxes
  const RECURRING_KW = [
    'affitto', 'rent', 'locazione', 'condominio', 'mutuo', 'mortgage', 'rata', 'finanziamento', 'prestito', 'loan',
    'findomestic', 'agos', 'compass', 'cofidis', 'leasing', 'enel', 'edison', 'a2a', 'hera', 'iren', 'plenitude',
    'sorgenia', 'acea', 'illumia', 'engie', 'energia', 'luce', 'gas', 'acqua', 'water', 'electricity', 'utility',
    'internet', 'phone', 'iliad', 'vodafone', 'tim', 'windtre', 'wind tre', 'fastweb', 'ho mobile', 'kena', 'visible',
    'verizon', 't mobile', 'assicurazione', 'insurance', 'unipol', 'generali', 'allianz', 'axa', 'tari', 'imu', 'bollo',
    'canone', 'f24'
  ];
  const SUB_CATEGORIES = ['Streaming & Abbonamenti'];
  const RECURRING_CATEGORIES = ['Affitto & Casa', 'Utenze & Domiciliazioni', 'Imposte & Tasse', 'Commissioni Bancarie'];

  // Short keywords must match a whole word ('tim' not in "timvision"); longer ones a word start
  const kwRx = kw => new RegExp('(^|[^a-z0-9])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (kw.length <= 4 ? '($|[^a-z0-9])' : ''));
  const SUB_RX = SUB_KW.map(k => [k, kwRx(k)]);
  const REC_RX = RECURRING_KW.map(k => [k, kwRx(k)]);

  // ── Merchant normalisation ─────────────────────────────────
  const NOISE_PREFIX = /^(pagamento (effettuato )?(su )?pos( estero)?|pagamento (a|di)|pagamento|addebito (diretto|sdd)( sepa)?|addebito|acquisto|bonifico( istantaneo)?( disposto)?( a (vostro )?favore( di)?)?|transfer (to|from)|payment (to|from)|sdd|pos|presso)\s+/;
  const STOP = new Set(['srl', 'spa', 'sas', 'snc', 'ltd', 'inc', 'llc', 'gmbh', 'bv', 'sa', 'eu', 'europe', 'italia', 'italy',
    'it', 'carta', 'card', 'nr', 'del', 'della', 'di', 'da', 'per', 'con', 'the', 'and', 'bill', 'payment', 'pagamento',
    'presso', 'com', 'www', 'help', 'ref', 'cod', 'disp']);

  function stripAccents(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  function cleanText(desc) {
    let s = stripAccents(String(desc || '').toLowerCase()).trim();
    // Intesa POS rows: the merchant follows "presso"
    const presso = s.match(/\bpresso\s+(.+)$/);
    if (presso) s = presso[1];
    for (let prev = ''; prev !== s;) { prev = s; s = s.replace(NOISE_PREFIX, ''); }
    return s.replace(/https?:\/\/|www\./g, ' ')
      .replace(/\.(com|it|net|org|io|eu|co)\b/g, ' ')
      .replace(/[^a-z0-9&@ ]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function subKeyword(text)       { const hit = SUB_RX.find(([, rx]) => rx.test(text)); return hit ? hit[0] : null; }
  function recurringKeyword(text) { const hit = REC_RX.find(([, rx]) => rx.test(text)); return hit ? hit[0] : null; }

  // "NETFLIX.COM 866-579-7172" and "Netflix" both become "netflix"
  function merchantKey(desc) {
    const s = cleanText(desc);
    const kw = subKeyword(s);
    if (kw) return kw;
    const toks = s.split(' ').filter(t => t.length > 1 && !/\d/.test(t) && !STOP.has(t));
    if (toks.length) return toks.slice(0, 2).join(' ');
    return s || String(desc || '').toLowerCase().trim();
  }

  // Firestore document id for a key (no slashes, short)
  function docId(key) { return key.replace(/[^a-z0-9~]+/g, '-').replace(/^-|-$/g, '').substring(0, 120) || 'x'; }

  // ── Date helpers (UTC, 'YYYY-MM-DD') ───────────────────────
  const toMs  = d => Date.UTC(+d.substring(0, 4), +d.substring(5, 7) - 1, +d.substring(8, 10));
  const toIso = ms => new Date(ms).toISOString().substring(0, 10);
  function addPeriod(date, freq) {
    const f = FREQS[freq];
    if (!f.months) return toIso(toMs(date) + f.days * DAY);
    const y = +date.substring(0, 4), m = +date.substring(5, 7) - 1 + f.months, d = +date.substring(8, 10);
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return toIso(Date.UTC(y, m, Math.min(d, last)));
  }

  // ── Statistics ─────────────────────────────────────────────
  function median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const n = s.length;
    return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0;
  }
  function cv(arr) {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    if (!mean) return 0;
    const v = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
    return Math.sqrt(v) / mean;
  }
  const cvScore = c => c <= 0.02 ? 1 : c <= 0.08 ? 0.85 : c <= 0.15 ? 0.65 : c <= 0.3 ? 0.35 : 0.1;

  // Amount stability, forgiving a price change (the last 3 charges are identical)
  function amountScore(amounts) {
    const all = cvScore(cv(amounts));
    return amounts.length >= 5 && cv(amounts.slice(-3)) <= 0.005 ? Math.max(all, 0.9) : all;
  }

  // Share of gaps that fit the period; a gap of 2-3 periods (missed or unrecorded charges) counts 0.6
  function fitPeriod(gaps, freq) {
    const f = FREQS[freq];
    let sum = 0, exact = 0;
    for (const g of gaps) {
      const k = Math.max(1, Math.round(g / f.days));
      if (k > 3) continue;
      if (Math.abs(g - k * f.days) <= f.tol * (1 + (k - 1) * 0.5)) {
        sum += k === 1 ? 1 : 0.6;
        if (k === 1) exact++;
      }
    }
    return { freq, regularity: gaps.length ? sum / gaps.length : 0, exact };
  }

  function bestPeriod(dates) {
    const ms = dates.map(toMs);
    const gaps = ms.slice(1).map((m, i) => (m - ms[i]) / DAY);
    if (!gaps.length) return null;
    let best = null;
    for (const fq of FREQ_ORDER) {
      const fit = fitPeriod(gaps, fq);
      if (!fit.exact) continue;
      if (!best || fit.regularity > best.regularity + 1e-9 ||
          (Math.abs(fit.regularity - best.regularity) < 1e-9 && fit.exact > best.exact)) best = fit;
    }
    return best ? { ...best, gaps } : null;
  }

  // ── Grouping ───────────────────────────────────────────────
  function isExpense(t) {
    return t && typeof t.amountEUR === 'number' && t.amountEUR < 0 && t.category !== '__exchange__' && t.date;
  }

  function groupByMerchant(transactions) {
    const groups = new Map();
    for (const t of transactions) {
      if (!isExpense(t)) continue;
      const key = merchantKey(t.description);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    for (const txs of groups.values()) txs.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    return groups;
  }

  // Splits a merchant's charges by amount (e.g. two Apple subscriptions on one bill name)
  function amountClusters(txs) {
    const sorted = [...txs].sort((a, b) => Math.abs(a.amountEUR) - Math.abs(b.amountEUR));
    const clusters = [];
    for (const t of sorted) {
      const a = Math.abs(t.amountEUR);
      const c = clusters[clusters.length - 1];
      if (c && a <= c.last * 1.15 + 0.5) { c.txs.push(t); c.last = a; } else clusters.push({ txs: [t], last: a });
    }
    return clusters.map(c => c.txs.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)));
  }

  const mostCommon = arr => {
    const n = {};
    arr.forEach(v => { n[v] = (n[v] || 0) + 1; });
    return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  };

  const BRAND_NAMES = {
    'netflix': 'Netflix', 'spotify': 'Spotify', 'apple': 'Apple', 'amazon prime': 'Amazon Prime', 'youtube': 'YouTube',
    'disney': 'Disney+', 'discoveryplus': 'discovery+', 'discovery plus': 'discovery+', 'icloud': 'iCloud',
    'prime video': 'Prime Video', 'primevideo': 'Prime Video', 'google one': 'Google One', 'dazn': 'DAZN', 'now tv': 'NOW',
    'nowtv': 'NOW', 'sky': 'Sky', 'timvision': 'TIMVISION', 'chatgpt': 'ChatGPT', 'openai': 'OpenAI', 'github': 'GitHub',
    'linkedin': 'LinkedIn', 'nordvpn': 'NordVPN', 'expressvpn': 'ExpressVPN', 'psn': 'PlayStation', 'xbox': 'Xbox',
    'paramount': 'Paramount+', 'hulu': 'Hulu', 'perplexity': 'Perplexity', 'adobe': 'Adobe', 'microsoft': 'Microsoft'
  };
  const titleCase = s => s.toLowerCase().replace(/(^|[\s/&-])([a-z\u00e0-\u00fa])/g, (m, a, b) => a + b.toUpperCase());

  // "Netflix" for brands; else the usual description without reference codes ("Spotify P2F3A1B9C" -> "Spotify")
  function displayName(txs, key) {
    const base = key.replace(/~.*$/, '');
    if (BRAND_NAMES[base]) return BRAND_NAMES[base];
    const recent = txs.slice(-6).map(t => String(t.description || '').trim()).filter(Boolean);
    let name = mostCommon(recent).replace(/\*\S*/g, ' ').split(/\s+/)
      .filter(w => !(/\d/.test(w) && w.length >= 4)).join(' ').trim();
    if (name && name === name.toUpperCase()) name = titleCase(name);
    if (name && name.length <= 34) return name;
    return titleCase(base);
  }

  // ── Building one item ──────────────────────────────────────
  function buildItem(key, txs, period, today, forcedFreq) {
    const freq = forcedFreq || period?.freq || 'monthly';
    const f = FREQS[freq];
    const amounts = txs.map(t => Math.abs(t.amountEUR));
    const amount = Math.round(median(amounts.slice(-3)) * 100) / 100;
    const lastDate = txs[txs.length - 1].date;
    const nextDate = addPeriod(lastDate, freq);
    const overdue = Math.round((toMs(today) - toMs(nextDate)) / DAY);
    const monthly = amount * f.perMonth;
    return {
      key, name: displayName(txs, key), frequency: freq,
      amount, amountMin: Math.min(...amounts), amountMax: Math.max(...amounts),
      count: txs.length, firstDate: txs[0].date, lastDate, nextDate,
      overdue, active: overdue <= f.grace,
      monthly: Math.round(monthly * 100) / 100, yearly: Math.round(monthly * 12 * 100) / 100,
      category: mostCommon(txs.map(t => t.category)),
      txIds: txs.map(t => t.id).reverse()
    };
  }

  // Scores a group; returns null when it is not a recurring pattern
  function analyse(key, txs, today, isCluster = false) {
    if (txs.length < 2) return null;
    const period = bestPeriod(txs.map(t => t.date));
    if (!period || period.regularity < 0.7) return null;
    const f = FREQS[period.freq];
    const amounts = txs.map(t => Math.abs(t.amountEUR));
    const amt = amountScore(amounts);

    const text = cleanText(txs.map(t => t.description).join(' | ') + ' | ' + txs.map(t => t.details || '').join(' | '));
    const subKw = subKeyword(text);
    const recKw = subKw ? null : recurringKeyword(text);
    const category = mostCommon(txs.map(t => t.category));
    const subCat = SUB_CATEGORIES.includes(category);
    const recCat = RECURRING_CATEGORIES.includes(category);
    const subSignal = !!(subKw || subCat);
    const recSignal = !subSignal && !!(recKw || recCat);

    // Enough charges: the frequency's minimum, or 2 (not weekly) with a brand/category or the same amount.
    // A split by amount needs 3 charges without a subscription signal (2 similar ones are often chance).
    const sameAmount = Math.max(...amounts) - Math.min(...amounts) < 0.01;
    const enough = txs.length >= f.minCount ||
      (txs.length >= 2 && period.freq !== 'weekly' && (subSignal || (!isCluster && (recSignal || sameAmount))));
    if (!enough) return null;
    // Varying amounts are spending habits (groceries, coffee) unless it is a bill or a subscription
    if (amt < (recSignal || subSignal ? 0.35 : 0.65)) return null;

    const item = buildItem(key, txs, period, today);
    let score = 40 * period.regularity + 25 * amt + 10 * Math.min(1, (txs.length - 1) / 5);
    if (subKw) score += 25; else if (subCat) score += 18;
    score = Math.round(Math.min(100, score));

    let kind;
    if (subSignal) kind = score >= 55 ? 'subscription' : 'uncertain';
    else if (recSignal) kind = 'recurring';
    else if (item.amount > 150 || amt < 0.85) kind = 'recurring';
    else kind = 'uncertain';

    const reasons = [];
    const exactOf = period.gaps.length;
    reasons.push(`${f.label}: ${period.exact} intervall${period.exact === 1 ? 'o' : 'i'} regolar${period.exact === 1 ? 'e' : 'i'} su ${exactOf}`);
    reasons.push(amt >= 0.85 ? 'Importo stabile' : amt >= 0.65 ? 'Importo quasi stabile' : 'Importo variabile');
    if (subKw) reasons.push(`Parola chiave abbonamento: "${subKw}"`);
    else if (subCat) reasons.push(`Categoria ${category}`);
    if (recKw) reasons.push(`Parola chiave spesa fissa: "${recKw}"`);
    else if (recCat && !subSignal) reasons.push(`Categoria ${category}`);
    if (!subSignal && !recSignal) reasons.push(kind === 'recurring'
      ? (item.amount > 150 ? 'Importo alto senza marchio noto (affitto, rata?)' : 'Importo variabile come una bolletta')
      : 'Nessun marchio noto: da verificare');

    return { ...item, kind, score, regularity: Math.round(period.regularity * 100) / 100, amountStability: amt, reasons, detected: true };
  }

  // ── Detection over all transactions ────────────────────────
  // prefs: { [key]: { status: 'confirmed'|'dismissed', manual?, frequency?, name? } }
  function detect(transactions, prefs = {}, today = toIso(Date.now())) {
    const groups = groupByMerchant(transactions);
    const items = [];
    for (const [key, txs] of groups) {
      // Whole merchant first; if that fails or its amounts vary (and it is not a bill), try each amount cluster
      const whole = analyse(key, txs, today);
      if (whole && (whole.amountStability >= 0.65 || whole.kind === 'recurring')) { items.push(whole); continue; }
      const clusters = amountClusters(txs).filter(c => c.length >= 2 && c.length < txs.length);
      const parts = clusters
        .map(c => analyse(`${key}~${Math.round(Math.abs(median(c.map(t => t.amountEUR))))}`, c, today, true))
        .filter(Boolean);
      if (parts.length) items.push(...parts); else if (whole) items.push(whole);
    }

    // User choices: confirmed (also by hand, for keys never detected) and dismissed
    const byKey = new Map(items.map(it => [it.key, it]));
    for (const [key, pref] of Object.entries(prefs || {})) {
      if (!pref || !pref.status) continue;
      let it = byKey.get(key);
      if (!it && pref.status === 'confirmed') {
        const base = key.replace(/~.*$/, '');
        let txs = groups.get(base);
        if (txs && key !== base) {
          const target = +key.split('~')[1];
          txs = amountClusters(txs).find(c => Math.round(Math.abs(median(c.map(t => t.amountEUR)))) === target);
        }
        if (!txs || !txs.length) continue;
        const period = txs.length >= 2 ? bestPeriod(txs.map(t => t.date)) : null;
        it = { ...buildItem(key, txs, period, today, FREQS[pref.frequency] ? pref.frequency : null),
          kind: 'subscription', score: null, reasons: ['Aggiunto a mano'], detected: false };
        items.push(it);
        byKey.set(key, it);
      }
      if (!it) continue;
      if (pref.frequency && FREQS[pref.frequency] && pref.frequency !== it.frequency) {
        const txs = it.txIds.map(id => transactions.find(t => t.id === id)).filter(Boolean).reverse();
        Object.assign(it, buildItem(key, txs, null, today, pref.frequency));
      }
      if (pref.name) it.name = pref.name;
      it.detectedKind = it.detected ? it.kind : null;
      it.userStatus = pref.status;
      if (pref.status === 'confirmed') it.kind = 'subscription';
    }

    const rank = { subscription: 0, uncertain: 1, recurring: 2 };
    items.sort((a, b) => (b.active - a.active) || (rank[a.kind] - rank[b.kind]) || (b.monthly - a.monthly));
    return items;
  }

  function totals(items) {
    const subs = items.filter(i => i.kind === 'subscription' && i.userStatus !== 'dismissed' && i.active);
    const rec  = items.filter(i => i.kind === 'recurring' && i.userStatus !== 'dismissed' && i.active);
    const monthly = subs.reduce((s, i) => s + i.monthly, 0);
    return {
      count: subs.length, monthly, yearly: monthly * 12,
      recurringCount: rec.length, recurringMonthly: rec.reduce((s, i) => s + i.monthly, 0)
    };
  }

  // Merchants for the "add by hand" picker: every expense group, most recent first
  function merchants(transactions) {
    return [...groupByMerchant(transactions)].map(([key, txs]) => ({
      key, name: displayName(txs, key), count: txs.length,
      lastDate: txs[txs.length - 1].date, lastAmount: Math.abs(txs[txs.length - 1].amountEUR)
    })).sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  }

  return { FREQS, FREQ_ORDER, merchantKey, docId, addPeriod, detect, totals, merchants };
})();

if (typeof module !== 'undefined') module.exports = Subscriptions;
