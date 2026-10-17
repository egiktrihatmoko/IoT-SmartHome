
module.exports = async function handler(req, res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return res.status(500).json({
      success: false,
      error: "Environment variable Upstash belum diatur di Vercel."
    });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");

    return res.status(405).json({
      success: false,
      error: "Metode tidak diizinkan."
    });
  }

  // GET hanya memeriksa koneksi, tidak menghitung kunjungan.
  if (req.method === "GET") {
    try {
      const response = await fetch(
        url.replace(/\/+$/, ""),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(["PING"]),
          cache: "no-store"
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.error) {
        throw new Error(data.error || "Ping Redis gagal.");
      }

      return res.status(200).json({
        success: true,
        status: "ok",
        redis: "connected"
      });
    } catch (error) {
      console.error("Pemeriksaan Redis gagal:", error);

      return res.status(502).json({
        success: false,
        error: "Koneksi ke Redis gagal."
      });
    }
  }

  try {
    // Mengambil tanggal berdasarkan zona waktu Indonesia (WIB).
    const dateParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());

    const dateValues = {};

    for (const part of dateParts) {
      if (part.type !== "literal") {
        dateValues[part.type] = part.value;
      }
    }

    const todayDate =
      `${dateValues.year}-${dateValues.month}-${dateValues.day}`;

    const dailyKey =
      `kalkulator:kunjungan_harian:${todayDate}`;

    const baseUrl = url.replace(/\/+$/, "");

    // Tambahkan total lama dan total harian.
    // Kunci total global TIDAK direset.
    const response = await fetch(`${baseUrl}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([
        ["INCR", "kalkulator:total_kunjungan"],
        ["INCR", dailyKey]
      ]),
      cache: "no-store"
    });

    const rows = await response.json().catch(() => null);

    if (
      !response.ok ||
      !Array.isArray(rows) ||
      rows.length !== 2 ||
      rows.some(row => !row || row.error)
    ) {
      console.error("Redis visit pipeline gagal:", rows);

      return res.status(502).json({
        success: false,
        error: "Gagal menyimpan data kunjungan."
      });
    }

    const total = Number(rows[0].result);
    const today = Number(rows[1].result);

    if (
      !Number.isSafeInteger(total) ||
      !Number.isSafeInteger(today) ||
      total < 1 ||
      today < 1
    ) {
      return res.status(502).json({
        success: false,
        error: "Redis mengembalikan data kunjungan yang tidak valid."
      });
    }

    return res.status(200).json({
      success: true,
      total,
      today,
      todayDate
    });

  } catch (error) {
    console.error("Kesalahan API kunjungan:", error);

    return res.status(500).json({
      success: false,
      error: "Koneksi atau penyimpanan kunjungan gagal."
    });
  }
};
