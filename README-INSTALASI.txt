DASHBOARD ADMIN KALKULATOR HARGA TAYANG

Tambahkan file dari paket ini ke repository GitHub/Vercel yang sudah ada. Jangan hapus atau timpa index.html maupun api/visits.js.

Struktur tambahan:
admin.html
api/admin/login.js
api/admin/stats.js
api/admin/logout.js
lib/adminAuth.js

Environment Variables di Vercel:
- UPSTASH_REDIS_REST_URL: gunakan nilai yang sudah ada.
- UPSTASH_REDIS_REST_TOKEN: gunakan nilai yang sudah ada.
- ADMIN_PASSWORD: buat password admin yang kuat dan unik.
- ADMIN_SESSION_SECRET: string acak minimal 32 karakter. Contoh membuatnya di Node.js:
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

Isi rahasia langsung di Vercel > Project > Settings > Environment Variables. Jangan masukkan password/token ke HTML atau GitHub. Setelah menambah/mengubah environment variables, redeploy.

Pasang:
1. Ekstrak ZIP.
2. Upload/copy file baru dengan struktur folder di atas ke repository yang sama.
3. Pertahankan index.html dan api/visits.js yang sudah ada.
4. Commit/push ke branch yang terhubung ke Vercel.
5. Tambahkan ADMIN_PASSWORD dan ADMIN_SESSION_SECRET di Vercel.
6. Setelah deployment selesai, buka https://DOMAIN-KAMU/admin.html.

Login memakai cookie HttpOnly, Secure, SameSite=Strict dengan masa sesi 8 jam. Dashboard membaca Redis key yang sudah digunakan API: kalkulator:total_kunjungan. API publik /api/visits tidak diubah. Statistik harian/bulanan belum ada karena API sekarang hanya menyimpan total global.
