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

  // ============================================================
  // Pareto PC consolidated workbook (one URL, one sheet per year).
  //
  // The published workbook has a separate sheet (gid) per calendar year,
  // each sheet carrying ALL months for that year as rows in this format:
  //
  //   Col A  Bulan ("Januari 2026", "Februari 2026", …)
  //   Col B  Departemen (Pareto Non PC Rakitan side)
  //   Col C  Omset
  //   Col D  %
  //   Col E  (blank separator)
  //   Col F  Bulan
  //   Col G  Departemen (Pareto PC side, includes PC Rakitan)
  //   Col H  Omset
  //   Col I  %
  //
  // Adding a new year = add an entry to PARETO_PC_YEAR_SOURCES.
  // The snapshot tables on top of the tab will auto-pick the latest
  // (year, month) combination; the trend table appends every month
  // chronologically across all years and computes MoM/YoY automatically.
  // ============================================================
  const PARETO_PC_BASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ8jW98gXTDyUaNGUu5YGd0FeYTDYuXGl0s-YP3vIzisoZUEdS8xwM0mmYzOuAdTv76T1VQcSQJIkYf/pub';
  const PARETO_PC_YEAR_SOURCES = [
    { year: 2024, gid: '0' },
    { year: 2025, gid: '778752786' },
    { year: 2026, gid: '1053765421' },
  ];

  function paretoPcSheetUrl(gid) {
    return `${PARETO_PC_BASE_URL}?gid=${encodeURIComponent(gid)}&single=true&output=tsv`;
  }

  // The 4 main department tabs + Pareto PC special tab
  const DEPT_TABS = ['Printer', 'Projector', 'Monitor', 'PC Branded', 'Pareto PC'];

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
    chartType: 'bar',  // 'bar' or 'line' for stacked chart
    paretoPcData: null,      // Parsed Pareto PC snapshot tables (latest month)
    paretoPcTrend: null,     // Parsed Pareto PC multi-month trend ({months, leftRows, rightRows, leftGrand, rightGrand})
    paretoPcFilters: {
      view: 'pc',            // 'pc' or 'nonpc' — which dataset to show in chart+table
      year: '__all__',       // year filter for the chart
      topN: 8,              // how many category lines to show (0=All)
    },
    filters: {
      dept: 'Printer',  // Default tab on first load
      kota: '__all__',
      bulan: '__all__',
      brand: '__all__',
      juta: '__all__',
      tahun: '__all__',
      cekInk: '__all__',
      msCategory: '__all__',  // Marketshare table category sub-tab
      msMode: 'qty',          // 'qty' or 'value' for marketshare toggle
      msKotaMode: 'qty',      // 'qty' or 'value' for marketshare kota toggle
      msTipePcMode: 'qty',    // 'qty' or 'value' for marketshare tipe PC toggle
      yoyMode: 'qty',         // 'qty' or 'value' for YoY chart toggle
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

      const totalSources = SOURCES.length;
      let completedSources = 0;

      const results = await Promise.all(
        SOURCES.map(async (src) => {
          const useCache = !ignoreCache && src.label !== CURRENT_YEAR;
          setLoadingStatus(`Mengambil data ${src.label}...`);
          try {
            const r = await PC.sheets.loadSheet(src.url, {
              cacheKey: src.label,
              useCache,
            });
            completedSources++;
            const pct = Math.round((completedSources / totalSources) * 100);
            setProgress(pct);
            setLoadingStatus(completedSources < totalSources
              ? `Mengambil data ${SOURCES[completedSources] ? SOURCES[completedSources].label : ''}...`
              : 'Memproses data...');
            return {
              src,
              records: r.records,
              fetchedAt: r.fetchedAt,
              fromCache: !!r.fromCache,
              savedAt: r.savedAt || null,
              error: null,
            };
          } catch (e) {
            completedSources++;
            const pct = Math.round((completedSources / totalSources) * 100);
            setProgress(pct);
            setLoadingDetail(`Gagal memuat ${src.label}`);
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
      hideLoadingOverlay();
      spinRefreshIcon(false);
    }
  }

  function spinRefreshIcon(spinning) {
    const i = document.getElementById('icon-refresh');
    if (!i) return;
    if (spinning) i.classList.add('animate-spin'); else i.classList.remove('animate-spin');
  }

  function showInitialLoading() {
    const el = document.getElementById('loadingOverlay');
    if (el) el.classList.remove('hidden');
    const title = document.getElementById('loadingTitle');
    if (title) title.textContent = 'Memuat Data Analytics';
    const status = document.getElementById('loadingStatus');
    if (status) status.textContent = 'Menghubungkan ke Google Sheets...';
    const detail = document.getElementById('loadingDetail');
    if (detail) detail.textContent = '';
    setProgress(0);
    document.getElementById('error-screen').classList.add('hidden');
    document.getElementById('dashboard').classList.add('hidden');
  }
  function showLoadingOverlay(msg) {
    const el = document.getElementById('loadingOverlay');
    if (el) el.classList.remove('hidden');
    const title = document.getElementById('loadingTitle');
    if (title) title.textContent = msg || 'Refresh Data';
    const status = document.getElementById('loadingStatus');
    if (status) status.textContent = 'Mengambil data terbaru...';
    const detail = document.getElementById('loadingDetail');
    if (detail) detail.textContent = '';
    setProgress(0);
  }
  function hideLoadingOverlay() {
    const el = document.getElementById('loadingOverlay');
    if (el) el.classList.add('hidden');
  }
  function setProgress(pct) {
    const fill = document.getElementById('progressFill');
    if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
  }
  function setLoadingStatus(text) {
    const el = document.getElementById('loadingStatus');
    if (el) el.textContent = text;
  }
  function setLoadingDetail(text) {
    const el = document.getElementById('loadingDetail');
    if (el) el.textContent = text;
  }
  function showError(msg) {
    hideLoadingOverlay();
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
      // Also clear Pareto PC combined cache (snapshot + monthly trend in one key)
      try { localStorage.removeItem(PARETO_PC_CACHE_KEY); } catch (e) {}
      // Belt-and-suspenders: also clear older versioned keys in case the user
      // upgraded across versions and old payloads are still sitting around.
      try {
        ['paretopc:pareto-pc-data:v1', 'paretopc:pareto-pc-data:v2',
         'paretopc:pareto-pc-trend:v1'].forEach(k => localStorage.removeItem(k));
      } catch (e) {}
      state.paretoPcData = null;
      state.paretoPcTrend = null;
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
      state.filters.cekInk = '__all__';
      state.filters.search = '';
      // Reset tahun to latest year (no "Semua" option)
      const allYears = [...new Set(state.records.map(r => r.year).filter(Boolean))].sort((a, b) => a - b);
      if (allYears.length) {
        state.filters.tahun = String(allYears[allYears.length - 1]);
      }
      // Default Ink Tank for Printer
      if (state.filters.dept === 'Printer') {
        const inkOpts = [...new Set(state.records.filter(r => r.dept === 'Printer' && r.cekInk).map(r => r.cekInk))];
        if (inkOpts.includes('Ink Tank')) {
          state.filters.cekInk = 'Ink Tank';
        }
      }
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
  // Marketshare QTY / Value toggle
  // ============================================================
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.ms-mode-btn');
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (mode === state.filters.msMode) return;
    state.filters.msMode = mode;
    document.querySelectorAll('.ms-mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    renderMarketshare();
  });

  // ============================================================
  // Marketshare per Kota QTY / Value toggle
  // ============================================================
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.ms-kota-mode-btn');
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (mode === state.filters.msKotaMode) return;
    state.filters.msKotaMode = mode;
    document.querySelectorAll('.ms-kota-mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    renderMarketshareKota();
  });

  // ============================================================
  // Marketshare per Tipe PC QTY / Value toggle
  // ============================================================
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.ms-tipepc-mode-btn');
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (mode === state.filters.msTipePcMode) return;
    state.filters.msTipePcMode = mode;
    document.querySelectorAll('.ms-tipepc-mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    renderMarketshareByTipePc();
  });

  // ============================================================
  // YoY QTY / Value toggle
  // ============================================================
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.yoy-mode-btn');
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (mode === state.filters.yoyMode) return;
    state.filters.yoyMode = mode;
    document.querySelectorAll('.yoy-mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    render();
  });

  // ============================================================
  // Stacked chart type toggle (Bar / Line)
  // ============================================================
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.chart-type-btn');
    if (!btn) return;
    const type = btn.dataset.type;
    if (type === state.chartType) return;
    state.chartType = type;
    document.querySelectorAll('.chart-type-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.type === type);
    });
    renderDept3D();
  });

  // ============================================================
  // Department tabs - prominent navigation, fixed order
  // ============================================================
  function renderDeptTabs() {
    const wrap = document.getElementById('dept-tabs');
    if (!wrap) return;
    // Show the 4 data-driven depts that have records + the special Pareto PC tab
    const presentDepts = new Set(state.records.map(r => r.dept).filter(Boolean));
    const tabs = DEPT_TABS.filter(d => d === 'Pareto PC' || presentDepts.has(d));

    // If active dept has no data and is not Pareto PC, fallback to first available
    if (state.filters.dept !== 'Pareto PC' && !presentDepts.has(state.filters.dept) && tabs.length) {
      state.filters.dept = tabs[0];
    }

    wrap.innerHTML = tabs.map(d => {
      const isActive = state.filters.dept === d;
      if (d === 'Pareto PC') {
        // Special tab - no record-based stats
        return `
          <button class="dept-tab dept-paretopc ${isActive ? 'active' : ''}" data-key="${escapeAttr(d)}">
            <span class="dept-tab-icon">📊</span>
            <span class="dept-tab-text">
              <span class="dept-tab-name">${escapeHtml(d)}</span>
              <span class="dept-tab-stat">Summary Report</span>
            </span>
          </button>
        `;
      }
      const recs = state.records.filter(r => r.dept === d);
      const total = U.sumBy(recs, r => r.total);
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
        // Default Tipe Printer to "Ink Tank" when switching to Printer dept
        if (state.filters.dept === 'Printer') {
          const inkOpts = [...new Set(state.records.filter(r => r.dept === 'Printer' && r.cekInk).map(r => r.cekInk))];
          if (inkOpts.includes('Ink Tank')) {
            state.filters.cekInk = 'Ink Tank';
          }
        }
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
    // For tahun filter: no "Semua" option, only list actual years
    const skipAll = (id === 'filter-tahun');
    const optsHtml = skipAll
      ? options.map(o => `<option value="${escapeAttr(String(o))}">${escapeHtml(String(o))}</option>`)
      : ['<option value="__all__">Semua</option>']
        .concat(options.map(o => `<option value="${escapeAttr(String(o))}">${escapeHtml(String(o))}</option>`));
    el.innerHTML = optsHtml.join('');
    if (skipAll) {
      // For tahun: select the current filter value if it exists in options
      if (currentValue && currentValue !== '__all__' && options.map(String).includes(String(currentValue))) {
        el.value = String(currentValue);
      } else if (options.length) {
        // Default to latest year
        el.value = String(options[options.length - 1]);
        state.filters.tahun = String(options[options.length - 1]);
      }
    } else if (currentValue && currentValue !== '__all__' && options.includes(currentValue)) {
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
    hideLoadingOverlay();
    document.getElementById('error-screen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');

    // Default tahun to the latest year in data
    const allYears = [...new Set(state.records.map(r => r.year).filter(Boolean))].sort((a, b) => a - b);
    if (allYears.length) {
      state.filters.tahun = String(allYears[allYears.length - 1]);
    }

    // Default Tipe Printer to "Ink Tank" if dept is Printer and Ink Tank is available
    if (state.filters.dept === 'Printer') {
      const inkOpts = [...new Set(state.records.filter(r => r.dept === 'Printer' && r.cekInk).map(r => r.cekInk))];
      if (inkOpts.includes('Ink Tank')) {
        state.filters.cekInk = 'Ink Tank';
      }
    }

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
    const dept = state.filters.dept;

    // Special handling for Pareto PC tab
    const paretoPcSection = document.getElementById('pareto-pc-section');
    const normalCharts = ['yoy-card', 'marketshare-tipepc-card', 'marketshare-card', 'marketshare-kota-card',
      'card-dimensi', 'dept3d-card', 'card-trend', 'card-mix', 'card-brand', 'card-product',
      'card-kota', 'card-sales', 'card-pareto'];

    if (dept === 'Pareto PC') {
      // Hide all normal chart cards
      normalCharts.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
      });
      // Also hide the grid containers (they contain card-trend, card-mix, etc.)
      document.querySelectorAll('#dashboard > .grid').forEach(el => el.classList.add('hidden'));
      // Hide filter card (filters don't apply to Pareto PC)
      const filterCard = document.querySelector('.filter-card');
      if (filterCard) filterCard.classList.add('hidden');
      // Show Pareto PC section
      if (paretoPcSection) paretoPcSection.classList.remove('hidden');
      // Load and render Pareto PC data
      loadAndRenderParetoPC();
      return;
    }

    // Normal dept selected - hide Pareto PC section, show grid containers
    if (paretoPcSection) paretoPcSection.classList.add('hidden');
    document.querySelectorAll('#dashboard > .grid').forEach(el => el.classList.remove('hidden'));
    // Show filter card
    const filterCard = document.querySelector('.filter-card');
    if (filterCard) filterCard.classList.remove('hidden');

    const filtered = A.filterRecords(state.records, state.filters);
    const deptLabel = dept || 'Semua';

    // Update chart titles to reflect active dept — all now QTY-based
    setText('title-trend',  `Tren Unit Terjual Bulanan — ${deptLabel}`);
    setText('sub-trend',    `Total unit ${deptLabel} per bulan`);
    setText('title-mix',    `Mix Brand di ${deptLabel}`);
    setText('sub-mix',      `Kontribusi % unit per brand`);
    setText('title-brand',  `Top 10 Produk (Value) — ${deptLabel}`);
    setText('title-product',`Top 10 Produk — ${deptLabel}`);
    setText('title-kota',   `Penjualan per Kota — ${deptLabel}`);
    setText('title-sales',  `Top 10 Sales — ${deptLabel}`);
    setText('title-pareto', `📊 Analisa Pareto 80/20 — ${deptLabel}`);
    setText('title-juta',   `Distribusi Range Harga — ${deptLabel}`);

    // Show/hide cards based on dept
    showCard('card-dimensi', dept === 'Monitor'); // Dimensi only for Monitor
    showCard('marketshare-tipepc-card', dept === 'PC Branded'); // Tipe PC only for PC Branded

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

    // YoY chart — uses ALL years/months (not affected by tahun/bulan filters)
    const yoyRecords = state.records.filter(r => {
      if (state.filters.dept   && state.filters.dept   !== '__all__' && r.dept   !== state.filters.dept)   return false;
      if (state.filters.kota   && state.filters.kota   !== '__all__' && r.kota   !== state.filters.kota)   return false;
      if (state.filters.brand  && state.filters.brand  !== '__all__' && r.brand  !== state.filters.brand)  return false;
      if (state.filters.cekInk && state.filters.cekInk !== '__all__' && r.cekInk !== state.filters.cekInk) return false;
      return true;
    });
    renderYoy(yoyRecords);

    // Marketshare per Brand (monthly detail table) — sits below YoY card.
    renderMarketshare();

    // Marketshare per Tipe PC (monthly detail table) — only for PC Branded dept.
    if (dept === 'PC Branded') {
      renderMarketshareByTipePc();
    }

    // Marketshare per Cabang (monthly detail table) — sits below brand marketshare.
    renderMarketshareKota();

    // 3D bar chart per departemen — total qty per dept × year
    renderDept3D();

    // Single-line trend (QTY-based)
    const sortedMonths = U.sortBulan([...new Set(filtered.map(r => r.bulan).filter(Boolean))]);
    const trendQty = {
      labels: sortedMonths,
      datasets: [{ label: 'Unit Terjual', data: sortedMonths.map(mo => U.sumBy(filtered.filter(r => r.bulan === mo), r => r.qty)) }]
    };
    Ch.trendChart(trendQty);

    // Mix Brand donut (QTY-based)
    const brandsByQty = A.aggBy(filtered, r => r.brand, { sumKey: 'qty' }).slice(0, 8).map(b => ({ ...b, total: b.qty }));
    Ch.brandMixChart(brandsByQty);

    // Top 10 charts (ALL QTY-based except chart-brand which is VALUE-based)
    Ch.topBarChart('chart-brand', A.topN(filtered, r => r.namaBarang, 10), 'Produk', { valueKey: 'total', formatter: U.formatIDR });
    Ch.topBarChart('chart-product', A.aggBy(filtered, r => r.namaBarang, { sumKey: 'qty' }).slice(0, 10).map(b => ({ ...b, total: b.qty })), 'Produk');
    Ch.topBarChart('chart-kota', A.aggBy(filtered, r => r.kota, { sumKey: 'qty' }).map(b => ({ ...b, total: b.qty })), 'Kota');
    Ch.topBarChart('chart-sales', A.aggBy(filtered, r => r.kodeSales, { sumKey: 'qty' }).slice(0, 10).map(b => ({ ...b, total: b.qty })), 'Sales');

    const p = A.pareto(filtered, r => r.namaBarang, 30);
    Ch.paretoChart(p);
    document.getElementById('pareto-summary').innerHTML = p.totalItems
      ? `🎯 <strong>${p.itemsIn80}</strong> dari <strong>${p.totalItems}</strong> produk ${deptLabel} (${(p.itemsIn80 / p.totalItems * 100).toFixed(1)}%) menghasilkan 80% dari omzet (${U.formatIDR(p.grandTotal * 0.8)} dari total ${U.formatIDR(p.grandTotal)}).`
      : '—';

    Ch.distChart('chart-juta', A.aggBy(filtered, r => r.cekJuta), 'Range');

    if (dept === 'Monitor') {
      renderDimensiTable(filtered);
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

    // Compute YoY based on selected mode (qty or value)
    const sumField = state.filters.yoyMode === 'value' ? 'total' : 'qty';
    const yoy = A.yoyByMonth(filtered, { sumField });

    // Hide the card only if there is literally nothing to chart.
    if (!yoy.years.length) { card.classList.add('hidden'); return; }

    // Always show the chart — even when only 1 year is selected. With 1 year
    // the chart simply renders 1 line for that year (still useful as a monthly
    // trend view).
    card.classList.remove('hidden');

    if (sumField === 'total') {
      Ch.yoyChart(yoy, {
        seriesLabel: 'Value',
        valueFormatter: (v) => U.formatIDR(v),
        axisFormatter: (v) => U.formatIDRCompact(v),
      });
    } else {
      Ch.yoyChart(yoy, {
        seriesLabel: 'Unit',
        valueFormatter: (v) => U.formatNumber(v) + ' unit',
        axisFormatter: (v) => U.formatNumber(v),
      });
    }

    // Update card subtitle to reflect mode
    const subEl = card.querySelector('.chart-sub');
    if (subEl) {
      if (sumField === 'total') {
        subEl.textContent = yoy.years.length === 1
          ? `Value (Rp) per bulan — Tahun ${yoy.years[0]}`
          : 'Perbandingan value (Rp) per bulan antar tahun';
      } else {
        subEl.textContent = yoy.years.length === 1
          ? `Unit terjual per bulan — Tahun ${yoy.years[0]}`
          : 'Perbandingan unit terjual per bulan antar tahun';
      }
    }

    // Summary text removed per user request — chart speaks for itself.
    const summaryEl = document.getElementById('yoy-summary');
    if (summaryEl) summaryEl.innerHTML = '';
  }

  // ============================================================
  // Marketshare per Brand — Detail Bulanan (table)
  // ============================================================
  function renderMarketshare() {
    const card = document.getElementById('marketshare-card');
    if (!card) return;

    // Determine focus year:
    //  - If user picked a specific year in the Tahun dropdown → use that year
    //  - Otherwise → use the most recent year in the dataset
    const yearsInData = [...new Set(state.records.map(r => r.year).filter(Boolean))].sort((a,b) => a - b);
    if (!yearsInData.length) { card.classList.add('hidden'); return; }

    let focusYear;
    if (state.filters.tahun && state.filters.tahun !== '__all__') {
      focusYear = parseInt(state.filters.tahun, 10);
    } else {
      focusYear = yearsInData[yearsInData.length - 1];
    }
    const prevYear = focusYear - 1;

    const dept = state.filters.dept;
    const category = state.filters.msCategory || '__all__';

    // Apply ALL active filters EXCEPT `tahun` and `bulan`:
    //  - tahun is owned by the marketshareTable function itself (year/prevYear params)
    //  - bulan would conflict with the per-month breakdown (always 12 rows)
    // Honor: dept, kota, brand, juta, cekInk
    const baseRecords = state.records.filter(r => {
      if (state.filters.dept   && state.filters.dept   !== '__all__' && r.dept   !== state.filters.dept)   return false;
      if (state.filters.kota   && state.filters.kota   !== '__all__' && r.kota   !== state.filters.kota)   return false;
      if (state.filters.brand  && state.filters.brand  !== '__all__' && r.brand  !== state.filters.brand)  return false;
      if (state.filters.juta   && state.filters.juta   !== '__all__' && r.cekJuta !== state.filters.juta)  return false;
      if (state.filters.cekInk && state.filters.cekInk !== '__all__' && r.cekInk !== state.filters.cekInk) return false;
      return true;
    });

    const data = A.marketshareTable(baseRecords, {
      year: focusYear,
      prevYear,
      dept: '__all__',   // already filtered above
      category,
      topN: 6,
      sumField: state.filters.msMode === 'value' ? 'total' : 'qty',
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

  // ============================================================
  // Marketshare per Tipe PC — Detail Bulanan (table)
  // Only visible when dept === 'PC Branded'. Groups by cekInk.
  // ============================================================
  function renderMarketshareByTipePc() {
    const card = document.getElementById('marketshare-tipepc-card');
    if (!card) return;

    // Only show for PC Branded
    if (state.filters.dept !== 'PC Branded') {
      card.classList.add('hidden');
      return;
    }

    const yearsInData = [...new Set(state.records.map(r => r.year).filter(Boolean))].sort((a, b) => a - b);
    if (!yearsInData.length) { card.classList.add('hidden'); return; }

    let focusYear;
    if (state.filters.tahun && state.filters.tahun !== '__all__') {
      focusYear = parseInt(state.filters.tahun, 10);
    } else {
      focusYear = yearsInData[yearsInData.length - 1];
    }
    const prevYear = focusYear - 1;

    // Apply filters except tahun, bulan (table is per-month breakdown)
    // Also skip cekInk filter since we are grouping BY cekInk
    const baseRecords = state.records.filter(r => {
      if (r.dept !== 'PC Branded') return false;
      if (state.filters.kota  && state.filters.kota  !== '__all__' && r.kota  !== state.filters.kota)  return false;
      if (state.filters.brand && state.filters.brand !== '__all__' && r.brand !== state.filters.brand) return false;
      if (state.filters.juta  && state.filters.juta  !== '__all__' && r.cekJuta !== state.filters.juta) return false;
      return true;
    });

    const data = A.marketshareTable(baseRecords, {
      year: focusYear,
      prevYear,
      dept: '__all__',
      category: '__all__',
      topN: 8,
      sumField: state.filters.msTipePcMode === 'value' ? 'total' : 'qty',
      groupByField: 'cekInk',
    });

    if (!data || !data.topBrands.length) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');

    // Period banner
    const banner = document.getElementById('ms-tipepc-period-banner');
    if (banner) {
      banner.innerHTML = `<span>📊 Tahun <strong>${focusYear}</strong> · YoY dibandingkan <strong>${prevYear}</strong> · Dept: <strong>PC Branded</strong></span>`;
    }

    renderMarketshareByTipePcTableHtml(data);
  }

  function renderMarketshareByTipePcTableHtml(data) {
    const table = document.getElementById('ms-tipepc-table');
    if (!table) return;
    const { topBrands, otherCount, rows, grandRow, estimasiClosing, growth, yearLabel, prevYearLabel, sumField } = data;
    const isValue = sumField === 'total';
    const valLabel = isValue ? 'VALUE' : 'QTY';

    // Build column list (topBrands here are actually tipe PC values like AIO, TOWER, MINI PC)
    const tipeCols = topBrands.map((b, i) => ({
      key: b,
      label: String(b).toUpperCase(),
      color: BRAND_PALETTE[i % BRAND_PALETTE.length],
    }));
    if (otherCount > 0) {
      tipeCols.push({ key: '__other__', label: `OTHER (${otherCount})`, color: COLOR_OTHER });
    }

    // ----- HEAD -----
    let headRow1 = `<tr class="brand-row">`;
    headRow1 += `<th rowspan="2" class="ms-head-bulan">BULAN</th>`;
    for (const c of tipeCols) {
      headRow1 += `<th colspan="2" class="ms-head-brand">${escapeHtml(c.label)}</th>`;
    }
    headRow1 += `<th rowspan="2" class="ms-head-grand"><span class="ms-head-main">GRAND</span><span class="ms-head-sub">TOTAL</span></th>`;
    headRow1 += `<th rowspan="2" class="ms-head-mom"><span class="ms-head-main">MOM</span><span class="ms-head-sub">${yearLabel}</span></th>`;
    headRow1 += `<th rowspan="2" class="ms-head-yoy"><span class="ms-head-main">YOY</span><span class="ms-head-sub">vs ${prevYearLabel}</span></th>`;
    headRow1 += `<th rowspan="2" class="ms-head-est"><span class="ms-head-main">ESTIMASI</span><span class="ms-head-sub">CLOSING</span></th>`;
    headRow1 += `<th rowspan="2" class="ms-head-growth"><span class="ms-head-main">GROWTH</span><span class="ms-head-sub">${yearLabel} vs ${prevYearLabel}</span></th>`;
    headRow1 += `</tr>`;

    let headRow2 = `<tr class="subhead">`;
    for (let i = 0; i < tipeCols.length; i++) {
      headRow2 += `<th>${valLabel}</th><th>%</th>`;
    }
    headRow2 += `</tr>`;

    // ----- BODY -----
    let growthMergedHtml = '';
    if (growth && growth.pct !== null && growth.pct !== undefined && !isNaN(growth.pct)) {
      const arrow = growth.pct >= 0 ? '▲' : '▼';
      const cls   = growth.pct >= 0 ? 'ms-up' : 'ms-down';
      growthMergedHtml = `
        <div class="ms-growth-merged">
          <span class="${cls} ms-growth-pct"><strong>${arrow} ${Math.abs(growth.pct).toFixed(2)}%</strong></span>
          <div class="ms-growth-period">${escapeHtml(growth.periodLabel)}</div>
          ${growth.note ? `<div class="ms-growth-note">${escapeHtml(growth.note)}</div>` : ''}
        </div>`;
    }

    let body = '';
    rows.forEach((row, idx) => {
      const cells = [];
      const hasData = row.grandTotal > 0;
      const bulanCls = hasData ? 'ms-bulan-cell' : 'ms-bulan-cell ms-empty-month';
      cells.push(`<td class="${bulanCls}">${escapeHtml(row.month.slice(0,3))}</td>`);
      for (const c of tipeCols) {
        const qty = row.qtyPerBrand[c.key] || 0;
        const share = row.sharePerBrand[c.key];
        const delta = row.shareDelta ? row.shareDelta[c.key] : null;
        if (!hasData) {
          cells.push(`<td class="ms-qty-cell ms-empty"></td><td class="ms-share-cell ms-empty"></td>`);
        } else {
          const fmtVal = isValue ? fmtValueShort(qty) : U.formatNumber(qty);
          cells.push(`<td class="ms-qty-cell">${fmtVal}</td>`);
          const isFlat = (delta === null || delta === undefined || isNaN(delta) || Math.abs(delta) < 0.005);
          const pctCls = isFlat ? 'pct-flat' : (delta >= 0 ? 'pct-up' : 'pct-down');
          const arrowChar = isFlat ? '' : (delta >= 0 ? '▲ ' : '▼ ');
          cells.push(`<td class="ms-share-cell ${pctCls}">${arrowChar}${(share || 0).toFixed(2)}%</td>`);
        }
      }
      // Grand Total
      cells.push(`<td class="ms-qty-cell ms-total-cell">${hasData ? (isValue ? fmtValueShort(row.grandTotal) : U.formatNumber(row.grandTotal)) : ''}</td>`);
      // MoM
      cells.push(`<td class="ms-share-cell ms-mom-cell">${hasData ? fmtPct(row.mom) : ''}</td>`);
      // YoY
      cells.push(`<td class="ms-share-cell ms-yoy-cell">${hasData ? fmtPct(row.yoy) : ''}</td>`);
      // Estimasi Closing
      let estHtml = '';
      if (estimasiClosing && estimasiClosing.monthName === row.month) {
        const estFmt = isValue ? fmtValueShort(estimasiClosing.value) : U.formatNumber(estimasiClosing.value);
        estHtml = `<strong>${estFmt}</strong>\n${estimasiClosing.daysElapsed}/${estimasiClosing.daysInMonth} hari`;
      }
      cells.push(`<td class="ms-est-cell">${estHtml}</td>`);
      // Growth merged
      if (idx === 0) {
        cells.push(`<td class="ms-growth-cell" rowspan="${rows.length}">${growthMergedHtml}</td>`);
      }

      const rowCls = hasData ? '' : ' class="ms-empty-row"';
      body += `<tr${rowCls}>${cells.join('')}</tr>`;
    });

    // ----- GRAND TOTAL ROW -----
    const grandCells = [];
    grandCells.push(`<td class="ms-bulan-cell">Grand Total</td>`);
    for (const c of tipeCols) {
      const qty = grandRow.qtyPerBrand[c.key] || 0;
      const share = grandRow.sharePerBrand[c.key] || 0;
      const fmtVal = isValue ? fmtValueShort(qty) : U.formatNumber(qty);
      grandCells.push(`<td class="ms-qty-cell">${fmtVal}</td>`);
      grandCells.push(`<td class="ms-share-cell">${share.toFixed(2)}%</td>`);
    }
    grandCells.push(`<td class="ms-qty-cell ms-total-cell">${isValue ? fmtValueShort(grandRow.grandTotal) : U.formatNumber(grandRow.grandTotal)}</td>`);
    grandCells.push(`<td class="ms-share-cell ms-mom-cell"></td>`);
    grandCells.push(`<td class="ms-share-cell ms-yoy-cell"></td>`);
    grandCells.push(`<td class="ms-est-cell"></td>`);
    grandCells.push(`<td class="ms-growth-cell"></td>`);

    table.innerHTML =
      `<thead>${headRow1}${headRow2}</thead>` +
      `<tbody>${body}</tbody>` +
      `<tfoot><tr class="ms-grand-row">${grandCells.join('')}</tr></tfoot>`;
  }

  // Brand color palette + known brand colors (matches reference screenshot)
  const BRAND_PALETTE = ['#fbbf24', '#22c55e', '#84cc16', '#e2e8f0', '#818cf8', '#fb923c', '#ec4899', '#60a5fa'];
  const COLOR_OTHER = '#c4b5fd';
  const COLOR_GRAND = '#cbd5e1';
  const COLOR_MOM   = '#fbbf24';
  const COLOR_YOY   = '#f472b6';
  const COLOR_EST   = '#a78bfa';
  const COLOR_GROW  = '#34d399';

  // Known brand → signature colors (case-insensitive)
  const KNOWN_BRANDS = {
    'asus': '#fbbf24', 'lenovo': '#22c55e', 'acer': '#84cc16', 'apple': '#e2e8f0',
    'axioo': '#818cf8', 'advan': '#fb923c', 'hp': '#ec4899', 'msi': '#60a5fa',
    'epson': '#22c55e', 'canon': '#ef4444', 'samsung': '#3b82f6', 'lg': '#a855f7',
    'xiaomi': '#fb923c', 'brother': '#60a5fa', 'aoc': '#ec4899', 'benq': '#06b6d4',
    'philips': '#84cc16', 'dell': '#3b82f6', 'blueprint': '#06b6d4',
    'other': COLOR_OTHER, 'unknown': '#94a3b8',
  };

  function brandColor(brand, fallbackIdx) {
    const k = String(brand || '').toLowerCase().trim();
    if (KNOWN_BRANDS[k]) return KNOWN_BRANDS[k];
    return BRAND_PALETTE[fallbackIdx % BRAND_PALETTE.length];
  }

  function fmtPct(v, decimals = 2) {
    if (v === null || v === undefined || isNaN(v)) return '';
    const arrow = v >= 0 ? '▲' : '▼';
    const cls = v >= 0 ? 'ms-up' : 'ms-down';
    return `<span class="${cls}">${arrow} ${Math.abs(v).toFixed(decimals)}%</span>`;
  }

  /** Short value format for table cells: no "Rp " prefix, compact */
  function fmtValueShort(n) {
    if (!n) return '0';
    const abs = Math.abs(n);
    if (abs >= 1e9)  return (n / 1e9).toFixed(1) + 'M';
    if (abs >= 1e6)  return (n / 1e6).toFixed(1) + 'Jt';
    if (abs >= 1e3)  return (n / 1e3).toFixed(0) + 'rb';
    return Math.round(n).toLocaleString('id-ID');
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
    const { topBrands, otherCount, rows, grandRow, estimasiClosing, growth, yearLabel, prevYearLabel, sumField } = data;
    const isValue = sumField === 'total';
    const valLabel = isValue ? 'VALUE' : 'QTY';

    // Build column list: [...topBrands, _OTHER, GRAND, MOM, YOY, EST, GROWTH]
    const brandCols = topBrands.map((b, i) => ({
      key: b,
      label: String(b).toUpperCase(),
      color: brandColor(b, i),
    }));
    if (otherCount > 0) {
      brandCols.push({ key: '__other__', label: `OTHER (${otherCount})`, color: COLOR_OTHER });
    }

    // ----- HEAD -----
    let headRow1 = `<tr class="brand-row">`;
    headRow1 += `<th rowspan="2" class="ms-head-bulan">BULAN</th>`;
    for (const c of brandCols) {
      const brandSlug = c.key === '__other__' ? 'other' : String(c.key).toLowerCase().replace(/[^a-z]/g, '');
      headRow1 += `<th colspan="2" class="ms-head-brand ms-brand-${brandSlug}">${escapeHtml(c.label)}</th>`;
    }
    headRow1 += `<th rowspan="2" class="ms-head-grand"><span class="ms-head-main">GRAND</span><span class="ms-head-sub">TOTAL</span></th>`;
    headRow1 += `<th rowspan="2" class="ms-head-mom"><span class="ms-head-main">MOM</span><span class="ms-head-sub">${yearLabel}</span></th>`;
    headRow1 += `<th rowspan="2" class="ms-head-yoy"><span class="ms-head-main">YOY</span><span class="ms-head-sub">vs ${prevYearLabel}</span></th>`;
    headRow1 += `<th rowspan="2" class="ms-head-est"><span class="ms-head-main">ESTIMASI</span><span class="ms-head-sub">CLOSING</span></th>`;
    headRow1 += `<th rowspan="2" class="ms-head-growth"><span class="ms-head-main">GROWTH</span><span class="ms-head-sub">${yearLabel} vs ${prevYearLabel}</span></th>`;
    headRow1 += `</tr>`;

    let headRow2 = `<tr class="subhead">`;
    for (let i = 0; i < brandCols.length; i++) {
      headRow2 += `<th>${valLabel}</th><th>%</th>`;
    }
    headRow2 += `</tr>`;

    // ----- BODY -----
    // Pre-compute the merged Growth cell content (rendered once with rowspan=12)
    let growthMergedHtml = '';
    if (growth && growth.pct !== null && growth.pct !== undefined && !isNaN(growth.pct)) {
      const arrow = growth.pct >= 0 ? '▲' : '▼';
      const cls   = growth.pct >= 0 ? 'ms-up' : 'ms-down';
      growthMergedHtml = `
        <div class="ms-growth-merged">
          <span class="${cls} ms-growth-pct"><strong>${arrow} ${Math.abs(growth.pct).toFixed(2)}%</strong></span>
          <div class="ms-growth-period">${escapeHtml(growth.periodLabel)}</div>
          ${growth.note ? `<div class="ms-growth-note">${escapeHtml(growth.note)}</div>` : ''}
        </div>`;
    }

    let body = '';
    rows.forEach((row, idx) => {
      const cells = [];
      // Month label cell
      const hasData = row.grandTotal > 0;
      const bulanCls = hasData ? 'ms-bulan-cell' : 'ms-bulan-cell ms-empty-month';
      cells.push(`<td class="${bulanCls}">${escapeHtml(row.month.slice(0,3))}</td>`);
      for (const c of brandCols) {
        const qty = row.qtyPerBrand[c.key] || 0;
        const share = row.sharePerBrand[c.key];
        const delta = row.shareDelta ? row.shareDelta[c.key] : null;
        if (!hasData) {
          // Empty cells (no '-' placeholder per user request)
          cells.push(`<td class="ms-qty-cell ms-empty"></td><td class="ms-share-cell ms-empty"></td>`);
        } else {
          const fmtVal = isValue ? fmtValueShort(qty) : U.formatNumber(qty);
          cells.push(`<td class="ms-qty-cell">${fmtVal}</td>`);
          // Entire share % cell colored by delta direction
          const isFlat = (delta === null || delta === undefined || isNaN(delta) || Math.abs(delta) < 0.005);
          const pctCls = isFlat ? 'pct-flat' : (delta >= 0 ? 'pct-up' : 'pct-down');
          const arrowChar = isFlat ? '' : (delta >= 0 ? '▲ ' : '▼ ');
          cells.push(`<td class="ms-share-cell ${pctCls}">${arrowChar}${(share || 0).toFixed(2)}%</td>`);
        }
      }
      // Grand Total
      cells.push(`<td class="ms-qty-cell ms-total-cell">${hasData ? (isValue ? fmtValueShort(row.grandTotal) : U.formatNumber(row.grandTotal)) : ''}</td>`);
      // MoM
      cells.push(`<td class="ms-share-cell ms-mom-cell">${hasData ? fmtPct(row.mom) : ''}</td>`);
      // YoY
      cells.push(`<td class="ms-share-cell ms-yoy-cell">${hasData ? fmtPct(row.yoy) : ''}</td>`);

      // Estimasi Closing — only the row matching estimasiClosing.monthName
      let estHtml = '';
      if (estimasiClosing && estimasiClosing.monthName === row.month) {
        const estFmt = isValue ? fmtValueShort(estimasiClosing.value) : U.formatNumber(estimasiClosing.value);
        estHtml = `<strong>${estFmt}</strong>\n${estimasiClosing.daysElapsed}/${estimasiClosing.daysInMonth} hari`;
      }
      cells.push(`<td class="ms-est-cell">${estHtml}</td>`);

      // Growth — MERGED across all 12 rows. Only render the cell on the FIRST row
      // with rowspan = total number of months. Other rows skip this column.
      if (idx === 0) {
        cells.push(`<td class="ms-growth-cell" rowspan="${rows.length}">${growthMergedHtml}</td>`);
      }

      const rowCls = hasData ? '' : ' class="ms-empty-row"';
      body += `<tr${rowCls}>${cells.join('')}</tr>`;
    });

    // ----- GRAND TOTAL ROW -----
    const grandCells = [];
    grandCells.push(`<td class="ms-bulan-cell">Grand Total</td>`);
    for (const c of brandCols) {
      const qty = grandRow.qtyPerBrand[c.key] || 0;
      const share = grandRow.sharePerBrand[c.key] || 0;
      const fmtVal = isValue ? fmtValueShort(qty) : U.formatNumber(qty);
      grandCells.push(`<td class="ms-qty-cell">${fmtVal}</td>`);
      grandCells.push(`<td class="ms-share-cell">${share.toFixed(2)}%</td>`);
    }
    grandCells.push(`<td class="ms-qty-cell ms-total-cell">${isValue ? fmtValueShort(grandRow.grandTotal) : U.formatNumber(grandRow.grandTotal)}</td>`);
    grandCells.push(`<td class="ms-share-cell ms-mom-cell"></td>`);
    grandCells.push(`<td class="ms-share-cell ms-yoy-cell"></td>`);
    grandCells.push(`<td class="ms-est-cell"></td>`);
    grandCells.push(`<td class="ms-growth-cell"></td>`); // Growth column placeholder for tfoot row

    table.innerHTML =
      `<thead>${headRow1}${headRow2}</thead>` +
      `<tbody>${body}</tbody>` +
      `<tfoot><tr class="ms-grand-row">${grandCells.join('')}</tr></tfoot>`;
  }

  // ============================================================
  // Marketshare per Cabang/Kota — Detail Bulanan (table)
  // ============================================================
  // Kota color palette
  const KOTA_PALETTE = ['#fbbf24','#22c55e','#84cc16','#818cf8','#fb923c','#ec4899','#60a5fa','#06b6d4','#e2e8f0','#a78bfa'];

  function kotaColor(idx) {
    return KOTA_PALETTE[idx % KOTA_PALETTE.length];
  }

  function renderMarketshareKota() {
    const card = document.getElementById('marketshare-kota-card');
    if (!card) return;

    const yearsInData = [...new Set(state.records.map(r => r.year).filter(Boolean))].sort((a,b) => a - b);
    if (!yearsInData.length) { card.classList.add('hidden'); return; }

    let focusYear;
    if (state.filters.tahun && state.filters.tahun !== '__all__') {
      focusYear = parseInt(state.filters.tahun, 10);
    } else {
      focusYear = yearsInData[yearsInData.length - 1];
    }
    const prevYear = focusYear - 1;

    const dept = state.filters.dept;

    // Apply filters except tahun, bulan, kota (table is per-month per-kota breakdown)
    const baseRecords = state.records.filter(r => {
      if (state.filters.dept   && state.filters.dept   !== '__all__' && r.dept   !== state.filters.dept)   return false;
      if (state.filters.brand  && state.filters.brand  !== '__all__' && r.brand  !== state.filters.brand)  return false;
      if (state.filters.juta   && state.filters.juta   !== '__all__' && r.cekJuta !== state.filters.juta)  return false;
      if (state.filters.cekInk && state.filters.cekInk !== '__all__' && r.cekInk !== state.filters.cekInk) return false;
      return true;
    });

    const data = A.marketshareByKota(baseRecords, {
      year: focusYear,
      prevYear,
      dept: '__all__',
      topN: 10,
      sumField: state.filters.msKotaMode === 'value' ? 'total' : 'qty',
    });

    if (!data || !data.topKota.length) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');

    // Period banner
    const banner = document.getElementById('ms-kota-period-banner');
    if (banner) {
      banner.innerHTML = `<span>📊 Tahun <strong>${focusYear}</strong> · YoY dibandingkan <strong>${prevYear}</strong></span>`;
    }

    renderMarketshareKotaTableHtml(data);
  }

  function renderMarketshareKotaTableHtml(data) {
    const table = document.getElementById('ms-kota-table');
    if (!table) return;
    const { topKota, otherCount, rows, grandRow, estimasiClosing, growth, yearLabel, prevYearLabel, sumField } = data;
    const isValue = sumField === 'total';
    const valLabel = isValue ? 'VALUE' : 'QTY';

    // Build column list
    const kotaCols = topKota.map((k, i) => ({
      key: k,
      label: String(k).toUpperCase(),
      color: kotaColor(i),
    }));
    if (otherCount > 0) {
      kotaCols.push({ key: '__other__', label: `OTHER (${otherCount})`, color: COLOR_OTHER });
    }

    // ----- HEAD -----
    let headRow1 = `<tr class="brand-row">`;
    headRow1 += `<th rowspan="2" class="ms-head-bulan">BULAN</th>`;
    for (const c of kotaCols) {
      headRow1 += `<th colspan="2" class="ms-head-brand">${escapeHtml(c.label)}</th>`;
    }
    headRow1 += `<th rowspan="2" class="ms-head-grand"><span class="ms-head-main">GRAND</span><span class="ms-head-sub">TOTAL</span></th>`;
    headRow1 += `<th rowspan="2" class="ms-head-mom"><span class="ms-head-main">MOM</span><span class="ms-head-sub">${yearLabel}</span></th>`;
    headRow1 += `<th rowspan="2" class="ms-head-yoy"><span class="ms-head-main">YOY</span><span class="ms-head-sub">vs ${prevYearLabel}</span></th>`;
    headRow1 += `<th rowspan="2" class="ms-head-est"><span class="ms-head-main">ESTIMASI</span><span class="ms-head-sub">CLOSING</span></th>`;
    headRow1 += `<th rowspan="2" class="ms-head-growth"><span class="ms-head-main">GROWTH</span><span class="ms-head-sub">${yearLabel} vs ${prevYearLabel}</span></th>`;
    headRow1 += `</tr>`;

    let headRow2 = `<tr class="subhead">`;
    for (let i = 0; i < kotaCols.length; i++) {
      headRow2 += `<th>${valLabel}</th><th>%</th>`;
    }
    headRow2 += `</tr>`;

    // ----- BODY -----
    let growthMergedHtml = '';
    if (growth && growth.pct !== null && growth.pct !== undefined && !isNaN(growth.pct)) {
      const arrow = growth.pct >= 0 ? '▲' : '▼';
      const cls   = growth.pct >= 0 ? 'ms-up' : 'ms-down';
      growthMergedHtml = `
        <div class="ms-growth-merged">
          <span class="${cls} ms-growth-pct"><strong>${arrow} ${Math.abs(growth.pct).toFixed(2)}%</strong></span>
          <div class="ms-growth-period">${escapeHtml(growth.periodLabel)}</div>
          ${growth.note ? `<div class="ms-growth-note">${escapeHtml(growth.note)}</div>` : ''}
        </div>`;
    }

    let body = '';
    rows.forEach((row, idx) => {
      const cells = [];
      const hasData = row.grandTotal > 0;
      const bulanCls = hasData ? 'ms-bulan-cell' : 'ms-bulan-cell ms-empty-month';
      cells.push(`<td class="${bulanCls}">${escapeHtml(row.month.slice(0,3))}</td>`);
      for (const c of kotaCols) {
        const qty = row.qtyPerKota[c.key] || 0;
        const share = row.sharePerKota[c.key];
        const delta = row.shareDelta ? row.shareDelta[c.key] : null;
        if (!hasData) {
          cells.push(`<td class="ms-qty-cell ms-empty"></td><td class="ms-share-cell ms-empty"></td>`);
        } else {
          const fmtVal = isValue ? U.formatIDRCompact(qty) : U.formatNumber(qty);
          cells.push(`<td class="ms-qty-cell">${fmtVal}</td>`);
          const isFlat = (delta === null || delta === undefined || isNaN(delta) || Math.abs(delta) < 0.005);
          const pctCls = isFlat ? 'pct-flat' : (delta >= 0 ? 'pct-up' : 'pct-down');
          const arrowChar = isFlat ? '' : (delta >= 0 ? '▲ ' : '▼ ');
          cells.push(`<td class="ms-share-cell ${pctCls}">${arrowChar}${(share || 0).toFixed(2)}%</td>`);
        }
      }
      // Grand Total
      cells.push(`<td class="ms-qty-cell ms-total-cell">${hasData ? (isValue ? fmtValueShort(row.grandTotal) : U.formatNumber(row.grandTotal)) : ''}</td>`);
      // MoM
      cells.push(`<td class="ms-share-cell ms-mom-cell">${hasData ? fmtPct(row.mom) : ''}</td>`);
      // YoY
      cells.push(`<td class="ms-share-cell ms-yoy-cell">${hasData ? fmtPct(row.yoy) : ''}</td>`);
      // Estimasi Closing
      let estHtml = '';
      if (estimasiClosing && estimasiClosing.monthName === row.month) {
        const estFmt = isValue ? fmtValueShort(estimasiClosing.value) : U.formatNumber(estimasiClosing.value);
        estHtml = `<strong>${estFmt}</strong>\n${estimasiClosing.daysElapsed}/${estimasiClosing.daysInMonth} hari`;
      }
      cells.push(`<td class="ms-est-cell">${estHtml}</td>`);
      // Growth merged
      if (idx === 0) {
        cells.push(`<td class="ms-growth-cell" rowspan="${rows.length}">${growthMergedHtml}</td>`);
      }

      const rowCls = hasData ? '' : ' class="ms-empty-row"';
      body += `<tr${rowCls}>${cells.join('')}</tr>`;
    });

    // ----- GRAND TOTAL ROW -----
    const grandCells = [];
    grandCells.push(`<td class="ms-bulan-cell">Grand Total</td>`);
    for (const c of kotaCols) {
      const qty = grandRow.qtyPerKota[c.key] || 0;
      const share = grandRow.sharePerKota[c.key] || 0;
      const fmtVal = isValue ? fmtValueShort(qty) : U.formatNumber(qty);
      grandCells.push(`<td class="ms-qty-cell">${fmtVal}</td>`);
      grandCells.push(`<td class="ms-share-cell">${share.toFixed(2)}%</td>`);
    }
    grandCells.push(`<td class="ms-qty-cell ms-total-cell">${isValue ? fmtValueShort(grandRow.grandTotal) : U.formatNumber(grandRow.grandTotal)}</td>`);
    grandCells.push(`<td class="ms-share-cell ms-mom-cell"></td>`);
    grandCells.push(`<td class="ms-share-cell ms-yoy-cell"></td>`);
    grandCells.push(`<td class="ms-est-cell"></td>`);
    grandCells.push(`<td class="ms-growth-cell"></td>`);

    table.innerHTML =
      `<thead>${headRow1}${headRow2}</thead>` +
      `<tbody>${body}</tbody>` +
      `<tfoot><tr class="ms-grand-row">${grandCells.join('')}</tr></tfoot>`;
  }

  // ============================================================
  // STACKED BAR CHART — Market Brand per Bulan (Chart.js)
  // ============================================================
  // High-contrast brand colors (each visually distinct from neighbors)
  const BRAND_STACK_COLORS = {
    'Epson':    '#10b981', 'Canon':    '#dc2626', 'HP':       '#d946ef',
    'Samsung':  '#2563eb', 'LG':       '#7c3aed', 'Lenovo':   '#15803d',
    'ASUS':     '#ca8a04', 'Xiaomi':   '#ea580c', 'Brother':  '#0891b2',
    'MSI':      '#4f46e5', 'ACER':     '#65a30d', 'Other':    '#6b7280',
    'Blueprint':'#0284c7', 'Unknown':  '#a1a1aa', '_default': '#6366f1',
  };

  function getStackColor(brand) {
    if (BRAND_STACK_COLORS[brand]) return BRAND_STACK_COLORS[brand];
    const tc = brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
    if (BRAND_STACK_COLORS[tc]) return BRAND_STACK_COLORS[tc];
    if (BRAND_STACK_COLORS[brand.toUpperCase()]) return BRAND_STACK_COLORS[brand.toUpperCase()];
    return BRAND_STACK_COLORS._default;
  }

  let stackedChartInstance = null;

  function renderDept3D() {
    const card = document.getElementById('dept3d-card');
    const canvas = document.getElementById('chart-stacked');
    if (!card || !canvas) return;

    if (!state.records.length) { card.classList.add('hidden'); return; }

    // Focus year
    const yearsInData = [...new Set(state.records.map(r => r.year).filter(Boolean))].sort();
    let focusYear;
    if (state.filters.tahun && state.filters.tahun !== '__all__') {
      focusYear = parseInt(state.filters.tahun, 10);
    } else {
      focusYear = yearsInData[yearsInData.length - 1];
    }

    // Apply active filters + restrict to focus year
    const filtered = state.records.filter(r => {
      if (r.year !== focusYear) return false;
      if (state.filters.dept   && state.filters.dept   !== '__all__' && r.dept   !== state.filters.dept)   return false;
      if (state.filters.kota   && state.filters.kota   !== '__all__' && r.kota   !== state.filters.kota)   return false;
      if (state.filters.brand  && state.filters.brand  !== '__all__' && r.brand  !== state.filters.brand)  return false;
      if (state.filters.cekInk && state.filters.cekInk !== '__all__' && r.cekInk !== state.filters.cekInk) return false;
      return true;
    });

    if (!filtered.length) { card.classList.add('hidden'); return; }

    // Top brands (qty) — exclude "Other"/"Unknown" from ranking, they go to bucket
    const brandTotals = new Map();
    for (const r of filtered) {
      const b = r.brand || 'Unknown';
      brandTotals.set(b, (brandTotals.get(b) || 0) + (r.qty || 0));
    }
    const isOtherLike = (b) => /^(other|unknown)$/i.test(String(b).trim());
    const allEntries = [...brandTotals.entries()].sort((a, b) => b[1] - a[1]);
    const realBrandEntries = allEntries.filter(([k]) => !isOtherLike(k));
    const otherDataBrands = new Set(allEntries.filter(([k]) => isOtherLike(k)).map(([k]) => k));
    const topBrands = realBrandEntries.slice(0, 6).map(([k]) => k);
    const overflowBrands = new Set(realBrandEntries.slice(6).map(([k]) => k));
    const hasOther = overflowBrands.size > 0 || otherDataBrands.size > 0;
    const allKeys = hasOther ? [...topBrands, 'Other'] : [...topBrands];

    if (!allKeys.length) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');

    // Update titles
    const dept = state.filters.dept && state.filters.dept !== '__all__' ? state.filters.dept : '';
    const titleEl = document.getElementById('stacked-title');
    const subEl = document.getElementById('stacked-sub');
    if (titleEl) titleEl.textContent = `📦 Market Brand per Bulan${dept ? ' — ' + dept : ''} (${focusYear})`;
    if (subEl) subEl.textContent = `Top ${topBrands.length} brand, unit terjual per bulan (stacked)`;

    // Build matrix brand × month
    const MONTHS_FULL = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    const matrix = {};
    for (const k of allKeys) matrix[k] = new Array(12).fill(0);
    for (const r of filtered) {
      const mIdx = MONTHS_FULL.indexOf(r.bulan);
      if (mIdx < 0) continue;
      const key = topBrands.includes(r.brand) ? r.brand : ((overflowBrands.has(r.brand) || otherDataBrands.has(r.brand)) ? 'Other' : null);
      if (key) matrix[key][mIdx] += (r.qty || 0);
    }

    // Find last month with data
    let lastIdx = -1;
    for (let m = 0; m < 12; m++) {
      for (const k of allKeys) { if (matrix[k][m] > 0) { lastIdx = m; break; } }
    }
    if (lastIdx < 0) { card.classList.add('hidden'); return; }

    const labels = MONTHS_SHORT.slice(0, lastIdx + 1);
    const datasets = allKeys.map(brand => ({
      label: brand,
      data: matrix[brand].slice(0, lastIdx + 1),
      backgroundColor: getStackColor(brand) + '99',
      borderColor: getStackColor(brand),
      borderWidth: state.chartType === 'line' ? 2.5 : 0,
      borderRadius: state.chartType === 'line' ? 0 : 6,
      ...(state.chartType === 'line' ? {
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 7,
        pointBackgroundColor: getStackColor(brand),
        pointBorderColor: '#0a0e1a',
        pointBorderWidth: 2,
        fill: false,
      } : {}),
    }));

    // Destroy old + create new
    if (stackedChartInstance) { stackedChartInstance.destroy(); stackedChartInstance = null; }
    const chartType = state.chartType === 'line' ? 'line' : 'bar';
    stackedChartInstance = new Chart(canvas.getContext('2d'), {
      type: chartType,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 10, boxHeight: 10, padding: 14, usePointStyle: true, pointStyle: chartType === 'line' ? 'circle' : 'rect', font: { size: 11, weight: 500 } },
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              title: (items) => items.length ? items[0].label + ' ' + focusYear : '',
              label: (c) => {
                const total = c.chart.data.datasets.reduce((s, ds) => s + (ds.data[c.dataIndex] || 0), 0);
                const pct = total > 0 ? ((c.parsed.y / total) * 100).toFixed(1) : '0.0';
                return ` ${c.dataset.label}: ${U.formatNumber(c.parsed.y)} unit (${pct}%)`;
              },
              footer: (items) => {
                const total = items.reduce((s, i) => s + i.parsed.y, 0);
                return `Total: ${U.formatNumber(total)} unit`;
              }
            }
          }
        },
        scales: {
          x: {
            stacked: chartType === 'bar',
            grid: { display: false },
            ticks: { font: { weight: 600 } },
          },
          y: {
            stacked: chartType === 'bar',
            ticks: { callback: (v) => U.formatNumber(v) },
            grid: { color: 'rgba(45,52,84,0.25)', drawBorder: false },
          }
        }
      }
    });
  }

  // ============================================================
  // DIMENSI TABLE — Report per ukuran layar (Monitor only)
  // ============================================================
  function renderDimensiTable(records) {
    const table = document.getElementById('table-dimensi');
    if (!table) return;

    // Group by dimensi
    const grouped = new Map();
    let totalQty = 0;
    let totalRevenue = 0;
    for (const r of records) {
      const dim = r.dimensi || 'Lainnya';
      if (!grouped.has(dim)) grouped.set(dim, { qty: 0, revenue: 0 });
      const g = grouped.get(dim);
      g.qty += (r.qty || 0);
      g.revenue += (r.total || 0);
      totalQty += (r.qty || 0);
      totalRevenue += (r.total || 0);
    }

    // Sort ascending by dimension size (smallest → largest)
    // Extract leading number from dimension string for numeric sort
    const rows = [...grouped.entries()]
      .map(([dim, d]) => ({
        dimensi: dim,
        qty: d.qty,
        revenue: d.revenue,
        pctQty: totalQty > 0 ? (d.qty / totalQty * 100) : 0,
        pctRevenue: totalRevenue > 0 ? (d.revenue / totalRevenue * 100) : 0,
      }))
      .sort((a, b) => {
        // Extract first number from dimension strings (e.g., "24 Inch / 25 Inch" → 24)
        const numA = parseInt(String(a.dimensi).match(/\d+/) || [999]);
        const numB = parseInt(String(b.dimensi).match(/\d+/) || [999]);
        return numA - numB;  // ascending: smallest dimension first
      });

    if (!rows.length) {
      table.innerHTML = '<tr><td class="text-center py-4" style="color:var(--text-muted)">Tidak ada data dimensi</td></tr>';
      return;
    }

    let html = `<thead><tr>
      <th class="ms-head-bulan">Dimensi</th>
      <th class="ms-head-grand">QTY</th>
      <th class="ms-head-grand">% QTY</th>
      <th class="ms-head-grand">Revenue</th>
      <th class="ms-head-grand">% Revenue</th>
    </tr></thead><tbody>`;

    for (const row of rows) {
      html += `<tr>
        <td class="ms-bulan-cell">${escapeHtml(row.dimensi)}</td>
        <td class="ms-qty-cell">${U.formatNumber(row.qty)}</td>
        <td class="ms-share-cell">${row.pctQty.toFixed(1)}%</td>
        <td class="ms-qty-cell">${U.formatIDRCompact(row.revenue)}</td>
        <td class="ms-share-cell">${row.pctRevenue.toFixed(1)}%</td>
      </tr>`;
    }

    html += `</tbody><tfoot><tr class="ms-grand-row">
      <td class="ms-bulan-cell">Total</td>
      <td class="ms-qty-cell">${U.formatNumber(totalQty)}</td>
      <td class="ms-share-cell">100%</td>
      <td class="ms-qty-cell">${U.formatIDRCompact(totalRevenue)}</td>
      <td class="ms-share-cell">100%</td>
    </tr></tfoot>`;

    table.innerHTML = html;
  }

  // ============================================================
  // PARETO PC — Fetch & render from the consolidated year-per-sheet workbook
  // ============================================================
  // Single combined cache: snapshot (latest month) + multi-month trend are
  // built from the same fetched data, so they live under one key. Bump v3
  // when the persisted shape changes again.
  const PARETO_PC_CACHE_KEY = 'paretopc:pareto-pc:v3';
  const PARETO_PC_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  // Auto-clear invalid cache: if the stored payload lacks expected shape,
  // delete it so we re-fetch cleanly.
  try {
    const _raw = localStorage.getItem(PARETO_PC_CACHE_KEY);
    if (_raw) {
      const _parsed = JSON.parse(_raw);
      if (!_parsed || !_parsed.data || !_parsed.data.snapshot || !_parsed.data.trend) {
        console.warn('[ParetoPC] Cache has invalid shape, clearing.');
        localStorage.removeItem(PARETO_PC_CACHE_KEY);
      }
    }
  } catch (_e) {
    try { localStorage.removeItem(PARETO_PC_CACHE_KEY); } catch (_) {}
  }

  // Indonesian month-name → (month index 1-12, short label) mapping.
  const PARETO_PC_BULAN_MAP = {
    'januari':1, 'februari':2, 'maret':3, 'april':4, 'mei':5, 'juni':6,
    'juli':7, 'agustus':8, 'september':9, 'oktober':10, 'november':11, 'desember':12,
  };
  const PARETO_PC_SHORT_BULAN = ['','Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

  /** Parse "Januari 2026" / "JUNI 2025" → { year, month, label, short } */
  function parseBulanLabel(raw, fallbackYear) {
    const s = String(raw || '').trim();
    if (!s) return null;
    const parts = s.split(/\s+/);
    const monthKey = (parts[0] || '').toLowerCase();
    const monthIdx = PARETO_PC_BULAN_MAP[monthKey];
    if (!monthIdx) return null;
    let year = fallbackYear;
    if (parts[1] && /^\d{4}$/.test(parts[1])) year = parseInt(parts[1], 10);
    const niceMonth = monthKey.charAt(0).toUpperCase() + monthKey.slice(1);
    return {
      year,
      month: monthIdx,
      label: `${niceMonth} ${year}`,
      short: PARETO_PC_SHORT_BULAN[monthIdx],
    };
  }

  /**
   * Returns true when the cell text looks like a numeric amount (possibly
   * Indonesian-formatted, possibly negative, possibly with a "Rp" prefix
   * or "%" suffix). Used to skip pivot-table subheader rows like
   *   "April 2026  Dept Tambahan  SUM of Total Harga  SUM of Total Harga"
   * that share the Bulan column with real data rows.
   */
  function isNumericValueCell(s) {
    if (s == null) return false;
    const t = String(s).trim().replace(/[Rr][Pp]\.?\s*/g, '').replace(/%\s*$/, '');
    if (!t) return false;
    return /^-?[\d.,]+$/.test(t);
  }

  /**
   * Parse one published year-sheet TSV. Returns:
   *   { year, months: [{ key, year, month, label, short, leftRows, rightRows, leftGrand, rightGrand }] }
   * Months are sorted by month index ascending. Rows for unrecognized
   * Bulan labels (e.g. the 2025 legacy snapshot with no month column) are
   * dropped silently — the caller logs how many rows that affected.
   */
  function parseParetoPCYearSheet(tsv, year) {
    const months = new Map(); // key 'Januari 2026' -> month bucket
    const lines = String(tsv || '').split(/\r?\n/);
    let droppedRows = 0;

    function ensureMonth(bulanRaw) {
      const key = String(bulanRaw || '').trim();
      if (!key) return null;
      let bucket = months.get(key);
      if (bucket) return bucket;
      const parsed = parseBulanLabel(key, year);
      if (!parsed) return null;
      bucket = {
        key,
        year: parsed.year, month: parsed.month,
        label: parsed.label, short: parsed.short,
        leftRows: [], rightRows: [],
        leftGrand: 0, rightGrand: 0,
      };
      months.set(key, bucket);
      return bucket;
    }

    // Skip header row (line 0). Skip first 1 row even if blank.
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line == null) continue;
      // TSV: Google Sheets pub-tsv doesn't quote tab-containing fields
      // because cells can't contain tabs in the source. Plain split is safe.
      const cols = line.split('\t');
      if (cols.length < 4) continue;

      // Left side: A=Bulan, B=Departemen, C=Omset, D=%
      const lBulan = (cols[0] || '').trim();
      const lName  = (cols[1] || '').trim();
      const lVal   = (cols[2] || '').trim();
      const lPct   = (cols[3] || '').trim();
      if (lBulan && lName && isNumericValueCell(lVal)) {
        const bucket = ensureMonth(lBulan);
        if (bucket) {
          const isGrand = /grand\s*total/i.test(lName);
          const value   = parseIndonesianNumber(lVal);
          if (isGrand) {
            bucket.leftGrand += value;
          } else {
            bucket.leftRows.push({
              name: lName, value, valueRaw: lVal,
              pct: parseIndonesianPct(lPct), pctRaw: lPct,
              isGrandTotal: false,
            });
          }
        } else {
          droppedRows++;
        }
      }

      // Right side: F=Bulan(5), G=Departemen(6), H=Omset(7), I=%(8)
      const rBulan = (cols[5] || '').trim();
      const rName  = (cols[6] || '').trim();
      const rVal   = (cols[7] || '').trim();
      const rPct   = (cols[8] || '').trim();
      if (rBulan && rName && isNumericValueCell(rVal)) {
        const bucket = ensureMonth(rBulan);
        if (bucket) {
          const isGrand = /grand\s*total/i.test(rName);
          const value   = parseIndonesianNumber(rVal);
          if (isGrand) {
            bucket.rightGrand += value;
          } else {
            bucket.rightRows.push({
              name: rName, value, valueRaw: rVal,
              pct: parseIndonesianPct(rPct), pctRaw: rPct,
              isGrandTotal: false,
            });
          }
        } else {
          droppedRows++;
        }
      }
    }

    if (droppedRows > 0) {
      console.warn(`[ParetoPC] Year ${year}: ${droppedRows} row(s) dropped — Bulan label not in expected "Januari 2026" form.`);
    }

    const monthsArr = [...months.values()].sort((a, b) => a.month - b.month);
    return { year, months: monthsArr };
  }

  async function loadAndRenderParetoPC() {
    console.log('[ParetoPC] loadAndRenderParetoPC called');

    // 1) In-memory cache
    if (state.paretoPcData && state.paretoPcTrend) {
      renderParetoPCTables(state.paretoPcData);
      renderParetoPCTrend(state.paretoPcTrend);
      return;
    }

    // 2) localStorage cache (combined snapshot+trend)
    try {
      const cached = localStorage.getItem(PARETO_PC_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        // Validate shape before using
        if (parsed && parsed.data && parsed.data.snapshot && parsed.data.trend &&
            parsed.savedAt && (Date.now() - new Date(parsed.savedAt).getTime()) < PARETO_PC_CACHE_TTL_MS) {
          state.paretoPcData  = parsed.data.snapshot;
          state.paretoPcTrend = parsed.data.trend;
          renderParetoPCTables(state.paretoPcData);
          renderParetoPCTrend(state.paretoPcTrend);
          return;
        } else if (parsed && (!parsed.data || !parsed.data.snapshot || !parsed.data.trend)) {
          // Invalid shape - clear it
          console.warn('[ParetoPC] Cache shape invalid, removing.');
          localStorage.removeItem(PARETO_PC_CACHE_KEY);
        }
      }
    } catch (e) {
      console.warn('[ParetoPC] Cache read error, clearing:', e);
      try { localStorage.removeItem(PARETO_PC_CACHE_KEY); } catch (_) {}
    }

    // 3) Fetch every year sheet in parallel. A failed/empty sheet does not
    // block the others — we just log and skip it.
    showParetoPCTrendLoading();
    try {
      const yearResults = await Promise.all(
        PARETO_PC_YEAR_SOURCES.map(async (s) => {
          try {
            const tsv = await PC.sheets.fetchCsv(paretoPcSheetUrl(s.gid));
            const parsed = parseParetoPCYearSheet(tsv, s.year);
            console.log(`[ParetoPC] Year ${s.year}: ${parsed.months.length} month(s) parsed`);
            return { source: s, parsed, ok: true };
          } catch (err) {
            console.warn('[ParetoPC] year fetch failed:', s.year, err);
            return { source: s, parsed: { year: s.year, months: [] }, ok: false };
          }
        })
      );

      // Flatten chronologically across all years.
      const allMonths = [];
      for (const yr of yearResults) {
        for (const m of yr.parsed.months) allMonths.push(m);
      }
      allMonths.sort((a, b) => (a.year - b.year) || (a.month - b.month));

      // Snapshot tables = the latest available month.
      const latest = allMonths.length ? allMonths[allMonths.length - 1] : null;
      const snapshot = latest ? buildParetoPCSnapshot(latest) : { leftTable: [], rightTable: [] };

      // Trend = every month chronologically.
      const trend = buildParetoPCTrend(allMonths);

      state.paretoPcData  = snapshot;
      state.paretoPcTrend = trend;

      try {
        localStorage.setItem(PARETO_PC_CACHE_KEY, JSON.stringify({
          data: { snapshot, trend },
          savedAt: new Date().toISOString(),
        }));
      } catch (e) {}

      renderParetoPCTables(snapshot);
      renderParetoPCTrend(trend);
    } catch (err) {
      console.error('[ParetoPC] Failed to load Pareto PC data:', err);
      showParetoPCTrendError(err.message || String(err));
      U.toast('Gagal memuat data Pareto PC: ' + (err.message || err), 'error');
    }
  }

  /**
   * Build the snapshot tables (top of the Pareto PC tab) from a single
   * month bucket. Appends a synthetic Grand Total row matching the shape
   * the existing renderParetoTable() expects.
   */
  function buildParetoPCSnapshot(month) {
    const grandRight = month.rightGrand || month.rightRows.reduce((s, r) => s + (r.value || 0), 0);
    const grandLeft  = month.leftGrand  || month.leftRows.reduce((s, r) => s + (r.value || 0), 0);
    function withGrand(rows, grand) {
      const out = rows.map(r => Object.assign({}, r));
      // Recompute pct against grand so snapshot pct is internally consistent
      // even if the source row's pct was rounded.
      if (grand) {
        for (const r of out) r.pct = (r.value / grand) * 100;
      }
      out.push({
        name: 'Grand Total',
        value: grand,
        valueRaw: String(grand),
        pct: 100,
        pctRaw: '100,00%',
        isGrandTotal: true,
      });
      return out;
    }
    return {
      latestMonthLabel: month.label,
      leftTable:  withGrand(month.leftRows,  grandLeft),
      rightTable: withGrand(month.rightRows, grandRight),
    };
  }

  /** Parse Indonesian-style number like "2.492.093.440" -> 2492093440 */
  function parseIndonesianNumber(s) {
    if (!s) return 0;
    let str = String(s).trim();
    // Remove any currency prefix
    str = str.replace(/[Rr][Pp]\.?\s*/g, '');
    // Check if it uses Indonesian format (dots as thousand sep, comma as decimal)
    if (str.includes(',') || (str.match(/\./g) || []).length > 1) {
      // Indonesian: remove dots (thousand sep), replace comma with dot (decimal)
      str = str.replace(/\./g, '').replace(',', '.');
    } else if ((str.match(/\./g) || []).length === 1) {
      const afterDot = str.split('.')[1] || '';
      if (afterDot.length === 3) {
        // Single dot with 3 digits after = thousand separator
        str = str.replace('.', '');
      }
    }
    const n = parseFloat(str);
    return isNaN(n) ? 0 : n;
  }

  /** Parse Indonesian percentage like "18,50%" -> 18.50 */
  function parseIndonesianPct(s) {
    if (!s) return 0;
    let str = String(s).trim().replace('%', '');
    str = str.replace(',', '.');
    const n = parseFloat(str);
    return isNaN(n) ? 0 : n;
  }

  function renderParetoPCTables(data) {
    renderParetoTable('table-pareto-pc', data.rightTable);
    renderParetoTable('table-pareto-nonpc', data.leftTable);
    // Surface which calendar month the snapshot is built from so users
    // never wonder whether they're looking at stale data.
    const subRight = document.getElementById('pareto-pc-snapshot-sub');
    const subLeft  = document.getElementById('pareto-pc-snapshot-nonpc-sub');
    const tag = data.latestMonthLabel ? ` · <strong>${escapeHtml(data.latestMonthLabel)}</strong>` : '';
    if (subRight) subRight.innerHTML = `Data revenue per kategori (termasuk PC Branded &amp; PC Rakitan)${tag}`;
    if (subLeft)  subLeft.innerHTML  = `Data revenue per departemen (tanpa PC Rakitan)${tag}`;
  }

  function renderParetoTable(tableId, rows) {
    const table = document.getElementById(tableId);
    if (!table) return;

    if (!rows || !rows.length) {
      table.innerHTML = '<tr><td class="text-center py-4" style="color:var(--text-muted)">Tidak ada data</td></tr>';
      return;
    }

    let html = `<thead><tr>
      <th class="ms-head-bulan" style="text-align:left">No</th>
      <th class="ms-head-bulan" style="text-align:left">Kategori / Dept</th>
      <th class="ms-head-grand" style="text-align:right">Total Harga (Rp)</th>
      <th class="ms-head-grand" style="text-align:right">Persentase</th>
    </tr></thead><tbody>`;

    let no = 1;
    for (const row of rows) {
      if (row.isGrandTotal) continue; // render in tfoot
      const isNegative = row.value < 0;
      const isVoucher = /voucher/i.test(row.name);
      const rowClass = (isNegative || isVoucher) ? ' class="pareto-pc-negative"' : '';
      html += `<tr${rowClass}>
        <td class="ms-bulan-cell">${no}</td>
        <td class="ms-bulan-cell">${escapeHtml(row.name)}</td>
        <td class="ms-qty-cell" style="text-align:right">${formatRpPareto(row.value)}</td>
        <td class="ms-share-cell" style="text-align:right">${row.pct.toFixed(2)}%</td>
      </tr>`;
      no++;
    }
    html += `</tbody>`;

    // Grand Total row
    const grandRow = rows.find(r => r.isGrandTotal);
    if (grandRow) {
      html += `<tfoot><tr class="ms-grand-row">
        <td class="ms-bulan-cell"></td>
        <td class="ms-bulan-cell"><strong>${escapeHtml(grandRow.name)}</strong></td>
        <td class="ms-qty-cell" style="text-align:right"><strong>${formatRpPareto(grandRow.value)}</strong></td>
        <td class="ms-share-cell" style="text-align:right"><strong>${grandRow.pct.toFixed(2)}%</strong></td>
      </tr></tfoot>`;
    }

    table.innerHTML = html;
  }

  // ============================================================
  // PARETO PC — Multi-month Trend (MoM / YoY)
  //
  // Trend tables are built from the chronological list of months produced
  // by loadAndRenderParetoPC() (which fans out across PARETO_PC_YEAR_SOURCES
  // and flattens every year sheet into one ordered timeline).
  //
  //   - "Pareto PC"           = right-table cells of each monthly row
  //   - "Pareto PC Non PC..." = left-table cells of each monthly row
  //
  // Each cell shows revenue + MoM % vs the previous month. YoY is computed
  // for the headline banner whenever the same calendar month appears in a
  // previous year.
  // ============================================================

  /**
   * Combine an ordered list of month buckets into a trend structure.
   *
   * Input:
   *   months: [{ year, month, label, short, leftRows, rightRows, leftGrand, rightGrand }, ...]
   *
   * Output:
   *   {
   *     months: [{ year, month, label, short }],
   *     rightRows: [{ name, byIdx: {0: value, 1: value, ...}, total }],
   *     leftRows:  [{ name, byIdx: {...}, total }],
   *     rightGrandByIdx: {0: total, ...},
   *     leftGrandByIdx:  {0: total, ...},
   *   }
   *
   * Categories are unioned across all months (missing month = 0). Rows are
   * sorted by total revenue desc so the highest-impact categories sit at
   * the top of each trend table; voucher/negative rows sink to the bottom.
   */
  function buildParetoPCTrend(monthsList) {
    const months = (monthsList || []).map(m => ({
      year: m.year, month: m.month, label: m.label, short: m.short,
    }));

    function buildSide(getRows, getGrand) {
      const map = new Map();      // category name -> { name, byIdx, total }
      const grand = {};            // monthIdx -> grand total for this side
      (monthsList || []).forEach((m, idx) => {
        const rows = getRows(m) || [];
        for (const row of rows) {
          if (row.isGrandTotal) continue; // grand handled separately
          const key = String(row.name || '').trim();
          if (!key) continue;
          let bucket = map.get(key);
          if (!bucket) { bucket = { name: key, byIdx: {}, total: 0 }; map.set(key, bucket); }
          const v = Number(row.value) || 0;
          bucket.byIdx[idx] = (bucket.byIdx[idx] || 0) + v;
          bucket.total += v;
        }
        const g = Number(getGrand(m)) || 0;
        if (g) {
          grand[idx] = g;
        } else {
          // Fallback: if the source didn't carry a Grand Total row, sum the
          // visible category rows so MoM % at the footer is still correct.
          let sum = 0;
          for (const row of rows) if (!row.isGrandTotal) sum += Number(row.value) || 0;
          grand[idx] = sum;
        }
      });
      const arr = [...map.values()];
      arr.sort((a, b) => b.total - a.total);
      return { rows: arr, grand };
    }

    const right = buildSide(m => m.rightRows, m => m.rightGrand);
    const left  = buildSide(m => m.leftRows,  m => m.leftGrand);

    return {
      months,
      rightRows: right.rows,
      rightGrandByIdx: right.grand,
      leftRows: left.rows,
      leftGrandByIdx: left.grand,
    };
  }

  function showParetoPCTrendLoading() {
    const ids = ['table-pareto-pc-trend', 'table-pareto-nonpc-trend'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<tr><td class="text-center py-4" style="color:var(--text-muted)">⏳ Memuat data trend bulanan…</td></tr>';
      }
    });
  }

  function showParetoPCTrendError(msg) {
    const ids = ['table-pareto-pc-trend', 'table-pareto-nonpc-trend'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = `<tr><td class="text-center py-4" style="color:#f43f5e">Gagal memuat trend: ${escapeHtml(msg)}</td></tr>`;
      }
    });
  }

  function renderParetoPCTrend(trend) {
    if (!trend) return;
    try {
      renderParetoPCTrendTable('table-pareto-pc-trend',    trend.months, trend.rightRows, trend.rightGrandByIdx);
      renderParetoPCTrendTable('table-pareto-nonpc-trend', trend.months, trend.leftRows,  trend.leftGrandByIdx);
      renderParetoPCTrendBanner(trend);
      renderParetoPCLineChart(trend);
      populateParetoPCYearFilter(trend);
    } catch (err) {
      console.error('[ParetoPC] renderParetoPCTrend error:', err);
      const errEl = document.getElementById('pareto-pc-trend-banner');
      if (errEl) {
        errEl.innerHTML = `<div class="pareto-pc-error">Error rendering trend: ${escapeHtml(err.message || String(err))}</div>`;
      }
    }
  }

  /** Top-of-card banner: latest month total + MoM + YoY headline. */
  function renderParetoPCTrendBanner(trend) {
    const banner = document.getElementById('pareto-pc-trend-banner');
    if (!banner) return;
    const months = trend.months || [];
    const lastIdx = months.length - 1;
    if (lastIdx < 0) { banner.innerHTML = ''; return; }

    const last = months[lastIdx];
    const prevIdx = lastIdx > 0 ? lastIdx - 1 : -1;
    const prev = prevIdx >= 0 ? months[prevIdx] : null;
    const lastTotal = trend.rightGrandByIdx[lastIdx] || 0;
    const prevTotal = prev ? (trend.rightGrandByIdx[prevIdx] || 0) : 0;

    // YoY: find the same calendar month in any earlier year.
    let yoyIdx = -1;
    for (let i = lastIdx - 1; i >= 0; i--) {
      if (months[i].month === last.month && months[i].year < last.year) { yoyIdx = i; break; }
    }
    const yoy = yoyIdx >= 0 ? months[yoyIdx] : null;
    const yoyTotal = yoy ? (trend.rightGrandByIdx[yoyIdx] || 0) : 0;

    function pctSpan(curr, base, baseLabel) {
      if (!base) return `<span class="ms-empty">— vs ${escapeHtml(baseLabel)}</span>`;
      const pct = ((curr - base) / base) * 100;
      const arrow = pct >= 0 ? '▲' : '▼';
      const cls   = pct >= 0 ? 'ms-up' : 'ms-down';
      return `<span class="${cls}">${arrow} ${Math.abs(pct).toFixed(2)}%</span> <span style="color:var(--text-muted)">vs ${escapeHtml(baseLabel)}</span>`;
    }

    const momHtml = prev ? pctSpan(lastTotal, prevTotal, prev.label) : '<span class="ms-empty">— (bulan pertama)</span>';
    const yoyHtml = yoy  ? pctSpan(lastTotal, yoyTotal,  yoy.label)  : '<span class="ms-empty">— belum ada data tahun sebelumnya</span>';

    banner.innerHTML =
      `<span>📈 Total <strong>${escapeHtml(last.label)}</strong>: <strong>${formatRpPareto(lastTotal)}</strong></span>` +
      ` &nbsp;·&nbsp; <span>MoM ${momHtml}</span>` +
      ` &nbsp;·&nbsp; <span>YoY ${yoyHtml}</span>` +
      ` &nbsp;·&nbsp; <span style="color:var(--text-muted)">${months.length} bulan dimuat</span>`;
  }

  // ============================================================
  // PARETO PC — Line Chart (monthly revenue by top categories)
  // ============================================================
  let paretoPcChartInstance = null;

  /** Populate the year filter dropdown based on available months in trend data */
  function populateParetoPCYearFilter(trend) {
    const sel = document.getElementById('pareto-pc-year-filter');
    if (!sel || !trend || !trend.months) return;
    const years = [...new Set(trend.months.map(m => m.year))].sort();
    const currentVal = state.paretoPcFilters.year;
    let html = '<option value="__all__">Semua</option>';
    for (const y of years) {
      html += `<option value="${y}">${y}</option>`;
    }
    sel.innerHTML = html;
    // Restore selection
    if (currentVal && currentVal !== '__all__' && years.map(String).includes(String(currentVal))) {
      sel.value = String(currentVal);
    } else {
      sel.value = '__all__';
    }
  }

  /** Render line chart showing monthly revenue for top categories */
  function renderParetoPCLineChart(trend) {
    const canvas = document.getElementById('chart-pareto-pc-trend');
    if (!canvas || !trend || !trend.months || !trend.months.length) return;

    const view = state.paretoPcFilters.view; // 'pc' or 'nonpc'
    const yearFilter = state.paretoPcFilters.year;
    const topN = state.paretoPcFilters.topN;

    // Select the correct dataset side
    const rows = view === 'pc' ? trend.rightRows : trend.leftRows;
    const grandByIdx = view === 'pc' ? trend.rightGrandByIdx : trend.leftGrandByIdx;
    const months = trend.months;

    // Filter months by year if specified
    let monthIndices = months.map((m, i) => i);
    if (yearFilter && yearFilter !== '__all__') {
      const yr = parseInt(yearFilter, 10);
      monthIndices = monthIndices.filter(i => months[i].year === yr);
    }

    if (!monthIndices.length || !rows || !rows.length) {
      if (paretoPcChartInstance) { paretoPcChartInstance.destroy(); paretoPcChartInstance = null; }
      return;
    }

    // Top N categories by total (within filtered months)
    const rowsWithFiltered = rows.map(r => {
      let sum = 0;
      for (const idx of monthIndices) sum += (r.byIdx[idx] || 0);
      return { ...r, filteredTotal: sum };
    }).filter(r => r.filteredTotal > 0);
    rowsWithFiltered.sort((a, b) => b.filteredTotal - a.filteredTotal);

    const displayRows = topN > 0 ? rowsWithFiltered.slice(0, topN) : rowsWithFiltered;
    if (!displayRows.length) {
      if (paretoPcChartInstance) { paretoPcChartInstance.destroy(); paretoPcChartInstance = null; }
      return;
    }

    // Build labels (month short labels)
    const labels = monthIndices.map(i => `${months[i].short} ${months[i].year}`);

    // Chart.js line chart color palette
    const CHART_COLORS = [
      '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
      '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#a855f7',
      '#14b8a6', '#e11d48',
    ];

    const datasets = displayRows.map((row, i) => {
      const color = CHART_COLORS[i % CHART_COLORS.length];
      const data = monthIndices.map(idx => row.byIdx[idx] || 0);
      return {
        label: row.name,
        data,
        borderColor: color,
        backgroundColor: color + '20',
        tension: 0.4,
        cubicInterpolationMode: 'monotone',
        borderWidth: 2.5,
        pointRadius: 4,
        pointHoverRadius: 7,
        pointBackgroundColor: color,
        pointBorderColor: '#0a0e1a',
        pointBorderWidth: 2,
        fill: false,
      };
    });

    // Update chart title
    const titleEl = document.getElementById('pareto-pc-chart-title');
    const subEl = document.getElementById('pareto-pc-chart-sub');
    const viewLabel = view === 'pc' ? 'Pareto PC' : 'Non PC Rakitan';
    const yearLabel = yearFilter && yearFilter !== '__all__' ? ` (${yearFilter})` : '';
    if (titleEl) titleEl.textContent = `📈 Trend Revenue Bulanan — ${viewLabel}${yearLabel}`;
    if (subEl) subEl.textContent = `Top ${displayRows.length} kategori berdasarkan revenue per bulan`;

    // Destroy previous instance
    if (paretoPcChartInstance) { paretoPcChartInstance.destroy(); paretoPcChartInstance = null; }

    paretoPcChartInstance = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 8, boxHeight: 8, padding: 14, usePointStyle: true, pointStyle: 'circle', font: { size: 11 } },
          },
          tooltip: {
            callbacks: {
              label: (c) => `${c.dataset.label}: ${formatRpParetoCompact(c.parsed.y)}`,
              footer: (items) => {
                const total = items.reduce((s, it) => s + it.parsed.y, 0);
                return `Subtotal tampil: ${formatRpParetoCompact(total)}`;
              }
            }
          }
        },
        scales: {
          y: {
            ticks: { callback: (v) => {
              if (v >= 1e9) return (v / 1e9).toFixed(1) + 'M';
              if (v >= 1e6) return (v / 1e6).toFixed(0) + 'Jt';
              return v.toLocaleString('id-ID');
            }},
            grid: { color: 'rgba(45,52,84,0.35)', drawBorder: false }
          },
          x: { grid: { display: false }, ticks: { font: { weight: 500 } } }
        }
      }
    });
  }

  /**
   * Render a per-category x per-month trend table.
   * Each month column shows: revenue + MoM % vs previous month (stacked).
   * Trailing column = Total across all loaded months.
   */
  function renderParetoPCTrendTable(tableId, months, rows, grandByIdx) {
    const table = document.getElementById(tableId);
    if (!table) return;

    if (!months || !months.length) {
      table.innerHTML = '<tr><td class="text-center py-4" style="color:var(--text-muted)">Tidak ada bulan terdaftar</td></tr>';
      return;
    }
    if (!rows || !rows.length) {
      table.innerHTML = '<tr><td class="text-center py-4" style="color:var(--text-muted)">Tidak ada data</td></tr>';
      return;
    }

    // Header row
    let head = `<thead><tr>
      <th class="ms-head-bulan" style="text-align:left">No</th>
      <th class="ms-head-bulan" style="text-align:left">Kategori / Dept</th>`;
    for (const m of months) {
      head += `<th class="ms-head-grand" style="text-align:right">
        <span class="ms-head-main">${escapeHtml(m.short || m.label)}</span>
        <span class="ms-head-sub">${m.year}</span>
      </th>`;
    }
    head += `<th class="ms-head-grand" style="text-align:right">
      <span class="ms-head-main">TOTAL</span>
      <span class="ms-head-sub">${months.length} bln</span>
    </th></tr></thead>`;

    // Body rows
    let body = '<tbody>';
    let no = 1;
    for (const row of rows) {
      const isVoucher = /voucher/i.test(row.name);
      const isNegative = row.total < 0;
      const trClass = (isVoucher || isNegative) ? ' class="pareto-pc-negative"' : '';
      body += `<tr${trClass}>
        <td class="ms-bulan-cell">${no}</td>
        <td class="ms-bulan-cell">${escapeHtml(row.name)}</td>`;
      for (let i = 0; i < months.length; i++) {
        const v = row.byIdx[i] || 0;
        const prev = i > 0 ? (row.byIdx[i - 1] || 0) : null;
        body += `<td class="ms-qty-cell" style="text-align:right">
          <div>${formatRpParetoCompact(v)}</div>
          <div class="pareto-pc-mom">${renderMoMPct(v, prev)}</div>
        </td>`;
      }
      body += `<td class="ms-qty-cell" style="text-align:right"><strong>${formatRpParetoCompact(row.total)}</strong></td>`;
      body += `</tr>`;
      no++;
    }
    body += '</tbody>';

    // Grand total footer
    let foot = '<tfoot><tr class="ms-grand-row">';
    foot += `<td class="ms-bulan-cell"></td><td class="ms-bulan-cell"><strong>Grand Total</strong></td>`;
    let totalAll = 0;
    for (let i = 0; i < months.length; i++) {
      const v = grandByIdx[i] || 0;
      const prev = i > 0 ? (grandByIdx[i - 1] || 0) : null;
      totalAll += v;
      foot += `<td class="ms-qty-cell" style="text-align:right">
        <div><strong>${formatRpParetoCompact(v)}</strong></div>
        <div class="pareto-pc-mom">${renderMoMPct(v, prev)}</div>
      </td>`;
    }
    foot += `<td class="ms-qty-cell" style="text-align:right"><strong>${formatRpParetoCompact(totalAll)}</strong></td>`;
    foot += `</tr></tfoot>`;

    table.innerHTML = head + body + foot;
  }

  /** Render MoM % as colored arrow. Returns "—" when previous is null/0. */
  function renderMoMPct(curr, prev) {
    if (prev === null || prev === undefined) return '<span class="ms-empty">—</span>';
    if (!prev) return '<span class="ms-empty">—</span>';
    const pct = ((curr - prev) / prev) * 100;
    if (!isFinite(pct) || isNaN(pct)) return '<span class="ms-empty">—</span>';
    const arrow = pct >= 0 ? '▲' : '▼';
    const cls   = pct >= 0 ? 'ms-up' : 'ms-down';
    return `<span class="${cls}">${arrow} ${Math.abs(pct).toFixed(1)}%</span>`;
  }

  /** Compact rupiah for trend cells: keeps numbers readable in narrow columns. */
  function formatRpParetoCompact(n) {
    if (!n) return 'Rp 0';
    const isNeg = n < 0;
    const abs = Math.abs(n);
    let out;
    if (abs >= 1e9)      out = (abs / 1e9).toFixed(2) + ' M';
    else if (abs >= 1e6) out = (abs / 1e6).toFixed(1) + ' Jt';
    else if (abs >= 1e3) out = (abs / 1e3).toFixed(0) + ' Rb';
    else                  out = Math.round(abs).toLocaleString('id-ID');
    return (isNeg ? '-' : '') + 'Rp ' + out;
  }

  /** Format currency for Pareto PC tables (snapshot view — full digits). */
  function formatRpPareto(n) {
    if (!n) return 'Rp 0';
    const isNeg = n < 0;
    const abs = Math.abs(n);
    const formatted = Math.round(abs).toLocaleString('id-ID');
    return (isNeg ? '-' : '') + 'Rp ' + formatted;
  }

  // ============================================================
  // PARETO PC — Filter controls (view toggle, year, topN)
  // ============================================================
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.pareto-pc-view-btn');
    if (!btn) return;
    const view = btn.dataset.view;
    if (view === state.paretoPcFilters.view) return;
    state.paretoPcFilters.view = view;
    document.querySelectorAll('.pareto-pc-view-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });
    // Re-render chart only (tables show both sides always)
    if (state.paretoPcTrend) {
      renderParetoPCLineChart(state.paretoPcTrend);
    }
  });

  const paretoPcYearSel = document.getElementById('pareto-pc-year-filter');
  if (paretoPcYearSel) {
    paretoPcYearSel.addEventListener('change', () => {
      state.paretoPcFilters.year = paretoPcYearSel.value;
      if (state.paretoPcTrend) renderParetoPCLineChart(state.paretoPcTrend);
    });
  }

  const paretoPcTopNSel = document.getElementById('pareto-pc-topn-filter');
  if (paretoPcTopNSel) {
    paretoPcTopNSel.addEventListener('change', () => {
      state.paretoPcFilters.topN = parseInt(paretoPcTopNSel.value, 10) || 0;
      if (state.paretoPcTrend) renderParetoPCLineChart(state.paretoPcTrend);
    });
  }

  // ============================================================
  // PNG DOWNLOAD — capture card as image using html2canvas
  // ============================================================
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-png');
    if (!btn) return;
    const targetId = btn.dataset.target;
    const card = document.getElementById(targetId);
    if (!card) return;

    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = '⏳';

    // Determine background color based on current theme
    const isDark = document.documentElement.classList.contains('dark');
    const bgColor = isDark ? '#07091a' : '#eef1f7';

    html2canvas(card, {
      scale: 2,
      backgroundColor: bgColor,
      useCORS: true,
      logging: false,
    }).then((canvas) => {
      const link = document.createElement('a');
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      link.download = `${targetId}_${dateStr}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    }).catch((err) => {
      console.error('PNG capture failed:', err);
      U.toast('Gagal capture PNG: ' + err.message, 'error');
    }).finally(() => {
      btn.disabled = false;
      btn.textContent = origText;
    });
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
