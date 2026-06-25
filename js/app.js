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
  const DEPT_TABS = ['Pareto PC', 'Printer', 'Projector', 'Monitor', 'PC Branded'];

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
    paretoPcData: null,      // All parsed months: [{ year, month, label, short, leftRows, rightRows, leftGrand, rightGrand }]
    paretoPcFilters: { year: null, month: null }, // Selected tahun/bulan for Pareto PC tab
    filters: {
      dept: 'Pareto PC',  // Default tab on first load
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
              fromFallback: !!r.fromFallback,
              fallbackAge: r.fallbackAge || null,
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
              fromFallback: false,
              fallbackAge: null,
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
          fromFallback: res.fromFallback,
          fallbackAge: res.fallbackAge,
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

      // Show toast messages for fallback usage and errors
      const fallbackResults = results.filter(r => r.fromFallback);
      if (fallbackResults.length) {
        const msgs = fallbackResults.map(r =>
          `Data ${r.src.label} menggunakan cache terakhir (${r.fallbackAge})`
        );
        msgs.forEach(msg => U.toast(msg, 'info'));
      }

      if (errored.length) {
        const failedLabels = errored.map(e => e.src.label).join(', ');
        U.toast(`Gagal memuat ${failedLabels}, coba Refresh`, 'error');
      } else if (!fallbackResults.length && silent) {
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
      const clearedFallback = PC.sheets.clearFallbackCache();
      // Clear Pareto PC cache
      try { localStorage.removeItem(PARETO_PC_CACHE_KEY); } catch (e) {}
      try {
        ['paretopc:pareto-pc-data:v1','paretopc:pareto-pc-data:v2','paretopc:pareto-pc:v3','paretopc:pareto-pc-trend:v1'].forEach(k => localStorage.removeItem(k));
      } catch (e) {}
      state.paretoPcData = null;
      U.toast(`${cleared + clearedFallback} entri cache dihapus. Memuat ulang…`, 'info');
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

    // Single-line trend (follows YoY mode: qty or value)
    const sortedMonths = U.sortBulan([...new Set(filtered.map(r => r.bulan).filter(Boolean))]);
    const trendSumField = state.filters.yoyMode === 'value' ? 'total' : 'qty';
    const trendLabel = trendSumField === 'total' ? 'Total Omzet' : 'Unit Terjual';
    const trendQty = {
      labels: sortedMonths,
      datasets: [{ label: trendLabel, data: sortedMonths.map(mo => U.sumBy(filtered.filter(r => r.bulan === mo), r => r[trendSumField])) }]
    };
    if (trendSumField === 'total') {
      Ch.trendChart(trendQty, { valueFormatter: (v) => U.formatIDR(v), axisFormatter: (v) => U.formatIDRCompact(v) });
    } else {
      Ch.trendChart(trendQty);
    }

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
  const PARETO_PC_CACHE_KEY = 'paretopc:pareto-pc:v4';
  const PARETO_PC_CACHE_TTL_MS = 60 * 60 * 1000;

  const PARETO_PC_BULAN_MAP = {
    'januari':1,'februari':2,'maret':3,'april':4,'mei':5,'juni':6,
    'juli':7,'agustus':8,'september':9,'oktober':10,'november':11,'desember':12,
  };
  const PARETO_PC_BULAN_NAMES = ['','Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const PARETO_PC_SHORT_BULAN = ['','Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

  function parseBulanLabel(raw, fallbackYear) {
    const s = String(raw || '').trim();
    if (!s) return null;
    const parts = s.split(/\s+/);
    const monthKey = (parts[0] || '').toLowerCase();
    const monthIdx = PARETO_PC_BULAN_MAP[monthKey];
    if (!monthIdx) return null;
    let year = fallbackYear;
    if (parts[1] && /^\d{4}$/.test(parts[1])) year = parseInt(parts[1], 10);
    return { year, month: monthIdx, label: `${PARETO_PC_BULAN_NAMES[monthIdx]} ${year}`, short: PARETO_PC_SHORT_BULAN[monthIdx] };
  }

  function isNumericValueCell(s) {
    if (s == null) return false;
    const t = String(s).trim().replace(/[Rr][Pp]\.?\s*/g, '').replace(/%\s*$/, '');
    if (!t) return false;
    return /^-?[\d.,]+$/.test(t);
  }

  function parseParetoPCYearSheet(tsv, year) {
    const months = new Map();
    const lines = String(tsv || '').split(/\r?\n/);
    function ensureMonth(bulanRaw) {
      const key = String(bulanRaw || '').trim();
      if (!key) return null;
      let bucket = months.get(key);
      if (bucket) return bucket;
      const parsed = parseBulanLabel(key, year);
      if (!parsed) return null;
      bucket = { key, year: parsed.year, month: parsed.month, label: parsed.label, short: parsed.short, leftRows: [], rightRows: [], leftGrand: 0, rightGrand: 0 };
      months.set(key, bucket);
      return bucket;
    }
    for (let i = 1; i < lines.length; i++) {
      const cols = (lines[i] || '').split('\t');
      if (cols.length < 4) continue;
      const lBulan = (cols[0]||'').trim(), lName = (cols[1]||'').trim(), lVal = (cols[2]||'').trim(), lPct = (cols[3]||'').trim();
      if (lBulan && lName && isNumericValueCell(lVal)) {
        const bucket = ensureMonth(lBulan);
        if (bucket) {
          const isGrand = /grand\s*total/i.test(lName);
          const value = parseIndonesianNumber(lVal);
          if (isGrand) bucket.leftGrand += value;
          else bucket.leftRows.push({ name: lName, value, pct: parseIndonesianPct(lPct), isGrandTotal: false });
        }
      }
      const rBulan = (cols[5]||'').trim(), rName = (cols[6]||'').trim(), rVal = (cols[7]||'').trim(), rPct = (cols[8]||'').trim();
      if (rBulan && rName && isNumericValueCell(rVal)) {
        const bucket = ensureMonth(rBulan);
        if (bucket) {
          const isGrand = /grand\s*total/i.test(rName);
          const value = parseIndonesianNumber(rVal);
          if (isGrand) bucket.rightGrand += value;
          else bucket.rightRows.push({ name: rName, value, pct: parseIndonesianPct(rPct), isGrandTotal: false });
        }
      }
    }
    return { year, months: [...months.values()].sort((a, b) => a.month - b.month) };
  }

  function parseIndonesianNumber(s) {
    if (!s) return 0;
    let str = String(s).trim();
    str = str.replace(/[Rr][Pp]\.?\s*/g, '');
    if (str.includes(',') || (str.match(/\./g) || []).length > 1) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else if ((str.match(/\./g) || []).length === 1) {
      const afterDot = str.split('.')[1] || '';
      if (afterDot.length === 3) str = str.replace('.', '');
    }
    const n = parseFloat(str);
    return isNaN(n) ? 0 : n;
  }

  function parseIndonesianPct(s) {
    if (!s) return 0;
    let str = String(s).trim().replace('%', '').replace(',', '.');
    const n = parseFloat(str);
    return isNaN(n) ? 0 : n;
  }

  // ---- LOADER ----
  /** Get effective grand total for a month side (fallback to sum of rows if no Grand Total row) */
  function effectiveGrand(monthObj, side) {
    const g = side === 'right' ? monthObj.rightGrand : monthObj.leftGrand;
    if (g) return g;
    const rows = side === 'right' ? monthObj.rightRows : monthObj.leftRows;
    return (rows || []).reduce((s, r) => s + (r.value || 0), 0);
  }

  async function loadAndRenderParetoPC() {
    console.log('[ParetoPC] loadAndRenderParetoPC called');
    if (state.paretoPcData && state.paretoPcData.length) { renderParetoPC(); return; }
    try {
      const cached = localStorage.getItem(PARETO_PC_CACHE_KEY);
      if (cached) {
        const p = JSON.parse(cached);
        if (p.savedAt && (Date.now() - new Date(p.savedAt).getTime()) < PARETO_PC_CACHE_TTL_MS && Array.isArray(p.data) && p.data.length) {
          state.paretoPcData = p.data;
          renderParetoPC();
          return;
        }
      }
    } catch (e) {}
    try {
      const yearResults = await Promise.all(
        PARETO_PC_YEAR_SOURCES.map(async (s) => {
          try {
            const tsv = await PC.sheets.fetchCsv(paretoPcSheetUrl(s.gid));
            return parseParetoPCYearSheet(tsv, s.year);
          } catch (err) { console.warn('[ParetoPC] year fetch failed:', s.year, err); return { year: s.year, months: [] }; }
        })
      );
      const allMonths = [];
      for (const yr of yearResults) for (const m of yr.months) allMonths.push(m);
      allMonths.sort((a, b) => (a.year - b.year) || (a.month - b.month));
      state.paretoPcData = allMonths;
      try { localStorage.setItem(PARETO_PC_CACHE_KEY, JSON.stringify({ data: allMonths, savedAt: new Date().toISOString() })); } catch (e) {}
      ['paretopc:pareto-pc-data:v1','paretopc:pareto-pc-data:v2','paretopc:pareto-pc:v3','paretopc:pareto-pc-trend:v1'].forEach(k => { try { localStorage.removeItem(k); } catch(_){} });
      renderParetoPC();
    } catch (err) {
      console.error('[ParetoPC] Failed:', err);
      U.toast('Gagal memuat data Pareto PC: ' + (err.message || err), 'error');
    }
  }

  // ---- RENDER ORCHESTRATOR ----
  function renderParetoPC() {
    const allMonths = state.paretoPcData || [];
    if (!allMonths.length) return;
    populateParetoPCFilters(allMonths);
    const sel = getSelectedParetoPCMonth(allMonths);
    if (!sel) return;
    const selIdx = allMonths.indexOf(sel);
    const prevMonth = selIdx > 0 ? allMonths[selIdx - 1] : null;
    let yoyMonth = null;
    for (let i = selIdx - 1; i >= 0; i--) {
      if (allMonths[i].month === sel.month && allMonths[i].year < sel.year) { yoyMonth = allMonths[i]; break; }
    }
    // Merge VOUCHER into LAIN-LAIN (immutable — never mutates original data)
    const mergedRight = mergeVoucherIntoLain(sel.rightRows);
    const mergedLeft  = mergeVoucherIntoLain(sel.leftRows);
    const mergedPrevRight = prevMonth ? mergeVoucherIntoLain(prevMonth.rightRows) : null;
    const mergedPrevLeft  = prevMonth ? mergeVoucherIntoLain(prevMonth.leftRows) : null;
    const mergedYoyRight  = yoyMonth ? mergeVoucherIntoLain(yoyMonth.rightRows) : null;
    const mergedYoyLeft   = yoyMonth ? mergeVoucherIntoLain(yoyMonth.leftRows) : null;
    renderParetoTableInline('table-pareto-pc', mergedRight, effectiveGrand(sel, 'right'), mergedPrevRight, prevMonth ? effectiveGrand(prevMonth, 'right') : 0, mergedYoyRight, yoyMonth ? effectiveGrand(yoyMonth, 'right') : 0, prevMonth, yoyMonth);
    renderParetoTableInline('table-pareto-nonpc', mergedLeft, effectiveGrand(sel, 'left'), mergedPrevLeft, prevMonth ? effectiveGrand(prevMonth, 'left') : 0, mergedYoyLeft, yoyMonth ? effectiveGrand(yoyMonth, 'left') : 0, prevMonth, yoyMonth);
    const subR = document.getElementById('pareto-pc-snapshot-sub');
    const subL = document.getElementById('pareto-pc-snapshot-nonpc-sub');
    if (subR) subR.innerHTML = `Data revenue per kategori · <strong>${escapeHtml(sel.label)}</strong>`;
    if (subL) subL.innerHTML = `Data revenue per departemen · <strong>${escapeHtml(sel.label)}</strong>`;
    const info = document.getElementById('pareto-pc-filter-info');
    if (info) {
      let txt = `${allMonths.length} bulan dimuat`;
      if (prevMonth) txt += ` · MoM vs ${prevMonth.short}`;
      if (yoyMonth) txt += ` · YoY vs ${yoyMonth.label}`;
      info.textContent = txt;
    }
    // Recalculate sticky offset
    updateParetoPCFilterStickyTop();
    // Render omset chart (all months, all years)
    renderParetoPCOmsetChart(allMonths);
  }

  function populateParetoPCFilters(allMonths) {
    const yearSel = document.getElementById('pareto-pc-filter-year');
    const monthSel = document.getElementById('pareto-pc-filter-month');
    if (!yearSel || !monthSel) return;
    const years = [...new Set(allMonths.map(m => m.year))].sort();
    const currentYear = state.paretoPcFilters.year || years[years.length - 1];
    yearSel.innerHTML = years.map(y => `<option value="${y}"${y === currentYear ? ' selected' : ''}>${y}</option>`).join('');
    const monthsInYear = allMonths.filter(m => m.year === currentYear);
    const currentMonth = state.paretoPcFilters.month || (monthsInYear.length ? monthsInYear[monthsInYear.length - 1].month : 1);
    monthSel.innerHTML = monthsInYear.map(m => `<option value="${m.month}"${m.month === currentMonth ? ' selected' : ''}>${PARETO_PC_BULAN_NAMES[m.month]}</option>`).join('');
    state.paretoPcFilters.year = currentYear;
    state.paretoPcFilters.month = currentMonth;
  }

  function getSelectedParetoPCMonth(allMonths) {
    const y = state.paretoPcFilters.year;
    const m = state.paretoPcFilters.month;
    let sel = allMonths.find(x => x.year === y && x.month === m);
    if (!sel && allMonths.length) sel = allMonths[allMonths.length - 1];
    return sel || null;
  }

  /**
   * Merge VOUCHER into LAIN-LAIN (IMMUTABLE — returns new array, never mutates input).
   */
  function mergeVoucherIntoLain(rows) {
    if (!rows || !rows.length) return rows;
    const LAIN = 'LAIN - LAIN';
    let lainRow = null, voucherRow = null;
    const out = [];
    for (const r of rows) {
      const upper = (r.name || '').toUpperCase().trim();
      if (upper === 'VOUCHER') { voucherRow = r; }
      else if (upper === 'LAIN - LAIN') { lainRow = r; }
      else { out.push(r); }
    }
    if (lainRow && voucherRow) {
      out.push({ name: LAIN, value: lainRow.value + voucherRow.value, pct: lainRow.pct + voucherRow.pct, isGrandTotal: false });
    } else if (voucherRow && !lainRow) {
      out.push({ name: LAIN, value: voucherRow.value, pct: voucherRow.pct, isGrandTotal: false });
    } else if (lainRow && !voucherRow) {
      out.push({ name: LAIN, value: lainRow.value, pct: lainRow.pct, isGrandTotal: false });
    }
    return out;
  }

  // ---- TABLE WITH INLINE MoM + YoY ----
  function renderParetoTableInline(tableId, rows, grand, prevRows, prevGrand, yoyRows, yoyGrand, prevMonthObj, yoyMonthObj) {
    const table = document.getElementById(tableId);
    if (!table) return;
    if (!rows || !rows.length) { table.innerHTML = '<tr><td class="text-center py-4" style="color:var(--text-muted)">Tidak ada data</td></tr>'; return; }
    const hasMoM = !!prevRows;
    const hasYoY = !!yoyRows;
    const prevMap = new Map();
    if (prevRows) prevRows.forEach(r => prevMap.set(r.name, r.value));
    const yoyMap = new Map();
    if (yoyRows) yoyRows.forEach(r => yoyMap.set(r.name, r.value));

    let head = `<thead><tr>
      <th class="ms-head-bulan" style="text-align:center">Kategori / Dept</th>
      <th class="ms-head-grand" style="text-align:center">Total Omset (Rp)</th>
      <th class="ms-head-grand" style="text-align:center">%</th>`;
    if (hasMoM) head += `<th class="ms-head-yoy" style="text-align:center"><span class="ms-head-main">MoM</span><span class="ms-head-sub">vs ${escapeHtml(prevMonthObj ? prevMonthObj.short : '')}</span></th>`;
    if (hasYoY) head += `<th class="ms-head-yoy" style="text-align:center"><span class="ms-head-main">YoY</span><span class="ms-head-sub">vs ${escapeHtml(yoyMonthObj ? yoyMonthObj.short + ' ' + yoyMonthObj.year : '')}</span></th>`;
    head += `</tr></thead>`;

    let body = '<tbody>';
    // Sort rows by omset descending
    const sortedRows = [...rows].sort((a, b) => b.value - a.value);
    for (const row of sortedRows) {
      const isNeg = row.value < 0 || /voucher/i.test(row.name);
      const cls = isNeg ? ' class="pareto-pc-negative"' : '';
      body += `<tr${cls}>
        <td class="ms-bulan-cell" style="text-align:center">${escapeHtml(row.name)}</td>
        <td class="ms-qty-cell" style="text-align:center">${formatRpPareto(row.value)}</td>
        <td class="ms-share-cell" style="text-align:center">${row.pct.toFixed(2)}%</td>`;
      if (hasMoM) body += `<td class="ms-share-cell" style="text-align:center">${renderPctChange(row.value, prevMap.get(row.name))}</td>`;
      if (hasYoY) body += `<td class="ms-share-cell" style="text-align:center">${renderPctChange(row.value, yoyMap.get(row.name))}</td>`;
      body += `</tr>`;
    }
    body += '</tbody>';

    let foot = `<tfoot><tr class="ms-grand-row">
      <td class="ms-bulan-cell" style="text-align:center"><strong>Grand Total</strong></td>
      <td class="ms-qty-cell" style="text-align:center"><strong>${formatRpPareto(grand)}</strong></td>
      <td class="ms-share-cell" style="text-align:center"><strong>100%</strong></td>`;
    if (hasMoM) foot += `<td class="ms-share-cell" style="text-align:center"><strong>${renderPctChange(grand, prevGrand)}</strong></td>`;
    if (hasYoY) foot += `<td class="ms-share-cell" style="text-align:center"><strong>${renderPctChange(grand, yoyGrand)}</strong></td>`;
    foot += `</tr></tfoot>`;
    table.innerHTML = head + body + foot;
  }

  function renderPctChange(curr, base) {
    if (base === null || base === undefined) return '<span class="ms-empty">—</span>';
    if (!base) return '<span class="ms-empty">—</span>';
    const pct = ((curr - base) / Math.abs(base)) * 100;
    if (!isFinite(pct) || isNaN(pct)) return '<span class="ms-empty">—</span>';
    const arrow = pct >= 0 ? '▲' : '▼';
    const cls = pct >= 0 ? 'ms-up' : 'ms-down';
    return `<span class="${cls}">${arrow} ${Math.abs(pct).toFixed(1)}%</span>`;
  }

  function formatRpPareto(n) {
    if (!n) return 'Rp 0';
    const isNeg = n < 0;
    const abs = Math.abs(n);
    return (isNeg ? '-' : '') + 'Rp ' + Math.round(abs).toLocaleString('id-ID');
  }

  // ---- CHART: Total Omset PC per Bulan + YoY ----
  let paretoPcOmsetChart = null;

  function renderParetoPCOmsetChart(allMonths) {
    const canvas = document.getElementById('canvas-pareto-pc-omset');
    if (!canvas || !allMonths || !allMonths.length) return;

    // Group months by year
    const yearMap = new Map();
    for (const m of allMonths) {
      if (!yearMap.has(m.year)) yearMap.set(m.year, []);
      yearMap.get(m.year).push(m);
    }
    const years = [...yearMap.keys()].sort();

    // X-axis labels = all 12 month shorts (Jan–Des).
    // Even if not all months have data, we show all 12 for proper alignment.
    const labels = PARETO_PC_SHORT_BULAN.slice(1); // ['Jan','Feb',...,'Des']

    // Color palette per year
    const YEAR_COLORS = {
      2024: { line: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
      2025: { line: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' },
      2026: { line: '#ec4899', bg: 'rgba(236,72,153,0.15)' },
    };
    const DEFAULT_COLORS = [
      { line: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
      { line: '#10b981', bg: 'rgba(16,185,129,0.1)' },
      { line: '#06b6d4', bg: 'rgba(6,182,212,0.1)' },
    ];

    const datasets = years.map((yr, idx) => {
      const months = yearMap.get(yr);
      // rightGrand = total omset PC (Pareto PC side = right table grand total)
      // Fallback: sum rows if Grand Total row missing from source
      const data = new Array(12).fill(null);
      const estimated = new Array(12).fill(false);
      for (const m of months) {
        let val = effectiveGrand(m, 'right');
        // Estimasi bulan berjalan: jika ini tahun+bulan sekarang, proyeksi ke full month
        const now = new Date();
        const curYear = now.getFullYear();
        const curMonth = now.getMonth() + 1; // 1-indexed
        if (yr === curYear && m.month === curMonth) {
          const dayNow = now.getDate();
          const daysTotal = new Date(curYear, curMonth, 0).getDate(); // days in current month
          if (dayNow < daysTotal && val > 0) {
            val = Math.round(val * (daysTotal / dayNow));
            estimated[m.month - 1] = true;
          }
        }
        data[m.month - 1] = val;
      }
      const colors = YEAR_COLORS[yr] || DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
      return {
        label: String(yr),
        data,
        borderColor: colors.line,
        backgroundColor: colors.line + '30',
        tension: 0.4,
        cubicInterpolationMode: 'monotone',
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: colors.line,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
        fill: true,
        spanGaps: false,
        estimated,
      };
    });

    const subEl = document.getElementById('pareto-pc-omset-chart-sub');
    if (subEl) {
      const now = new Date();
      const curMonth = PARETO_PC_SHORT_BULAN[now.getMonth() + 1];
      const estNote = ` · ${curMonth} = estimasi`;
      if (years.length > 1) {
        subEl.textContent = `Komparasi YoY: ${years.join(' vs ')}${estNote}`;
      } else {
        subEl.textContent = `Grand total revenue bulanan ${years[0]}${estNote}`;
      }
    }

    if (paretoPcOmsetChart) {
      // Update in-place for smooth animation transition
      if (paretoPcOmsetChart.data.datasets.length === datasets.length) {
        paretoPcOmsetChart.data.labels = labels;
        datasets.forEach((ds, i) => { Object.assign(paretoPcOmsetChart.data.datasets[i], ds); });
        paretoPcOmsetChart.update('default');
        return;
      }
      paretoPcOmsetChart.destroy();
      paretoPcOmsetChart = null;
    }

    paretoPcOmsetChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 1200, easing: 'easeOutQuart' },
        transitions: {
          active: { animation: { duration: 400, easing: 'easeOutQuart' } },
        },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 12, boxHeight: 3, padding: 16, usePointStyle: false, font: { size: 12, weight: 600 } },
          },
          tooltip: {
            callbacks: {
              label: (c) => {
                if (c.parsed.y == null) return '';
                const est = c.dataset.estimated;
                const isEst = est && est[c.dataIndex];
                const suffix = isEst ? ' (estimasi)' : '';
                return `${c.dataset.label}: ${formatRpPareto(c.parsed.y)}${suffix}`;
              },
              afterBody: (items) => {
                // Show YoY % when hovering over a month with data from multiple years
                if (items.length < 2) return '';
                const latest = items[items.length - 1];
                const prev = items[items.length - 2];
                if (latest.parsed.y == null || prev.parsed.y == null || !prev.parsed.y) return '';
                const pct = ((latest.parsed.y - prev.parsed.y) / prev.parsed.y) * 100;
                const arrow = pct >= 0 ? '▲' : '▼';
                return `YoY: ${arrow} ${Math.abs(pct).toFixed(1)}%`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (v) => {
                if (v >= 1e9) return (v / 1e9).toFixed(1) + ' M';
                if (v >= 1e6) return (v / 1e6).toFixed(0) + ' Jt';
                return v.toLocaleString('id-ID');
              },
              font: { size: 11 },
            },
            grid: { color: 'rgba(45,52,84,0.3)', drawBorder: false },
          },
          x: {
            grid: { display: false },
            ticks: { font: { size: 11, weight: 500 } },
          }
        }
      }
    });
  }

  // ---- FILTER EVENT LISTENERS ----
  document.getElementById('pareto-pc-filter-year')?.addEventListener('change', (e) => {
    state.paretoPcFilters.year = parseInt(e.target.value, 10);
    state.paretoPcFilters.month = null;
    renderParetoPC();
  });
  document.getElementById('pareto-pc-filter-month')?.addEventListener('change', (e) => {
    state.paretoPcFilters.month = parseInt(e.target.value, 10);
    renderParetoPC();
  });

  // Keep filter bar sticky below the main header group.
  function updateParetoPCFilterStickyTop() {
    const stickyGroup = document.querySelector('.sticky-top-group');
    const filterBar = document.getElementById('pareto-pc-filter-bar');
    if (!stickyGroup || !filterBar) return;
    const headerH = stickyGroup.getBoundingClientRect().height;
    filterBar.style.top = headerH + 'px';
  }
  window.addEventListener('resize', updateParetoPCFilterStickyTop);
  updateParetoPCFilterStickyTop();

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
  // Prefetch Pareto PC data in background during page load so it's ready
  // instantly when the user clicks the tab (no loading delay).
  function prefetchParetoPC() {
    loadAndRenderParetoPC().catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { loadAllSources(false); prefetchParetoPC(); });
  } else {
    loadAllSources(false);
    prefetchParetoPC();
  }
})();
