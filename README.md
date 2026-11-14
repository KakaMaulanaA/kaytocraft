# KaytoCraft 3D (AssetCraft 3D) — Fase 1: Generator MVP

Studio internal untuk mengubah **teks / gambar → model 3D** pakai AI, preview di viewport Three.js, lalu bawa ke **Blender**.

```
Prompt / gambar ──► API engine (Tripo3D / Meshy) ──► model disimpan lokal (./storage)
                                                     └─► viewport ► Export .GLB / .OBJ / Python script ► Blender
```

## Menjalankan

Butuh **Node.js 20.9+** (cek: `node -v`).

```bash
npm install
copy .env.example .env.local   # Windows (macOS/Linux: cp)
npm run dev
```

Buka http://localhost:3000.

**Mode Gratis (Procedural)** — tanpa API key & tanpa biaya. Ketik objek sederhana (boleh bahasa Indonesia), misalnya `meja kayu bulat`, `kursi kantor hitam`, `rak buku`, `peti harta karun`, `tong kayu tua`, `pedang jepang`. Model dibangun langsung di browser dengan ukuran asli (meter), bevel, tekstur, dan nama part yang rapi untuk Blender. Objek yang didukung: meja, kursi, kursi kantor, stool, bangku, rak buku, lemari, laci, peti/kotak, peti harta, tong, vas/guci/pot, mug, botol, lampu, pedang. Objek lain → pakai engine AI (Tripo).

Untuk objek apa pun, isi salah satu key di `.env.local`, lalu restart `npm run dev`:

| Variabel | Dapat dari | Catatan |
|---|---|---|
| `TRIPO_API_KEY` | developers.tripo3d.ai/en/keys → Create Key | Default engine kalau terisi. Text & image to 3D. |
| `GEMINI_API_KEY` | aistudio.google.com/apikey | Engine **Gemini — gratis** (kuota harian Google). Merancang model dari bentuk dasar, juga dipakai tombol *Rancang* di Knowledge Library. Model dipilih otomatis; opsional `GEMINI_MODEL`. |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | Engine **Claude**: Claude merancang model dari bentuk dasar (blockout rapi, objek keras apa pun, bisa dari gambar). Bayar per token. Opsional `ANTHROPIC_MODEL`. |
| `MESHY_API_KEY` | meshy.ai → Settings → API | Text-to-3D jalan 2 tahap (geometri → texturing), lebih lama. |

API key hanya dipakai di server (route `/api/*`), tidak pernah dikirim ke browser.

## Knowledge Library (menu "Knowledge Library")

Ajarkan barang baru sekali, lalu pakai **gratis** selamanya. Saat prompt mengandung kata kunci sebuah entri, Generator memakai Library dulu (bisa dimatikan di Pengaturan lanjutan).

- **Tulisan** — tulis deskripsi → *Rancang dengan Claude* (butuh `ANTHROPIC_API_KEY`), atau tempel **resep JSON** (gratis; bisa minta dibuatkan di chat).
- **File** — `.glb`, `.fbx`, atau `.blend` (dikonversi otomatis dengan Blender).
- **Gambar** — foto/sketsa → Claude merancang blockout-nya. Untuk hasil detail: Image to 3D (Tripo) lalu tombol **Library** di kartu Asset Vault.
- **Kamus** — ajarkan kata/istilah: `lemari jati → teak wood wardrobe`.
- Entri **resep** bisa diwarnai ulang lewat prompt: `sofa merah`, `pintu putih`, `sofa kulit`.

Semua tersimpan di folder `library/` (index.json, resep .json, model .glb, thumbnail .png) — gampang di-backup atau dibagikan.

## Batch Synthesis (menu "Batch Synthesis")

Buat banyak barang sekaligus. Drop file **.docx / .xlsx / .csv / .txt** berisi daftar barang (satu per baris atau sel; nomor, bullet, dan judul kolom seperti "Nama barang" dilewati), atau ketik daftarnya. Pilih cara membuat:

- **Otomatis (gratis)** — Library → Mode Gratis → Gemini.
- **Gemini / Claude** — semua dirancang AI.
- **Tripo3D** — kualitas terbaik, 20 kredit per barang (estimasi & konfirmasi sebelum mulai).

Semua hasil masuk Asset Vault (lengkap dengan thumbnail), bisa dibuka satu per satu (ikon mata) atau diunduh sekaligus sebagai **.zip**. Antrian berjalan di tab browser, jadi biarkan tab terbuka sampai selesai. Maksimal 200 barang per batch.

