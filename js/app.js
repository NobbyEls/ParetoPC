/**
 * ParetoPC Dashboard - Main app controller
 *
 * Data is fetched fresh from Google Sheets on every page load.
 * To add another year (e.g. 2025) for YoY comparison, just append
 * to the SOURCES array below.
 */
(() => {
  const U = PC.utils;
  const A = PC.analytics;
  const Ch = PC.charts;

  // ============================================================
  // 🔧 DATA SOURCES — edit this array to add another spreadsheet/year
  // ============================================================
  const SOURCES = [
    {
      label: '2025',
      url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQXTD8lAQ4MiHlohXrMRntfU9Frfcw9E1w1y-uVpfsWiLKzzKJCBoa-561eKo-fF3iTiOk85UsrE-aC/pub?gid=1837670229&single=true&output=csv',
    },
    {
      label: '2026',
      url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRRqSZ-ul2r7ZbXd2vqir9744EcG3dp7CeOlk4YOBhgFcXmjdepy_YJ9Y9hXYHfmNuY9v_eeitsqXLb/pub?gid=1837670229&single=true&output=csv',
    },
  ];

  // The 4 main department tabs - shown in this exact order
  const DEPT_TABS = ['Printer', 'Projector', 'Monitor', 'PC Branded'];

  // Slugify dept name → CSS class (e.g. "PC Branded" → "pcbranded")
  function deptSlug(d) {
    return String(d || '').toLowerCase().replace(/[^a-z]/g, '');
  }

  // ============================================================
  // State
  // ============================================================
  const state = {
    records: [],
    sources: [],   // [{ label, url, count, fetchedAt }]
    fetchedAt: null,
    filters: {
      dept: 'Printer',  // Default tab on first load
      kota: '__all__',
      bulan: '__all__',
      brand: '__all__',
      juta: '__all__',
      tahun: '__all__',
      search: '',
    },
    table: {
      page: 1,
      pageSize: 25,
      sort: { key: 'tgl', dir: 'desc' },
      cache: [],
    }
  };

  // ============================================================
  // Theme toggle (persisted) - default is DARK for ELS-style
  // ============================================================
  const THEME_KEY = 'paretopc:theme';
  function applyStoredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    // Default to dark unless user explicitly chose light
    if (saved === 'light') document.documentElement.classList.remove('dark');
    else document.documentElement.classList.add('dark');
  }
  applyStoredTheme();

  document.getElementById('btn-theme').addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    Ch.refreshTheme();
  });

  // ============================================================
  // Data fetching - load all sources in parallel & merge
  // ============================================================
  async function loadAllSources(silent = false) {
    if (!SOURCES.length) {
      showError('Belum ada sumber data terdaftar. Edit array SOURCES di js/app.js.');
      return;
    }
    try {
      if (!silent) {
        showInitialLoading();
      } else {
        showLoadingOverlay('Refresh data...');
        spinRefreshIcon(true);
      }

      const results = await Promise.all(
        SOURCES.map(async (src) => {
          try {
            const r = await PC.sheets.loadSheet(src.url);
            return { src, records: r.records, fetchedAt: r.fetchedAt, error: null };
          } catch (e) {
            return { src, records: [], fetchedAt: new Date(), error: e.message || String(e) };
          }
        })
      );

      // Merge records, tagging each with its source label
      const merged = [];
      const sourceInfo = [];
      for (const res of results) {
        for (const rec of res.records) merged.push({ ...rec, _source: res.src.label });
        sourceInfo.push({
          label: res.src.label,
          url: res.src.url,
          count: res.records.length,
          fetchedAt: res.fetchedAt,
          error: res.error,
        });
      }

      const errored = results.filter(r => r.error);
      if (errored.length === results.length) {
        // All sources failed
        throw new Error(errored.map(e => `[${e.src.label}] ${e.error}`).join(' · '));
      }

      state.records = merged;
      state.sources = sourceInfo;
      state.fetchedAt = new Date();

      onDataLoaded();
      if (errored.length) {
        U.toast(`${errored.length} sumber gagal dimuat: ${errored.map(e => e.src.label).join(', ')}`, 'error');
      } else if (silent) {
        U.toast('Data berhasil di-refresh.', 'success');
      }
    } catch (err) {
      console.error(err);
      if (silent) {
        U.toast('Gagal refresh: ' + err.message, 'error');
      } else {
        showError(err.message || 'Tidak bisa fetch data.');
      }
    } finally {
      U.hideLoading();
      spinRefreshIcon(false);
    }
  }

  function spinRefreshIcon(spinning) {
    const i = document.getElementById('icon-refresh');
    if (!i) return;
    if (spinning) i.classList.add('animate-spin'); else i.classList.remove('animate-spin');
  }

  function showInitialLoading() {
    document.getElementById('initial-loading').classList.remove('hidden');
    document.getElementById('error-screen').classList.add('hidden');
    document.getElementById('dashboard').classList.add('hidden');
  }
  function showLoadingOverlay(msg) {
    const m = document.getElementById('loading-msg');
    if (m && msg) m.textContent = msg;
    document.getElementById('loading').classList.remove('hidden');
  }
  function showError(msg) {
    document.getElementById('initial-loading').classList.add('hidden');
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('error-screen').classList.remove('hidden');
    document.getElementById('error-msg').textContent = msg;
  }

  document.getElementById('btn-refresh').addEventListener('click', () => loadAllSources(/*silent*/ true));
  document.getElementById('btn-retry').addEventListener('click', () => loadAllSources(false));

  // ============================================================
  // Year pills (header)
  // ============================================================
  function renderYearPills() {
    const wrap = document.getElementById('year-pills');
    if (!wrap) return;
    const years = [...new Set(state.records.map(r => r.year).filter(Boolean))].sort();
    if (!years.length) { wrap.innerHTML = ''; return; }
    const active = state.filters.tahun;
    wrap.innerHTML = years.map(y => {
      const isActive = String(active) === String(y);
      return `
        <button class="year-pill ${isActive ? 'active year-' + y : ''}" data-year="${y}">
          <span class="dot"></span>
          <span>${y}</span>
        </button>
      `;
    }).join('');
    wrap.querySelectorAll('.year-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const y = btn.dataset.year;
        // Toggle: clicking active pill resets to "all years"
        state.filters.tahun = (String(state.filters.tahun) === y) ? '__all__' : y;
        // Sync the dropdown filter too
        const sel = document.getElementById('filter-tahun');
        if (sel) sel.value = state.filters.tahun;
        renderYearPills();
        render();
      });
    });
  }

  // ============================================================
  // Live clock pill in header
  // ============================================================
  function startClockPill() {
    const el = document.getElementById('clock-pill-text');
    if (!el) return;
    const update = () => {
      const d = new Date();
      const fmt = d.toLocaleString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
      el.textContent = fmt;
    };
    update();
    setInterval(update, 30000);
  }
  startClockPill();

  // Reset filters button
  document.addEventListener('click', (e) => {
    if (e.target.closest('#btn-reset-filters')) {
      state.filters.kota = '__all__';
      state.filters.bulan = '__all__';
      state.filters.brand = '__all__';
      state.filters.juta = '__all__';
      state.filters.tahun = '__all__';
      state.filters.search = '';
      const search = document.getElementById('table-search');
      if (search) search.value = '';
      populateFilters();
      renderYearPills();
      render();
      U.toast('Filter direset.', 'info');
    }
  });
  function bindFilter(elId, key) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.addEventListener('change', () => {
      state.filters[key] = el.value || '__all__';
      // Keep year pills in sync when tahun dropdown changes
      if (key === 'tahun') renderYearPills();
      render();
    });
  }
  bindFilter('filter-tahun', 'tahun');
  bindFilter('filter-kota', 'kota');
  bindFilter('filter-bulan', 'bulan');
  bindFilter('filter-brand', 'brand');
  bindFilter('filter-juta', 'juta');

  document.getElementById('table-search').addEventListener('input', (e) => {
    state.filters.search = e.target.value;
    state.table.page = 1;
    renderTable();
  });

  // ============================================================
  // Department tabs - prominent navigation, fixed order
  // ============================================================
  function renderDeptTabs() {
    const wrap = document.getElementById('dept-tabs');
    if (!wrap) return;
    // Show ONLY the 4 declared depts that have data
    const presentDepts = new Set(state.records.map(r => r.dept).filter(Boolean));
    const tabs = DEPT_TABS.filter(d => presentDepts.has(d));

    // If active dept has no data, fallback to first available
    if (!presentDepts.has(state.filters.dept) && tabs.length) {
      state.filters.dept = tabs[0];
    }

    wrap.innerHTML = tabs.map(d => {
      const recs = state.records.filter(r => r.dept === d);
      const total = U.sumBy(recs, r => r.total);
      const isActive = state.filters.dept === d;
      return `
        <button class="dept-tab dept-${deptSlug(d)} ${isActive ? 'active' : ''}" data-key="${escapeAttr(d)}">
          <span class="dept-tab-icon">${U.deptIcon(d)}</span>
          <span class="dept-tab-text">
            <span class="dept-tab-name">${escapeHtml(d)}</span>
            <span class="dept-tab-stat">${U.formatIDRCompact(total)} · ${recs.length.toLocaleString('id-ID')} baris</span>
          </span>
        </button>
      `;
    }).join('');
    wrap.querySelectorAll('.dept-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        if (state.filters.dept === btn.dataset.key) return;
        state.filters.dept = btn.dataset.key;
        // Reset sub-filters when switching dept (except tahun, useful to keep)
        state.filters.kota = '__all__';
        state.filters.bulan = '__all__';
        state.filters.brand = '__all__';
        state.filters.juta = '__all__';
        state.table.page = 1;
        renderDeptTabs();
        populateFilters();
        render();
        // Smooth scroll to top so user sees the dashboard refresh
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  // ============================================================
  // Filter dropdowns
  // ============================================================
  function populateFilters() {
    const base = state.filters.dept === '__all__'
      ? state.records
      : state.records.filter(r => r.dept === state.filters.dept);

    const years = uniqueSorted(base.map(r => r.year).filter(Boolean));
    fillSelect('filter-tahun', years.map(String), state.filters.tahun);
    fillSelect('filter-kota', uniqueSorted(base.map(r => r.kota)), state.filters.kota);
    fillSelect('filter-bulan', U.sortBulan(uniqueSorted(base.map(r => r.bulan))), state.filters.bulan);
    fillSelect('filter-brand', uniqueSorted(base.map(r => r.brand)), state.filters.brand);
    fillSelect('filter-juta', uniqueSorted(base.map(r => r.cekJuta)), state.filters.juta);
  }
  function uniqueSorted(arr) {
    return [...new Set(arr.filter(v => v !== '' && v !== null && v !== undefined))]
      .sort((a, b) => {
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        return String(a).localeCompare(String(b));
      });
  }
  function fillSelect(id, options, currentValue) {
    const el = document.getElementById(id);
    if (!el) return;
    const optsHtml = ['<option value="__all__">Semua</option>']
      .concat(options.map(o => `<option value="${escapeAttr(String(o))}">${escapeHtml(String(o))}</option>`));
    el.innerHTML = optsHtml.join('');
    if (currentValue && currentValue !== '__all__' && options.includes(currentValue)) {
      el.value = currentValue;
    } else {
      el.value = '__all__';
      const key = id.replace('filter-', '');
      state.filters[key] = '__all__';
    }
  }

  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  // ============================================================
  // Render dashboard after data load
  // ============================================================
  function onDataLoaded() {
    document.getElementById('initial-loading').classList.add('hidden');
    document.getElementById('error-screen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');

    // Source label
    const ok = state.sources.filter(s => !s.error);
    const labelText = ok.length
      ? `Sumber: Google Sheets — ${ok.map(s => `${s.label} (${s.count.toLocaleString('id-ID')})`).join(' · ')}`
      : 'Sumber: Google Sheets';
    document.getElementById('source-label').textContent = labelText;
    document.getElementById('row-count').textContent = state.records.length.toLocaleString('id-ID');
    document.getElementById('last-update').textContent = U.formatDateTime(state.fetchedAt);

    const dates = state.records.map(r => r.tgl).filter(Boolean).sort((a, b) => a - b);
    if (dates.length) {
      document.getElementById('period-range').textContent = `${U.formatDate(dates[0])} → ${U.formatDate(dates[dates.length - 1])}`;
    } else {
      document.getElementById('period-range').textContent = '—';
    }

    renderDeptTabs();
    populateFilters();
    renderYearPills();
    render();
  }

  function render() {
    const filtered = A.filterRecords(state.records, state.filters);
    const dept = state.filters.dept;
    const deptLabel = dept || 'Semua';

    // Update chart titles to reflect active dept
    setText('title-trend',  `Tren Penjualan Bulanan — ${deptLabel}`);
    setText('sub-trend',    `Total omzet ${deptLabel} per bulan`);
    setText('title-mix',    `Mix Brand di ${deptLabel}`);
    setText('sub-mix',      `Kontribusi % omzet per brand`);
    setText('title-brand',  `Top 10 Brand — ${deptLabel}`);
    setText('title-product',`Top 10 Produk — ${deptLabel}`);
    setText('title-kota',   `Penjualan per Kota — ${deptLabel}`);
    setText('title-sales',  `Top 10 Sales — ${deptLabel}`);
    setText('title-pareto', `📊 Analisa Pareto 80/20 — ${deptLabel}`);
    setText('title-juta',   `Distribusi Range Harga — ${deptLabel}`);

    // Show/hide cards based on dept
    showCard('card-ink', dept === 'Printer');     // Ink Tank only for Printer

    // KPIs
    const sum = A.summary(filtered);
    const sumAll = A.summary(state.records);
    document.getElementById('kpi-revenue').textContent = U.formatIDR(sum.revenue);
    document.getElementById('kpi-revenue-sub').textContent = sumAll.revenue ? `${(sum.revenue / sumAll.revenue * 100).toFixed(1)}% dari total` : '—';
    document.getElementById('kpi-qty').textContent = U.formatNumber(sum.qty);
    document.getElementById('kpi-qty-sub').textContent = sumAll.qty ? `${(sum.qty / sumAll.qty * 100).toFixed(1)}% dari total` : '—';
    document.getElementById('kpi-trx').textContent = U.formatNumber(sum.trx);
    document.getElementById('kpi-trx-sub').textContent = sumAll.trx ? `${(sum.trx / sumAll.trx * 100).toFixed(1)}% dari total` : '—';
    document.getElementById('kpi-avg').textContent = U.formatIDR(sum.avg);
    document.getElementById('kpi-avg-sub').textContent = sum.lines + ' baris transaksi';

    // YoY chart — uses filtered (already scoped to active dept)
    renderYoy(filtered);

    // Single-line trend (just for active dept)
    Ch.trendChart(A.monthlyTrend(filtered, { byDept: false }));

    // Mix Brand pie (top brands' share within active dept)
    const topBrands = A.topN(filtered, r => r.brand, 8);
    Ch.brandMixChart(topBrands);

    Ch.topBarChart('chart-brand', A.topN(filtered, r => r.brand, 10), 'Brand');
    Ch.topBarChart('chart-product', A.topN(filtered, r => r.namaBarang, 10), 'Produk');
    Ch.topBarChart('chart-kota', A.aggBy(filtered, r => r.kota), 'Kota');
    Ch.topBarChart('chart-sales', A.topN(filtered, r => r.kodeSales, 10), 'Sales');

    const p = A.pareto(filtered, r => r.namaBarang, 30);
    Ch.paretoChart(p);
    document.getElementById('pareto-summary').innerHTML = p.totalItems
      ? `🎯 <strong>${p.itemsIn80}</strong> dari <strong>${p.totalItems}</strong> produk ${deptLabel} (${(p.itemsIn80 / p.totalItems * 100).toFixed(1)}%) menghasilkan 80% dari omzet (${U.formatIDR(p.grandTotal * 0.8)} dari total ${U.formatIDR(p.grandTotal)}).`
      : '—';

    Ch.distChart('chart-juta', A.aggBy(filtered, r => r.cekJuta), 'Range');

    if (dept === 'Printer') {
      const inkAgg = A.aggBy(
        filtered.filter(r => r.cekInk && r.cekInk !== ''),
        r => r.cekInk
      );
      Ch.pieChart('chart-ink', inkAgg);
    }

    renderTable(filtered);
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function showCard(id, show) {
    const el = document.getElementById(id);
    if (!el) return;
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
  }

  function renderYoy(filtered) {
    const card = document.getElementById('yoy-card');
    // Use full filtered (including all years) to compute YoY,
    // unless user picked a specific year — then hide YoY chart.
    if (state.filters.tahun && state.filters.tahun !== '__all__') {
      card.classList.add('hidden');
      return;
    }
    // Compute YoY from records that match all filters EXCEPT year (already true)
    const yoy = A.yoyByMonth(filtered);
    if (yoy.years.length < 2) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    Ch.yoyChart(yoy);

    // Build a rich summary: full-year totals + same-period (apple-to-apple) growth
    const s = A.yoySummary(filtered);
    const lines = [];

    // Line 1: full-year totals per year
    const fullParts = s.years.map(y => {
      let part = `<strong>${y}</strong>: ${U.formatIDR(s.totals[y])}`;
      const g = s.growth[y];
      if (g !== null && g !== undefined) {
        const arrow = g >= 0 ? '▲' : '▼';
        const cls = g >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
        part += ` <span class="${cls}">${arrow} ${g.toFixed(1)}%</span>`;
      }
      return part;
    });
    lines.push(`<div class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0.5">Total per Tahun</div><div>${fullParts.join(' · ')}</div>`);

    // Line 2: same-period comparison if available and not = full year
    if (s.samePeriod && !s.samePeriod.fullYear) {
      const sp = s.samePeriod;
      const periodLabel = sp.months.length === 1
        ? sp.months[0]
        : `${sp.months[0]} – ${sp.months[sp.months.length - 1]}`;
      const spParts = s.years.map(y => {
        let part = `<strong>${y}</strong>: ${U.formatIDR(sp.totals[y])}`;
        const g = sp.growth[y];
        if (g !== null && g !== undefined) {
          const arrow = g >= 0 ? '▲' : '▼';
          const cls = g >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
          part += ` <span class="${cls} font-semibold">${arrow} ${g.toFixed(1)}%</span>`;
        }
        return part;
      });
      lines.push(`<div class="mt-2 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0.5">📐 Same-period YoY (${periodLabel}) — apel-ke-apel</div><div>${spParts.join(' · ')}</div>`);
    }

    document.getElementById('yoy-summary').innerHTML = lines.join('');
  }

  // ============================================================
  // Detail table
  // ============================================================
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (state.table.sort.key === k) state.table.sort.dir = state.table.sort.dir === 'asc' ? 'desc' : 'asc';
      else { state.table.sort.key = k; state.table.sort.dir = 'asc'; }
      renderTable();
    });
  });
  document.getElementById('btn-prev-page').addEventListener('click', () => {
    if (state.table.page > 1) { state.table.page--; renderTable(); }
  });
  document.getElementById('btn-next-page').addEventListener('click', () => {
    state.table.page++; renderTable();
  });

  function renderTable(prefiltered) {
    const filtered = prefiltered || A.filterRecords(state.records, state.filters);
    const { key, dir } = state.table.sort;
    const sgn = dir === 'asc' ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
      let av = a[key], bv = b[key];
      if (key === 'tgl') { av = av ? av.getTime() : 0; bv = bv ? bv.getTime() : 0; }
      if (typeof av === 'number' && typeof bv === 'number') return sgn * (av - bv);
      return sgn * String(av || '').localeCompare(String(bv || ''));
    });

    state.table.cache = sorted;
    const total = sorted.length;
    const pages = Math.max(1, Math.ceil(total / state.table.pageSize));
    if (state.table.page > pages) state.table.page = pages;
    const start = (state.table.page - 1) * state.table.pageSize;
    const slice = sorted.slice(start, start + state.table.pageSize);

    const tbody = document.getElementById('table-body');
    tbody.innerHTML = slice.map(r => `
      <tr>
        <td>${r.tgl ? U.formatDate(r.tgl) : (r.tglRaw || '—')}</td>
        <td class="font-mono text-xs">${escapeHtml(r.noDok)}</td>
        <td>${escapeHtml(r.kota)}</td>
        <td><span class="${U.deptChipClass(r.dept)}">${escapeHtml(r.dept)}</span></td>
        <td>${escapeHtml(r.brand)}</td>
        <td class="max-w-xs truncate" title="${escapeAttr(r.namaBarang)}">${escapeHtml(r.namaBarang)}</td>
        <td class="text-right">${U.formatNumber(r.qty)}</td>
        <td class="text-right font-medium">${U.formatIDR(r.total)}</td>
        <td class="font-mono text-xs">${escapeHtml(r.kodeSales)}</td>
      </tr>
    `).join('');

    document.getElementById('table-info').textContent = `${total.toLocaleString('id-ID')} baris`;
    document.getElementById('page-info').textContent = `${state.table.page} / ${pages}`;
    document.getElementById('btn-prev-page').disabled = state.table.page <= 1;
    document.getElementById('btn-next-page').disabled = state.table.page >= pages;

    document.querySelectorAll('th[data-sort]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === key) th.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
    });
  }

  // Export filtered table to CSV
  document.getElementById('btn-export-csv').addEventListener('click', () => {
    const rows = state.table.cache.length ? state.table.cache : A.filterRecords(state.records, state.filters);
    const headers = ['Tgl','No Dok','Kota','Dept','Brand','Nama Barang','Qty','Harga','Diskon','Total','Sales','Tahun'];
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([
        r.tgl ? r.tgl.toISOString().slice(0,10) : (r.tglRaw || ''),
        r.noDok, r.kota, r.dept, r.brand, r.namaBarang,
        r.qty, r.harga, r.diskon, r.total, r.kodeSales, r.year || ''
      ].map(U.csvEscape).join(','));
    }
    const ts = new Date().toISOString().slice(0,10);
    U.downloadText(`paretopc-export-${ts}.csv`, '\uFEFF' + lines.join('\n'), 'text/csv;charset=utf-8');
  });

  // ============================================================
  // Boot — fetch fresh on every page open
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => loadAllSources(false));
  } else {
    loadAllSources(false);
  }
})();
