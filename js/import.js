// ============================================================
// IMPORT MODULE — Revolut CSV + Intesa XLSX + Satispay XLSX parsing
// Exchange rate calculation (EUR/USD weighted average)
// Duplicate detection and category suggestions (history + keyword rules)
// ============================================================
const Import = (() => {

  // ── Intesa category → our category ──────────────────────
  const INTESA_MAP = {
    'trasporti':              'Trasporti & Mobilità',
    'noleggi':                'Trasporti & Mobilità',
    'taxi':                   'Trasporti & Mobilità',
    'parcheggi':              'Trasporti & Mobilità',
    'pedaggi':                'Trasporti & Mobilità',
    'carburant':              'Trasporti & Mobilità',
    'viaggi':                 'Viaggi & Vacanze',
    'treno':                  'Viaggi & Vacanze',
    'aereo':                  'Viaggi & Vacanze',
    'nave':                   'Viaggi & Vacanze',
    'imposte sul reddito':    'Imposte & Tasse',
    'tasse varie':            'Imposte & Tasse',
    'pagamento delega':       'Imposte & Tasse',
    'imposte, bolli':         'Commissioni Bancarie',
    'commissioni':            'Commissioni Bancarie',
    'costo bonifico':         'Commissioni Bancarie',
    'domiciliazioni':         'Utenze & Domiciliazioni',
    'utenze':                 'Utenze & Domiciliazioni',
    'spesa alimentare':       'Spesa Alimentare',
    'supermercato':           'Spesa Alimentare',
    'ristoranti':             'Ristoranti & Bar',
    'bar':                    'Ristoranti & Bar',
    'fast food':              'Ristoranti & Bar',
    'tempo libero':           'Intrattenimento',
    'sport':                  'Sport & Fitness',
    'salute':                 'Salute & Farmacia',
    'farmacia':               'Salute & Farmacia',
    'abbigliamento':          'Abbigliamento & Shopping',
    'casa e arredo':          'Affitto & Casa',
    'affitto':                'Affitto & Casa',
    'streaming':              'Streaming & Abbonamenti',
    'giroconti':              'Trasferimenti',
    'addebito mia carta':     'Trasferimenti',
    'bonifici ricevuti':      'Entrate',
    'stipendio':              'Entrate',
    'rimborsi':               'Entrate',
  };

  // ── Revolut auto-suggest keywords ────────────────────────
  const KW_MAP = {
    'Affitto & Casa':         ['rent','affitto','housing','propane','pasadena propane','property'],
    'Spesa Alimentare':       ['grocery','supermarket','albertsons','vallarta','trader joe','whole foods','food','market','deli','kroger','safeway','mercato','mercat','supermercato','pescheria','macelleria','panetteria','panificio','conad','coop','esselunga','carrefour','lidl','eurospin','penny','despar','naturasi'],
    'Ristoranti & Bar':       ['restaurant','cafe','pizza','burger','starbucks','bar','sushi','diner','kitchen','grill','orbit','jpl cafe','dena burgers','liquor','bistro','tavern','caffe','caffetteria','pasticceria','gelateria','trattoria','osteria','ristorante','pizzeria','pub','panineria','chickfila','chick-fil-a','wendy','shake shack','taqueria','mcdonald','coffee'],
    'Trasporti & Mobilità':   ['uber','waymo','lyft','taxi','parking','amtrak','train','metro','mta','joes auto','auto park','transit','bus','subway','trenitalia','italo','gtt','apcoa','telepass','autostrade','chevron','shell','maverik','fastrak','sixt','hertz','thrifty','avis','q8','esso','benzina'],
    'Viaggi & Vacanze':       ['hotel','marriott','holiday inn','airbnb','southwest','american airlines','united','delta','flight','easyjet','ita','south rim','general store','lax travel','canyon','resort','motel','booking','edreams','ryanair','tours'],
    'Abbigliamento & Shopping':['zara','h&m','fashion','clothes','clothing','shoes','gap','forever21','nordstrom','target'],
    'Streaming & Abbonamenti':['netflix','spotify','apple','amazon prime','discoveryplus','youtube','hulu','disney','origin financial','paramount'],
    'Shopping Online':        ['amazon','ebay','etsy','shopify','alibaba'],
    'Imposte & Tasse':        ['tax','f24','imposte','tasse','pagamento delega','irs'],
    'Commissioni Bancarie':   ['fee','commission','costo bonifico','bolli','bank charge'],
    'Trasferimenti':          ['transfer to','transfer from','bonifico','addebito diretto'],
    'Sport & Fitness':        ['gym','fitness','sport','palestra','yoga','equinox'],
    'Salute & Farmacia':      ['pharmacy','farmacia','medical','doctor','hospital','dentist','cvs','walgreens','rite aid'],
    'Intrattenimento':        ['movie','cinema','concert','show','dodger','stadium','theme park','dj','wild west','disneyland','spo dj','junctions'],
    'Utenze & Domiciliazioni':['electricity','gas','water','internet','phone','paypal','utility'],
  };

  // Keywords match at the start of a word, so 'gas' no longer matches "Las Vegas"
  const KW_RX = Object.entries(KW_MAP).map(([cat, kws]) => [cat, kws.map(k =>
    new RegExp('(^|[^a-z0-9])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))]);

  function suggestCategory(description) {
    const low = stripAccents(String(description || '').toLowerCase());
    for (const [cat, rxs] of KW_RX) {
      if (rxs.some(rx => rx.test(low))) return cat;
    }
    return 'Altro';
  }

  function mapIntesaCategory(raw) {
    const low = (raw || '').toLowerCase().trim();
    for (const [key, val] of Object.entries(INTESA_MAP)) {
      if (low.includes(key)) return val;
    }
    return 'Altro';
  }

  // Simple deterministic ID from date+amount+description
  function genId(date, amount, description) {
    const s = `${date}|${amount}|${description}`;
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(36);
  }

  // Identical rows in one file (e.g. two 0.50€ fees on the same day) would
  // get the same genId and one would be dropped on save: suffix the repeats.
  // Deterministic, so re-importing the same file yields the same ids.
  function uniqueIds(txs) {
    const seen = {};
    txs.forEach(t => {
      if (seen[t.id] === undefined) { seen[t.id] = 1; return; }
      seen[t.id]++;
      t.id = `${t.id}-${seen[t.id]}`;
    });
    return txs;
  }

  // ── Text normalisation ───────────────────────────────────
  function stripAccents(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // Words that carry no merchant information in bank descriptions
  const STOPWORDS = new Set(('effettuato il alle ore mediante la carta presso ctv di usd eur al cambio ora ' +
    'autorizzazione pagamento pagamenti effettuata su pos estero addebito diretto disposto disposta a favore da voi ' +
    'bonifico istantaneo sepa srl spa sas snc sarl et cie sca mandato cod disp nome the and of at com www ' +
    'in per del della dei e n xxxx xx to from by transfer payment money sent received').split(' '));
  // Card-processor prefixes that hide the real merchant ("SQ *SHAKE SHACK", "PAYPAL *STARBUCKS")
  const PROCESSOR_PREFIXES = new Set(['sq', 'tst', 'fh', 'tcb', 'sp', 'pp', 'paypal', 'sumup', 'zettle', 'izettle']);

  function tokens(text) {
    const toks = stripAccents(text).toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(w => w.length >= 2 && !/\d/.test(w) && !STOPWORDS.has(w));
    while (toks.length > 1 && PROCESSOR_PREFIXES.has(toks[0])) toks.shift();
    return toks;
  }

  // Two tokens are "the same word" if equal or one is a prefix of the other
  // (min 4 chars): "starbucksse" ~ "starbucks", "pasticc" ~ "pasticceria"
  function tokEq(a, b) {
    if (a === b) return true;
    if (a.length < 4 || b.length < 4) return false;
    return a.startsWith(b) || b.startsWith(a);
  }

  // Share of the shorter token list found in the other one (0..1)
  function tokenSimilarity(a, b) {
    if (!a.length || !b.length) return 0;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    const hits = short.filter(x => long.some(y => tokEq(x, y))).length;
    return hits / short.length;
  }

  // Intesa card rows: the merchant is after "presso", before "(ctv. di … usd …)"
  function merchantFromDetails(details) {
    const m = String(details || '').match(/\bpresso\s+(.+?)(?:\s*\(ctv\..*)?$/i);
    return m ? m[1].trim() : '';
  }

  // Text that identifies who the money went to / came from
  function merchantText(t) {
    return [t.description, merchantFromDetails(t.details)].filter(Boolean).join(' ');
  }

  // ── Category suggestions ─────────────────────────────────
  // Learned from already-categorised transactions: merchant key → category counts.
  // Keys are the first one and two significant tokens of the description, split by sign
  // (an incoming "Gloria P." and an outgoing one can mean different things).
  const NOT_LEARNED = new Set(['Altro', '__exchange__', '', null, undefined]);

  function buildCategoryIndex(existing) {
    const idx = { one: new Map(), two: new Map() };
    const add = (map, key, cat) => {
      if (!map.has(key)) map.set(key, {});
      const c = map.get(key);
      c[cat] = (c[cat] || 0) + 1;
    };
    (existing || []).forEach(t => {
      if (NOT_LEARNED.has(t.category)) return;
      const sign = (t.amountEUR ?? t.amount) < 0 ? '-' : '+';
      const toks = tokens(merchantText(t));
      if (!toks.length) return;
      add(idx.one, sign + toks[0], t.category);
      if (toks.length > 1) add(idx.two, sign + toks[0] + ' ' + toks[1], t.category);
    });
    return idx;
  }

  function bestOf(counts) {
    let best = null, n = 0, total = 0;
    for (const [cat, c] of Object.entries(counts)) {
      total += c;
      if (c > n) { best = cat; n = c; }
    }
    return { category: best, count: n, total };
  }

  function lookupHistory(idx, t) {
    const toks = tokens(merchantText(t));
    if (!toks.length) return null;
    const sign = (t.amountEUR ?? t.amount) < 0 ? '-' : '+';
    if (toks.length > 1) {
      const c = idx.two.get(sign + toks[0] + ' ' + toks[1]);
      if (c) return bestOf(c);
    }
    const exact = idx.one.get(sign + toks[0]);
    if (exact && toks[0].length >= 3) return bestOf(exact);
    // Fuzzy first-token match ("starbucksse" ~ "starbucks")
    if (toks[0].length >= 5) {
      for (const [key, c] of idx.one) {
        if (key[0] === sign && key.length >= 6 && tokEq(key.slice(1), toks[0])) return bestOf(c);
      }
    }
    return null;
  }

  // Sets t.category and t._suggest = { by: 'history'|'bank'|'rules'|'default', label }
  // Order: your past transactions → the parser's bank-based category → keyword rules.
  function categorize(txs, existing) {
    const idx = buildCategoryIndex(existing);
    txs.forEach(t => {
      if (t.category === '__exchange__') return;
      const hist = lookupHistory(idx, t);
      // Only trust history when that merchant is mostly filed under one category
      if (hist && hist.category && hist.count / hist.total >= 0.6) {
        t.category = hist.category;
        t._suggest = { by: 'history', label: `Storico ${hist.count}/${hist.total}` };
        return;
      }
      if (t.category && t.category !== 'Altro') {
        t._suggest = { by: 'bank', label: t._bankCat ? `Banca: ${t._bankCat}` : 'Regola fonte' };
        return;
      }
      const rule = suggestCategory([merchantText(t), t.details, t._bankCat].filter(Boolean).join(' '));
      if (rule !== 'Altro') {
        t.category = rule;
        t._suggest = { by: 'rules', label: 'Parole chiave' };
        return;
      }
      t.category = (t.amountEUR ?? t.amount) > 0 ? 'Entrate' : 'Altro';
      t._suggest = { by: 'default', label: 'Nessuna regola' };
    });
    return txs;
  }

  // ── Duplicate detection ──────────────────────────────────
  // Marks each row with t._dup = { level: 'sure'|'maybe', match } when it already
  // exists on the platform. 'sure': same id, or same amount, date within 2 days and
  // similar description. 'maybe': same amount and date (±1 day) but different text,
  // e.g. a manually entered expense. Each existing transaction matches at most one row.
  const DAY = 86400000;

  function amountOf(t) {
    return t.amountEUR !== null && t.amountEUR !== undefined ? t.amountEUR : t.amount;
  }

  function findDuplicates(txs, existing) {
    const byId = new Map((existing || []).map(e => [e.id, e]));
    const used = new Set();
    const byAmount = new Map();
    (existing || []).forEach(e => {
      const k = Math.round(Math.abs(amountOf(e)) * 100);
      if (!byAmount.has(k)) byAmount.set(k, []);
      byAmount.get(k).push(e);
    });

    // Exact id matches first, so fuzzy matching can't steal them
    txs.forEach(t => {
      delete t._dup;
      const e = byId.get(t.id);
      if (e) { t._dup = { level: 'sure', match: e }; used.add(e.id); }
    });

    txs.forEach(t => {
      if (t._dup || t.category === '__exchange__') return;
      const amt = amountOf(t);
      const cands = byAmount.get(Math.round(Math.abs(amt) * 100)) || [];
      const tToks = tokens(merchantText(t) + ' ' + (t.details || ''));
      const tTime = new Date(t.date).getTime();
      let best = null, bestScore = -1;
      cands.forEach(e => {
        if (used.has(e.id)) return;
        // Same direction (manual entries store a positive amount, the sign is in amountEUR)
        if ((amountOf(e) < 0) !== (amt < 0)) return;
        if (t.amountEUR === null && e.currency !== t.currency) return;
        const days = Math.abs(new Date(e.date).getTime() - tTime) / DAY;
        if (days > 2) return;
        const sim = tokenSimilarity(tToks, tokens(merchantText(e) + ' ' + (e.details || '')));
        const score = sim - days * 0.1;
        if (score > bestScore) { best = { e, sim, days }; bestScore = score; }
      });
      if (!best) return;
      if (best.sim >= 0.5) t._dup = { level: 'sure', match: best.e };
      else if (best.days <= 1) t._dup = { level: 'maybe', match: best.e };
      if (t._dup) used.add(best.e.id);
    });
    return txs;
  }

  // Helper to extract value by multiple possible header names (case & BOM insensitive)
  function getRowVal(row, ...possibleKeys) {
    if (!row) return undefined;
    for (const key of possibleKeys) {
      const target = key.toLowerCase();
      for (const k of Object.keys(row)) {
        const cleanK = k.replace(/^\ufeff/, '').trim().toLowerCase();
        if (cleanK === target) {
          return row[k];
        }
      }
    }
    return undefined;
  }

  // ── Parse Revolut CSV ─────────────────────────────────────
  function parseRevolutCSV(csvText, currency) {
    const cleanText = (csvText || '').replace(/^\ufeff/, '').trim();
    const { data } = Papa.parse(cleanText, { header: true, skipEmptyLines: true });
    const transactions = [];
    const exchanges    = [];

    data.forEach(row => {
      const stateVal = (getRowVal(row, 'State', 'Stato', 'Status') || '').toString().trim().toUpperCase();
      // If state column is present, check validity; if missing, assume completed
      if (stateVal && !['COMPLETED', 'PENDING', 'COMPLETATA', 'IN SOSPESO', 'ESEGUITO', 'RECORDED'].includes(stateVal)) {
        return;
      }

      const rawAmountStr = (getRowVal(row, 'Amount', 'Importo', 'Value') || '').toString().replace(/\s/g, '').replace(',', '.');
      const amount = parseFloat(rawAmountStr);

      const rawDateStr = (getRowVal(row, 'Started Date', 'Date', 'Data inizio', 'Data', 'Started_Date') || '').toString().trim();
      const dateRaw = rawDateStr.split(' ')[0];
      if (!dateRaw || isNaN(amount)) return;

      const dateObj = new Date(dateRaw);
      if (isNaN(dateObj.getTime())) return;
      const year  = dateObj.getFullYear();
      const month = `${year}-${String(dateObj.getMonth() + 1).padStart(2,'0')}`;

      const description = (getRowVal(row, 'Description', 'Descrizione', 'Details') || '').toString().substring(0, 120);
      const rowCurrency = (getRowVal(row, 'Currency', 'Valuta') || currency).toString().trim().toUpperCase();
      const type        = (getRowVal(row, 'Type', 'Tipo') || '').toString().trim();
      const balance     = parseFloat((getRowVal(row, 'Balance', 'Saldo') || '0').toString().replace(',', '.')) || 0;

      const tx = {
        id:          genId(dateRaw, amount, description),
        date:        dateRaw,
        month,
        year,
        description,
        amount,
        currency:    rowCurrency,
        amountEUR:   rowCurrency === 'EUR' ? amount : (currency === 'EUR' ? amount : null),
        category:    null,
        source:      rowCurrency === 'EUR' ? 'revolut_eur' : 'revolut_usd',
        type,
        balance,
        importedAt:  new Date().toISOString(),
        notes:       ''
      };

      if (type.toLowerCase() === 'exchange' || description.toLowerCase().includes('exchanged to') || description.toLowerCase().includes('cambio')) {
        exchanges.push(tx);
        tx.category = '__exchange__';
        transactions.push(tx);
        return;
      }

      // Categorise
      if (type.toLowerCase() === 'transfer' && amount < 0) tx.category = 'Trasferimenti';
      else if (type.toLowerCase() === 'transfer' && amount > 0) tx.category = 'Entrate';
      else if (amount > 0) tx.category = 'Entrate';
      // Expenses are categorised later by categorize() (history first, then keywords)
      else tx.category = null;
      if (type) tx._bankCat = type;

      transactions.push(tx);
    });

    uniqueIds(transactions);
    return { transactions, exchanges };
  }

  // ── Parse Intesa XLSX ─────────────────────────────────────
  function parseIntesaXLSX(arrayBuffer) {
    const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }); // raw: true is critical for correct Dates and Numbers

    const transactions = [];
    let headerIdx = -1;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r && Array.isArray(r)) {
        const rowStr = r.map(c => String(c).trim().toLowerCase()).join(' ');
        if (rowStr.includes('data') && (rowStr.includes('importo') || rowStr.includes('descrizione') || rowStr.includes('operazione') || rowStr.includes('categoria'))) {
          headerIdx = i;
          break;
        }
      }
    }
    // Fallback 2: any row that has a cell containing 'data'
    if (headerIdx < 0) {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r && r.some(c => String(c).trim().toLowerCase().includes('data'))) {
          headerIdx = i;
          break;
        }
      }
    }
    // Fallback 3: any row that has a cell containing 'importo'
    if (headerIdx < 0) {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r && r.some(c => String(c).trim().toLowerCase().includes('importo'))) {
          headerIdx = i;
          break;
        }
      }
    }
    // Fallback 4: use first non-empty row as header and attempt parsing anyway
    if (headerIdx < 0) {
      for (let i = 0; i < rows.length; i++) {
        if (rows[i] && rows[i].some(c => String(c).trim() !== '')) {
          headerIdx = i;
          console.warn('[parseIntesaXLSX] Intestazione non trovata, uso riga', i, 'come header di fallback:', rows[i]);
          break;
        }
      }
    }

    if (headerIdx < 0) throw new Error('Intestazione della tabella ("Data", "Importo", etc.) non trovata nel file Intesa.');

    // Determine column mapping dynamically from header
    const header = rows[headerIdx].map(c => String(c).trim().toLowerCase());
    let dateCol = header.findIndex(c => c.startsWith('data'));
    let descCol = header.findIndex(c => c.includes('descrizione') || c.includes('causale') || c.includes('operazione'));
    let catCol  = header.findIndex(c => c.includes('categoria'));
    let amtCol  = header.findIndex(c => c.includes('importo') || c.includes('entrate') || c.includes('uscite'));
    // "Dettagli" (3rd column): full bank text — merchant for card payments, payee and
    // reason for transfers, original USD amount and FX rate for foreign POS payments
    const detCol = header.findIndex(c => c.includes('dettagli'));

    if (dateCol < 0) dateCol = 0;
    if (descCol < 0) descCol = 1;
    if (catCol < 0)  catCol = 5;
    if (amtCol < 0)  amtCol = 7;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || (r[dateCol] === '' && r[amtCol] === '')) continue;

      let dateStr = r[dateCol];
      
      // Parse amount properly
      let amount = 0;
      if (typeof r[amtCol] === 'number') {
        amount = r[amtCol];
      } else {
        const rawAmount = String(r[amtCol] || '').replace(/\./g,'').replace(',','.');
        amount = parseFloat(rawAmount);
      }
      if (isNaN(amount)) continue;

      // Normalise date
      let date;
      if (dateStr instanceof Date) {
        // Fix timezone offset issue which might shift date to previous day
        const tzOffsetMs = dateStr.getTimezoneOffset() * 60000;
        date = new Date(dateStr.getTime() - tzOffsetMs).toISOString().split('T')[0];
      } else {
        const parts = String(dateStr).trim().split(/[\/\-\.]/);
        if (parts.length === 3) {
          if (parts[0].length === 4) date = `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
          else date = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
        } else {
          date = String(dateStr);
        }
      }
      const d = new Date(date);
      if (isNaN(d.getTime())) continue;

      const year  = d.getFullYear();
      const month = `${year}-${String(d.getMonth() + 1).padStart(2,'0')}`;
      const operation = String(r[descCol] || '').trim().substring(0, 120);
      const rawCat = r[catCol] ? String(r[catCol]).trim() : '';
      let details = detCol >= 0 ? String(r[detCol] || '').replace(/\s+/g, ' ').trim() : '';
      if (/^n\.?d\.?$/i.test(details) || details.toLowerCase() === operation.toLowerCase()) details = '';

      // Generic operations ("Pagamento Effettuato Su Pos Estero") hide the merchant,
      // which is only in the details: show the merchant as the description instead.
      // The id still uses the bank's operation text so earlier imports keep matching.
      let description = operation;
      const merchant = merchantFromDetails(details);
      if (merchant && /^pagamento\b.*\bpos\b/i.test(operation)) {
        description = merchant.substring(0, 120);
      }

      const tx = {
        id:          genId(date, amount, operation),
        date,
        month,
        year,
        description,
        amount,
        currency:    'EUR',
        amountEUR:   amount,
        category:    mapIntesaCategory(rawCat),
        source:      'intesa',
        type:        operation.substring(0, 50),
        balance:     0,
        importedAt:  new Date().toISOString(),
        notes:       ''
      };
      if (details) tx.details = details.substring(0, 500);
      if (rawCat) tx._bankCat = rawCat;
      transactions.push(tx);
    }
    return uniqueIds(transactions);
  }

  // ── Parse Satispay XLSX/CSV ───────────────────────────────
  // Export columns: Date, Name, Description, Amount, Type, Status, Balance,
  // Balance after transaction, ID. Type/Status values start with an emoji.
  const clean = v => String(v ?? '').replace(/^[^\p{L}\p{N}]+/u, '').trim();

  // Movements between Satispay and your own bank/money boxes: not real income or
  // spending (the bank side is imported from the bank file), excluded by default.
  const SATISPAY_INTERNAL = /savings|money box|salvadanaio|investment|investiment|to bank|from bank|verso banca|da banca|ricarica/i;

  function parseSatispayXLSX(data) {
    const wb = XLSX.read(data, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

    const headerIdx = rows.findIndex(r => {
      const h = (r || []).map(c => String(c).trim().toLowerCase());
      return h.some(c => c === 'date' || c === 'data') && h.some(c => c === 'amount' || c === 'importo');
    });
    if (headerIdx < 0) throw new Error('Intestazione Satispay ("Date", "Amount", …) non trovata.');

    const header = rows[headerIdx].map(c => String(c).trim().toLowerCase());
    const col = (...names) => header.findIndex(c => names.some(n => c === n || c.startsWith(n)));
    const dateCol = col('date', 'data');
    const nameCol = col('name', 'nome');
    const descCol = col('description', 'descrizione');
    const amtCol  = col('amount', 'importo');
    const typeCol = col('type', 'tipo');
    const statCol = col('status', 'stato');
    const idCol   = col('id');

    const transactions = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r[dateCol] === '' || r[amtCol] === '') continue;

      const status = clean(r[statCol]);
      if (/cancel|annull|rifiut|fail|declin/i.test(status)) continue;

      let amount = r[amtCol];
      if (typeof amount !== 'number') {
        let s = String(amount).replace(/[€\s]/g, '');
        if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
        amount = parseFloat(s);
      }
      if (isNaN(amount) || amount === 0) continue;
      amount = Math.round(amount * 100) / 100;

      let d = r[dateCol];
      if (!(d instanceof Date)) {
        const m = String(d).trim().match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
        if (!m) continue;
        d = m[1].length === 4 ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(+m[3], +m[2] - 1, +m[1]);
      }
      if (isNaN(d.getTime())) continue;
      // Local calendar day (cellDates gives local midnight-based dates)
      const date  = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const year  = d.getFullYear();
      const month = date.substring(0, 7);

      const name = String(r[nameCol] ?? '').trim();
      const note = descCol >= 0 ? String(r[descCol] ?? '').trim() : '';
      const type = clean(r[typeCol]);
      const spId = idCol >= 0 ? String(r[idCol] ?? '').trim() : '';
      const description = (name || type || 'Satispay').substring(0, 120);
      const details = [type, note, status && status !== 'Approved' ? status : ''].filter(Boolean).join(' · ');

      let category = null;
      if (SATISPAY_INTERNAL.test(type)) category = 'Trasferimenti';
      else if (/cashback|reward|points|punti|premio/i.test(type)) category = 'Entrate';

      const tx = {
        // Satispay has its own transaction id: use it, so equal payments on the same day stay distinct
        id:          spId ? `sp-${spId.replace(/[^A-Za-z0-9-]/g, '')}` : genId(date, amount, `satispay|${description}`),
        date,
        month,
        year,
        description,
        amount,
        currency:    'EUR',
        amountEUR:   amount,
        category,
        source:      'satispay',
        type:        type.substring(0, 50),
        balance:     0,
        importedAt:  new Date().toISOString(),
        notes:       ''
      };
      if (details) tx.details = details.substring(0, 500);
      if (type) tx._bankCat = type;
      if (SATISPAY_INTERNAL.test(type)) tx._internal = true;
      transactions.push(tx);
    }
    return uniqueIds(transactions);
  }

  // ── Exchange rate matching ────────────────────────────────
  function matchExchanges(eurExchanges, usdExchanges) {
    if (!eurExchanges.length || !usdExchanges.length) return null;

    const pairs = [];
    let totalEur = 0;
    let totalUsd = 0;

    eurExchanges.forEach(eurTx => {
      if (eurTx.amount >= 0) return; // Spent EUR to buy USD
      const eurSpent = Math.abs(eurTx.amount);

      const usdMatch = usdExchanges.find(u => {
        if (u.amount <= 0) return false;
        const dDiff = Math.abs(new Date(u.date) - new Date(eurTx.date));
        return dDiff <= 2 * 86400000;
      });

      if (usdMatch) {
        const usdRecv = usdMatch.amount;
        const rate    = usdRecv / eurSpent;
        pairs.push({ date: eurTx.date, eur: eurSpent, usd: usdRecv, rate });
        totalEur += eurSpent;
        totalUsd += usdRecv;
      }
    });

    if (!pairs.length || totalEur === 0) return null;
    const avgRate = totalUsd / totalEur;
    return { rate: avgRate, totalEur, totalUsd, pairs };
  }

  function applyEURConversion(txs, rate) {
    return txs.map(t => {
      if (t.currency === 'USD' && t.amountEUR === null) {
        return { ...t, amountEUR: parseFloat((t.amount / rate).toFixed(2)) };
      }
      return t;
    });
  }

  return {
    parseRevolutCSV, parseIntesaXLSX, parseSatispayXLSX, matchExchanges, applyEURConversion,
    suggestCategory, categorize, findDuplicates
  };
})();
