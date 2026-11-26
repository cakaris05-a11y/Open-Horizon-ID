// Konfigurasi publik situs Open Horizon ID.
// Kunci di bawah adalah "publishable key" Supabase: memang dirancang untuk
// dipasang terbuka di browser. Keamanan data dijaga Row Level Security —
// publik hanya bisa MEMBACA tabel articles, tidak bisa menulis/mengubah.
window.OHI_CONFIG = {
  SUPABASE_URL: "https://gvkjsvmgcpxjksivwwcv.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_DUeY1LmeTf4ovoM-788POA_S5CxyiHR"
};
