/**
 * ParetoPC Dashboard - Analytics
 * Aggregations operating on normalized records.
 */
window.PC = window.PC || {};

PC.analytics = (() => {
  const U = PC.utils;

  /** Apply filters to records. filters = { dept, kota, bulan, brand, juta, tahun, cekInk, search } */
  function filterRecords(records, filters = {}) {
    const { dept, kota, bulan, brand, juta, tahun, cekInk, search } = filters;
    const q = search ? search.toLowerCase() : '';
    const yr = tahun && tahun !== '__all__' ? parseInt(tahun, 10) : null;
    return records.filter(r => {
      if (dept && dept !== '__all__' && r.dept !== dept) return false;
      if (kota && kota !== '__all__' && r.kota !== kota) return false;
      if (bulan && bulan !== '__all__' && r.bulan !== bulan) return false;
      if (brand && brand !== '__all__' && r.brand !== brand) return false;
      if (juta && juta !== '__all__' && r.cekJuta !== juta) return false;
      if (cekInk && cekInk !== '__all__' && r.cekInk !== cekInk) return false;
      if (yr !== null && r.year !== yr) return false;
      if (q) {
        const hay = `${r.namaBarang} ${r.brand} ${r.kodeSales} ${r.kodeBarang} ${r.kota} ${r.dept} ${r.noDok}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  /**
   * Year-over-year monthly comparison.
   * opts.sumField — 'total' (default) or 'qty'
   *
   * Months WITHOUT any records get null (so Chart.js won't extend the line into
   * the future / unsold months — the line stops at the latest month with data).
   * Months that have records but sum to zero stay as 0 (genuine zero sales).
   */
  function yoyByMonth(records, opts = {}) {
    const { sumField = 'total' } = opts;
    const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const yearsSet = new Set();
    for (const r of records) if (r.year) yearsSet.add(r.year);
    const years = [...yearsSet].sort((a, b) => a - b);

    const datasets = years.map(y => {
      // Which months have at least 1 record for this year?
      const monthsWithData = new Set();
      for (const r of records) {
        if (r.year === y && r.bulan) monthsWithData.add(r.bulan);
      }
      // Find the LAST month (calendar order) that has data.
      let latestIdx = -1;
      MONTHS.forEach((m, i) => { if (monthsWithData.has(m)) latestIdx = i; });

      return {
        label: String(y),
        data: MONTHS.map((mo, i) => {
          // Beyond the latest month with data → null (no line drawn there)
          if (i > latestIdx) return null;
          return U.sumBy(
            records.filter(r => r.year === y && r.bulan === mo),
            r => r[sumField] || 0
          );
        }),
      };
    });
    return { years, labels: MONTHS, datasets, sumField };
  }

  /** YoY summary: returns { years, totals, growth, samePeriod, sumField } */
  function yoySummary(records, opts = {}) {
    const { sumField = 'total' } = opts;
    const yearsSet = new Set();
    for (const r of records) if (r.year) yearsSet.add(r.year);
    const years = [...yearsSet].sort((a, b) => a - b);
    const totals = {};
    for (const y of years) {
      totals[y] = U.sumBy(records.filter(r => r.year === y), r => r[sumField] || 0);
    }
    const growth = {};
    for (let i = 1; i < years.length; i++) {
      const cur = years[i], prev = years[i-1];
      growth[cur] = totals[prev] ? ((totals[cur] - totals[prev]) / totals[prev]) * 100 : null;
    }

    // Same-period YoY: only compare months present in ALL years (apple-to-apple)
    const samePeriod = computeSamePeriod(records, years, sumField);

    return { years, totals, growth, samePeriod, sumField };
  }

  /**
   * Compute apples-to-apples YoY using the intersection of months
   * present in all years.
   */
  function computeSamePeriod(records, years, sumField = 'total') {
    if (!years || years.length < 2) return null;
    const monthsByYear = {};
    for (const y of years) {
      monthsByYear[y] = new Set(records.filter(r => r.year === y).map(r => r.bulan).filter(Boolean));
    }
    let common = null;
    for (const y of years) {
      common = common === null ? new Set(monthsByYear[y]) : new Set([...common].filter(m => monthsByYear[y].has(m)));
    }
    if (!common || common.size === 0) return null;

    const orderedMonths = U.sortBulan([...common]);
    const totals = {};
    for (const y of years) {
      totals[y] = U.sumBy(
        records.filter(r => r.year === y && common.has(r.bulan)),
        r => r[sumField] || 0
      );
    }
    const growth = {};
    for (let i = 1; i < years.length; i++) {
      const cur = years[i], prev = years[i-1];
      growth[cur] = totals[prev] ? ((totals[cur] - totals[prev]) / totals[prev]) * 100 : null;
    }
    const fullYear = orderedMonths.length === 12;
    return { months: orderedMonths, totals, growth, fullYear };
  }

  /** Compute KPI summary */
  function summary(records) {
    let revenue = 0, qty = 0;
    const trxSet = new Set();
    for (const r of records) {
      revenue += r.total || 0;
      qty += r.qty || 0;
      if (r.noDok) trxSet.add(r.noDok);
    }
    const trx = trxSet.size || records.length;
    return {
      revenue,
      qty,
      trx,
      avg: trx ? revenue / trx : 0,
      lines: records.length,
    };
  }

  /** Total revenue grouped by an arbitrary key */
  function aggBy(records, keyFn, opts = {}) {
    const { sumKey = 'total' } = opts;
    const map = new Map();
    for (const r of records) {
      const k = keyFn(r);
      if (k === null || k === undefined || k === '') continue;
      const cur = map.get(k) || { key: k, total: 0, qty: 0, count: 0 };
      cur.total += r.total || 0;
      cur.qty   += r.qty || 0;
      cur.count += 1;
      map.set(k, cur);
    }
    const arr = [...map.values()].sort((a, b) => b[sumKey === 'qty' ? 'qty' : 'total'] - a[sumKey === 'qty' ? 'qty' : 'total']);
    return arr;
  }

  /** Aggregation by department, sorted in domain order */
  function aggByDept(records) {
    const arr = aggBy(records, r => r.dept);
    return arr.sort((a, b) => {
      const ia = U.DEPT_ORDER.indexOf(a.key);
      const ib = U.DEPT_ORDER.indexOf(b.key);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return b.total - a.total;
    });
  }

  /** Monthly trend, optionally split by department */
  function monthlyTrend(records, opts = {}) {
    const { byDept = true } = opts;
    const months = [...new Set(records.map(r => r.bulan).filter(Boolean))];
    const sortedMonths = U.sortBulan(months);

    if (!byDept) {
      const totals = sortedMonths.map(mo => U.sumBy(records.filter(r => r.bulan === mo), r => r.total));
      return { labels: sortedMonths, datasets: [{ label: 'Total', data: totals }] };
    }

    const depts = U.sortDepts([...new Set(records.map(r => r.dept).filter(Boolean))]);
    const datasets = depts.map(d => ({
      label: d,
      data: sortedMonths.map(mo => U.sumBy(
        records.filter(r => r.bulan === mo && r.dept === d),
        r => r.total
      )),
      color: U.deptColor(d),
    }));
    return { labels: sortedMonths, datasets };
  }

  /** Pareto on a key (default: nama barang) */
  function pareto(records, keyFn = r => r.namaBarang, limit = 30) {
    const agg = aggBy(records, keyFn);
    const top = agg.slice(0, limit);
    const grandTotal = agg.reduce((s, x) => s + x.total, 0);
    let cum = 0;
    const out = top.map(item => {
      cum += item.total;
      return {
        key: item.key,
        total: item.total,
        qty: item.qty,
        cumPct: grandTotal ? (cum / grandTotal) * 100 : 0,
        pct: grandTotal ? (item.total / grandTotal) * 100 : 0,
      };
    });
    // Find where cumulative crosses 80%
    const cut = out.findIndex(x => x.cumPct >= 80);
    return {
      items: out,
      grandTotal,
      cutoffIdx: cut,                            // last index in 80%
      itemsIn80: cut === -1 ? out.length : cut + 1,
      totalItems: agg.length,
    };
  }

  /** Top N for a key */
  function topN(records, keyFn, n = 10) {
    return aggBy(records, keyFn).slice(0, n);
  }

  // ============================================================
  // MARKETSHARE TABLE — Per Brand · Per Bulan (12 months) · Growth
  // ============================================================
  const MS_MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

  function _daysInMonth(monthIdx, year) {
    if (monthIdx === 1) {
      const isLeap = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0));
      return isLeap ? 29 : 28;
    }
    return [31,28,31,30,31,30,31,31,30,31,30,31][monthIdx];
  }

  /**
   * Build a marketshare matrix for a single year, with QTY or Value & share% per brand
   * per month, plus MoM/YoY/EstimasiClosing/Growth on the GRAND TOTAL.
   *
   * Filters used: dept, category (cekPc). bulan/brand filters are intentionally
   * ignored because the table itself is a per-month, per-brand breakdown.
   *
   * @param {Array} records  Full records dataset.
   * @param {Object} opts    { year, prevYear, dept, category, topN, sumField }
   * @returns marketshare data object (see briefing for shape).
   */
  function marketshareTable(records, opts = {}) {
    const { year, prevYear, dept, category = '__all__', topN: nBrands = 8, sumField = 'qty' } = opts;
    if (!year) return null;

    // Filter by dept + category
    const matchScope = (r) => {
      if (dept && dept !== '__all__' && r.dept !== dept) return false;
      if (category && category !== '__all__' && r.cekPc !== category) return false;
      return true;
    };

    const curYear = records.filter(r => r.year === year && matchScope(r));
    const prvYear = records.filter(r => r.year === prevYear && matchScope(r));

    if (!curYear.length) {
      return {
        topBrands: [], otherCount: 0, rows: [], grandRow: { qtyPerBrand: {}, sharePerBrand: {}, grandTotal: 0 },
        estimasiClosing: null, growth: null,
        yearLabel: String(year), prevYearLabel: String(prevYear),
        sumField,
      };
    }

    // Compute total per brand in current year using the selected sumField — pick top N.
    // Brands literally named "Other" / "Unknown" / "OTHER" are EXCLUDED from
    // top-ranking and always grouped into the OTHER bucket at the end.
    const brandTotals = new Map();
    for (const r of curYear) {
      const k = r.brand || 'Unknown';
      brandTotals.set(k, (brandTotals.get(k) || 0) + (r[sumField] || 0));
    }
    const isOtherLike = (b) => /^(other|unknown)$/i.test(String(b).trim());
    const allEntries = [...brandTotals.entries()].sort((a, b) => b[1] - a[1]);
    const realBrandEntries = allEntries.filter(([k]) => !isOtherLike(k));
    const otherDataBrands  = allEntries.filter(([k]) =>  isOtherLike(k)).map(([k]) => k);

    const topBrands = realBrandEntries.slice(0, nBrands).map(([k]) => k);
    const overflowBrands = realBrandEntries.slice(nBrands).map(([k]) => k);
    const otherBrands = [...overflowBrands, ...otherDataBrands];
    const otherSet = new Set(otherBrands);
    const otherCount = otherBrands.length;

    const allKeys = [...topBrands, '__other__'];

    // Per-month matrix for current year
    const matrix = {};   // matrix[monthIdx][brandKey] = sum
    const monthMaxDay = new Array(12).fill(0);
    for (let i = 0; i < 12; i++) {
      matrix[i] = {};
      for (const k of allKeys) matrix[i][k] = 0;
    }
    for (const r of curYear) {
      const mIdx = MS_MONTHS.indexOf(r.bulan);
      if (mIdx < 0) continue;
      const key = topBrands.includes(r.brand) ? r.brand : (otherSet.has(r.brand) ? '__other__' : '__other__');
      matrix[mIdx][key] = (matrix[mIdx][key] || 0) + (r[sumField] || 0);
      // Track latest day in each month for estimasi closing
      if (r.tgl instanceof Date && !isNaN(r.tgl)) {
        const day = r.tgl.getDate();
        if (day > monthMaxDay[mIdx]) monthMaxDay[mIdx] = day;
      }
    }

    // Per-month grand totals for previous year
    const prvMonthGrand = new Array(12).fill(0);
    for (const r of prvYear) {
      const mIdx = MS_MONTHS.indexOf(r.bulan);
      if (mIdx < 0) continue;
      prvMonthGrand[mIdx] += (r[sumField] || 0);
    }

    // Find latest month with data + decide which (if any) is the running month.
    let latestMonth = -1;
    for (let i = 0; i < 12; i++) if (monthMaxDay[i] > 0) latestMonth = i;
    const today = new Date();
    const isCurrentCalendarYear = (year === today.getFullYear());
    let runningMonthIdx = -1;
    if (latestMonth >= 0 && isCurrentCalendarYear) {
      const totalDays = _daysInMonth(latestMonth, year);
      if (monthMaxDay[latestMonth] < totalDays) runningMonthIdx = latestMonth;
    }

    // Build rows: 12 months. Track previous-month share to compute shareDelta.
    let prevSharePerBrand = {}; // last month's share per brand
    let prevMonthGrandTotal = null; // for MoM
    const rows = [];

    // Optional: seed prevSharePerBrand with prior year's December shares so
    // January comparison isn't always blank.
    const prvDecPerBrand = {};
    for (const k of allKeys) prvDecPerBrand[k] = 0;
    let prvDecGrand = 0;
    for (const r of prvYear) {
      if (r.bulan !== 'Desember') continue;
      const key = topBrands.includes(r.brand) ? r.brand : '__other__';
      prvDecPerBrand[key] += (r[sumField] || 0);
      prvDecGrand += (r[sumField] || 0);
    }
    if (prvDecGrand > 0) {
      for (const k of allKeys) prevSharePerBrand[k] = (prvDecPerBrand[k] / prvDecGrand) * 100;
      prevMonthGrandTotal = prvDecGrand;
    }

    for (let i = 0; i < 12; i++) {
      const qtyPerBrand = {};
      let monthTotal = 0;
      for (const k of allKeys) {
        qtyPerBrand[k] = matrix[i][k] || 0;
        monthTotal += qtyPerBrand[k];
      }
      const hasData = monthTotal > 0;

      const sharePerBrand = {};
      const shareDelta = {};
      for (const k of allKeys) {
        sharePerBrand[k] = monthTotal > 0 ? (qtyPerBrand[k] / monthTotal) * 100 : 0;
        const prv = prevSharePerBrand[k];
        shareDelta[k] = (prv === undefined || prv === null) ? null : (sharePerBrand[k] - prv);
      }

      // Use estimasi for running month when computing MoM/YoY anchor value
      let estClosingValue = null;
      if (i === runningMonthIdx && hasData) {
        const totalDays = _daysInMonth(i, year);
        const elapsed = monthMaxDay[i];
        if (elapsed > 0) estClosingValue = Math.round(monthTotal * (totalDays / elapsed));
      }

      const anchorValue = (estClosingValue !== null) ? estClosingValue : monthTotal;
      let mom = null;
      if (hasData && prevMonthGrandTotal && prevMonthGrandTotal > 0) {
        mom = ((anchorValue - prevMonthGrandTotal) / prevMonthGrandTotal) * 100;
      }
      let yoy = null;
      const prvSame = prvMonthGrand[i];
      if (hasData && prvSame > 0) {
        yoy = ((anchorValue - prvSame) / prvSame) * 100;
      }

      rows.push({
        month: MS_MONTHS[i],
        monthIdx: i,
        qtyPerBrand,
        sharePerBrand,
        shareDelta,
        grandTotal: monthTotal,
        mom,
        yoy,
        isLatestMonth: (i === latestMonth),
      });

      if (hasData) {
        prevSharePerBrand = { ...sharePerBrand };
        prevMonthGrandTotal = anchorValue; // chain MoM using estimasi if running
      }
    }

    // Grand row (whole year)
    const grandQtyPerBrand = {};
    let grandTotal = 0;
    for (const k of allKeys) {
      grandQtyPerBrand[k] = 0;
      for (let i = 0; i < 12; i++) grandQtyPerBrand[k] += matrix[i][k] || 0;
      grandTotal += grandQtyPerBrand[k];
    }
    const grandSharePerBrand = {};
    for (const k of allKeys) {
      grandSharePerBrand[k] = grandTotal > 0 ? (grandQtyPerBrand[k] / grandTotal) * 100 : 0;
    }

    // Estimasi closing payload (only if there is a running month)
    let estimasiClosing = null;
    if (runningMonthIdx >= 0) {
      const totalDays = _daysInMonth(runningMonthIdx, year);
      const elapsed = monthMaxDay[runningMonthIdx];
      const monthTotal = rows[runningMonthIdx].grandTotal;
      if (elapsed > 0 && monthTotal > 0) {
        estimasiClosing = {
          value: Math.round(monthTotal * (totalDays / elapsed)),
          daysElapsed: elapsed,
          daysInMonth: totalDays,
          monthName: MS_MONTHS[runningMonthIdx],
          monthIdx: runningMonthIdx,
        };
      }
    }

    // Cumulative growth: Jan->latest_month, current vs prev year (uses estimasi for running)
    let growth = null;
    if (latestMonth >= 0) {
      let cumCur = 0, cumPrev = 0;
      for (let i = 0; i <= latestMonth; i++) {
        const monthTotal = rows[i].grandTotal;
        if (i === runningMonthIdx && estimasiClosing) cumCur += estimasiClosing.value;
        else cumCur += monthTotal;
        cumPrev += prvMonthGrand[i] || 0;
      }
      let pct = null;
      if (cumPrev > 0 && cumCur > 0) pct = ((cumCur - cumPrev) / cumPrev) * 100;
      const periodLabel = `Jan – ${MS_MONTHS[latestMonth].slice(0,3)} ${year} vs Jan – ${MS_MONTHS[latestMonth].slice(0,3)} ${prevYear}`;
      const note = (runningMonthIdx === latestMonth && estimasiClosing)
        ? `(${MS_MONTHS[latestMonth].slice(0,3)}: estimasi closing)`
        : '';
      growth = {
        pct,
        periodLabel,
        note,
        anchorMonth: MS_MONTHS[latestMonth],
        anchorMonthIdx: latestMonth,
      };
    }

    return {
      topBrands,
      otherCount,
      rows,
      grandRow: { qtyPerBrand: grandQtyPerBrand, sharePerBrand: grandSharePerBrand, grandTotal },
      estimasiClosing,
      growth,
      yearLabel: String(year),
      prevYearLabel: String(prevYear),
      sumField,
    };
  }

  /**
   * Build a marketshare matrix for a single year, grouped by KOTA/CABANG.
   * Same structure as marketshareTable but uses r.kota as the grouping key.
   *
   * @param {Array} records  Full records dataset.
   * @param {Object} opts    { year, prevYear, dept, topN, sumField }
   * @returns marketshare data object grouped by kota.
   */
  function marketshareByKota(records, opts = {}) {
    const { year, prevYear, dept, topN: nKota = 10, sumField = 'qty' } = opts;
    if (!year) return null;

    const matchScope = (r) => {
      if (dept && dept !== '__all__' && r.dept !== dept) return false;
      return true;
    };

    const curYear = records.filter(r => r.year === year && matchScope(r));
    const prvYear = records.filter(r => r.year === prevYear && matchScope(r));

    if (!curYear.length) {
      return {
        topKota: [], otherCount: 0, rows: [], grandRow: { qtyPerKota: {}, sharePerKota: {}, grandTotal: 0 },
        estimasiClosing: null, growth: null,
        yearLabel: String(year), prevYearLabel: String(prevYear),
        sumField,
      };
    }

    // Compute total per kota in current year
    const kotaTotals = new Map();
    for (const r of curYear) {
      const k = r.kota || 'Unknown';
      kotaTotals.set(k, (kotaTotals.get(k) || 0) + (r[sumField] || 0));
    }
    const isOtherLike = (b) => /^(other|unknown)$/i.test(String(b).trim());
    const allEntries = [...kotaTotals.entries()].sort((a, b) => b[1] - a[1]);
    const realKotaEntries = allEntries.filter(([k]) => !isOtherLike(k));
    const otherDataKota = allEntries.filter(([k]) => isOtherLike(k)).map(([k]) => k);

    const topKota = realKotaEntries.slice(0, nKota).map(([k]) => k);
    const overflowKota = realKotaEntries.slice(nKota).map(([k]) => k);
    const otherKota = [...overflowKota, ...otherDataKota];
    const otherSet = new Set(otherKota);
    const otherCount = otherKota.length;

    const allKeys = [...topKota];
    if (otherCount > 0) allKeys.push('__other__');

    // Per-month matrix for current year
    const matrix = {};
    const monthMaxDay = new Array(12).fill(0);
    for (let i = 0; i < 12; i++) {
      matrix[i] = {};
      for (const k of allKeys) matrix[i][k] = 0;
    }
    for (const r of curYear) {
      const mIdx = MS_MONTHS.indexOf(r.bulan);
      if (mIdx < 0) continue;
      const key = topKota.includes(r.kota) ? r.kota : '__other__';
      matrix[mIdx][key] = (matrix[mIdx][key] || 0) + (r[sumField] || 0);
      if (r.tgl instanceof Date && !isNaN(r.tgl)) {
        const day = r.tgl.getDate();
        if (day > monthMaxDay[mIdx]) monthMaxDay[mIdx] = day;
      }
    }

    // Per-month grand totals for previous year
    const prvMonthGrand = new Array(12).fill(0);
    for (const r of prvYear) {
      const mIdx = MS_MONTHS.indexOf(r.bulan);
      if (mIdx < 0) continue;
      prvMonthGrand[mIdx] += (r[sumField] || 0);
    }

    // Find latest month with data + running month
    let latestMonth = -1;
    for (let i = 0; i < 12; i++) if (monthMaxDay[i] > 0) latestMonth = i;
    const today = new Date();
    const isCurrentCalendarYear = (year === today.getFullYear());
    let runningMonthIdx = -1;
    if (latestMonth >= 0 && isCurrentCalendarYear) {
      const totalDays = _daysInMonth(latestMonth, year);
      if (monthMaxDay[latestMonth] < totalDays) runningMonthIdx = latestMonth;
    }

    // Build rows
    let prevSharePerKota = {};
    let prevMonthGrandTotal = null;

    // Seed with prev year December
    const prvDecPerKota = {};
    for (const k of allKeys) prvDecPerKota[k] = 0;
    let prvDecGrand = 0;
    for (const r of prvYear) {
      if (r.bulan !== 'Desember') continue;
      const key = topKota.includes(r.kota) ? r.kota : '__other__';
      prvDecPerKota[key] = (prvDecPerKota[key] || 0) + (r[sumField] || 0);
      prvDecGrand += (r[sumField] || 0);
    }
    if (prvDecGrand > 0) {
      for (const k of allKeys) prevSharePerKota[k] = (prvDecPerKota[k] / prvDecGrand) * 100;
      prevMonthGrandTotal = prvDecGrand;
    }

    const rows = [];
    for (let i = 0; i < 12; i++) {
      const qtyPerKota = {};
      let monthTotal = 0;
      for (const k of allKeys) {
        qtyPerKota[k] = matrix[i][k] || 0;
        monthTotal += qtyPerKota[k];
      }
      const hasData = monthTotal > 0;

      const sharePerKota = {};
      const shareDelta = {};
      for (const k of allKeys) {
        sharePerKota[k] = monthTotal > 0 ? (qtyPerKota[k] / monthTotal) * 100 : 0;
        const prv = prevSharePerKota[k];
        shareDelta[k] = (prv === undefined || prv === null) ? null : (sharePerKota[k] - prv);
      }

      let estClosingValue = null;
      if (i === runningMonthIdx && hasData) {
        const totalDays = _daysInMonth(i, year);
        const elapsed = monthMaxDay[i];
        if (elapsed > 0) estClosingValue = Math.round(monthTotal * (totalDays / elapsed));
      }

      const anchorValue = (estClosingValue !== null) ? estClosingValue : monthTotal;
      let mom = null;
      if (hasData && prevMonthGrandTotal && prevMonthGrandTotal > 0) {
        mom = ((anchorValue - prevMonthGrandTotal) / prevMonthGrandTotal) * 100;
      }
      let yoy = null;
      const prvSame = prvMonthGrand[i];
      if (hasData && prvSame > 0) {
        yoy = ((anchorValue - prvSame) / prvSame) * 100;
      }

      rows.push({
        month: MS_MONTHS[i],
        monthIdx: i,
        qtyPerKota,
        sharePerKota,
        shareDelta,
        grandTotal: monthTotal,
        mom,
        yoy,
        isLatestMonth: (i === latestMonth),
      });

      if (hasData) {
        prevSharePerKota = { ...sharePerKota };
        prevMonthGrandTotal = anchorValue;
      }
    }

    // Grand row
    const grandQtyPerKota = {};
    let grandTotal = 0;
    for (const k of allKeys) {
      grandQtyPerKota[k] = 0;
      for (let i = 0; i < 12; i++) grandQtyPerKota[k] += matrix[i][k] || 0;
      grandTotal += grandQtyPerKota[k];
    }
    const grandSharePerKota = {};
    for (const k of allKeys) {
      grandSharePerKota[k] = grandTotal > 0 ? (grandQtyPerKota[k] / grandTotal) * 100 : 0;
    }

    // Estimasi closing
    let estimasiClosing = null;
    if (runningMonthIdx >= 0) {
      const totalDays = _daysInMonth(runningMonthIdx, year);
      const elapsed = monthMaxDay[runningMonthIdx];
      const monthTotal = rows[runningMonthIdx].grandTotal;
      if (elapsed > 0 && monthTotal > 0) {
        estimasiClosing = {
          value: Math.round(monthTotal * (totalDays / elapsed)),
          daysElapsed: elapsed,
          daysInMonth: totalDays,
          monthName: MS_MONTHS[runningMonthIdx],
          monthIdx: runningMonthIdx,
        };
      }
    }

    // Cumulative growth
    let growth = null;
    if (latestMonth >= 0) {
      let cumCur = 0, cumPrev = 0;
      for (let i = 0; i <= latestMonth; i++) {
        const monthTotal = rows[i].grandTotal;
        if (i === runningMonthIdx && estimasiClosing) cumCur += estimasiClosing.value;
        else cumCur += monthTotal;
        cumPrev += prvMonthGrand[i] || 0;
      }
      let pct = null;
      if (cumPrev > 0 && cumCur > 0) pct = ((cumCur - cumPrev) / cumPrev) * 100;
      const periodLabel = `Jan \u2013 ${MS_MONTHS[latestMonth].slice(0,3)} ${year} vs Jan \u2013 ${MS_MONTHS[latestMonth].slice(0,3)} ${prevYear}`;
      const note = (runningMonthIdx === latestMonth && estimasiClosing)
        ? `(${MS_MONTHS[latestMonth].slice(0,3)}: estimasi closing)`
        : '';
      growth = { pct, periodLabel, note, anchorMonth: MS_MONTHS[latestMonth], anchorMonthIdx: latestMonth };
    }

    return {
      topKota,
      otherCount,
      rows,
      grandRow: { qtyPerKota: grandQtyPerKota, sharePerKota: grandSharePerKota, grandTotal },
      estimasiClosing,
      growth,
      yearLabel: String(year),
      prevYearLabel: String(prevYear),
      sumField,
    };
  }

  return {
    filterRecords, summary, aggBy, aggByDept,
    monthlyTrend, pareto, topN,
    yoyByMonth, yoySummary,
    marketshareTable, marketshareByKota,
  };
})();
