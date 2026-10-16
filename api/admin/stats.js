module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, error: "Metode tidak diizinkan" });
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    return res.status(500).json({ success: false, error: "Environment variable Upstash belum lengkap" });
  }

  const cookies = String(req.headers.cookie || "").split(";").map(v => v.trim());
  const sessionCookie = cookies.find(v => v.startsWith("admin_session="));
  const sessionToken = sessionCookie ? sessionCookie.slice("admin_session=".length) : "";
  if (!/^[a-f0-9]{64}$/i.test(sessionToken)) {
    return res.status(401).json({ success: false, error: "Sesi admin tidak valid" });
  }

  const baseUrl = redisUrl.replace(/\/$/, "");
  async function command(cmd) {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${redisToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmd),
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || `Upstash HTTP ${response.status}`);
    return data.result;
  }

  try {
    const sessionRaw = await command(["GET", `admin_session:${sessionToken}`]);
    if (!sessionRaw) return res.status(401).json({ success: false, error: "Sesi admin sudah berakhir" });
    let session;
    try { session = typeof sessionRaw === "string" ? JSON.parse(sessionRaw) : sessionRaw; }
    catch { return res.status(401).json({ success: false, error: "Data sesi tidak valid" }); }
    if (!session || session.role !== "admin") {
      return res.status(403).json({ success: false, error: "Akses admin diperlukan" });
    }

    const now = new Date();
    const dateFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit"
    });
    const todayDate = dateFmt.format(now);
    const dateList = [];
    for (let i = 364; i >= 0; i--) {
      const d = new Date(`${todayDate}T00:00:00+07:00`);
      d.setDate(d.getDate() - i);
      dateList.push(dateFmt.format(d));
    }

    // Pipeline untuk mengambil 365 hari tanpa satu permintaan jaringan per hari.
    const pipeline = [
      ["GET", "kalkulator:total_kunjungan"],
      ...dateList.map(date => ["GET", `kalkulator:kunjungan_harian:${date}`])
    ];
    const response = await fetch(`${baseUrl}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${redisToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(pipeline),
      cache: "no-store"
    });
    const rows = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(rows) || rows.some(row => row && row.error)) {
      throw new Error("Gagal membaca statistik dari Upstash");
    }
    const total = Math.max(0, Number(rows[0] && rows[0].result) || 0);
    const daily = dateList.map((date, i) => ({
      date,
      count: Math.max(0, Number(rows[i + 1] && rows[i + 1].result) || 0)
    }));
    const today = daily[daily.length - 1].count;
    return res.status(200).json({ success: true, total, today, todayDate, daily });
  } catch (error) {
    console.error("Admin stats error:", error);
    return res.status(502).json({ success: false, error: "Tidak dapat memuat statistik pengunjung." });
  }
};
