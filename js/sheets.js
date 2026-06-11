/**
 * ParetoPC Dashboard - Google Sheets fetcher
 * Handles published-CSV URL detection and conversion.
 */
window.PC = window.PC || {};

PC.sheets = (() => {
  const U = PC.utils;

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

    // Already a CSV-output URL?
    if (/[?&]output=csv\b/i.test(url)) {
      return url;
    }

    // Published web URL: /spreadsheets/d/e/{ID}/pub... → make it CSV
    if (/\/spreadsheets\/d\/e\//i.test(url)) {
      // strip existing fragment
      url = url.split('#')[0];
      // Replace /pubhtml or /pub.* → /pub?output=csv
      // Preserve gid if present
      const u = new URL(url);
      const gid = u.searchParams.get('gid');
      // Rewrite path to end with /pub
      u.pathname = u.pathname.replace(/\/(pubhtml|pub)(\/.*)?$/i, '/pub');
      // Reset search
      u.search = '';
      u.searchParams.set('output', 'csv');
      u.searchParams.set('single', 'true');
      if (gid) u.searchParams.set('gid', gid);
      return u.toString();
    }

    // Standard spreadsheet URL: /spreadsheets/d/{ID}/...
    const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (m) {
      const id = m[1];
      // Try to extract gid from URL if present
      let gid = null;
      const gidMatch = url.match(/[#?&]gid=(\d+)/);
      if (gidMatch) gid = gidMatch[1];
      let csv = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
      if (gid) csv += `&gid=${gid}`;
      if (sheetName) csv += `&sheet=${encodeURIComponent(sheetName)}`;
      return csv;
    }

    // Otherwise, return as-is and hope it's a CSV endpoint
    return url;
  }

  /** Fetch CSV text from a URL (handles cache busting). */
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
    // Heuristic: detect HTML response (e.g., login page) — means access denied
    if (ct.includes('text/html') || /^\s*<(!doctype|html)/i.test(text)) {
      throw new Error('Spreadsheet belum di-publish atau tidak bisa diakses publik. Buka di Google Sheets → File → Share → Publish to web.');
    }
    return text;
  }

  /** Fetch & parse a Google Sheet into normalized records */
  async function loadSheet(rawUrl, sheetName) {
    const csvUrl = toCsvUrl(rawUrl, sheetName);
    const csvText = await fetchCsv(csvUrl);
    const rows = PC.parser.parseCSVText(csvText);
    const result = PC.parser.normalize(rows);
    return { ...result, csvUrl, fetchedAt: new Date() };
  }

  return { toCsvUrl, fetchCsv, loadSheet };
})();
