# Sentra-Berita
Auto fetch berita untuk Santra Berita

## Gerbang verifikasi

Sejak 27 Nov 2026, setiap artikel yang diambil skrip ini melewati **mesin
verifikasi** dari repo pendamping
[`sentra-berita-verifikasi`](https://github.com/cakaris05-a11y/sentra-berita-verifikasi)
(salinan terkendali ada di `scripts/verifikasi.py` + `config/sumber-terpercaya.json`,
lihat `scripts/VERIFIKASI-SUMBER.md`). Hasilnya disimpan sebagai
`status_verifikasi` (TERKONFIRMASI / CELAH / BERTENTANGAN), `jumlah_klaster`,
dan `diverifikasi_pada`. Situs hanya menampilkan yang TERKONFIRMASI.

**Satu langkah manual sekali saja:** jalankan `supabase/migrasi-verifikasi.sql`
di Supabase SQL Editor untuk menambah kolom-kolom itu. Sebelum migrasi
dijalankan, fetcher otomatis mundur ke format lama dan mencatat peringatan
di log Actions, jadi pengambilan berita tidak putus.
