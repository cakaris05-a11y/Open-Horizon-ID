# Berkas Verifikasi (Salinan Terkendali)

`scripts/verifikasi.py` dan `config/sumber-terpercaya.json` di repo ini adalah
**salinan persis** dari repo sumber kebenaran:

- Repo: `cakaris05-a11y/sentra-berita-verifikasi`
- Berkas asal: `scripts/verifikasi.py`, `config/sumber-terpercaya.json`

Aturan main:

1. **Jangan menyunting salinan di repo ini.** Semua perubahan protokol dan
   daftar sumber dilakukan di repo `sentra-berita-verifikasi`.
2. Untuk memperbarui: salin kedua berkas dari repo sumber ke path yang sama
   di repo ini, lalu commit dengan pesan yang menyebut commit sumbernya.
3. Setelah menyalin, jalankan skenario di `eval/scenarios.yaml` (di repo
   sumber) terhadap salinan baru sebelum commit.

Alasan penyalinan, bukan pemanggilan lintas repo: GitHub Actions di repo ini
tidak punya akses baca ke repo privat lain tanpa token tambahan, jadi salinan
terkendali adalah cara paling sederhana dan tetap bisa diaudit.
