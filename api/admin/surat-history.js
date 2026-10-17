module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, error: "Metode tidak diizinkan." });
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    return res.status(500).json({ success: false, error: "Environment variable Upstash belum lengkap." });
  }

  const cookies = String(req.headers.cookie || "").split(";").map(value => value.trim());
  const sessionCookie = cookies.find(value => value.startsWith("admin_session="));
  const sessionToken = sessionCookie ? sessionCookie.slice("admin_session=".length) : "";
  if (!/^[a-f0-9]{64}$/i.test(sessionToken)) {
    return res.status(401).json({ success: false, error: "Sesi admin tidak valid." });
  }

  const baseUrl = redisUrl.replace(/\/+$/, "");
  async function command(cmd) {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(cmd),
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || `Upstash HTTP ${response.status}`);
    return data.result;
  }

  try {
    const sessionRaw = await command(["GET", `admin_session:${sessionToken}`]);
    if (!sessionRaw) return res.status(401).json({ success: false, error: "Sesi admin sudah berakhir." });

    let session;
    try {
      session = typeof sessionRaw === "string" ? JSON.parse(sessionRaw) : sessionRaw;
    } catch (_) {
      return res.status(401).json({ success: false, error: "Data sesi tidak valid." });
    }
    if (!session || session.role !== "admin" || typeof session.email !== "string") {
      return res.status(403).json({ success: false, error: "Akses admin diperlukan." });
    }

    const commands = [
      ["GET", "surat:total_dibuat"],
      ["SCARD", "surat:ip_unik_hashes"],
      ["LRANGE", "surat:riwayat:terbaru", "0", "499"]
    ];
    const response = await fetch(`${baseUrl}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(commands),
      cache: "no-store"
    });
    const rows = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(rows) || rows.length !== commands.length || rows.some(row => !row || row.error)) {
      throw new Error("Gagal membaca riwayat surat dari Upstash.");
    }

    const total = Math.max(0, Number(rows[0].result) || 0);
    const uniqueIps = Math.max(0, Number(rows[1].result) || 0);
    const rawRecords = Array.isArray(rows[2].result) ? rows[2].result : [];
    const records = rawRecords.map(raw => {
      try { return typeof raw === "string" ? JSON.parse(raw) : raw; }
      catch (_) { return null; }
    }).filter(record => record && typeof record === "object");

    // Hitung jumlah pembuatan per IP di antara 500 catatan terbaru.
    const counts = new Map();
    for (const record of records) {
      const key = String(record.ip || "");
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    const output = records.map(record => ({
      id: String(record.id || ""),
      ip: String(record.ip || "Tidak diketahui"),
      city: String(record.city || "Tidak diketahui"),
      region: String(record.region || ""),
      country: String(record.country || ""),
      location: String(record.location || [record.city, record.region, record.country].filter(Boolean).join(", ")),
      timestamp: String(record.timestamp || ""),
      time: String(record.time || record.timestamp || "—"),
      count: counts.get(String(record.ip || "")) || 1
    }));

    return res.status(200).json({ success: true, total, uniqueIps, records: output });
  } catch (error) {
    console.error("ADMIN_SURAT_HISTORY_ERROR:", error);
    return res.status(502).json({ success: false, error: "Tidak dapat memuat riwayat surat." });
  }
};
