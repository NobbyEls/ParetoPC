# ParetoPC — Dashboard Analisa Penjualan

Web dashboard interaktif untuk analisa penjualan PC, Printer, Monitor — **dipisah otomatis per departemen** (kolom "Cek Dept"), dengan analisa **Year-over-Year (YoY)**. 100% berjalan di browser, tanpa server, hosted gratis di **GitHub Pages**.

## Fitur Utama

- 🔌 **Auto-load dari Google Sheets** — data ditarik fresh setiap kali halaman dibuka (cache-busted)
- 📅 **Multi-tahun & YoY** — gabungkan beberapa spreadsheet (per tahun) untuk perbandingan year-over-year, dengan **Same-period comparison** yang otomatis (apel-ke-apel ketika tahun terbaru belum complete)
- 📊 **KPI Cards**: Total Omzet, Qty, Jumlah Transaksi, Rata-rata
- 🗂️ **Filter per Departemen** (Printer, Monitor, PC Branded, Projector) + Tahun, Kota, Bulan, Brand, Range Harga
- 📈 Tren bulanan, mix departemen, top brand, top produk, top sales, breakdown per kota
- 🎯 **Pareto 80/20** — temukan produk yang menghasilkan 80% omzet
- 📋 Tabel detail dengan search, sort, pagination, export CSV
- 🌓 Dark/light mode
- 📱 Responsif (desktop, tablet, mobile)
- 🔒 100% client-side — data tidak pernah dikirim ke server manapun selain Google Sheets sendiri

## Cara Menambahkan Tahun Baru (untuk YoY)

Buka file [`js/app.js`](js/app.js) dan edit array **SOURCES** di bagian atas:

```js
const SOURCES = [
  {
    label: '2026',
    url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR.../pub?gid=...&output=csv',
  },
  // ⬇ TAMBAH BARIS BARU UNTUK TAHUN SEBELUMNYA:
  {
    label: '2025',
    url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR.../pub?gid=...&output=csv',
  },
];
```

Cukup commit + push, dashboard akan otomatis menarik data dari semua URL dan menampilkan chart **Year-over-Year**.

### Cara dapat URL dari Google Sheets

1. Buka spreadsheet tahun ybs di Google Sheets
2. Menu **File → Share → Publish to web**
3. Pilih sheet (tab) yang ingin dipublish, format **Comma-separated values (.csv)**
4. Klik **Publish**, copy URL yang muncul
5. Paste sebagai value `url` di array SOURCES

## Struktur Kolom yang Diharapkan

Header harus ada di **baris 1** spreadsheet. Kolom yang dibaca (case-insensitive):

| Header | Wajib | Keterangan |
|--|--|--|
| `Tgl.` | ✅ | Tanggal `DD/MM/YYYY` (tahun otomatis di-extract untuk YoY) |
| `No Dok.` | | Nomor dokumen |
| `Kode Gudang` | | Lokasi gudang |
| `Kode Departemen` | | Kode internal dept |
| `Kode Barang` | | SKU produk |
| `Nama Barang` | | Nama produk |
| `Qty*` atau `Qty` | | Jumlah unit |
| `Harga` | | Harga satuan |
| `Diskon` | | Nilai diskon |
| `Total (IDR)` | ✅ | Total transaksi |
| `Kode Sales` | | ID sales person |
| `Cek Kota` | | Kota / cabang |
| `Bulan` | | Nama bulan (Januari, Februari, ...) |
| `Brand` | | Merek produk (EPSON & Epson otomatis digabung) |
| `Cek Juta` | | Range harga (Dibawah 2 Juta, dst.) |
| **`Cek Dept`** | ✅ | **Departemen — kolom kunci pengelompokan** |
| `Dimensi` | | Ukuran |
| `Cek Ink Tank` | | Tipe printer (Ink Tank / Non Ink Tank) |

Format angka Indonesia (`1.985.000`, `Rp 2.345.000`) didukung otomatis.

## Deploy ke GitHub Pages

Setelah push ke `main`:
1. Buka repo → **Settings → Pages**
2. **Source**: `Deploy from a branch`
3. **Branch**: `main` / folder: `/ (root)` → **Save**
4. ~1 menit kemudian dashboard tersedia di `https://<username>.github.io/ParetoPC/`

## Struktur File

```
ParetoPC/
├── index.html          ← halaman utama
├── css/
│   └── style.css       ← custom styling
└── js/
    ├── utils.js        ← parser angka/tanggal Indonesia, formatter, toast
    ├── parser.js       ← Excel/CSV → record normal, brand normalization
    ├── sheets.js       ← Google Sheets URL handler & fetch (cache-busted)
    ├── analytics.js    ← agregasi, YoY, pareto, top-N
    ├── charts.js       ← Chart.js factories (line, bar, doughnut, pareto, YoY)
    └── app.js          ← controller utama: state, filter, render
```

## Arsitektur

- **No build step** — pure HTML/JS/CSS, dependency via CDN
- **State**: in-memory only (data fetch ulang setiap page load)
- **Multi-source**: semua URL di array SOURCES di-fetch parallel dengan `Promise.all`, lalu di-merge
- **Cache-busting**: setiap fetch tambah `?_t=<timestamp>` agar selalu dapat data terbaru
- **Privacy**: data hanya diproses di browser; tidak ada backend

## Tech Stack

- **HTML + Tailwind CSS** (via CDN)
- **Chart.js v4** untuk visualisasi
- **SheetJS (xlsx.js)** untuk parsing CSV
- **Vanilla JavaScript** — tanpa framework

## Lisensi

MIT — silakan dipakai dan dimodifikasi sesuai kebutuhan.
