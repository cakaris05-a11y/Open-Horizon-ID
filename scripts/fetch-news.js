import { createClient } from '@supabase/supabase-js'
import fetch from 'node-fetch'
import WebSocket from 'ws'
import { ambilSemuaRss } from './rss.js'
import { spawn } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  // Node 20 belum punya WebSocket bawaan, sedangkan supabase-js terbaru
  // memerlukannya saat membuat client (untuk modul realtime yang tidak
  // kita pakai). Paket `ws` dipasang sebagai transport agar tidak crash.
  { realtime: { transport: WebSocket } }
)

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

function domainDari(urlStr) {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// Jalankan mesin verifikasi dari repo sentra-berita-verifikasi
// (salinan terkendali: scripts/verifikasi.py + config/sumber-terpercaya.json).
// Mengembalikan peta url -> {status, jumlah_klaster}, atau null bila gagal.
async function jalankanVerifikasi(articles) {
  const kandidat = articles.map(article => ({
    id: article.url,
    judul: article.title,
    url: article.url,
    sumber_domain: domainDari(article.source?.url) || domainDari(article.url),
    klaster: null
  }))

  const tmpFile = path.join(os.tmpdir(), `sentra-kandidat-${process.pid}.json`)
  await writeFile(tmpFile, JSON.stringify(kandidat))

  try {
    const hasil = await new Promise((resolve, reject) => {
      const proc = spawn('python3', [path.join(SCRIPT_DIR, 'verifikasi.py'), tmpFile])
      let out = ''
      let err = ''
      proc.stdout.on('data', d => { out += d })
      proc.stderr.on('data', d => { err += d })
      proc.on('error', reject)
      proc.on('close', code => {
        if (code !== 0) return reject(new Error(`verifikasi.py keluar dengan kode ${code}: ${err}`))
        try { resolve(JSON.parse(out)) } catch (e) { reject(e) }
      })
    })
    return hasil.per_artikel || {}
  } finally {
    await unlink(tmpFile).catch(() => {})
  }
}

async function fetchNews() {
  try {
    console.log('🔍 Fetching news from GNews for Santra Berita...')

    // Fetch dari GNews API
    const response = await fetch(
      `https://gnews.io/api/v4/top-headlines?country=id&lang=id&max=10&token=${process.env.GNEWS_API_KEY}`
    )

    if (!response.ok) {
      throw new Error(`GNews API error: ${response.status}`)
    }

    const data = await response.json()

    if (!data.articles || data.articles.length === 0) {
      console.log('⚠️  GNews kosong untuk run ini; lanjut dengan RSS saja')
      data.articles = []
    }

    console.log(`📰 Found ${data.articles.length} articles for Santra Berita`)

    // Sumber kedua: RSS resmi langsung dari medianya. Setiap feed adalah
    // klaster independen, jadi cerita yang sama di GNews dan RSS (atau di
    // dua feed berbeda) bisa saling menguatkan di gerbang verifikasi.
    const rssArticles = await ambilSemuaRss()
    const terlihat = new Set()
    const semuaArtikel = []
    for (const a of [...data.articles, ...rssArticles]) {
      if (!a.url || terlihat.has(a.url)) continue
      terlihat.add(a.url)
      semuaArtikel.push(a)
    }
    console.log(`📰 Kolam gabungan: ${semuaArtikel.length} artikel (GNews ${data.articles.length} + RSS ${rssArticles.length}, sesudah buang duplikat URL)`)

    // Gerbang verifikasi: nilai dulu, simpan belakangan.
    // Bila mesin verifikasi gagal jalan, semua artikel ditandai CELAH
    // (tertahan, tidak tayang) — gagal secara aman, bukan lolos diam-diam.
    let perArtikel = {}
    try {
      perArtikel = await jalankanVerifikasi(semuaArtikel)
      console.log('🛡️  Verifikasi selesai')
    } catch (e) {
      console.error(`⚠️  Mesin verifikasi gagal (${e.message}); semua artikel ditandai CELAH`)
    }

    const sekarang = new Date().toISOString()

    // Transform data untuk Supabase (kolom lama + kolom verifikasi)
    const articles = semuaArtikel.map(article => {
      const v = perArtikel[article.url]
      return {
        title: article.title,
        description: article.description,
        content: article.content,
        url: article.url,
        image_url: article.image,
        source: article.source.name,
        published_at: article.publishedAt,
        status_verifikasi: v?.status || 'CELAH',
        jumlah_klaster: v?.jumlah_klaster || 0,
        diverifikasi_pada: sekarang
      }
    })

    const lolos = articles.filter(a => a.status_verifikasi === 'TERKONFIRMASI').length
    console.log(`🛡️  Hasil verifikasi: ${lolos} TERKONFIRMASI, ${articles.length - lolos} tertahan (CELAH/BERTENTANGAN)`)

    // Insert ke Supabase
    let { data: inserted, error } = await supabase
      .from('articles')
      .upsert(articles, {
        onConflict: 'url',
        ignoreDuplicates: false
      })
      .select()

    if (error) {
      // Kolom verifikasi kemungkinan belum ada (migrasi SQL belum dijalankan).
      // Mundur ke perilaku lama agar pengambilan berita tidak pernah putus,
      // sambil berteriak jelas di log bahwa migrasi masih utang.
      console.error('⚠️  Upsert berkolom verifikasi gagal:', error.message)
      console.error('⚠️  Bila penyebabnya kolom belum ada, jalankan supabase/migrasi-verifikasi.sql di Supabase SQL Editor. Mundur ke format lama untuk run ini.')
      const lama = articles.map(({ status_verifikasi, jumlah_klaster, diverifikasi_pada, ...sisa }) => sisa)
      const ulang = await supabase
        .from('articles')
        .upsert(lama, {
          onConflict: 'url',
          ignoreDuplicates: false
        })
        .select()
      inserted = ulang.data
      error = ulang.error
    }

    if (error) {
      console.error('❌ Supabase error:', error)
      process.exit(1)
    }

    console.log(`✅ Successfully inserted ${inserted?.length || articles.length} articles to Santra Berita database`)

  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

fetchNews()
