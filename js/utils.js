/**
 * ParetoPC Dashboard - Utility helpers
 */
window.PC = window.PC || {};

PC.utils = (() => {

  const MONTH_ID = ['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember'];

  /** Parse Indonesian number like "275.000" -> 275000, "1.985.000" -> 1985000 */
  function parseIDNumber(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    let s = String(v).trim();
    if (!s || s === '-' || s.toLowerCase() === '#n/a') return 0;
    // Remove currency symbols and spaces
    s = s.replace(/[Rr][Pp]\.?\s*/g, '').replace(/\s+/g, '');
    // Indonesian: '.' = thousand separator, ',' = decimal
    // English-style fallback: if there's only one '.' and 1-2 trailing digits, treat as decimal
    if (s.includes(',')) {
      // ID style with decimals: remove all dots, replace comma with dot
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // Could be all dots = thousand sep, OR a single trailing decimal
      const dots = (s.match(/\./g) || []).length;
      if (dots === 1) {
        const after = s.split('.')[1] || '';
        if (after.length === 3) {
          // thousand separator
          s = s.replace(/\./g, '');
        }
        // else assume decimal point — keep
      } else if (dots > 1) {
        s = s.replace(/\./g, '');
      }
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  /** Parse date like "01/01/2026" or "1/1/2026" -> Date */
  function parseIDDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    const s = String(v).trim();
    if (!s) return null;
    // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) {
      let [_, d, mo, y] = m;
      d = parseInt(d, 10); mo = parseInt(mo, 10); y = parseInt(y, 10);
      if (y < 100) y += 2000;
      const dt = new Date(y, mo - 1, d);
      return isNaN(dt) ? null : dt;
    }
    // ISO YYYY-MM-DD
    const iso = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (iso) {
      const [_, y, mo, d] = iso;
      const dt = new Date(parseInt(y), parseInt(mo) - 1, parseInt(d));
      return isNaN(dt) ? null : dt;
    }
    const dt = new Date(s);
    return isNaN(dt) ? null : dt;
  }

  function formatIDR(n) {
    if (n === null || n === undefined || isNaN(n)) return 'Rp 0';
    return 'Rp ' + Math.round(n).toLocaleString('id-ID');
  }

  function formatIDRCompact(n) {
    if (!n) return 'Rp 0';
    const abs = Math.abs(n);
    if (abs >= 1e12) return 'Rp ' + (n / 1e12).toFixed(1) + ' T';
    if (abs >= 1e9)  return 'Rp ' + (n / 1e9).toFixed(1) + ' M';
    if (abs >= 1e6)  return 'Rp ' + (n / 1e6).toFixed(1) + ' Jt';
    if (abs >= 1e3)  return 'Rp ' + (n / 1e3).toFixed(0) + ' rb';
    return 'Rp ' + Math.round(n);
  }

  function formatNumber(n) {
    if (n === null || n === undefined || isNaN(n)) return '0';
    return Math.round(n).toLocaleString('id-ID');
  }

  function formatDate(d) {
    if (!d) return '—';
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatDateTime(d) {
    if (!d) return '—';
    return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /** Normalize a header string for matching: lowercase, strip non-alnum */
  function normHeader(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /** Find the index of a header in a row by trying multiple alias variants */
  function findCol(headerRow, aliases) {
    const norm = headerRow.map(normHeader);
    for (const a of aliases) {
      const target = normHeader(a);
      const idx = norm.indexOf(target);
      if (idx !== -1) return idx;
    }
    // fallback: fuzzy contains
    for (const a of aliases) {
      const target = normHeader(a);
      const idx = norm.findIndex(h => h.includes(target));
      if (idx !== -1) return idx;
    }
    return -1;
  }

  /** Group an array by key fn, returning Map<key, items[]> */
  function groupBy(arr, keyFn) {
    const m = new Map();
    for (const item of arr) {
      const k = keyFn(item);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(item);
    }
    return m;
  }

  /** Sum a numeric field over an array */
  function sumBy(arr, fn) {
    let s = 0;
    for (const x of arr) s += fn(x) || 0;
    return s;
  }

  /** Department display order & color */
  const DEPT_ORDER = ['Printer', 'Monitor', 'PC Branded'];
  const DEPT_COLORS = {
    'Printer':    '#ef4444',
    'Monitor':    '#3b82f6',
    'PC Branded': '#10b981',
    '_other':     '#a78bfa',
  };
  const PALETTE = [
    '#6366f1','#10b981','#f59e0b','#ef4444','#3b82f6','#a855f7',
    '#ec4899','#14b8a6','#f97316','#84cc16','#06b6d4','#8b5cf6',
  ];

  function deptColor(name) {
    return DEPT_COLORS[name] || DEPT_COLORS._other;
  }
  function paletteColor(i) {
    return PALETTE[i % PALETTE.length];
  }

  function deptChipClass(d) {
    if (!d) return 'chip chip-other';
    const k = String(d).toLowerCase();
    if (k.includes('printer')) return 'chip chip-printer';
    if (k.includes('monitor')) return 'chip chip-monitor';
    if (k.includes('branded')) return 'chip chip-pcbranded';
    return 'chip chip-other';
  }

  /** Sort department list with known order first, then alphabetical */
  function sortDepts(arr) {
    return [...arr].sort((a, b) => {
      const ia = DEPT_ORDER.indexOf(a);
      const ib = DEPT_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return String(a).localeCompare(String(b));
    });
  }

  function bulanIndex(b) {
    const k = String(b || '').toLowerCase().trim();
    return MONTH_ID.indexOf(k);
  }

  /** Sort month names by Indonesian month order */
  function sortBulan(arr) {
    return [...arr].sort((a, b) => bulanIndex(a) - bulanIndex(b));
  }

  /** Toast notification */
  let toastTimer = null;
  function toast(msg, type = 'info') {
    const el = document.getElementById('toast');
    const m = document.getElementById('toast-msg');
    if (!el || !m) return;
    m.textContent = msg;
    el.classList.remove('hidden', 'toast-success', 'toast-error', 'toast-info');
    el.classList.add('toast-' + type);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 4500);
  }

  function showLoading(msg) {
    const el = document.getElementById('loading');
    const m = document.getElementById('loading-msg');
    if (m && msg) m.textContent = msg;
    if (el) el.classList.remove('hidden');
  }
  function hideLoading() {
    const el = document.getElementById('loading');
    if (el) el.classList.add('hidden');
  }

  /** Persist & retrieve from localStorage with namespacing */
  const STORAGE_KEY = 'paretopc:config:v1';
  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveConfig(cfg) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (e) {}
  }
  function clearConfig() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  /** Download text as a file */
  function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  }

  /** Escape a value for CSV */
  function csvEscape(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  return {
    parseIDNumber, parseIDDate, formatIDR, formatIDRCompact, formatNumber,
    formatDate, formatDateTime, normHeader, findCol, groupBy, sumBy,
    deptColor, paletteColor, deptChipClass, sortDepts, sortBulan, bulanIndex,
    toast, showLoading, hideLoading,
    loadConfig, saveConfig, clearConfig,
    downloadText, csvEscape,
    DEPT_ORDER, PALETTE,
  };
})();
