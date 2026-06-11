# ParetoPC — Dashboard Analisa Penjualan

Web dashboard interaktif untuk analisa penjualan PC, Printer, Monitor — **dipisah otomatis per departemen** (kolom "Cek Dept"). 100% berjalan di browser, tanpa server, hosted gratis di **GitHub Pages**.

![Stack](https://img.shields.io/badge/Stack-Static%20HTML%20%2B%20JS-blue)
![Charts](https://img.shields.io/badge/Charts-Chart.js-orange)
![Hosting](https://img.shields.io/badge/Hosting-GitHub%20Pages-success)

## Fitur Utama

- 🔌 **Terkoneksi ke Google Sheets** — dashboard auto-update saat data spreadsheet berubah
- 🔄 **Auto-refresh** opsional (1 menit s/d 1 jam)
- 📁 **Fallback**: bisa juga upload file Excel/CSV manual
- 📊 **KPI Cards**: Total Omzet, Qty, Jumlah Transaksi, Rata-rata
- 🗂️ **Filter per Departemen** (Printer, Monitor, PC Branded) + Kota, Bulan, Brand, Range Harga
- 📈 Tren bulanan, mix departemen, top brand, top produk, top sales, breakdown per kota
- 🎯 **Pareto 80/20** — temukan produk yang menghasilkan 80% omzet
- 📋 Tabel detail dengan search, sort, pagination, export CSV
- 🌓 Dark/light mode
- 📱 Responsif (desktop, tablet, mobile)
- 🔒 100% client-side — data tidak pernah dikirim ke server manapun

## Cara Pakai

### 1. Setup Spreadsheet (sekali saja)

Di Google Sheets Anda:
1. Pastikan baris pertama adalah header (Tgl., No Dok., Kode Gudang, ..., Cek Dept, dst.)
2. Menu **File → Share → Publish to web**
3. Pilih sheet yang dipublish, format **Comma-separated values (.csv)**
4. Klik **Publish**, copy URL CSV yang muncul

### 2. Buka Dashboard

- Buka URL GitHub Pages dari repo ini
- Default URL spreadsheet sudah ter-isi (untuk demo)
- Untuk pakai spreadsheet Anda: klik tombol **⚙️ Settings** di header → paste URL Anda → Save
- Untuk update data, edit spreadsheet Anda — dashboard akan ambil data terbaru saat refresh atau auto-refresh

## Struktur Kolom yang Diharapkan

Header harus ada di **baris 1**. Kolom yang dibaca (case-insensitive, sebagian boleh tidak ada):

| Header (di spreadsheet) | Wajib | Keterangan |
|--|--|--|
| `Tgl.` | ✅ | Tanggal `DD/MM/YYYY` |
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
| `Brand` | | Merek produk |
| `Cek Juta` | | Range harga (Dibawah 2 Juta, dst.) |
| **`Cek Dept`** | ✅ | **Departemen — kolom kunci pengelompokan** (Printer / Monitor / PC Branded) |
| `Dimensi` | | Ukuran |
| `Cek Ink Tank` | | Tipe printer (Ink Tank / Non Ink Tank) |

Format angka Indonesia (`1.985.000`, `Rp 2.345.000`) didukung otomatis.

## Deploy ke GitHub Pages

1. Push semua file di repo ini ke branch `main`.
2. Di GitHub: **Settings → Pages**.
3. Pada bagian **Build and deployment**, pilih:
   - **Source**: Deploy from a branch
   - **Branch**: `main` / folder: `/ (root)`
4. Klik **Save**. Dalam ~1 menit dashboard tersedia di:
   `https://<username>.github.io/ParetoPC/`

## Struktur File

```
ParetoPC/
├── index.html          ← halaman utama
├── css/
│   └── style.css       ← custom styling
└── js/
    ├── utils.js        ← parser angka/tanggal Indonesia, formatter
    ├── parser.js       ← Excel/CSV → record normal
    ├── sheets.js       ← Google Sheets URL handler & fetch
    ├── analytics.js    ← agregasi, pareto, top-N
    ├── charts.js       ← Chart.js factories
    └── app.js          ← controller utama, state, event handler
```

## Arsitektur

- **No build step** — pure HTML/JS/CSS, dependency via CDN
- **State**: in-memory + `localStorage` untuk simpan URL spreadsheet & preferensi
- **Privacy**: data hanya diproses di browser; nothing kirim ke pihak ketiga
- **CORS**: Google Sheets `/pub?output=csv` mengirim header CORS yang benar, jadi fetch langsung dari browser bekerja

## Limitasi & Catatan

- Sheets harus **dipublish ke web** (atau sharing "Anyone with the link"). Jika private, fetch akan gagal.
- Performance optimal untuk dataset s/d ~50.000 baris. Di atas itu mungkin perlu pagination/streaming.
- Auto-refresh hanya berjalan selama tab browser terbuka & aktif.

## Tech Stack

- **HTML + Tailwind CSS** (via CDN)
- **Chart.js v4** untuk visualisasi
- **SheetJS (xlsx.js)** untuk parsing Excel/CSV (dipakai juga untuk parse CSV dari Google Sheets)
- **Vanilla JavaScript** — tanpa framework

## Lisensi

MIT — silakan dipakai dan dimodifikasi sesuai kebutuhan.
