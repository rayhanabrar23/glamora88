# Glamora88 · Portal Bisnis

Portal internal untuk mencatat aktivitas harian Glamora88 (penjualan, pembelian/impor, stok, boost, biaya)
dan menampilkan kinerjanya: omzet, laba-rugi, titik impas, arus kas, dan stok.

Dibangun dengan React + Vite (tampilan), Cloudflare Workers + Hono (API), dan Cloudflare D1 (database).

> **Penting:** repo ini publik. **Jangan pernah** meng-commit data bisnis (file export TikTok, file .json data awal,
> cadangan). Semua data tersimpan di database D1 akun Cloudflare Anda, bukan di repo.

---

## Fitur

| Menu | Isi |
|---|---|
| **Ringkasan** | Omzet, pcs, laba operasional, nilai stok, posisi terhadap titik impas, catatan otomatis, grafik bulanan, tabel laba-rugi & arus kas |
| **Penjualan** | Unggah file export order TikTok (.xlsx/.csv) atau input manual. Status retur/cancel dibaca otomatis |
| **Pembelian & Impor** | Batch impor per SKU: kurs, harga CNY, cargo, status (Dipesan → Dalam perjalanan → Tiba) |
| **Produk & Stok** | Daftar model & varian, stok otomatis, nilai stok, model yang belum pernah laku, stock opname |
| **Boost & Promosi** | Budget, kupon, Apple fee, hasil (pembelian, penonton, views) |
| **Biaya Operasional** | Gaji, komisi, sewa, dll. dengan klasifikasi Tetap / Tetap (diskresioner) / Semi-variabel / Variabel |
| **Pengaturan** | Toko, tarif potongan TikTok, pemetaan SKU TikTok, impor & unduh cadangan data |

### Aturan membaca status export TikTok

| Kondisi di file export | Status di portal | Dihitung terjual? |
|---|---|---|
| Kolom Cancelation/Return Type kosong | Normal | Ya |
| Return/Refund dan *Sku Quantity of return* > 0 | Retur | Tidak (barang & uang kembali) |
| Return/Refund tetapi qty retur 0 | Retur tidak jadi | Ya |
| Cancel, *Cancelled Time* kosong, barang terkirim | Cancel ditolak | Ya |
| Cancel lainnya | Batal | Tidak |

Unggah file yang sama berkali-kali aman: data lama **diperbarui**, tidak dobel.

---

## Cara deploy ke Cloudflare (sekali saja)

Portal berjalan sebagai **Cloudflare Worker** (tampilan + API dalam satu proyek).

### 1. Buat database D1
1. **Cloudflare Dashboard → Storage & Databases → D1 SQL Database → Create**, nama: `glamora88-db`.
2. Salin **Database ID**, tempel ke `database_id` di `wrangler.toml`, lalu commit.

Tabel dibuat otomatis saat portal pertama kali dibuka.

### 2. Hubungkan repo (Workers Builds)
1. **Workers & Pages → Create → Import a repository** → pilih repo `glamora88`.
2. Pengaturan build:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
3. **Deploy**. Setiap push ke `main` akan ter-deploy otomatis.

### 3. Atur kata sandi
Di Worker `glamora88`: **Settings → Variables and Secrets → Add**:

| Nama | Tipe | Isi |
|---|---|---|
| `APP_PASSWORD` | Secret | Kata sandi bersama tim untuk masuk portal |
| `SESSION_SECRET` | Secret | Teks acak panjang (mis. 40 karakter), untuk mengamankan sesi login |

### 4. Muat data awal
1. Buka alamat portal (mis. `https://glamora88.<akun>.workers.dev`) dan masuk dengan `APP_PASSWORD`.
2. **Pengaturan → Impor & cadangan data → Pilih file .json** → pilih file data awal yang dikirim terpisah.
3. Cek menu **Ringkasan**.

### 5. (Disarankan) Lapisan keamanan tambahan
**Zero Trust → Access → Applications → Add (Self-hosted)** untuk domain portal, lalu izinkan hanya email tim.
Gratis untuk maksimal 50 pengguna. Dengan ini, halaman portal bahkan tidak bisa dibuka orang luar.

---

## Pemakaian harian (admin)

1. **Setiap hari / setelah live:** Seller Center → Pesanan → Ekspor → unggah di menu **Penjualan** (pilih tokonya).
2. **Saat ada SKU baru:** tambahkan di **Produk & Stok**, lalu petakan SKU TikTok-nya di **Pengaturan** jika muncul di daftar "belum dipetakan".
3. **Saat bayar impor:** buat batch di **Pembelian & Impor**; ubah status menjadi **Tiba** saat barang masuk gudang (stok otomatis bertambah).
4. **Setiap boost:** catat di **Boost & Promosi** (lihat angka di detail promosi TikTok).
5. **Setiap bayar gaji/sewa/dll.:** catat di **Biaya Operasional**.
6. **Akhir bulan:** stock opname di **Produk & Stok**, lalu **Unduh cadangan** di Pengaturan.

---

## Pengembangan lokal

```bash
npm install
cp .dev.vars.example .dev.vars        # isi APP_PASSWORD & SESSION_SECRET
npm run build
npx wrangler dev --port 8788          # http://localhost:8788 (D1 lokal otomatis)
```

Untuk mengubah tampilan dengan hot-reload, jalankan `npx wrangler dev --port 8788` di satu terminal dan `npm run dev`
di terminal lain (permintaan `/api` diteruskan ke port 8788).

### Struktur

```
worker/index.ts   titik masuk Worker: /api/* → API, selain itu → tampilan (dist/)
server/app.ts     API (Hono) — semua endpoint /api/*
server/           skema D1, autentikasi, helper database
shared/           logika bisnis: parser export TikTok, perhitungan laba, stok, titik impas
src/              tampilan (React): pages/, components/, lib/
```
