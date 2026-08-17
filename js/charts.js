// ============================================================
// CHARTS MODULE — Chart.js wrappers with Apple Design System
// ============================================================
const Charts = (() => {

  // Apple dark theme defaults
  Chart.defaults.color          = '#8e8e93';
  Chart.defaults.borderColor    = 'rgba(255,255,255,0.08)';
  Chart.defaults.font.family    = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Inter', sans-serif";
  Chart.defaults.font.size      = 12;

  // Apple System Palette
  const PALETTE = [
    '#0a84ff', '#30d158', '#ff9f0a', '#ff453a', '#bf5af2',
    '#64d2ff', '#ff375f', '#ffd60a', '#5e5ce6', '#32ade6',
    '#ff9500', '#af52de', '#5856d6', '#34c759', '#ff2d55', '#007aff'
  ];

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

  // ── Donut — category breakdown ────────────────────────────
  function donut(id, totals) {
    const entries = Object.entries(totals).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]);
    const labels  = entries.map(([k]) => k);
    const data    = entries.map(([,v]) => v);
    return create(id, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: PALETTE.slice(0, labels.length),
          borderColor: 'transparent',
          hoverOffset: 12
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { padding: 14, usePointStyle: true, pointStyle: 'circle', font: { size: 11, weight: '500' } }
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
    const cats   = categories.filter(c => (budgets[c] || 0) > 0 || (actuals[c] || 0) > 0);
    const bData  = cats.map(c => budgets[c] || 0);
    const aData  = cats.map(c => actuals[c]  || 0);
    const aColors = aData.map((v, i) => v > bData[i] ? 'rgba(255,69,58,0.85)' : 'rgba(48,209,88,0.85)');
    const aBorder = aData.map((v, i) => v > bData[i] ? '#ff453a' : '#30d158');

    return create(id, {
      type: 'bar',
      data: {
        labels: cats,
        datasets: [
          { label: 'Budget', data: bData,
            backgroundColor: 'rgba(10,132,255,0.25)', borderColor: '#0a84ff', borderWidth: 1.5, borderRadius: 6 },
          { label: 'Effettivo', data: aData,
            backgroundColor: aColors, borderColor: aBorder, borderWidth: 1.5, borderRadius: 6 }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle' } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { callback: v => fmt(v, true) } },
          y: { grid: { display: false } }
        }
      }
    });
  }

  // ── Monthly trend bar — Income vs Expenses ─────────────────
  function monthlyTrend(id, monthlyData) {
    const labels   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const expData  = labels.map((_, i) => monthlyData[i+1]?.exp || 0);
    const incData  = labels.map((_, i) => monthlyData[i+1]?.inc || 0);

    return create(id, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Entrate', data: incData, backgroundColor: 'rgba(48,209,88,0.85)', borderRadius: 6 },
          { label: 'Uscite',  data: expData, backgroundColor: 'rgba(255,69,58,0.85)', borderRadius: 6 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle' } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { callback: v => fmt(v, true) } }
        }
      }
    });
  }

  // ── Annual stacked bar — Expenses per category ────────────
  function annualStacked(id, year, txs) {
    const labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const catMap = {};

    txs.filter(t => t.amountEUR < 0).forEach(t => {
      const m = new Date(t.date).getMonth(); // 0-11
      const c = t.category || 'Altro';
      if (!catMap[c]) catMap[c] = new Array(12).fill(0);
      catMap[c][m] += Math.abs(t.amountEUR);
    });

    const datasets = Object.entries(catMap).map(([cat, values], i) => ({
      label: cat,
      data: values,
      backgroundColor: PALETTE[i % PALETTE.length],
      borderRadius: 3
    }));

    return create(id, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', font: { size: 10 } } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { callback: v => fmt(v, true) } }
        }
      }
    });
  }

  // ── Balance line — Total account evolution ────────────────
  function balanceLine(id, allTxs, initialBalance = 0) {
    const sorted = [...allTxs].sort((a,b) => new Date(a.date) - new Date(b.date));

    // Group by month
    const monthBalance = {};
    let current = initialBalance;

    sorted.forEach(t => {
      current += t.amountEUR;
      monthBalance[t.month] = current;
    });

    const labels = Object.keys(monthBalance).sort();
    const data   = labels.map(m => monthBalance[m]);

    return create(id, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Saldo Totale (EUR)',
          data,
          borderColor: '#0a84ff',
          backgroundColor: (ctx) => {
            const chart = ctx.chart;
            const { ctx: c, chartArea: a } = chart;
            if (!a) return 'rgba(10,132,255,0.1)';
            const gradient = c.createLinearGradient(0, a.top, 0, a.bottom);
            gradient.addColorStop(0, 'rgba(10,132,255,0.35)');
            gradient.addColorStop(1, 'rgba(10,132,255,0.0)');
            return gradient;
          },
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: '#0a84ff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` Saldo: ${fmt(ctx.raw)}` } }
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.06)' } },
          y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { callback: v => fmt(v, true) } }
        }
      }
    });
  }

  // ── Year Comparison Line ──────────────────────────────────
  function yearComparison(id, yearsData) {
    const labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const datasets = Object.entries(yearsData).map(([yr, mData], i) => ({
      label: yr,
      data: labels.map((_, idx) => mData[idx+1]?.exp || 0),
      borderColor: PALETTE[i % PALETTE.length],
      backgroundColor: 'transparent',
      tension: 0.35,
      borderWidth: 2,
      pointRadius: 3
    }));

    return create(id, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle' } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { callback: v => fmt(v, true) } }
        }
      }
    });
  }

  return { donut, budgetBar, monthlyTrend, annualStacked, balanceLine, yearComparison, destroy };
})();
