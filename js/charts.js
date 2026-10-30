// ============================================================
// CHARTS MODULE — Chart.js wrappers, colours read from the CSS theme
// ============================================================
const Charts = (() => {

  Chart.defaults.font.family = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  Chart.defaults.font.size   = 12;
  Chart.defaults.font.weight = '500';

  // One colour + icon per category, shared by charts and transaction avatars
  const CATEGORY_STYLE = {
    'Affitto & Casa':            { color: '#7a5cf5', icon: 'home' },
    'Spesa Alimentare':          { color: '#16a86c', icon: 'shopping-cart' },
    'Ristoranti & Bar':          { color: '#ff8a3d', icon: 'utensils' },
    'Trasporti & Mobilità':      { color: '#2f7bff', icon: 'bus' },
    'Viaggi & Vacanze':          { color: '#14b5c9', icon: 'plane' },
    'Abbigliamento & Shopping':  { color: '#e6467e', icon: 'shopping-bag' },
    'Salute & Farmacia':         { color: '#f23a4c', icon: 'heart-pulse' },
    'Sport & Fitness':           { color: '#20b26b', icon: 'dumbbell' },
    'Streaming & Abbonamenti':   { color: '#9b51e0', icon: 'tv' },
    'Utenze & Domiciliazioni':   { color: '#f2a90f', icon: 'zap' },
    'Imposte & Tasse':           { color: '#5c6b80', icon: 'landmark' },
    'Commissioni Bancarie':      { color: '#8a8f98', icon: 'percent' },
    'Intrattenimento':           { color: '#ff5fa2', icon: 'ticket' },
    'Trasferimenti':             { color: '#3a8fd9', icon: 'arrow-left-right' },
    'Entrate':                   { color: '#11a46a', icon: 'arrow-down-left' },
    'Altro':                     { color: '#8a8a96', icon: 'ellipsis' }
  };
  const EXTRA = ['#f23a4c', '#ff8a3d', '#f2a90f', '#16a86c', '#14b5c9', '#2f7bff', '#7a5cf5', '#e6467e', '#5c6b80', '#20b26b'];

  function categoryStyle(cat) {
    if (CATEGORY_STYLE[cat]) return CATEGORY_STYLE[cat];
    let h = 0;
    for (const ch of String(cat || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return { color: EXTRA[h % EXTRA.length], icon: 'tag' };
  }
  const catColor = cat => categoryStyle(cat).color;

  // Theme colours, read when each chart is built so light/dark both work
  function theme() {
    const s = getComputedStyle(document.documentElement);
    const v = n => s.getPropertyValue(n).trim();
    return {
      accent: v('--accent'), success: v('--success'), danger: v('--danger'), warning: v('--warning'),
      text: v('--text'), text2: v('--text2'), text3: v('--text3'), surface: v('--surface'),
      grid: v('--chart-grid')
    };
  }

  function alpha(color, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(color);
    if (!m) return color;
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function gradient(color, top = 0.24) {
    return ctx => {
      const { ctx: c, chartArea: a } = ctx.chart;
      if (!a) return alpha(color, 0.1);
      const g = c.createLinearGradient(0, a.top, 0, a.bottom);
      g.addColorStop(0, alpha(color, top));
      g.addColorStop(1, alpha(color, 0));
      return g;
    };
  }

  // Applied on every theme change (and at load) from app.js
  function applyTheme() {
    const t = theme();
    Chart.defaults.color = t.text2;
    Chart.defaults.borderColor = t.grid;
    const tt = Chart.defaults.plugins.tooltip;
    tt.backgroundColor = t.text;
    tt.titleColor = t.surface;
    tt.bodyColor = t.surface;
    tt.padding = 10;
    tt.cornerRadius = 12;
    tt.boxPadding = 4;
    tt.titleFont = { weight: '700' };
    tt.usePointStyle = true;
    const lg = Chart.defaults.plugins.legend.labels;
    lg.usePointStyle = true;
    lg.pointStyle = 'circle';
    lg.boxWidth = 8;
    lg.boxHeight = 8;
  }

  const _instances = {};

  function destroy(id) {
    if (_instances[id]) { _instances[id].destroy(); delete _instances[id]; }
  }

  function create(id, config) {
    destroy(id);
    const el = document.getElementById(id);
    if (!el) return null;
    const chart = new Chart(el, config);
    _instances[id] = chart;
    return chart;
  }

  function fmt(v, compact = false) {
    if (compact && Math.abs(v) >= 1000)
      return `€${(v / 1000).toFixed(1)}k`;
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
  }

  const MONTHS = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
  const isNarrow = () => window.innerWidth <= 560;

  // ── Donut — category breakdown ────────────────────────────
  function donut(id, totals) {
    const t = theme();
    const entries = Object.entries(totals).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]);
    const labels  = entries.map(([k]) => k);
    const data    = entries.map(([,v]) => v);
    return create(id, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: labels.map(catColor),
          borderColor: t.surface,
          borderWidth: 3,
          borderRadius: 6,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { padding: 12, font: { size: 11, weight: '600' } }
          },
          tooltip: {
            callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.raw)}` }
          }
        }
      }
    });
  }

  // ── Horizontal bar — Budget vs Actual ────────────────────
  function budgetBar(id, budgets, actuals, categories) {
    const t = theme();
    const cats   = categories.filter(c => (budgets[c] || 0) > 0 || (actuals[c] || 0) > 0);
    const bData  = cats.map(c => budgets[c] || 0);
    const aData  = cats.map(c => actuals[c]  || 0);
    const aColors = aData.map((v, i) => v > bData[i] ? t.danger : t.success);

    return create(id, {
      type: 'bar',
      data: {
        labels: cats,
        datasets: [
          { label: 'Budget', data: bData, backgroundColor: alpha(t.text3, 0.28), borderRadius: 6, borderSkipped: false,
            barPercentage: 0.9, categoryPercentage: 0.75 },
          { label: 'Effettivo', data: aData, backgroundColor: aColors, borderRadius: 6, borderSkipped: false,
            barPercentage: 0.9, categoryPercentage: 0.75 }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', align: 'end' },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
        },
        scales: {
          x: { grid: { color: t.grid }, border: { display: false }, ticks: { callback: v => fmt(v, true), maxTicksLimit: isNarrow() ? 4 : 8 } },
          y: { grid: { display: false }, border: { display: false },
               ticks: { font: { size: isNarrow() ? 10 : 12 }, callback(v) { const l = this.getLabelForValue(v); return isNarrow() && l.length > 16 ? l.slice(0, 15) + '…' : l; } } }
        }
      }
    });
  }

  // ── Monthly trend line — Income vs Expenses ─────────────────
  function monthlyTrend(id, year, monthlyData) {
    const t = theme();
    const labels   = MONTHS;
    const expData  = labels.map((_, i) => {
      const k = `${year}-${String(i+1).padStart(2,'0')}`;
      return monthlyData[k]?.expenses || monthlyData[i+1]?.expenses || monthlyData[i+1]?.exp || 0;
    });
    const incData  = labels.map((_, i) => {
      const k = `${year}-${String(i+1).padStart(2,'0')}`;
      return monthlyData[k]?.income || monthlyData[i+1]?.income || monthlyData[i+1]?.inc || 0;
    });
    const line = (label, data, color) => ({
      label, data, borderColor: color, backgroundColor: gradient(color, 0.2),
      fill: true, tension: 0.4, borderWidth: 2.5,
      pointRadius: 0, pointHoverRadius: 6, pointBackgroundColor: color, pointBorderColor: t.surface, pointBorderWidth: 2
    });

    return create(id, {
      type: 'line',
      data: { labels, datasets: [line('Entrate', incData, t.success), line('Uscite', expData, t.accent)] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'end' },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: { grid: { color: t.grid }, border: { display: false }, ticks: { callback: v => fmt(v, true), maxTicksLimit: 6 } }
        }
      }
    });
  }

  // ── Annual stacked bar — Expenses per category ────────────
  function annualStacked(id, year, txs) {
    const t = theme();
    const labels = MONTHS;
    const catMap = {};

    const fx = Data.shareFactors();
    txs.filter(t => t.category !== '__exchange__' && t.amountEUR < 0).forEach(t => {
      const m = new Date(t.date).getMonth(); // 0-11
      const c = t.category || 'Altro';
      if (!catMap[c]) catMap[c] = new Array(12).fill(0);
      catMap[c][m] += Math.abs(Data.myAmount(t, fx));
    });

    const datasets = Object.entries(catMap).map(([cat, values]) => ({
      label: cat,
      data: values,
      backgroundColor: catColor(cat),
      borderRadius: 4,
      borderSkipped: false,
      borderColor: t.surface,
      borderWidth: { top: 1.5 }
    }));

    return create(id, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 10.5, weight: '600' }, padding: 10 } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, border: { display: false } },
          y: { stacked: true, grid: { color: t.grid }, border: { display: false }, ticks: { callback: v => fmt(v, true), maxTicksLimit: 6 } }
        }
      }
    });
  }

  // ── Balance line — Total account evolution with seamless Forecast ──────────
  function balanceLine(id, balanceData, mode = 'monthly') {
    const t = theme();
    let labels = [];
    let datasets = [];
    let showLegend = false;

    if (balanceData && balanceData.labels) {
      labels = balanceData.labels;
      showLegend = balanceData.hasForecast || false;

      datasets.push({
        label: 'Saldo reale',
        data: balanceData.realData,
        borderColor: t.accent,
        backgroundColor: gradient(t.accent, 0.22),
        fill: true,
        tension: mode === 'daily' ? 0.15 : 0.4,
        borderWidth: 2.5,
        pointRadius: mode === 'daily' ? 0 : 3,
        pointHoverRadius: 6,
        pointBackgroundColor: t.accent,
        pointBorderColor: t.surface,
        pointBorderWidth: 2
      });

      if (balanceData.hasForecast && balanceData.forecastData && balanceData.forecastData.some(v => v !== null)) {
        datasets.push({
          label: 'Previsione (budget mesi futuri)',
          data: balanceData.forecastData,
          borderColor: t.warning,
          borderDash: [6, 6],
          backgroundColor: gradient(t.warning, 0.16),
          fill: true,
          tension: 0.4,
          borderWidth: 2.5,
          pointRadius: mode === 'daily' ? 0 : 3,
          pointHoverRadius: 6,
          pointBackgroundColor: t.warning,
          pointBorderColor: t.surface,
          pointBorderWidth: 2
        });
      }
    } else {
      // Fallback if raw array passed
      labels = Array.isArray(balanceData) ? balanceData.map((_, i) => `P${i+1}`) : [];
      datasets.push({
        label: 'Saldo totale (EUR)',
        data: Array.isArray(balanceData) ? balanceData : [],
        borderColor: t.accent,
        fill: true,
        tension: 0.35,
        borderWidth: 2.5
      });
    }

    return create(id, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: showLegend, position: 'top', align: 'end' },
          tooltip: {
            callbacks: {
              label: ctx => {
                if (ctx.raw === null || ctx.raw === undefined) return '';
                return ` ${ctx.dataset.label}: ${fmt(ctx.raw)}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false }, border: { display: false },
            ticks: { maxTicksLimit: isNarrow() ? 6 : (mode === 'daily' ? 30 : 24), font: { size: 10.5 } }
          },
          y: { grid: { color: t.grid }, border: { display: false }, ticks: { callback: v => fmt(v, true), maxTicksLimit: 6 } }
        }
      }
    });
  }

  // ── Year Comparison Line ──────────────────────────────────
  function yearComparison(id, yearsData) {
    const t = theme();
    const labels = MONTHS;
    const colors = [t.accent, '#2f7bff', '#16a86c', '#f2a90f', '#7a5cf5', '#14b5c9'];
    const datasets = Object.entries(yearsData).map(([yr, mData], i) => ({
      label: yr,
      data: labels.map((_, idx) => {
        const k = `${yr}-${String(idx+1).padStart(2,'0')}`;
        return mData[k]?.expenses || mData[idx+1]?.expenses || mData[idx+1]?.exp || 0;
      }),
      borderColor: colors[i % colors.length],
      backgroundColor: colors[i % colors.length],
      tension: 0.4,
      borderWidth: 2.5,
      pointRadius: 0,
      pointHoverRadius: 5
    }));

    return create(id, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'end' },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: { grid: { color: t.grid }, border: { display: false }, ticks: { callback: v => fmt(v, true), maxTicksLimit: 6 } }
        }
      }
    });
  }

  // ── Forecast Chart — Actual vs Planned Budget & Portfolio Balance ───────────
  function forecast(id, forecastData) {
    const t = theme();
    const { labels, monthlyExpActual, monthlyExpForecast, monthlyBalanceForecast } = forecastData;

    return create(id, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Spesa reale (consuntivo)',
            data: monthlyExpActual,
            backgroundColor: t.accent,
            borderRadius: 6,
            order: 2
          },
          {
            type: 'bar',
            label: 'Budget previsto (mesi futuri)',
            data: monthlyExpForecast,
            backgroundColor: alpha(t.warning, 0.7),
            borderRadius: 6,
            order: 2
          },
          {
            type: 'line',
            label: 'Previsione saldo',
            data: monthlyBalanceForecast,
            borderColor: t.text2,
            backgroundColor: 'transparent',
            tension: 0.35,
            borderWidth: 2.5,
            pointRadius: 3,
            pointBackgroundColor: t.text2,
            yAxisID: 'y1',
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: ctx => {
                if (ctx.raw === null || ctx.raw === undefined) return '';
                return ` ${ctx.dataset.label}: ${fmt(ctx.raw)}`;
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            title: { display: true, text: 'Spese / Budget (€)', font: { size: 11 } },
            grid: { color: t.grid },
            ticks: { callback: v => fmt(v, true) }
          },
          y1: {
            position: 'right',
            title: { display: true, text: 'Saldo previsionale (€)', font: { size: 11 } },
            grid: { display: false },
            ticks: { callback: v => fmt(v, true) }
          }
        }
      }
    });
  }

  // ── Wallet timeline — balance from the base: income adds, expenses subtract ──
  function walletTimeline(id, txs, base) {
    const t = theme();
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0].date, last = sorted[sorted.length - 1].date;
    const spanDays = (new Date(last) - new Date(first)) / 86400000;
    const byDay = spanDays <= 62;
    const keyOf = t => byDay ? t.date : t.date.substring(0, 7);

    // Continuous axis so gaps show as empty periods
    const keys = [];
    const cur = new Date(first + 'T00:00:00');
    const end = new Date(last + 'T00:00:00');
    if (!byDay) cur.setDate(1);
    while (cur <= end) {
      const ym = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
      keys.push(byDay ? `${ym}-${String(cur.getDate()).padStart(2, '0')}` : ym);
      if (byDay) cur.setDate(cur.getDate() + 1); else cur.setMonth(cur.getMonth() + 1);
    }

    const inc = {}, exp = {};
    sorted.forEach(t => {
      const k = keyOf(t);
      if (t.amountEUR > 0) inc[k] = (inc[k] || 0) + t.amountEUR;
      else exp[k] = (exp[k] || 0) + Math.abs(t.amountEUR);
    });
    const r2 = v => Math.round(v * 100) / 100;
    const incData = [0, ...keys.map(k => r2(inc[k] || 0))];
    const expData = [0, ...keys.map(k => -r2(exp[k] || 0))];
    let run = base;
    const balance = [r2(base), ...keys.map(k => r2(run += (inc[k] || 0) - (exp[k] || 0)))];

    const labels = ['Base', ...keys.map(k => byDay
      ? new Date(k + 'T00:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
      : new Date(k + '-01T00:00:00').toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }))];

    return create(id, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { type: 'line', label: 'Saldo', data: balance, borderColor: t.text, backgroundColor: t.text,
            borderWidth: 2.5, tension: 0.3, pointRadius: labels.length > 40 ? 0 : 3, pointBorderColor: t.surface, pointBorderWidth: 1.5, order: 1 },
          { label: 'Entrate (+)', data: incData, stack: 'flow',
            backgroundColor: alpha(t.success, 0.75), borderRadius: 5, borderSkipped: false, order: 2 },
          { label: 'Uscite (−)', data: expData, stack: 'flow',
            backgroundColor: alpha(t.accent, 0.75), borderRadius: 5, borderSkipped: false, order: 3 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'end' },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: isNarrow() ? 6 : 16 } },
          y: { beginAtZero: true, border: { display: false },
               grid: { color: ctx => ctx.tick.value === 0 ? alpha(t.text3, 0.6) : t.grid },
               ticks: { callback: v => fmt(v, true), maxTicksLimit: 6 } }
        }
      }
    });
  }

  // ── Subscriptions — charges per month (last 12 months) ────
  // months: ['YYYY-MM', ...]; subs: totals per month (same order)
  function subscriptionMonths(id, months, subs) {
    const t = theme();
    const labels = months.map(m => MONTHS[+m.substring(5, 7) - 1] + (m.endsWith('-01') ? ` ${m.substring(2, 4)}` : ''));
    const bar = (label, data, color) => ({ label, data, backgroundColor: color, borderRadius: 6, borderSkipped: false,
      barPercentage: 0.8, categoryPercentage: 0.7 });
    return create(id, {
      type: 'bar',
      data: { labels, datasets: [bar('Abbonamenti', subs, t.accent)] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 6 } },
          y: { beginAtZero: true, grid: { color: t.grid }, border: { display: false },
               ticks: { callback: v => fmt(v, true), maxTicksLimit: 5 } }
        }
      }
    });
  }

  return { walletTimeline, donut, budgetBar, monthlyTrend, annualStacked, balanceLine, yearComparison, forecast, destroy,
           subscriptionMonths, applyTheme, categoryStyle };
})();
