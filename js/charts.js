/**
 * ParetoPC Dashboard - Chart factories using Chart.js
 */
window.PC = window.PC || {};

PC.charts = (() => {
  const U = PC.utils;

  // Set Chart.js defaults — picked up dynamically based on theme
  function applyTheme() {
    const isDark = document.documentElement.classList.contains('dark');
    Chart.defaults.color = isDark ? '#9aa3b9' : '#475569';
    Chart.defaults.borderColor = isDark ? 'rgba(45,52,84,0.5)' : 'rgba(100,116,139,0.15)';
    Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
    Chart.defaults.font.size = 11;
    Chart.defaults.plugins.tooltip.backgroundColor = isDark ? 'rgba(11,15,30,0.95)' : 'rgba(15,23,42,0.95)';
    Chart.defaults.plugins.tooltip.borderColor = isDark ? '#2d3454' : '#cbd5e1';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 12;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.titleFont = { size: 12, weight: 600 };
    Chart.defaults.plugins.tooltip.bodyFont = { size: 12, weight: 500 };
    Chart.defaults.plugins.tooltip.boxPadding = 6;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyle = 'circle';
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.plugins.legend.labels.boxHeight = 8;
    Chart.defaults.plugins.legend.labels.padding = 14;
  }
  applyTheme();

  const _instances = {};

  /** Destroy previous chart on a canvas before re-creating */
  function _replace(id, config) {
    applyTheme();
    if (_instances[id]) {
      _instances[id].destroy();
      delete _instances[id];
    }
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    _instances[id] = new Chart(canvas.getContext('2d'), config);
    return _instances[id];
  }

  function destroyAll() {
    for (const k of Object.keys(_instances)) {
      try { _instances[k].destroy(); } catch (e) {}
      delete _instances[k];
    }
  }

  function refreshTheme() {
    applyTheme();
    for (const k of Object.keys(_instances)) {
      try { _instances[k].update(); } catch (e) {}
    }
  }

  /* ---------- Charts ---------- */

  function trendChart(monthly) {
    const datasets = monthly.datasets.map((ds, i) => {
      const color = ds.color || U.paletteColor(i);
      return {
        label: ds.label,
        data: ds.data,
        backgroundColor: color + '20',
        borderColor: color,
        tension: 0.4,                 // smoother bezier
        cubicInterpolationMode: 'monotone',
        borderWidth: 2.5,
        pointRadius: 5,
        pointHoverRadius: 8,
        pointBackgroundColor: color,
        pointBorderColor: '#0a0e1a',
        pointBorderWidth: 2,
        pointHoverBorderWidth: 3,
        pointHoverBackgroundColor: color,
        pointHoverBorderColor: '#fff',
        fill: true,
      };
    });
    return _replace('chart-trend', {
      type: 'line',
      data: { labels: monthly.labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, padding: 14, usePointStyle: true, pointStyle: 'circle' } },
          tooltip: {
            callbacks: { label: (c) => `${c.dataset.label}: ${U.formatIDR(c.parsed.y)}` }
          }
        },
        scales: {
          y: {
            ticks: { callback: (v) => U.formatIDRCompact(v) },
            grid: { color: 'rgba(45,52,84,0.35)', drawBorder: false }
          },
          x: { grid: { display: false }, ticks: { font: { weight: 500 } } }
        }
      }
    });
  }

  function deptMixChart(deptAgg) {
    return _doughnut('chart-mix', deptAgg, { colorFn: (l) => U.deptColor(l) });
  }

  /** Brand mix doughnut for a single department — uses palette colors */
  function brandMixChart(brandAgg) {
    return _doughnut('chart-mix', brandAgg, { colorFn: (l, i) => U.paletteColor(i) });
  }

  function _doughnut(canvasId, agg, opts = {}) {
    const { colorFn = (l, i) => U.paletteColor(i) } = opts;
    const labels = agg.map(d => d.key);
    const data = agg.map(d => d.total);
    const colors = labels.map((l, i) => colorFn(l, i));
    return _replace(canvasId, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 3, borderColor: '#0a0e1a', hoverBorderWidth: 0, hoverOffset: 8 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, padding: 12, usePointStyle: true, pointStyle: 'circle', font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (c) => {
                const tot = c.dataset.data.reduce((a,b) => a+b, 0);
                const pct = tot ? ((c.parsed / tot) * 100).toFixed(1) : 0;
                return `${c.label}: ${U.formatIDR(c.parsed)} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  function topBarChart(canvasId, agg, label) {
    const labels = agg.map(d => d.key);
    const data = agg.map(d => d.total);
    // Use ELS-inspired magenta-purple gradient palette
    const palette = ['#ec4899','#a855f7','#06b6d4','#f59e0b','#10b981','#3b82f6','#f472b6','#8b5cf6','#facc15','#22d3ee'];
    return _replace(canvasId, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label,
          data,
          backgroundColor: labels.map((_, i) => palette[i % palette.length] + 'cc'),
          borderColor: labels.map((_, i) => palette[i % palette.length]),
          borderWidth: 1,
          borderRadius: 6,
          barThickness: 'flex',
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c) => `${U.formatIDR(c.parsed.x)} · ${U.formatNumber(agg[c.dataIndex].qty)} unit`
            }
          }
        },
        scales: {
          x: {
            ticks: { callback: (v) => U.formatIDRCompact(v) },
            grid: { color: 'rgba(45,52,84,0.25)', drawBorder: false }
          },
          y: {
            grid: { display: false },
            ticks: {
              autoSkip: false,
              font: { weight: 500 },
              callback: function(value) {
                const lbl = this.getLabelForValue(value);
                if (typeof lbl === 'string' && lbl.length > 30) return lbl.slice(0, 28) + '…';
                return lbl;
              }
            }
          }
        }
      }
    });
  }

  function paretoChart(p) {
    const labels = p.items.map(x => {
      const s = String(x.key);
      return s.length > 28 ? s.slice(0, 26) + '…' : s;
    });
    const totals = p.items.map(x => x.total);
    const cum = p.items.map(x => x.cumPct);

    // Highlight items in 80% with magenta gradient, rest in muted gray
    const cutoff = p.cutoffIdx === -1 ? p.items.length - 1 : p.cutoffIdx;
    const colors = p.items.map((_, i) => i <= cutoff ? '#ec4899' : 'rgba(148,163,184,0.4)');
    const borders = p.items.map((_, i) => i <= cutoff ? '#f472b6' : 'rgba(148,163,184,0.6)');

    return _replace('chart-pareto', {
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Omzet',
            data: totals,
            backgroundColor: colors,
            borderColor: borders,
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: 'y',
          },
          {
            type: 'line',
            label: 'Kumulatif %',
            data: cum,
            borderColor: '#06b6d4',
            backgroundColor: 'rgba(6,182,212,0.15)',
            borderWidth: 2.5,
            tension: 0.35,
            cubicInterpolationMode: 'monotone',
            pointRadius: 4,
            pointHoverRadius: 7,
            pointBackgroundColor: '#06b6d4',
            pointBorderColor: '#0a0e1a',
            pointBorderWidth: 2,
            yAxisID: 'y1',
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (c) => {
                if (c.dataset.type === 'line') return `Kumulatif: ${c.parsed.y.toFixed(1)}%`;
                const item = p.items[c.dataIndex];
                return `${U.formatIDR(item.total)} · ${item.pct.toFixed(1)}%`;
              }
            }
          },
        },
        scales: {
          y: {
            position: 'left',
            ticks: { callback: (v) => U.formatIDRCompact(v) },
            grid: { color: 'rgba(45,52,84,0.25)', drawBorder: false }
          },
          y1: {
            position: 'right',
            min: 0, max: 100,
            ticks: { callback: (v) => v + '%', color: '#06b6d4' },
            grid: { drawOnChartArea: false }
          },
          x: {
            ticks: { autoSkip: false, maxRotation: 60, minRotation: 45, font: { size: 10 } },
            grid: { display: false }
          }
        }
      }
    });
  }

  function distChart(canvasId, agg, label) {
    const labels = agg.map(d => d.key);
    const data = agg.map(d => d.qty);
    const palette = ['#ec4899','#a855f7','#06b6d4','#f59e0b','#10b981','#3b82f6','#f472b6','#8b5cf6'];
    return _replace(canvasId, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label,
          data,
          backgroundColor: labels.map((_, i) => palette[i % palette.length] + 'cc'),
          borderColor: labels.map((_, i) => palette[i % palette.length]),
          borderWidth: 1,
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c) => `${U.formatNumber(c.parsed.y)} unit · ${U.formatIDR(agg[c.dataIndex].total)}`
            }
          }
        },
        scales: {
          y: { ticks: { callback: (v) => U.formatNumber(v) }, grid: { color: 'rgba(45,52,84,0.25)', drawBorder: false } },
          x: { grid: { display: false }, ticks: { font: { weight: 500 } } }
        }
      }
    });
  }

  function yoyChart(yoy) {
    // Year palette inspired by ELS: 2024 gray, 2025 cyan-blue, 2026 magenta
    const yearColors = {
      2023: '#475569',
      2024: '#94a3b8',
      2025: '#3b82f6',
      2026: '#ec4899',
      2027: '#10b981',
    };
    const datasets = yoy.datasets.map((ds, i) => {
      const yr = parseInt(ds.label, 10);
      const color = yearColors[yr] || U.paletteColor(i);
      return {
        label: `${ds.label} - Omzet`,
        data: ds.data,
        backgroundColor: color + '15',
        borderColor: color,
        tension: 0.4,
        cubicInterpolationMode: 'monotone',
        borderWidth: 2.5,
        pointRadius: 5,
        pointHoverRadius: 8,
        pointBackgroundColor: color,
        pointBorderColor: '#0a0e1a',
        pointBorderWidth: 2,
        fill: false,
      };
    });
    return _replace('chart-yoy', {
      type: 'line',
      data: { labels: yoy.labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'end', labels: { boxWidth: 8, boxHeight: 8, padding: 16, usePointStyle: true, pointStyle: 'circle' } },
          tooltip: {
            callbacks: { label: (c) => `${c.dataset.label}: ${U.formatIDR(c.parsed.y)}` }
          }
        },
        scales: {
          y: {
            ticks: { callback: (v) => U.formatIDRCompact(v) },
            grid: { color: 'rgba(45,52,84,0.35)', drawBorder: false }
          },
          x: { grid: { display: false }, ticks: { font: { weight: 500 } } }
        }
      }
    });
  }

  function pieChart(canvasId, agg) {
    const labels = agg.map(d => d.key);
    const data = agg.map(d => d.qty || d.total);
    const colors = labels.map((_, i) => U.paletteColor(i));
    return _replace(canvasId, {
      type: 'pie',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: 'transparent' }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, padding: 10 } },
          tooltip: {
            callbacks: {
              label: (c) => {
                const tot = c.dataset.data.reduce((a,b) => a+b, 0);
                const pct = tot ? ((c.parsed / tot) * 100).toFixed(1) : 0;
                return `${c.label}: ${U.formatNumber(c.parsed)} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  return {
    trendChart, deptMixChart, brandMixChart, topBarChart, paretoChart, distChart, pieChart,
    yoyChart,
    refreshTheme, destroyAll
  };
})();
