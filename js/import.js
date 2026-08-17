// ============================================================
// IMPORT MODULE — Revolut CSV + Intesa XLSX parsing
// Exchange rate calculation (EUR/USD weighted average)
// ============================================================
const Import = (() => {

  // ── Intesa category → our category ──────────────────────
  const INTESA_MAP = {
    'trasporti':              'Trasporti & Mobilità',
    'noleggi':                'Trasporti & Mobilità',
    'taxi':                   'Trasporti & Mobilità',
    'parcheggi':              'Trasporti & Mobilità',
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
  };

  // ── Revolut auto-suggest keywords ────────────────────────
  const KW_MAP = {
    'Affitto & Casa':         ['rent','affitto','housing','propane','pasadena propane','property'],
    'Spesa Alimentare':       ['grocery','supermarket','albertsons','vallarta','trader joe','whole foods','food','market','deli','kroger','safeway'],
    'Ristoranti & Bar':       ['restaurant','cafe','pizza','burger','starbucks','bar','sushi','diner','kitchen','grill','orbit','jpl cafe','dena burgers','liquor','bistro','tavern'],
    'Trasporti & Mobilità':   ['uber','waymo','lyft','taxi','parking','amtrak','train','metro','mta','joes auto','auto park','transit','bus','subway'],
    'Viaggi & Vacanze':       ['hotel','marriott','holiday inn','airbnb','southwest','american airlines','united','delta','flight','easyjet','ita','south rim','general store','lax travel','canyon','resort','motel','booking'],
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

  function suggestCategory(description) {
    const low = description.toLowerCase();
    for (const [cat, kws] of Object.entries(KW_MAP)) {
      if (kws.some(k => low.includes(k))) return cat;
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

  // ── Parse Revolut CSV ─────────────────────────────────────
  // currency: 'EUR' or 'USD'
  function parseRevolutCSV(csvText, currency) {
    const { data } = Papa.parse(csvText.trim(), { header: true, skipEmptyLines: true });
    const transactions = [];
    const exchanges    = []; // Exchange-type rows (for rate calculation)

    data.forEach(row => {
      if (!['COMPLETED','PENDING'].includes(row.State)) return;
      const amount = parseFloat(row.Amount);
      const dateRaw = (row['Started Date'] || '').split(' ')[0];
      if (!dateRaw || isNaN(amount)) return;

      const dateObj = new Date(dateRaw);
      if (isNaN(dateObj)) return;
      const year  = dateObj.getFullYear();
      const month = `${year}-${String(dateObj.getMonth() + 1).padStart(2,'0')}`;

      const tx = {
        id:          genId(dateRaw, amount, row.Description),
        date:        dateRaw,
        month,
        year,
        description: (row.Description || '').substring(0, 120),
        amount,
        currency:    row.Currency || currency,
        amountEUR:   currency === 'EUR' ? amount : null,
        category:    null,
        source:      currency === 'EUR' ? 'revolut_eur' : 'revolut_usd',
        type:        row.Type || '',
        balance:     parseFloat(row.Balance) || 0,
        importedAt:  new Date().toISOString(),
        notes:       ''
      };

      if (row.Type === 'Exchange') {
        exchanges.push(tx);
        // Exchange rows are not expense/income — skip categorisation
        tx.category = '__exchange__';
        transactions.push(tx);
        return;
      }

      // Categorise
      if (row.Type === 'Transfer' && amount < 0) tx.category = 'Trasferimenti';
      else if (row.Type === 'Transfer' && amount > 0) tx.category = 'Entrate';
      else if (amount > 0) tx.category = 'Entrate';
      else tx.category = suggestCategory(row.Description);

      transactions.push(tx);
    });

    return { transactions, exchanges };
  }

  // ── Parse Intesa XLSX ─────────────────────────────────────
  function parseIntesaXLSX(arrayBuffer) {
    const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

    const transactions = [];
    let headerIdx = -1;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r && String(r[0]).trim() === 'Data') { headerIdx = i; break; }
    }
    if (headerIdx < 0) throw new Error('Header "Data" non trovato nel file Intesa.');

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r[0] && !r[7]) continue;

      let dateStr = r[0];
      const rawAmount = String(r[7] || '').replace(/\./g,'').replace(',','.');
      const amount = parseFloat(rawAmount);
      if (isNaN(amount)) continue;

      // Normalise date
      let date;
      if (dateStr instanceof Date) {
        date = dateStr.toISOString().split('T')[0];
      } else {
        const parts = String(dateStr).split('/');
        date = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : String(dateStr);
      }
      const d = new Date(date);
      if (isNaN(d)) continue;

      const year  = d.getFullYear();
      const month = `${year}-${String(d.getMonth() + 1).padStart(2,'0')}`;
      const description = String(r[1] || '').substring(0, 120);

      transactions.push({
        id:          genId(date, amount, description),
        date,
        month,
        year,
        description,
        amount,
        currency:    'EUR',
        amountEUR:   amount,
        category:    mapIntesaCategory(r[5]),
        source:      'intesa',
        type:        String(r[1] || '').substring(0, 50),
        balance:     0,
        importedAt:  new Date().toISOString(),
        notes:       ''
      });
    }
    return transactions;
  }

  // ── Exchange rate matching ────────────────────────────────
  // eurExchanges: rows from EUR file with amount < 0  (EUR spent buying USD)
  // usdExchanges: rows from USD file with amount > 0  (USD received)
  function matchExchangeRates(eurExchanges, usdExchanges) {
    const eurSold    = eurExchanges.filter(t => t.amount < 0);
    const usdBought  = usdExchanges.filter(t => t.amount > 0);
    const TOLERANCE  = 24 * 60 * 60 * 1000; // match within same day

    const pairs = [];
    const usedUsd = new Set();

    eurSold.forEach(e => {
      const eDate = new Date(e.date).getTime();
      const match = usdBought.find(u => {
        if (usedUsd.has(u.id)) return false;
        return Math.abs(new Date(u.date).getTime() - eDate) <= TOLERANCE;
      });
      if (match) {
        usedUsd.add(match.id);
        pairs.push({
          date:        e.date,
          eurSpent:    Math.abs(e.amount),
          usdReceived: match.amount,
          rate:        match.amount / Math.abs(e.amount)
        });
      }
    });
    return pairs;
  }

  // Weighted average: total USD received / total EUR spent
  function calculateWeightedRate(pairs) {
    if (!pairs.length) return null;
    const totalEur = pairs.reduce((s, p) => s + p.eurSpent, 0);
    const totalUsd = pairs.reduce((s, p) => s + p.usdReceived, 0);
    return { rate: totalUsd / totalEur, totalEur, totalUsd, pairs };
  }

  // Apply EUR conversion to all USD transactions
  function applyEURConversion(transactions, usdPerEur) {
    return transactions.map(t => {
      if (t.currency === 'USD' && t.amountEUR === null) {
        t.amountEUR = parseFloat((t.amount / usdPerEur).toFixed(2));
      }
      return t;
    });
  }

  return {
    parseRevolutCSV,
    parseIntesaXLSX,
    matchExchangeRates,
    calculateWeightedRate,
    applyEURConversion,
    suggestCategory
  };
})();
