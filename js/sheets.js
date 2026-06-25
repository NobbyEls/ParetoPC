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

  // Fallback cache prefix - stores last successful fetch for ALL sources
  // (including CURRENT_YEAR) so we can serve stale data when network fails.
  const FALLBACK_PREFIX = 'paretopc:fallback:v1:';

  // Retry configuration
  const RETRY_COUNT = 2;           // Number of retries after initial failure
  const RETRY_BASE_DELAY = 2000;   // Base delay in ms (2s -> 4s exponential)

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

  // ---------- Fallback cache helpers ----------

  /** Write to fallback cache (separate from normal cache, stores ALL sources). */
  async function _writeFallbackCache(key, csvText) {
    try {
      const gz = await _compressToBase64(csvText);
      const payload = gz
        ? JSON.stringify({ compressed: true, gz, savedAt: new Date().toISOString(), originalKB: Math.round(csvText.length / 1024) })
        : JSON.stringify({ csv: csvText, savedAt: new Date().toISOString() });
      localStorage.setItem(FALLBACK_PREFIX + key, payload);
      return true;
    } catch (e) {
      console.warn('[ParetoPC] Fallback cache write failed for', key, e.name || e.message);
      try { localStorage.removeItem(FALLBACK_PREFIX + key); } catch (_) {}
      return false;
    }
  }

  /** Read from fallback cache. Returns { csv, savedAt } or null. */
  async function _readFallbackCache(key) {
    try {
      const raw = localStorage.getItem(FALLBACK_PREFIX + key);
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

  /** Clear all fallback cache entries. Returns the number cleared. */
  function clearFallbackCache() {
    let count = 0;
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(FALLBACK_PREFIX)) keys.push(k);
      }
      keys.forEach(k => { localStorage.removeItem(k); count++; });
    } catch (e) {}
    return count;
  }

  /** Format a time difference into a human-readable Indonesian string. */
  function _formatTimeAgo(savedAtISO) {
    const saved = new Date(savedAtISO);
    const now = new Date();
    const diffMs = now - saved;
    if (diffMs < 0) return 'baru saja';
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'baru saja';
    if (diffMin < 60) return diffMin + ' menit lalu';
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return diffHour + ' jam lalu';
    const diffDay = Math.floor(diffHour / 24);
    return diffDay + ' hari lalu';
  }

  // ---------- Retry helper ----------

  /** Delay helper for exponential backoff. */
  function _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Fetch with retry and exponential backoff. Returns csvText on success or throws on final failure. */
  async function _fetchWithRetry(csvUrl, opts = {}) {
    let lastError;
    const maxAttempts = 1 + RETRY_COUNT; // initial + retries
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await fetchCsv(csvUrl, opts);
      } catch (e) {
        lastError = e;
        if (attempt < maxAttempts - 1) {
          const delayMs = RETRY_BASE_DELAY * Math.pow(2, attempt); // 2s, 4s
          console.warn(`[ParetoPC] Fetch attempt ${attempt + 1} failed for ${csvUrl}, retrying in ${delayMs}ms...`, e.message);
          await _delay(delayMs);
        }
      }
    }
    throw lastError;
  }

  // ---------- Main loader ----------

  /**
   * Fetch & parse a Google Sheet into normalized records.
   *
   * opts:
   *   cacheKey: string  - localStorage key (typically the year label)
   *   useCache: boolean - if true, try cache before network
   *
   * Flow (with retry + fallback):
   *   1. If useCache && cache hit -> return cached data
   *   2. Fetch from network (with up to 2 retries, exponential backoff 2s/4s)
   *   3. On success -> write to fallback cache (all sources) + normal cache if useCache
   *   4. On failure after retries -> try fallback cache
   *      -> If fallback exists -> return stale data with fromFallback=true & savedAt
   *      -> If no fallback -> throw error
   */
  async function loadSheet(rawUrl, opts = {}) {
    const { cacheKey, useCache = false, sheetName } = opts;

    // Try normal cache first (historical years only)
    if (useCache && cacheKey) {
      const cached = await _readCache(cacheKey);
      if (cached && cached.csv) {
        try {
          const rows = PC.parser.parseCSVText(cached.csv);
          const result = PC.parser.normalize(rows);
          return {
            ...result,
            fromCache: true,
            fromFallback: false,
            savedAt: new Date(cached.savedAt),
            fetchedAt: new Date(),
          };
        } catch (e) {
          console.warn('[ParetoPC] Cached CSV parse failed, refetching', e);
          try { localStorage.removeItem(CACHE_PREFIX + cacheKey); } catch (_) {}
        }
      }
    }

    // Fetch fresh from network with retry
    const csvUrl = toCsvUrl(rawUrl, sheetName);
    try {
      const csvText = await _fetchWithRetry(csvUrl);

      // Persist to normal cache if requested (historical years)
      if (useCache && cacheKey) await _writeCache(cacheKey, csvText);

      // Always persist to fallback cache (including current year)
      if (cacheKey) await _writeFallbackCache(cacheKey, csvText);

      const rows = PC.parser.parseCSVText(csvText);
      const result = PC.parser.normalize(rows);
      return {
        ...result,
        fromCache: false,
        fromFallback: false,
        fetchedAt: new Date(),
        csvUrl,
      };
    } catch (fetchError) {
      // Network failed after all retries - try fallback cache
      if (cacheKey) {
        const fallback = await _readFallbackCache(cacheKey);
        if (fallback && fallback.csv) {
          try {
            const rows = PC.parser.parseCSVText(fallback.csv);
            const result = PC.parser.normalize(rows);
            return {
              ...result,
              fromCache: false,
              fromFallback: true,
              fallbackAge: _formatTimeAgo(fallback.savedAt),
              savedAt: new Date(fallback.savedAt),
              fetchedAt: new Date(),
            };
          } catch (parseErr) {
            console.warn('[ParetoPC] Fallback CSV parse failed', parseErr);
            // Remove corrupted fallback
            try { localStorage.removeItem(FALLBACK_PREFIX + cacheKey); } catch (_) {}
          }
        }
      }
      // No fallback available - throw original error
      throw fetchError;
    }
  }

  return {
    toCsvUrl, fetchCsv, loadSheet,
    clearAllCache, clearFallbackCache, listCachedKeys,
  };
})();
