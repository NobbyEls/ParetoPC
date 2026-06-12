/**
 * ParetoPC Dashboard - Google Sheets fetcher with localStorage cache.
 *
 * Cache strategy:
 *  - For historical years (cacheKey provided & useCache true), CSV text is stored
 *    in localStorage so subsequent page loads bypass the network.
 *  - The "current year" source is always fetched fresh (no cache).
 *  - Calling clearAllCache() removes all cached entries; the next loadSheet()
 *    will re-fetch from the network.
 */
window.PC = window.PC || {};

PC.sheets = (() => {
  const U = PC.utils;

  // Bump this string when the parser/normalize logic changes in a way that
  // invalidates older cached CSVs. (CSV format itself doesn't change, but
  // including this prefix gives us a kill-switch.)
  const CACHE_PREFIX = 'paretopc:csv:v1:';

  /**
   * Convert a Google Sheets URL into a fetch-able CSV URL.
   * Supports:
   *  - Already-published CSV URL (contains /pub and output=csv) → returned as-is
   *  - Standard /spreadsheets/d/{ID}/... URL → converted to /export?format=csv&gid=...
   *  - Published web URL ending in /pubhtml or /pub → suffix tweaked to output=csv
   */
  function toCsvUrl(rawUrl, sheetName) {
    if (!rawUrl) throw new Error('URL spreadsheet kosong.');
    let url = String(rawUrl).trim();

    if (/[?&]output=csv\b/i.test(url)) return url;

    if (/\/spreadsheets\/d\/e\//i.test(url)) {
      url = url.split('#')[0];
      const u = new URL(url);
      const gid = u.searchParams.get('gid');
      u.pathname = u.pathname.replace(/\/(pubhtml|pub)(\/.*)?$/i, '/pub');
      u.search = '';
      u.searchParams.set('output', 'csv');
      u.searchParams.set('single', 'true');
      if (gid) u.searchParams.set('gid', gid);
      return u.toString();
    }

    const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (m) {
      const id = m[1];
      let gid = null;
      const gidMatch = url.match(/[#?&]gid=(\d+)/);
      if (gidMatch) gid = gidMatch[1];
      let csv = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
      if (gid) csv += `&gid=${gid}`;
      if (sheetName) csv += `&sheet=${encodeURIComponent(sheetName)}`;
      return csv;
    }

    return url;
  }

  async function fetchCsv(url, opts = {}) {
    const { cacheBust = true } = opts;
    let finalUrl = url;
    if (cacheBust) {
      const sep = url.includes('?') ? '&' : '?';
      finalUrl = `${url}${sep}_t=${Date.now()}`;
    }
    const res = await fetch(finalUrl, { method: 'GET', mode: 'cors', credentials: 'omit' });
    if (!res.ok) {
      throw new Error(`Gagal fetch (${res.status}). Pastikan spreadsheet sudah di-publish ke web atau dishare "Anyone with the link".`);
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const text = await res.text();
    if (ct.includes('text/html') || /^\s*<(!doctype|html)/i.test(text)) {
      throw new Error('Spreadsheet belum di-publish atau tidak bisa diakses publik. Buka di Google Sheets → File → Share → Publish to web.');
    }
    return text;
  }

  // ---------- Cache helpers (localStorage with gzip compression) ----------

  /** Compress UTF-8 text → base64 string using browser's CompressionStream (gzip). */
  async function _compressToBase64(text) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
      const buf = await new Response(stream).arrayBuffer();
      const bytes = new Uint8Array(buf);
      // Chunked binary→string conversion (avoid stack overflow for large arrays)
      let binary = '';
      const chunk = 8192;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    } catch (e) {
      console.warn('[ParetoPC] gzip failed', e);
      return null;
    }
  }

  /** Decompress base64 gzip → UTF-8 text. Returns null on failure. */
  async function _decompressFromBase64(b64) {
    if (typeof DecompressionStream === 'undefined') return null;
    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return await new Response(stream).text();
    } catch (e) {
      console.warn('[ParetoPC] gunzip failed', e);
      return null;
    }
  }

  async function _readCache(key) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      let csv = parsed.csv;
      if (parsed.compressed && parsed.gz) {
        csv = await _decompressFromBase64(parsed.gz);
        if (!csv) return null;
      }
      return { csv, savedAt: parsed.savedAt };
    } catch (e) { return null; }
  }

  async function _writeCache(key, csvText) {
    try {
      // Try gzip first (saves 6-8x space, helps stay under 5-10 MB quota)
      const gz = await _compressToBase64(csvText);
      const payload = gz
        ? JSON.stringify({ compressed: true, gz, savedAt: new Date().toISOString(), originalKB: Math.round(csvText.length / 1024) })
        : JSON.stringify({ csv: csvText, savedAt: new Date().toISOString() });
      localStorage.setItem(CACHE_PREFIX + key, payload);
      return true;
    } catch (e) {
      // QuotaExceededError is the most likely cause
      console.warn('[ParetoPC] Cache write failed for', key, '—', e.name || e.message);
      try { localStorage.removeItem(CACHE_PREFIX + key); } catch (_) {}
      return false;
    }
  }

  /** Remove all CSV cache entries. Returns the number cleared. */
  function clearAllCache() {
    let count = 0;
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
      }
      keys.forEach(k => { localStorage.removeItem(k); count++; });
    } catch (e) {}
    return count;
  }

  /** List currently-cached keys with their saved timestamps & size. */
  function listCachedKeys() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(CACHE_PREFIX)) continue;
        const raw = localStorage.getItem(k);
        try {
          const obj = JSON.parse(raw);
          out.push({
            label: k.replace(CACHE_PREFIX, ''),
            savedAt: new Date(obj.savedAt),
            sizeKB: Math.round(raw.length / 1024),
            originalKB: obj.originalKB || null,
            compressed: !!obj.compressed,
          });
        } catch (e) {}
      }
    } catch (e) {}
    return out;
  }

  // ---------- Main loader ----------

  /**
   * Fetch & parse a Google Sheet into normalized records.
   *
   * opts:
   *   cacheKey: string  - localStorage key (typically the year label)
   *   useCache: boolean - if true, try cache before network
   */
  async function loadSheet(rawUrl, opts = {}) {
    const { cacheKey, useCache = false, sheetName } = opts;

    // Try cache first
    if (useCache && cacheKey) {
      const cached = await _readCache(cacheKey);
      if (cached && cached.csv) {
        try {
          const rows = PC.parser.parseCSVText(cached.csv);
          const result = PC.parser.normalize(rows);
          return {
            ...result,
            fromCache: true,
            savedAt: new Date(cached.savedAt),
            fetchedAt: new Date(),
          };
        } catch (e) {
          console.warn('[ParetoPC] Cached CSV parse failed, refetching', e);
          try { localStorage.removeItem(CACHE_PREFIX + cacheKey); } catch (_) {}
        }
      }
    }

    // Fetch fresh from network
    const csvUrl = toCsvUrl(rawUrl, sheetName);
    const csvText = await fetchCsv(csvUrl);

    // Persist if requested (compressed)
    if (useCache && cacheKey) await _writeCache(cacheKey, csvText);

    const rows = PC.parser.parseCSVText(csvText);
    const result = PC.parser.normalize(rows);
    return {
      ...result,
      fromCache: false,
      fetchedAt: new Date(),
      csvUrl,
    };
  }

  return {
    toCsvUrl, fetchCsv, loadSheet,
    clearAllCache, listCachedKeys,
  };
})();