## Alur ke Blender

1. **Export .GLB (Blender Ready)** → di Blender: *File › Import › glTF 2.0*.
2. **Python Script** → menyalin script; di Blender buka tab *Scripting › New*, paste, *Run*. Model langsung ter-import (server ini harus sedang jalan).
3. **.OBJ** → ekspor geometri dari viewport (tanpa tekstur), untuk software yang tidak membaca GLB.

**.BLEND** → file Blender siap buka (collection rapi, root di origin, tekstur dikemas, plus kamera & cahaya). Dikonversi otomatis memakai Blender di komputer ini (dicari di Steam / Program Files, atau atur `BLENDER_PATH`). Konversi pertama butuh beberapa detik, berikutnya instan (di-cache).

Mode **Quad-Remesh** membuat Tripo mengeluarkan **.FBX** (bukan GLB). Viewport tetap bisa menampilkannya dan script Python otomatis memakai importer FBX.

## Online di Netlify

Versi online otomatis menyesuaikan diri:

- **Penyimpanan** pindah ke **Netlify Blobs** (aset, thumbnail, Knowledge Library). Isi folder `library/` di repo disalin ke sana saat pertama kali dibuka.
- **Login password** wajib: atur `APP_PASSWORD`. Tanpa itu web menolak semua akses.
- **Upload besar** (> 3,5 MB) dikirim per potongan 4 MB — aman untuk batas Netlify.
- **.BLEND** dibuat oleh GitHub Actions (Blender gratis dari GitHub): klik pertama ±1–2 menit, berikutnya instan. Setelan: lihat bawah. Unggah ke Library online pakai .glb/.fbx.
- Model > 20 MB tidak bisa diunduh lewat Netlify (batas respons). Pakai Density *Balanced/Low* untuk Tripo.

Langkah deploy:

1. Push folder ini ke GitHub (`storage/` dan `.env.local` otomatis tidak ikut).
2. Netlify › *Add new project* › *Import an existing project* › pilih repo. Build setting terbaca dari `netlify.toml`.
3. *Site configuration › Environment variables*: isi `APP_PASSWORD`, lalu key yang dipakai (`TRIPO_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, …). Lalu *Deploys › Trigger deploy*.

**.BLEND online (sekali setel):**

1. GitHub › Settings › Developer settings › *Fine-grained tokens* › Generate: Repository access = repo ini saja, Permissions › **Contents: Read and write**. Salin token.
2. Netlify › Environment variables: `GITHUB_TOKEN` = token tadi, `GITHUB_REPO` = `namakamu/namarepo`, `BLEND_WORKER_SECRET` = teks acak panjang.
3. GitHub repo › Settings › Secrets and variables › Actions › *New repository secret*: `BLEND_WORKER_SECRET` = teks acak yang sama.
4. Netlify › Trigger deploy.

Data di PC (`storage/`) dan online (Netlify Blobs) terpisah. Entri Library baru dari PC ikut online saat folder `library/` di-push — hanya jika Library online masih kosong.

## Struktur

```
app/
  page.tsx                  Generator (3 panel)
  api/generate              buat task di engine
  api/tasks/[id]            polling status + unduh hasil ke ./storage
  api/assets/...            daftar, file model, thumbnail, hapus
  batch|topology|texture|bridge   placeholder Fase 2–3
components/
  generator/ControlPanel    input prompt/gambar, preset, setelan engine
  generator/Viewport        viewport Three.js + toolbar + export dock
  generator/AssetVault      history hasil generate
  shell/                    header & sidebar
lib/
  server/providers.ts       integrasi Tripo3D v3, Meshy, Demo
  server/blobstore.ts       penyimpanan: folder di PC, Netlify Blobs online
  server/storage.ts         aset (storage/assets/<id>.json + file model)
  three/viewer.ts           kelas ModelViewer (load GLB/FBX, wireframe, shading, statistik)
  presets.ts, types.ts
public/demo/                model contoh untuk Demo Mode
```

Hasil generate tersimpan di `./storage` (sudah di-.gitignore). Link download dari Tripo/Meshy kedaluwarsa dalam hitungan menit, jadi server langsung menyimpan salinannya.

## Roadmap

- **Fase 1 (sekarang):** Generator, viewport, export GLB/OBJ, history, statistik polycount.
- **Fase 2:** Batch Synthesis, PBR Texture Lab (ekstrak map), Topology analysis, konversi FBX.
- **Fase 3:** Add-on Blender + tombol *Send to Blender* via localhost.
