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
      label: '2024',
      url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTl41UUW1aYTQoKwnmpZZ0lgMD4LXt9V89NIhZIXNV19WGPphLUvhiscncehAACSsnEtHfq5VgqedkR/pub?gid=1837670229&single=true&output=csv',
    },
    {
      label: '2025',
      url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQXTD8lAQ4MiHlohXrMRntfU9Frfcw9E1w1y-uVpfsWiLKzzKJCBoa-561eKo-fF3iTiOk85UsrE-aC/pub?gid=1837670229&single=true&output=csv',
    },
    {
      label: '2026',
      url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRRqSZ-ul2r7ZbXd2vqir9744EcG3dp7CeOlk4YOBhgFcXmjdepy_YJ9Y9hXYHfmNuY9v_eeitsqXLb/pub?gid=1837670229&single=true&output=csv',
    },
  ];

  // The "current" year is fetched fresh on every page load.
  // Older years are cached in localStorage and only re-fetched
  // when the user clicks "Clear Cache".
  const CURRENT_YEAR = String(new Date().getFullYear());

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
      cekInk: '__all__',
      msCategory: '__all__',  // Marketshare table category sub-tab
      search: '',
    },
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
  // Historical years (≠ CURRENT_YEAR) load from localStorage cache.
  // Current year always fetches fresh.
  // ============================================================
  async function loadAllSources(silent = false, options = {}) {
    const { ignoreCache = false } = options;
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
          const useCache = !ignoreCache && src.label !== CURRENT_YEAR;
          try {
            const r = await PC.sheets.loadSheet(src.url, {
              cacheKey: src.label,
              useCache,
            });
            return {
              src,
              records: r.records,
              fetchedAt: r.fetchedAt,
              fromCache: !!r.fromCache,
              savedAt: r.savedAt || null,
              error: null,
            };
          } catch (e) {
            return {
              src,
              records: [],
              fetchedAt: new Date(),
              fromCache: false,
              error: e.message || String(e),
            };
          }
        })
      );

      const merged = [];
      const sourceInfo = [];
      for (const res of results) {
        for (const rec of res.records) merged.push({ ...rec, _source: res.src.label });
        sourceInfo.push({
          label: res.src.label,
          url: res.src.url,
          count: res.records.length,
          fetchedAt: res.fetchedAt,
          fromCache: res.fromCache,
          savedAt: res.savedAt,
          error: res.error,
        });
      }

      const errored = results.filter(r => r.error);
      if (errored.length === results.length) {
        throw new Error(errored.map(e => `[${e.src.label}] ${e.error}`).join(' · '));
      }

      state.records = merged;
      state.sources = sourceInfo;
      state.fetchedAt = new Date();

      onDataLoaded();

      if (errored.length) {
        U.toast(`${errored.length} sumber gagal: ${errored.map(e => e.src.label).join(', ')}`, 'error');
      } else if (silent) {
        U.toast('Data ter-update.', 'success');
      }
    } catch (err) {
      console.error(err);
      if (silent) U.toast('Gagal refresh: ' + err.message, 'error');
      else showError(err.message || 'Tidak bisa fetch data.');
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
  // Clear Cache button — wipes localStorage CSV cache and refetches all
  // ============================================================
  const btnClear = document.getElementById('btn-clear-cache');
  if (btnClear) {
    btnClear.addEventListener('click', async () => {
      const cached = PC.sheets.listCachedKeys();
      const cachedYears = cached.map(c => c.label).join(', ') || '(tidak ada)';
      const ok = confirm(
        `Hapus cache lokal untuk tahun: ${cachedYears}?\n\n` +
        `Setelah dihapus, semua data akan di-fetch ulang dari Google Sheets.\n` +
        `Pakai ini kalau spreadsheet tahun lama Anda diubah dan Anda mau ambil versi terbaru.`
      );
      if (!ok) return;
      const cleared = PC.sheets.clearAllCache();
      U.toast(`${cleared} entri cache dihapus. Memuat ulang…`, 'info');
      await loadAllSources(false, { ignoreCache: true });
    });
  }

  // ============================================================
  // Year pills (header) — VISUAL INDICATOR ONLY (not clickable)
  // Cached (green ⚡) vs Live (red ●). Year filter is via dropdown.
  // ============================================================
  function renderYearPills() {
    const wrap = document.getElementById('year-pills');
    if (!wrap) return;
    const years = [...new Set(state.records.map(r => r.year).filter(Boolean))].sort();
    if (!years.length) { wrap.innerHTML = ''; return; }
    // Build a map of which year came from cache (uses last fetch's source info)
    const cachedYears = new Set((state.sources || []).filter(s => s.fromCache).map(s => s.label));

    wrap.innerHTML = years.map(y => {
      const yStr = String(y);
      const isCached = cachedYears.has(yStr);
      const stateClass = isCached ? 'cached' : 'live';
      const iconHtml = isCached
        ? '<span class="pill-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg></span>'
        : '<span class="pill-dot"></span>';
      const tip = isCached ? `Cached locally — klik tombol Clear Cache untuk re-fetch` : `Live — fetched fresh setiap reload`;
      return `
        <span class="year-pill ${stateClass}" data-year="${y}" title="${tip}">
          ${iconHtml}
          <span>${y}</span>
        </span>
      `;
    }).join('');
    // No click handler — pills are purely visual indicators.
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
      state.filters.cekInk = '__all__';
      state.filters.search = '';
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
  bindFilter('filter-cekink', 'cekInk');

  // ============================================================
  // Marketshare category sub-tabs (Semua / Gaming / Non Gaming)
  // ============================================================
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.ms-tab');
    if (!tab) return;
    state.filters.msCategory = tab.dataset.cat || '__all__';
    document.querySelectorAll('.ms-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.cat === state.filters.msCategory);
    });
    renderMarketshare();
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
        state.filters.cekInk = '__all__';
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

    // Cek Ink Tank filter (kolom U) - dynamic options based on dept
    const cekInkOpts = uniqueSorted(base.map(r => r.cekInk).filter(v => v && v !== ''));
    fillSelect('filter-cekink', cekInkOpts, state.filters.cekInk);
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

    // Show/hide Cek Ink Tank filter — only when current dept has multiple values in column U
    const distinctCekInk = [...new Set(state.records
      .filter(r => r.dept === dept && r.cekInk && r.cekInk !== '')
      .map(r => r.cekInk))];
    const cekInkWrap = document.getElementById('filter-cekink-wrap');
    const cekInkLabel = document.getElementById('filter-cekink-label');
    if (cekInkWrap) {
      if (distinctCekInk.length >= 2) {
        cekInkWrap.classList.remove('hidden');
        if (cekInkLabel) {
          // Adapt label per dept
          if (dept === 'Printer') cekInkLabel.textContent = 'Tipe Printer';
          else if (dept === 'PC Branded') cekInkLabel.textContent = 'Tipe PC';
          else cekInkLabel.textContent = 'Tipe (Kolom U)';
        }
      } else {
        cekInkWrap.classList.add('hidden');
        // Reset filter when not visible
        if (state.filters.cekInk !== '__all__') {
          state.filters.cekInk = '__all__';
        }
      }
    }

    // KPIs removed — totals are conveyed via dept tabs and YoY card.

    // YoY chart — uses filtered (already scoped to active dept)
    renderYoy(filtered);

    // Marketshare per Brand (monthly detail table) — sits below YoY card.
    renderMarketshare();

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
    // Compute YoY based on QTY (jumlah unit terjual) — per user request
    const yoy = A.yoyByMonth(filtered, { sumField: 'qty' });
    if (yoy.years.length < 2) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    Ch.yoyChart(yoy, {
      seriesLabel: 'Unit',
      valueFormatter: (v) => U.formatNumber(v) + ' unit',
      axisFormatter: (v) => U.formatNumber(v),
    });

    // Update card subtitle to reflect qty mode
    const subEl = card.querySelector('.chart-sub');
    if (subEl) subEl.textContent = 'Perbandingan unit terjual per bulan antar tahun';

    // Build a rich summary based on QTY too
    const sQty = A.yoySummary(filtered, { sumField: 'qty' });
    const lines = [];

    const fmtUnit = (n) => U.formatNumber(n) + ' unit';

    const fullParts = sQty.years.map(y => {
      let part = `<strong>${y}</strong>: ${fmtUnit(sQty.totals[y])}`;
      const g = sQty.growth[y];
      if (g !== null && g !== undefined) {
        const arrow = g >= 0 ? '▲' : '▼';
        const cls = g >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
        part += ` <span class="${cls}">${arrow} ${g.toFixed(1)}%</span>`;
      }
      return part;
    });
    lines.push(`<div class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0.5">Total Unit per Tahun</div><div>${fullParts.join(' · ')}</div>`);

    if (sQty.samePeriod && !sQty.samePeriod.fullYear) {
      const sp = sQty.samePeriod;
      const periodLabel = sp.months.length === 1
        ? sp.months[0]
        : `${sp.months[0]} – ${sp.months[sp.months.length - 1]}`;
      const spParts = sQty.years.map(y => {
        let part = `<strong>${y}</strong>: ${fmtUnit(sp.totals[y])}`;
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
  // Marketshare per Brand — Detail Bulanan (table)
  // ============================================================
  function renderMarketshare() {
    const card = document.getElementById('marketshare-card');
    if (!card) return;

    // Determine focus year: most recent year present in data; need at least 1 year.
    const yearsInData = [...new Set(state.records.map(r => r.year).filter(Boolean))].sort((a,b) => a - b);
    if (!yearsInData.length) { card.classList.add('hidden'); return; }
    const focusYear = yearsInData[yearsInData.length - 1];
    const prevYear = focusYear - 1;

    const dept = state.filters.dept;
    const category = state.filters.msCategory || '__all__';

    // For the marketshare aggregation we ignore the bulan filter (always show 12 months)
    // and ignore the brand/kota/juta filters too — but we DO honor dept and the
    // category (Gaming/Non Gaming) sub-tab. The dept filter scopes which records
    // we look at; categories drill further.
    const data = A.marketshareTable(state.records, {
      year: focusYear,
      prevYear,
      dept,
      category,
      topN: 8,
    });

    if (!data || !data.topBrands.length) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');

    // Period banner
    const categoryLabel = category === '__all__' ? 'Semua' : category;
    const banner = document.getElementById('ms-period-banner');
    if (banner) {
      banner.innerHTML = `<span>📊 Tahun <strong>${focusYear}</strong> · YoY dibandingkan <strong>${prevYear}</strong> · Kategori: <strong>${escapeHtml(categoryLabel)}</strong></span>`;
    }

    // Sync active state of category tabs
    document.querySelectorAll('.ms-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.cat === category);
    });

    renderMarketshareTableHtml(data);
  }

  // Brand color palette (cycled) for the brand-row column headers.
  const BRAND_COLORS = ['#a16207', '#991b1b', '#14532d', '#475569', '#1e3a8a', '#9a3412', '#9f1239', '#0c4a6e'];
  const COLOR_OTHER = '#6d28d9';
  const COLOR_GRAND = '#1e293b';
  const COLOR_MOM   = '#7c2d12';
  const COLOR_YOY   = '#831843';
  const COLOR_EST   = '#1e1b4b';
  const COLOR_GROW  = '#064e3b';

  function fmtPct(v, decimals = 2) {
    if (v === null || v === undefined || isNaN(v)) return '-';
    const arrow = v >= 0 ? '▲' : '▼';
    const cls = v >= 0 ? 'ms-up' : 'ms-down';
    return `<span class="${cls}">${arrow} ${Math.abs(v).toFixed(decimals)}%</span>`;
  }

  function fmtShareDelta(delta) {
    // Tiny epsilon: anything under ~0.005 considered flat
    if (delta === null || delta === undefined || isNaN(delta)) return '';
    if (Math.abs(delta) < 0.005) return '';
    const arrow = delta >= 0 ? '▲' : '▼';
    const cls = delta >= 0 ? 'ms-up' : 'ms-down';
    return ` <span class="${cls}">${arrow}</span>`;
  }

  function renderMarketshareTableHtml(data) {
    const table = document.getElementById('ms-table');
    if (!table) return;
    const { topBrands, otherCount, rows, grandRow, estimasiClosing, growth, yearLabel, prevYearLabel } = data;

    // Build column list: [...topBrands, _OTHER, GRAND, MOM, YOY, EST, GROWTH]
    const brandCols = topBrands.map((b, i) => ({
      key: b,
      label: b,
      color: BRAND_COLORS[i % BRAND_COLORS.length],
    }));
    if (otherCount > 0) {
      brandCols.push({ key: '__other__', label: `OTHER (${otherCount})`, color: COLOR_OTHER });
    }

    // ----- HEAD -----
    let headRow1 = `<tr class="brand-row"><th rowspan="2" style="background:${COLOR_GRAND};min-width:90px">Bulan</th>`;
    for (const c of brandCols) {
      headRow1 += `<th colspan="2" style="background:${c.color}">${escapeHtml(c.label)}</th>`;
    }
    headRow1 += `<th rowspan="2" style="background:${COLOR_GRAND}">Grand<br>Total</th>`;
    headRow1 += `<th rowspan="2" style="background:${COLOR_MOM}">MoM<br><small>${yearLabel}</small></th>`;
    headRow1 += `<th rowspan="2" style="background:${COLOR_YOY}">YoY<br><small>vs ${prevYearLabel}</small></th>`;
    headRow1 += `<th rowspan="2" style="background:${COLOR_EST}">Estimasi<br>Closing</th>`;
    headRow1 += `<th rowspan="2" style="background:${COLOR_GROW}">Growth<br><small>${yearLabel} vs ${prevYearLabel}</small></th>`;
    headRow1 += `</tr>`;

    let headRow2 = `<tr class="subhead">`;
    for (let i = 0; i < brandCols.length; i++) {
      headRow2 += `<th>QTY</th><th>%</th>`;
    }
    headRow2 += `</tr>`;

    // ----- BODY -----
    let body = '';
    rows.forEach((row, idx) => {
      const cells = [];
      // Month label cell (gradient pink/purple)
      cells.push(`<td class="month-cell">${escapeHtml(row.month)}</td>`);

      const hasData = row.grandTotal > 0;
      for (const c of brandCols) {
        const qty = row.qtyPerBrand[c.key] || 0;
        const share = row.sharePerBrand[c.key];
        const delta = row.shareDelta ? row.shareDelta[c.key] : null;
        if (!hasData) {
          cells.push(`<td class="ms-qty-cell ms-empty">-</td><td class="ms-share-cell ms-empty">-</td>`);
        } else {
          cells.push(`<td class="ms-qty-cell">${U.formatNumber(qty)}</td>`);
          cells.push(`<td class="ms-share-cell">${(share || 0).toFixed(2)}%${fmtShareDelta(delta)}</td>`);
        }
      }
      // Grand Total
      cells.push(`<td class="ms-qty-cell">${hasData ? U.formatNumber(row.grandTotal) : '-'}</td>`);
      // MoM
      cells.push(`<td class="ms-share-cell">${hasData ? fmtPct(row.mom) : '-'}</td>`);
      // YoY
      cells.push(`<td class="ms-share-cell">${hasData ? fmtPct(row.yoy) : '-'}</td>`);

      // Estimasi Closing — only the row matching estimasiClosing.monthName
      let estHtml = '-';
      if (estimasiClosing && estimasiClosing.monthName === row.month) {
        estHtml = `<strong>${U.formatNumber(estimasiClosing.value)}</strong>\n${estimasiClosing.daysElapsed}/${estimasiClosing.daysInMonth} hari`;
      }
      cells.push(`<td class="ms-special-cell">${estHtml}</td>`);

      // Growth — only the row matching estimasiClosing.monthName (or last month with data)
      let growthHtml = '-';
      if (growth && growth.anchorMonth === row.month) {
        const gpct = growth.pct;
        const arrow = (gpct === null || gpct === undefined) ? '' : (gpct >= 0 ? '▲' : '▼');
        const cls = (gpct === null || gpct === undefined) ? '' : (gpct >= 0 ? 'ms-up' : 'ms-down');
        const headLine = (gpct === null || gpct === undefined)
          ? '<span class="ms-empty">-</span>'
          : `<span class="${cls}"><strong>${arrow} ${Math.abs(gpct).toFixed(2)}%</strong></span>`;
        growthHtml = `${headLine}\n${growth.periodLabel}${growth.note ? '\n' + growth.note : ''}`;
      }
      cells.push(`<td class="ms-special-cell">${growthHtml}</td>`);

      body += `<tr>${cells.join('')}</tr>`;
    });

    // ----- GRAND TOTAL ROW -----
    const grandCells = [];
    grandCells.push(`<td class="month-cell">Grand Total</td>`);
    for (const c of brandCols) {
      const qty = grandRow.qtyPerBrand[c.key] || 0;
      const share = grandRow.sharePerBrand[c.key] || 0;
      grandCells.push(`<td class="ms-qty-cell">${U.formatNumber(qty)}</td>`);
      grandCells.push(`<td class="ms-share-cell">${share.toFixed(2)}%</td>`);
    }
    grandCells.push(`<td class="ms-qty-cell">${U.formatNumber(grandRow.grandTotal)}</td>`);
    grandCells.push(`<td class="ms-share-cell">-</td>`);
    grandCells.push(`<td class="ms-share-cell">-</td>`);
    grandCells.push(`<td class="ms-special-cell">-</td>`);
    grandCells.push(`<td class="ms-special-cell">-</td>`);

    table.innerHTML =
      `<thead>${headRow1}${headRow2}</thead>` +
      `<tbody>${body}</tbody>` +
      `<tfoot><tr class="ms-grand-row">${grandCells.join('')}</tr></tfoot>`;
  }

  // ============================================================
  // Boot — fetch fresh on every page open
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => loadAllSources(false));
  } else {
    loadAllSources(false);
  }
})();
