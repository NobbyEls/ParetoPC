/**
 * ParetoPC Dashboard - Data parser
 * Converts raw rows (Excel/CSV) into normalized records.
 */
window.PC = window.PC || {};

PC.parser = (() => {
  const U = PC.utils;

  /** Header alias map: canonical key -> array of possible header strings */
  const COL_ALIASES = {
    tgl:        ['Tgl.', 'Tgl', 'Tanggal', 'Date'],
    noDok:      ['No Dok.', 'No Dok', 'Nomor Dokumen', 'No. Dok'],
    kodeGudang: ['Kode Gudang', 'Gudang', 'Warehouse'],
    kodeDept:   ['Kode Departemen', 'Kode Dept'],
    kodeBarang: ['Kode Barang', 'SKU'],
    namaBarang: ['Nama Barang', 'Item Name', 'Produk', 'Product'],
    qty:        ['Qty*', 'Qty', 'Quantity', 'Jumlah'],
    harga:      ['Harga', 'Price'],
    diskon:     ['Diskon', 'Discount'],
    total:      ['Total (IDR)', 'Total', 'Total IDR', 'Net Total', 'Sub Total', 'Grand Total'],
    kodeSales:  ['Kode Sales', 'Sales Code', 'Sales'],
    kota:       ['Cek Kota', 'Kota', 'City', 'Cabang', 'Branch'],
    week:       ['Week', 'Minggu'],
    bulan:      ['Bulan', 'Month Name'],
    month:      ['Month', 'Bulan Ke'],
    cekPc:      ['Cek PC'],
    brand:      ['Brand', 'Merek'],
    cekJuta:    ['Cek Juta', 'Range Harga', 'Price Range'],
    dept:       ['Cek Dept', 'Departemen', 'Department', 'Dept'],
    dimensi:    ['Dimensi', 'Dimension', 'Size', 'Ukuran'],
    cekInk:     ['Cek Ink Tank', 'Ink Tank', 'Tipe Printer'],
    cekPc2:     ['Cek PC 2', 'Cek PC  2'],
  };

  /** Convert a 2D array (header + rows) into normalized records */
  function normalize(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('File kosong atau tidak terbaca.');
    }

    // Find header row: pick first non-empty row
    let headerIdx = 0;
    while (headerIdx < rows.length && (!rows[headerIdx] || rows[headerIdx].every(c => c === '' || c === null || c === undefined))) {
      headerIdx++;
    }
    if (headerIdx >= rows.length) throw new Error('Tidak ditemukan baris header.');

    const headers = rows[headerIdx].map(h => String(h ?? '').trim());
    const colMap = {};
    for (const [key, aliases] of Object.entries(COL_ALIASES)) {
      colMap[key] = U.findCol(headers, aliases);
    }

    // Validate critical columns
    const missing = [];
    if (colMap.dept === -1) missing.push('Cek Dept');
    if (colMap.total === -1) missing.push('Total (IDR)');
    if (colMap.tgl === -1) missing.push('Tgl.');
    if (missing.length) {
      throw new Error('Kolom wajib tidak ditemukan: ' + missing.join(', '));
    }

    const records = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(c => c === '' || c === null || c === undefined)) continue;

      const get = (key) => {
        const idx = colMap[key];
        return idx === -1 || idx >= row.length ? '' : row[idx];
      };

      const total = U.parseIDNumber(get('total'));
      const qty   = U.parseIDNumber(get('qty')) || 1;

      const cleanText = (v) => {
        const s = String(v ?? '').trim();
        // Treat sheet error markers as empty
        if (!s || /^#?n\/a$/i.test(s) || /^#?ref!$/i.test(s) || /^#?value!$/i.test(s)) return '';
        return s;
      };

      const dept = cleanText(get('dept'));

      // Skip rows that have no department classification AND no money
      if (!dept && total === 0) continue;
      // Skip rows that look like junk: #N/A in dept and tiny/zero amounts
      if (!dept && qty <= 0) continue;

      const date = U.parseIDDate(get('tgl'));

      // Brand canonicalization: preserve short all-caps abbreviations (HP, LG, IBM)
      // but title-case longer mixed-case brands (EPSON/Epson/epson → "Epson")
      const rawBrand = cleanText(get('brand'));
      let brand;
      if (!rawBrand) {
        brand = 'Unknown';
      } else if (rawBrand.length <= 3 && /^[A-Z]+$/.test(rawBrand.toUpperCase())) {
        brand = rawBrand.toUpperCase();
      } else if (rawBrand === rawBrand.toUpperCase() && rawBrand.length <= 4) {
        // ASUS, ACER, SONY, etc — keep uppercase
        brand = rawBrand.toUpperCase();
      } else {
        brand = rawBrand.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
      }

      records.push({
        tgl:        date,
        tglRaw:     get('tgl'),
        noDok:      cleanText(get('noDok')),
        kodeGudang: cleanText(get('kodeGudang')),
        kodeDept:   cleanText(get('kodeDept')),
        kodeBarang: cleanText(get('kodeBarang')),
        namaBarang: cleanText(get('namaBarang')),
        qty,
        harga:      U.parseIDNumber(get('harga')),
        diskon:     U.parseIDNumber(get('diskon')),
        total,
        kodeSales:  cleanText(get('kodeSales')),
        kota:       cleanText(get('kota')),
        week:       cleanText(get('week')),
        bulan:      cleanText(get('bulan')),
        month:      U.parseIDNumber(get('month')),
        cekPc:      cleanText(get('cekPc')),
        brand,
        cekJuta:    cleanText(get('cekJuta')) || 'Lainnya',
        dept:       dept || 'Lainnya',
        dimensi:    cleanText(get('dimensi')),
        cekInk:     cleanText(get('cekInk')),
        cekPc2:     cleanText(get('cekPc2')),
      });
    }

    if (records.length === 0) {
      throw new Error('Tidak ada baris data yang valid setelah header.');
    }

    return { records, headers, colMap };
  }

  /** Parse Excel ArrayBuffer using SheetJS, return rows[][] */
  function parseExcelArrayBuffer(buf, sheetName) {
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    const targetSheet = sheetName && wb.Sheets[sheetName] ? sheetName : wb.SheetNames[0];
    const ws = wb.Sheets[targetSheet];
    if (!ws) throw new Error('Sheet "' + targetSheet + '" tidak ditemukan.');
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  }

  /** Parse a CSV string into rows[][] */
  function parseCSVText(text) {
    // Use SheetJS to parse CSV reliably (handles quotes, escapes)
    const wb = XLSX.read(text, { type: 'string' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  }

  /** Parse a File object */
  async function parseFile(file) {
    const isCsv = /\.csv$/i.test(file.name);
    if (isCsv) {
      const text = await file.text();
      return parseCSVText(text);
    } else {
      const buf = await file.arrayBuffer();
      return parseExcelArrayBuffer(buf);
    }
  }

  return {
    normalize,
    parseExcelArrayBuffer,
    parseCSVText,
    parseFile,
    COL_ALIASES,
  };
})();
