/**
 * ParetoPC Dashboard - Chart factories using Chart.js
 */
window.PC = window.PC || {};

PC.charts = (() => {
  const U = PC.utils;

  // Set Chart.js defaults — picked up dynamically based on theme
  function applyTheme() {
    const isDark = document.documentElement.classList.contains('dark');
    Chart.defaults.color = isDark ? '#cbd5e1' : '#475569';
    Chart.defaults.borderColor = isDark ? 'rgba(148,163,184,0.15)' : 'rgba(100,116,139,0.15)';
    Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
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
    const datasets = monthly.datasets.map((ds, i) => ({
      label: ds.label,
      data: ds.data,
      backgroundColor: (ds.color || U.paletteColor(i)) + '40',
      borderColor: ds.color || U.paletteColor(i),
      tension: 0.3,
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      fill: false,
    }));
    return _replace('chart-trend', {
      type: 'line',
      data: { labels: monthly.labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12 } },
          tooltip: {
            callbacks: { label: (c) => `${c.dataset.label}: ${U.formatIDR(c.parsed.y)}` }
          }
        },
        scales: {
          y: { ticks: { callback: (v) => U.formatIDRCompact(v) }, grid: { drawBorder: false } },
          x: { grid: { display: false } }
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
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: 'transparent' }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '60%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, padding: 10, font: { size: 11 } } },
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
    return _replace(canvasId, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label,
          data,
          backgroundColor: labels.map((_, i) => U.paletteColor(i)),
          borderRadius: 4,
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
          x: { ticks: { callback: (v) => U.formatIDRCompact(v) }, grid: { drawBorder: false } },
          y: {
            grid: { display: false },
            ticks: {
              autoSkip: false,
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

    // Highlight items in 80%
    const cutoff = p.cutoffIdx === -1 ? p.items.length - 1 : p.cutoffIdx;
    const colors = p.items.map((_, i) => i <= cutoff ? '#ef4444' : '#94a3b8');

    return _replace('chart-pareto', {
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Omzet',
            data: totals,
            backgroundColor: colors,
            borderRadius: 3,
            yAxisID: 'y',
          },
          {
            type: 'line',
            label: 'Kumulatif %',
            data: cum,
            borderColor: '#6366f1',
            backgroundColor: '#6366f180',
            borderWidth: 2,
            tension: 0.2,
            pointRadius: 2,
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
          // 80% reference line via custom plugin
        },
        scales: {
          y: {
            position: 'left',
            ticks: { callback: (v) => U.formatIDRCompact(v) },
            grid: { drawBorder: false }
          },
          y1: {
            position: 'right',
            min: 0, max: 100,
            ticks: { callback: (v) => v + '%' },
            grid: { drawOnChartArea: false }
          },
          x: {
            ticks: {
              autoSkip: false,
              maxRotation: 60, minRotation: 45,
              font: { size: 10 }
            },
            grid: { display: false }
          }
        }
      }
    });
  }

  function distChart(canvasId, agg, label) {
    const labels = agg.map(d => d.key);
    const data = agg.map(d => d.qty);
    return _replace(canvasId, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label,
          data,
          backgroundColor: labels.map((_, i) => U.paletteColor(i)),
          borderRadius: 4,
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
          y: { ticks: { callback: (v) => U.formatNumber(v) }, grid: { drawBorder: false } },
          x: { grid: { display: false } }
        }
      }
    });
  }

  function yoyChart(yoy) {
    // Use distinct colors per year, with the latest year highlighted
    const yearColors = ['#94a3b8', '#6366f1', '#10b981', '#f59e0b', '#ef4444'];
    const datasets = yoy.datasets.map((ds, i) => {
      const isLatest = i === yoy.datasets.length - 1;
      const baseColor = yearColors[i % yearColors.length];
      return {
        label: ds.label,
        data: ds.data,
        backgroundColor: isLatest ? baseColor : baseColor + '99',
        borderColor: baseColor,
        borderWidth: isLatest ? 0 : 1,
        borderRadius: 4,
      };
    });
    return _replace('chart-yoy', {
      type: 'bar',
      data: { labels: yoy.labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
          tooltip: {
            callbacks: { label: (c) => `${c.dataset.label}: ${U.formatIDR(c.parsed.y)}` }
          }
        },
        scales: {
          y: { ticks: { callback: (v) => U.formatIDRCompact(v) }, grid: { drawBorder: false } },
          x: { grid: { display: false } }
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
