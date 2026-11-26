// Pengambil RSS resmi untuk Open Horizon ID.
//
// Setiap feed di scripts/sumber-rss.json adalah satu klaster sumber
// independen untuk gerbang verifikasi (scripts/verifikasi.py): cerita
// yang sama yang muncul di GNews dan di feed resmi medianya — atau di
// dua feed berbeda — bisa saling menguatkan sampai TERKONFIRMASI.
//
// Prinsip: gagal secara lembut. Satu feed mati tidak boleh menjatuhkan
// run; feed itu dilewati dan sisanya tetap jalan.

import fetch from 'node-fetch'
import { readFile } from 'node:fs/promises'
import dns from 'node:dns'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Beberapa server media Indonesia menggantung bila IPv6 dicoba duluan;
// paksa urutan DNS mengutamakan IPv4 (perilaku curl yang terbukti jalan).
dns.setDefaultResultOrder('ipv4first')

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const TIMEOUT_MS = 20000

function dekodeEntitas(teks) {
  return teks
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function bersihkanTeks(teks) {
  return dekodeEntitas(String(teks || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function ambilTag(blok, tag) {
  const m = blok.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? m[1].trim() : ''
}

function ambilGambar(blokItem, deskripsiHtml) {
  const media = blokItem.match(/<media:content[^>]+url="([^"]+)"/i)
  if (media) return media[1]
  const enclosure = blokItem.match(/<enclosure[^>]+url="([^"]+)"[^>]*type="image/i)
  if (enclosure) return enclosure[1]
  const img = String(deskripsiHtml || '').match(/<img[^>]+src="([^"]+)"/i)
  if (img) return img[1]
  return null
}

// Parse satu dokumen RSS 2.0 menjadi artikel berbentuk GNews.
export function parseRss(xml, feed) {
  const tanpaCdata = String(xml).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  const blokItems = tanpaCdata.match(/<item[\s>][\s\S]*?<\/item>/gi) || []
  const hasil = []

  for (const blok of blokItems) {
    const judul = bersihkanTeks(ambilTag(blok, 'title'))
    let tautan = bersihkanTeks(ambilTag(blok, 'link'))
    if (!tautan) tautan = bersihkanTeks(ambilTag(blok, 'guid'))
    if (!judul || !tautan.startsWith('http')) continue

    const deskripsiMentah = ambilTag(blok, 'description')
    const deskripsi = bersihkanTeks(deskripsiMentah).slice(0, 600)
    const tgl = new Date(ambilTag(blok, 'pubDate'))
    const terbit = isNaN(tgl.getTime()) ? new Date().toISOString() : tgl.toISOString()

    hasil.push({
      title: judul,
      description: deskripsi,
      content: deskripsi,
      url: tautan,
      image: ambilGambar(blok, deskripsiMentah),
      source: { name: feed.nama, url: feed.beranda },
      publishedAt: terbit
    })
    if (hasil.length >= (feed.maks || 10)) break
  }
  return hasil
}

async function ambilSatuFeed(feed) {
  const kontrol = new AbortController()
  const timer = setTimeout(() => kontrol.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(feed.url, {
      signal: kontrol.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'
      }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const xml = await res.text()
    const artikel = parseRss(xml, feed)
    console.log(`📡 RSS ${feed.nama}: ${artikel.length} artikel`)
    return artikel
  } catch (e) {
    console.error(`⚠️  RSS ${feed.nama} dilewati (${e.message})`)
    return []
  } finally {
    clearTimeout(timer)
  }
}

// Ambil semua feed resmi secara paralel; tidak pernah melempar error.
export async function ambilSemuaRss() {
  let daftar = []
  try {
    const mentah = await readFile(path.join(SCRIPT_DIR, 'sumber-rss.json'), 'utf8')
    daftar = JSON.parse(mentah).feed || []
  } catch (e) {
    console.error(`⚠️  Daftar RSS tidak terbaca (${e.message}); lanjut tanpa RSS`)
    return []
  }
  const hasil = await Promise.all(daftar.map(ambilSatuFeed))
  return hasil.flat()
}
