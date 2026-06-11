/**
 * ParetoPC Dashboard - Main app controller
 */
(() => {
  const U = PC.utils;
  const A = PC.analytics;
  const Ch = PC.charts;

  // ===== Default Google Sheets URL =====
  // This is the user's published CSV. Auto-loaded on first visit if no config saved yet.
  const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRRqSZ-ul2r7ZbXd2vqir9744EcG3dp7CeOlk4YOBhgFcXmjdepy_YJ9Y9hXYHfmNuY9v_eeitsqXLb/pub?gid=1837670229&single=true&output=csv';

  // ===== State =====
  const state = {
    records: [],
    source: null,        // { type: 'sheet' | 'file', url, sheetName, name, fetchedAt }
    autoRefreshMs: 0,
    autoRefreshTimer: null,
    filters: {
      dept: '__all__',
      kota: '__all__',
      bulan: '__all__',
      brand: '__all__',
      juta: '__all__',
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
  // Theme toggle (persisted)
  // ============================================================
  const THEME_KEY = 'paretopc:theme';
  function applyStoredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const prefers = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (saved === 'dark' || (!saved && prefers)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }
  applyStoredTheme();

  document.getElementById('btn-theme').addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    Ch.refreshTheme();
  });

  // ============================================================
  // Mode tabs (Sheet vs File)
  // ============================================================
  const tabSheet = document.getElementById('tab-mode-sheet');
  const tabFile = document.getElementById('tab-mode-file');
  const modeSheet = document.getElementById('mode-sheet');
  const modeFile = document.getElementById('mode-file');

  tabSheet.addEventListener('click', () => switchMode('sheet'));
  tabFile.addEventListener('click', () => switchMode('file'));

  function switchMode(mode) {
    if (mode === 'sheet') {
      tabSheet.classList.add('active');
      tabFile.classList.remove('active');
      modeSheet.classList.remove('hidden');
      modeFile.classList.add('hidden');
    } else {
      tabFile.classList.add('active');
      tabSheet.classList.remove('active');
      modeFile.classList.remove('hidden');
      modeSheet.classList.add('hidden');
    }
  }

  // ============================================================
  // Connect from Google Sheets
  // ============================================================
  document.getElementById('btn-connect-sheet').addEventListener('click', async () => {
    const url = document.getElementById('sheet-url').value.trim();
    const sheetName = document.getElementById('sheet-name').value.trim();
    const refreshMs = parseInt(document.getElementById('auto-refresh').value, 10) || 0;
    if (!url) { U.toast('URL spreadsheet belum diisi.', 'error'); return; }
    await connectSheet(url, sheetName, refreshMs, /*persist*/ true);
  });

  async function connectSheet(url, sheetName, autoRefreshMs, persist = true) {
    try {
      U.showLoading('Mengambil data dari Google Sheets...');
      const result = await PC.sheets.loadSheet(url, sheetName);
      state.records = result.records;
      state.source = { type: 'sheet', url, sheetName, fetchedAt: result.fetchedAt };
      state.autoRefreshMs = autoRefreshMs || 0;
      if (persist) U.saveConfig({ url, sheetName, autoRefreshMs });
      setupAutoRefresh();
      onDataLoaded();
      U.toast(`Data berhasil dimuat: ${result.records.length.toLocaleString('id-ID')} baris.`, 'success');
    } catch (err) {
      console.error(err);
      U.toast('Gagal: ' + err.message, 'error');
    } finally {
      U.hideLoading();
    }
  }

  function setupAutoRefresh() {
    if (state.autoRefreshTimer) {
      clearInterval(state.autoRefreshTimer);
      state.autoRefreshTimer = null;
    }
    if (state.autoRefreshMs > 0 && state.source && state.source.type === 'sheet') {
      state.autoRefreshTimer = setInterval(() => {
        refreshFromSheet(/*silent*/ true);
      }, state.autoRefreshMs);
      const badge = document.getElementById('auto-refresh-badge');
      if (badge) badge.classList.remove('hidden');
    } else {
      const badge = document.getElementById('auto-refresh-badge');
      if (badge) badge.classList.add('hidden');
    }
  }

  async function refreshFromSheet(silent = false) {
    if (!state.source || state.source.type !== 'sheet') {
      U.toast('Sumber bukan Google Sheets — tidak bisa refresh.', 'error');
      return;
    }
    try {
      if (!silent) U.showLoading('Mengambil data terbaru...');
      const refreshIcon = document.getElementById('icon-refresh');
      if (refreshIcon) refreshIcon.classList.add('animate-spin');
      const result = await PC.sheets.loadSheet(state.source.url, state.source.sheetName);
      state.records = result.records;
      state.source.fetchedAt = result.fetchedAt;
      onDataLoaded();
      if (!silent) U.toast('Data ter-update.', 'success');
    } catch (err) {
      console.error(err);
      U.toast('Gagal refresh: ' + err.message, 'error');
    } finally {
      U.hideLoading();
      const refreshIcon = document.getElementById('icon-refresh');
      if (refreshIcon) refreshIcon.classList.remove('animate-spin');
    }
  }

  // ============================================================
  // File upload
  // ============================================================
  const fileInput = document.getElementById('file-input');
  const dropzone = document.getElementById('dropzone');

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
  });

  if (dropzone) {
    ['dragenter', 'dragover'].forEach(ev => {
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(ev => {
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        dropzone.classList.remove('dragover');
      });
    });
    dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
  }

  async function handleFile(file) {
    try {
      U.showLoading('Membaca file Excel...');
      const rows = await PC.parser.parseFile(file);
      const result = PC.parser.normalize(rows);
      state.records = result.records;
      state.source = { type: 'file', name: file.name, fetchedAt: new Date() };
      state.autoRefreshMs = 0;
      setupAutoRefresh();
      U.clearConfig(); // file mode doesn't persist
      onDataLoaded();
      U.toast(`File dimuat: ${result.records.length.toLocaleString('id-ID')} baris.`, 'success');
    } catch (err) {
      console.error(err);
      U.toast('Gagal membaca file: ' + err.message, 'error');
    } finally {
      U.hideLoading();
    }
  }

  // ============================================================
  // Settings modal
  // ============================================================
  const settingsModal = document.getElementById('settings-modal');
  const btnSettings = document.getElementById('btn-settings');
  btnSettings.addEventListener('click', () => {
    document.getElementById('settings-url').value = state.source && state.source.type === 'sheet' ? state.source.url : '';
    document.getElementById('settings-sheet').value = state.source && state.source.type === 'sheet' ? (state.source.sheetName || '') : '';
    document.getElementById('settings-refresh').value = String(state.autoRefreshMs || 0);
    settingsModal.classList.remove('hidden');
  });
  document.getElementById('btn-close-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.classList.add('hidden');
  });
  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const url = document.getElementById('settings-url').value.trim();
    const sheetName = document.getElementById('settings-sheet').value.trim();
    const refreshMs = parseInt(document.getElementById('settings-refresh').value, 10) || 0;
    if (!url) { U.toast('URL kosong.', 'error'); return; }
    settingsModal.classList.add('hidden');
    await connectSheet(url, sheetName, refreshMs, true);
  });
  document.getElementById('btn-disconnect').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    resetData();
  });

  // ============================================================
  // Reset / Refresh buttons
  // ============================================================
  document.getElementById('btn-refresh').addEventListener('click', () => refreshFromSheet(false));

  function resetData() {
    if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
    state.records = [];
    state.source = null;
    U.clearConfig();
    Ch.destroyAll();
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('connect-section').classList.remove('hidden');
    document.getElementById('btn-refresh').classList.add('hidden');
    document.getElementById('btn-settings').classList.add('hidden');
    document.getElementById('auto-refresh-badge').classList.add('hidden');
  }

  // ============================================================
  // Filter handlers
  // ============================================================
  function bindFilter(elId, key) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.addEventListener('change', () => {
      state.filters[key] = el.value || '__all__';
      render();
    });
  }
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
  // Department tab rendering
  // ============================================================
  function renderDeptTabs() {
    const wrap = document.getElementById('dept-tabs');
    if (!wrap) return;
    const depts = U.sortDepts([...new Set(state.records.map(r => r.dept).filter(Boolean))]);
    const allTotal = U.sumBy(state.records, r => r.total);
    const tabs = [
      { key: '__all__', label: 'Semua', count: state.records.length, total: allTotal },
      ...depts.map(d => {
        const rs = state.records.filter(r => r.dept === d);
        return { key: d, label: d, count: rs.length, total: U.sumBy(rs, r => r.total) };
      })
    ];
    wrap.innerHTML = tabs.map(t => `
      <button class="dept-tab ${state.filters.dept === t.key ? 'active' : ''}" data-key="${t.key}">
        <span>${t.label}</span>
        <span class="badge">${U.formatIDRCompact(t.total)}</span>
      </button>
    `).join('');
    wrap.querySelectorAll('.dept-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        state.filters.dept = btn.dataset.key;
        // Reset some sub-filters since brand list etc. change with dept
        renderDeptTabs();
        populateFilters();
        render();
      });
    });
  }

  // ============================================================
  // Populate filter dropdowns
  // ============================================================
  function populateFilters() {
    // Records visible after dept filter only (sub-filters depend on selected dept)
    const base = state.filters.dept === '__all__'
      ? state.records
      : state.records.filter(r => r.dept === state.filters.dept);

    fillSelect('filter-kota', uniqueSorted(base.map(r => r.kota)), state.filters.kota);
    fillSelect('filter-bulan', U.sortBulan(uniqueSorted(base.map(r => r.bulan))), state.filters.bulan);
    fillSelect('filter-brand', uniqueSorted(base.map(r => r.brand)), state.filters.brand);
    fillSelect('filter-juta', uniqueSorted(base.map(r => r.cekJuta)), state.filters.juta);
  }
  function uniqueSorted(arr) {
    return [...new Set(arr.filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b)));
  }
  function fillSelect(id, options, currentValue) {
    const el = document.getElementById(id);
    if (!el) return;
    const optsHtml = ['<option value="__all__">Semua</option>']
      .concat(options.map(o => `<option value="${escapeAttr(o)}">${escapeHtml(o)}</option>`));
    el.innerHTML = optsHtml.join('');
    // restore selection if still valid
    if (currentValue && currentValue !== '__all__' && options.includes(currentValue)) {
      el.value = currentValue;
    } else {
      el.value = '__all__';
      // sync state if no longer valid
      const key = id.replace('filter-', '');
      state.filters[key] = '__all__';
    }
  }

  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  // ============================================================
  // Render dashboard
  // ============================================================
  function onDataLoaded() {
    document.getElementById('connect-section').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    document.getElementById('btn-refresh').classList.toggle('hidden', state.source.type !== 'sheet');
    document.getElementById('btn-settings').classList.remove('hidden');

    // Source label
    const srcLabel = document.getElementById('source-label');
    const srcIcon = document.getElementById('source-icon');
    if (state.source.type === 'sheet') {
      srcLabel.textContent = 'Sumber: Google Sheets';
      srcIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/></svg>';
    } else {
      srcLabel.textContent = `Sumber: ${state.source.name || 'File'}`;
      srcIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>';
    }
    document.getElementById('row-count').textContent = state.records.length.toLocaleString('id-ID');
    document.getElementById('last-update').textContent = U.formatDateTime(state.source.fetchedAt);

    // Period range
    const dates = state.records.map(r => r.tgl).filter(Boolean).sort((a,b) => a - b);
    if (dates.length) {
      const min = dates[0], max = dates[dates.length - 1];
      document.getElementById('period-range').textContent = `${U.formatDate(min)} → ${U.formatDate(max)}`;
    } else {
      document.getElementById('period-range').textContent = '—';
    }

    renderDeptTabs();
    populateFilters();
    render();
  }

  function render() {
    const filtered = A.filterRecords(state.records, state.filters);

    // KPIs vs all-records baseline (so % comparisons are meaningful)
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

    // Charts
    Ch.trendChart(A.monthlyTrend(filtered, { byDept: state.filters.dept === '__all__' }));
    Ch.deptMixChart(A.aggByDept(state.filters.dept === '__all__' ? state.records : filtered));
    Ch.topBarChart('chart-brand', A.topN(filtered, r => r.brand, 10), 'Brand');
    Ch.topBarChart('chart-product', A.topN(filtered, r => r.namaBarang, 10), 'Produk');
    Ch.topBarChart('chart-kota', A.aggBy(filtered, r => r.kota), 'Kota');
    Ch.topBarChart('chart-sales', A.topN(filtered, r => r.kodeSales, 10), 'Sales');

    const p = A.pareto(filtered, r => r.namaBarang, 30);
    Ch.paretoChart(p);
    document.getElementById('pareto-summary').innerHTML = p.totalItems
      ? `🎯 <strong>${p.itemsIn80}</strong> dari <strong>${p.totalItems}</strong> produk (${(p.itemsIn80 / p.totalItems * 100).toFixed(1)}%) menghasilkan 80% dari omzet (${U.formatIDR(p.grandTotal * 0.8)} dari total ${U.formatIDR(p.grandTotal)}).`
      : '—';

    Ch.distChart('chart-juta', A.aggBy(filtered, r => r.cekJuta), 'Range');
    const inkAgg = A.aggBy(filtered.filter(r => r.dept === 'Printer' || r.cekInk), r => r.cekInk || 'Tidak Ada');
    Ch.pieChart('chart-ink', inkAgg);

    renderTable(filtered);
  }

  // ============================================================
  // Detail table
  // ============================================================
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (state.table.sort.key === k) {
        state.table.sort.dir = state.table.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.table.sort.key = k;
        state.table.sort.dir = 'asc';
      }
      renderTable();
    });
  });
  document.getElementById('btn-prev-page').addEventListener('click', () => {
    if (state.table.page > 1) { state.table.page--; renderTable(); }
  });
  document.getElementById('btn-next-page').addEventListener('click', () => {
    state.table.page++;
    renderTable();
  });

  function renderTable(prefiltered) {
    const filtered = prefiltered || A.filterRecords(state.records, state.filters);
    const { key, dir } = state.table.sort;
    const sgn = dir === 'asc' ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
      let av = a[key], bv = b[key];
      if (key === 'tgl') {
        av = av ? av.getTime() : 0;
        bv = bv ? bv.getTime() : 0;
      }
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

    // Sort indicators
    document.querySelectorAll('th[data-sort]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === key) th.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
    });
  }

  // Export filtered table to CSV
  document.getElementById('btn-export-csv').addEventListener('click', () => {
    const rows = state.table.cache.length ? state.table.cache : A.filterRecords(state.records, state.filters);
    const headers = ['Tgl','No Dok','Kota','Dept','Brand','Nama Barang','Qty','Harga','Diskon','Total','Sales'];
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([
        r.tgl ? r.tgl.toISOString().slice(0,10) : (r.tglRaw || ''),
        r.noDok, r.kota, r.dept, r.brand, r.namaBarang,
        r.qty, r.harga, r.diskon, r.total, r.kodeSales
      ].map(U.csvEscape).join(','));
    }
    const ts = new Date().toISOString().slice(0,10);
    U.downloadText(`paretopc-export-${ts}.csv`, '\uFEFF' + lines.join('\n'), 'text/csv;charset=utf-8');
  });

  // ============================================================
  // Boot — auto-load from saved config or default URL
  // ============================================================
  function prefillForm(url, sheetName, refreshMs) {
    document.getElementById('sheet-url').value = url || '';
    document.getElementById('sheet-name').value = sheetName || '';
    document.getElementById('auto-refresh').value = String(refreshMs || 0);
  }

  async function boot() {
    const cfg = U.loadConfig();
    if (cfg && cfg.url) {
      prefillForm(cfg.url, cfg.sheetName, cfg.autoRefreshMs);
      await connectSheet(cfg.url, cfg.sheetName, cfg.autoRefreshMs || 0, /*persist*/ false);
      return;
    }
    // First visit — try the default URL
    prefillForm(DEFAULT_SHEET_URL, '', 300000);
    await connectSheet(DEFAULT_SHEET_URL, '', 300000, /*persist*/ true);
  }

  // Run boot after DOM ready (already, but keep safe)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
