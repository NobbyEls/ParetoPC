/**
 * ParetoPC Dashboard - Analytics
 * Aggregations operating on normalized records.
 */
window.PC = window.PC || {};

PC.analytics = (() => {
  const U = PC.utils;

  /** Apply filters to records. filters = { dept, kota, bulan, brand, juta, search } */
  function filterRecords(records, filters = {}) {
    const { dept, kota, bulan, brand, juta, search } = filters;
    const q = search ? search.toLowerCase() : '';
    return records.filter(r => {
      if (dept && dept !== '__all__' && r.dept !== dept) return false;
      if (kota && kota !== '__all__' && r.kota !== kota) return false;
      if (bulan && bulan !== '__all__' && r.bulan !== bulan) return false;
      if (brand && brand !== '__all__' && r.brand !== brand) return false;
      if (juta && juta !== '__all__' && r.cekJuta !== juta) return false;
      if (q) {
        const hay = `${r.namaBarang} ${r.brand} ${r.kodeSales} ${r.kodeBarang} ${r.kota} ${r.dept} ${r.noDok}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
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

  return {
    filterRecords, summary, aggBy, aggByDept,
    monthlyTrend, pareto, topN,
  };
})();
