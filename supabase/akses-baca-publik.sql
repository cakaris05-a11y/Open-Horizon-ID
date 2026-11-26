-- Akses baca publik untuk situs Open Horizon ID (Cloudflare Pages).
-- Situs hanya MEMBACA artikel memakai kunci "anon" Supabase;
-- menulis/mengubah data tetap khusus service key milik pengambil berita.
-- Aman dijalankan berulang kali.

alter table public.articles enable row level security;

drop policy if exists "Artikel bisa dibaca publik" on public.articles;

create policy "Artikel bisa dibaca publik"
  on public.articles
  for select
  to anon, authenticated
  using (true);

grant select on public.articles to anon, authenticated;
