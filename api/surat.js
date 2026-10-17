const crypto = require("crypto");
const net = require("net");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return res.status(500).json({ success: false, error: "Environment variable Upstash belum diatur di Vercel." });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ success: false, error: "Metode tidak diizinkan." });
  }

  const baseUrl = url.replace(/\/+$/, "");

  async function command(cmd) {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(cmd),
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || `Upstash HTTP ${response.status}`);
    return data.result;
  }

  // GET hanya membaca total, tidak menambah hitungan.
  if (req.method === "GET") {
    try {
      const result = await command(["GET", "surat:total_dibuat"]);
      const total = Number(result || 0);
      if (!Number.isSafeInteger(total) || total < 0) throw new Error("Data total surat tidak valid.");
      return res.status(200).json({ success: true, total });
    } catch (error) {
      console.error("Gagal membaca total surat:", error);
      return res.status(502).json({ success: false, error: "Gagal mengambil total surat." });
    }
  }

  try {
    // Gunakan header IP yang disediakan platform; validasi agar nilai tidak sembarang.
    const rawIp = String(req.headers["x-real-ip"] || "").trim() ||
      String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const ip = rawIp.replace(/^\[|\]$/g, "").replace(/:\d+$/, (match, offset, full) => {
      // Jangan memotong port dari alamat IPv6.
      return net.isIP(full) === 6 ? match : "";
    });

    if (!ip || !net.isIP(ip)) {
      return res.status(400).json({ success: false, error: "IP pengunjung tidak dapat diverifikasi." });
    }

    const ipHash = crypto.createHash("sha256").update(ip).digest("hex");
    const hourKey = new Date().toISOString().slice(0, 13).replace(/[-T]/g, "");
    const rateKey = `surat:rate:${ipHash}:${hourKey}`;
    const hits = Number(await command(["INCR", rateKey]));
    if (hits === 1) await command(["EXPIRE", rateKey, 3600]);
    if (!Number.isSafeInteger(hits) || hits > 30) {
      return res.status(429).json({ success: false, error: "Terlalu banyak permintaan. Coba lagi nanti." });
    }

    // Lokasi hanya perkiraan dari IP. Kegagalan layanan geolokasi tidak menggagalkan pencatatan.
    let city = "Tidak diketahui";
    let region = "";
    let country = "";
    try {
      const geoResponse = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(2500),
        cache: "no-store"
      });
      if (geoResponse.ok) {
        const geo = await geoResponse.json();
        if (!geo.error) {
          city = typeof geo.city === "string" && geo.city ? geo.city : city;
          region = typeof geo.region === "string" ? geo.region : "";
          country = typeof geo.country_name === "string" ? geo.country_name : "";
        }
      }
    } catch (_) {
      // Tetap simpan riwayat walau layanan lokasi sedang tidak tersedia.
    }

    const now = new Date();
    const timestamp = now.toISOString();
    const time = new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      dateStyle: "short",
      timeStyle: "medium",
      hour12: false
    }).format(now) + " WIB";
    const id = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
    const record = {
      id,
      ip,
      city,
      region,
      country,
      location: [city, region, country].filter(Boolean).join(", "),
      timestamp,
      time
    };

    // Satu pipeline untuk memperbarui total dan menyimpan 500 riwayat terbaru.
    const commands = [
      ["INCR", "surat:total_dibuat"],
      ["LPUSH", "surat:riwayat:terbaru", JSON.stringify(record)],
      ["LTRIM", "surat:riwayat:terbaru", "0", "499"],
      ["SADD", "surat:ip_unik_hashes", ipHash]
    ];
    const response = await fetch(`${baseUrl}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(commands),
      cache: "no-store"
    });
    const rows = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(rows) || rows.length !== commands.length || rows.some(row => !row || row.error)) {
      throw new Error("Gagal menyimpan riwayat surat ke Upstash.");
    }

    const total = Number(rows[0].result);
    if (!Number.isSafeInteger(total) || total < 1) throw new Error("Total surat tidak valid.");
    return res.status(200).json({ success: true, total });
  } catch (error) {
    console.error("Gagal mencatat pembuatan surat:", error);
    return res.status(502).json({ success: false, error: "Gagal menyimpan pembuatan surat." });
  }
};
