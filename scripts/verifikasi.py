#!/usr/bin/env python3
"""Mesin verifikasi inti Sentra Berita (implementasi acuan Protokol v1.0).

Membaca daftar kandidat kabar (JSON), lalu menerapkan:
  - pengelompokan peristiwa: dari bidang "peristiwa" bila ada, atau dari
    kemiripan judul (tumpang-tindih token + penjaga angka) bila tidak ada,
  - pengelompokan klaster sumber independen (salinan satu asal = 1 klaster),
  - syarat lolos: >= 2 klaster independen, atau 1 klaster tingkat A,
  - status kabar: TERKONFIRMASI / CELAH / BERTENTANGAN,
  - keputusan per peristiwa dan per artikel: TAYANG / TAHAN.

Format masukan (daftar objek):
  {
    "id": "kabar-001",
    "judul": "...",
    "url": "https://...",
    "sumber_domain": "antaranews.com",
    "klaster": "antara",            // asal primer bersama; null bila independen
    "waktu_terbit": "2026-11-27T01:00:00+07:00",
    "peristiwa": "ev-001",          // opsional; tanpa ini dikelompokkan dari judul
    "bertentangan_dengan": []       // id kabar lain yang isinya bertentangan
  }

Pemakaian:
  python3 verifikasi.py kandidat.json [--sumber ../config/sumber-terpercaya.json]

Keluaran: JSON berisi "per_peristiwa" dan "per_artikel".
Skrip ini murni pustaka standar Python 3, tanpa kunci API dan tanpa jaringan.
"""

import argparse
import json
import re
import sys
from pathlib import Path

TINGKAT_BOBOT = {"A": 4, "B": 3, "C": 1, "D": 0}
AMBANG_TUMPAH_TINDIH_JUDUL = 0.5

STOPWORDS_ID = {
    "di", "ke", "dari", "dan", "yang", "untuk", "pada", "dengan", "ini", "itu",
    "adalah", "akan", "telah", "sudah", "tidak", "ada", "juga", "oleh", "atau",
    "dalam", "sebagai", "karena", "setelah", "sebelum", "hingga", "saat", "para",
    "usai", "jadi", "kata", "sebut", "antara", "lain", "lebih", "bisa", "dapat",
    "atas", "bagi", "pun", "per", "tiap", "sang", "para",
}


def muat_tingkat_sumber(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    domain_ke_tingkat = {}
    for tingkat, daftar in data["tingkat"].items():
        for s in daftar:
            if s.get("domain"):
                domain_ke_tingkat[s["domain"]] = tingkat
    return domain_ke_tingkat


def tingkat_dari(kabar, peta):
    return peta.get(kabar.get("sumber_domain") or "", "D")


def token_judul(judul):
    kata = re.findall(r"[a-z0-9]+", (judul or "").lower())
    return {k for k in kata if k not in STOPWORDS_ID and len(k) > 2}


def angka_judul(judul):
    """Kelompok angka dalam judul (magnitudo, skor, tanggal) sebagai sinyal kuat."""
    return frozenset(re.findall(r"\d+", (judul or "").lower()))


def kemiripan_judul(a, b):
    """Koefisien tumpang-tindih token kata: |A irisan B| / min(|A|, |B|)."""
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def kelompokkan_peristiwa(kandidat):
    """Kembalikan dict id_artikel -> id_peristiwa."""
    if all(k.get("peristiwa") for k in kandidat):
        return {k["id"]: k["peristiwa"] for k in kandidat}

    # Union-find atas kemiripan judul.
    induk = {k["id"]: k["id"] for k in kandidat}

    def cari(x):
        while induk[x] != x:
            induk[x] = induk[induk[x]]
            x = induk[x]
        return x

    def gabung(a, b):
        ra, rb = cari(a), cari(b)
        if ra != rb:
            induk[rb] = ra

    token = {k["id"]: token_judul(k.get("judul")) for k in kandidat}
    angka = {k["id"]: angka_judul(k.get("judul")) for k in kandidat}
    ids = [k["id"] for k in kandidat]
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = ids[i], ids[j]
            # Angka yang bertentangan (skor/magnitudo beda) = peristiwa berbeda.
            if angka[a] and angka[b] and angka[a] != angka[b]:
                continue
            if len(token[a] & token[b]) >= 3 and kemiripan_judul(token[a], token[b]) >= AMBANG_TUMPAH_TINDIH_JUDUL:
                gabung(a, b)

    kelompok = {}
    for k in kandidat:
        akar = cari(k["id"])
        kelompok.setdefault(akar, []).append(k["id"])
    hasil = {}
    for n, (akar, anggota) in enumerate(sorted(kelompok.items()), start=1):
        for id_artikel in anggota:
            hasil[id_artikel] = f"ev-{n:03d}"
    return hasil


def nilai_peristiwa(kabar_list, peta):
    """Kembalikan (status, klaster, catatan)."""
    klaster = {}
    for k in kabar_list:
        kunci = k.get("klaster") or f"domain:{k.get('sumber_domain')}"
        tingkat = tingkat_dari(k, peta)
        if kunci not in klaster or TINGKAT_BOBOT[tingkat] > TINGKAT_BOBOT[klaster[kunci]]:
            klaster[kunci] = tingkat

    ids = {k["id"] for k in kabar_list}
    bertentangan = any(
        set(k.get("bertentangan_dengan") or []) & ids for k in kabar_list
    )
    if bertentangan:
        return "BERTENTANGAN", klaster, "ada kabar yang saling bertentangan; tahan dan eskalasi"

    jumlah_klaster_kuat = sum(1 for t in klaster.values() if t in ("A", "B"))
    ada_a = any(t == "A" for t in klaster.values())
    if ada_a or jumlah_klaster_kuat >= 2:
        return "TERKONFIRMASI", klaster, "lolos verifikasi silang"
    return "CELAH", klaster, "konfirmasi independen belum cukup; tahan, cari sumber lanjutan"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("masukan", help="berkas JSON daftar kandidat kabar")
    ap.add_argument(
        "--sumber",
        default=str(Path(__file__).resolve().parent.parent / "config" / "sumber-terpercaya.json"),
        help="berkas daftar tingkat sumber",
    )
    args = ap.parse_args()

    peta = muat_tingkat_sumber(args.sumber)
    kandidat = json.loads(Path(args.masukan).read_text(encoding="utf-8"))

    peta_peristiwa = kelompokkan_peristiwa(kandidat)
    per_peristiwa_grup = {}
    for k in kandidat:
        per_peristiwa_grup.setdefault(peta_peristiwa[k["id"]], []).append(k)

    per_peristiwa = []
    per_artikel = {}
    for peristiwa, daftar in sorted(per_peristiwa_grup.items()):
        status, klaster, catatan = nilai_peristiwa(daftar, peta)
        keputusan = "TAYANG" if status == "TERKONFIRMASI" else "TAHAN"
        per_peristiwa.append(
            {
                "peristiwa": peristiwa,
                "status": status,
                "keputusan": keputusan,
                "klaster_independen": dict(sorted(klaster.items())),
                "jumlah_klaster": len(klaster),
                "jumlah_kabar": len(daftar),
                "catatan": catatan,
            }
        )
        for k in daftar:
            per_artikel[k["id"]] = {
                "peristiwa": peristiwa,
                "status": status,
                "keputusan": keputusan,
                "jumlah_klaster": len(klaster),
            }

    json.dump(
        {"per_peristiwa": per_peristiwa, "per_artikel": per_artikel},
        sys.stdout,
        ensure_ascii=False,
        indent=2,
    )
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
