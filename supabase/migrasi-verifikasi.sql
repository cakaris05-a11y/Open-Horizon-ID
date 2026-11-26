-- Migrasi gerbang verifikasi Sentra Berita (JALANKAN SEKALI SAJA)
-- Cara: buka Supabase Dashboard > SQL Editor > tempel seluruh berkas ini > Run.
--
-- Menambah kolom status verifikasi ke tabel articles. Nilai bawaan 'CELAH'
-- berarti artikel lama dianggap BELUM terverifikasi sampai diperiksa ulang;
-- situs hanya menampilkan artikel berstatus 'TERKONFIRMASI'.
-- Aman dijalankan ulang (if not exists).

alter table public.articles
  add column if not exists status_verifikasi text not null default 'CELAH',
  add column if not exists jumlah_klaster integer not null default 0,
  add column if not exists diverifikasi_pada timestamptz;

create index if not exists idx_articles_status_verifikasi
  on public.articles (status_verifikasi);
