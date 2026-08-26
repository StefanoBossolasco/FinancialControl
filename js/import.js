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
      else tx.category = suggestCategory(description);

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

    if (dateCol < 0) dateCol = 0;
    if (descCol < 0) descCol = 1;
    if (catCol < 0)  catCol = 5;
    if (amtCol < 0)  amtCol = 7;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || (!r[dateCol] && !r[amtCol])) continue;

      let dateStr = r[dateCol];
      const rawAmount = String(r[amtCol] || '').replace(/\./g,'').replace(',','.');
      const amount = parseFloat(rawAmount);
      if (isNaN(amount)) continue;

      // Normalise date
      let date;
      if (dateStr instanceof Date) {
        date = dateStr.toISOString().split('T')[0];
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
      const description = String(r[descCol] || '').substring(0, 120);
      const rawCat = r[catCol] ? String(r[catCol]) : '';

      transactions.push({
        id:          genId(date, amount, description),
        date,
        month,
        year,
        description,
        amount,
        currency:    'EUR',
        amountEUR:   amount,
        category:    mapIntesaCategory(rawCat),
        source:      'intesa',
        type:        description.substring(0, 50),
        balance:     0,
        importedAt:  new Date().toISOString(),
        notes:       ''
      });
    }
    return transactions;
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

  return { parseRevolutCSV, parseIntesaXLSX, matchExchanges, applyEURConversion, suggestCategory };
})();
