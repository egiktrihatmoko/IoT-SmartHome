
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

  const baseUrl = url.replace(/\/+$/, "");

  // GET: membaca total surat tanpa menambah hitungan.
  if (req.method === "GET") {
    try {
      const response = await fetch(
        `${baseUrl}/get/surat:total_dibuat`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`
          },
          cache: "no-store"
        }
      );

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || "Gagal membaca total surat.");
      }

      const total = Number(data.result || 0);

      if (!Number.isSafeInteger(total) || total < 0) {
        throw new Error("Data total surat tidak valid.");
      }

      return res.status(200).json({
        success: true,
        total
      });
    } catch (error) {
      console.error("Gagal membaca total surat:", error);

      return res.status(502).json({
        success: false,
        error: "Gagal mengambil total surat."
      });
    }
  }

  // POST: menambah total surat yang berhasil dibuat.
  try {
    const response = await fetch(
      `${baseUrl}/incr/surat:total_dibuat`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      }
    );

    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error || "Gagal menambah total surat.");
    }

    const total = Number(data.result);

    if (!Number.isSafeInteger(total) || total < 1) {
      throw new Error("Data total surat tidak valid.");
    }

    return res.status(200).json({
      success: true,
      total
    });
  } catch (error) {
    console.error("Gagal menambah total surat:", error);

    return res.status(502).json({
      success: false,
      error: "Gagal menyimpan total surat."
    });
  }
};
