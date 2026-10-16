
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return res.status(500).json({
      error: "Environment Variables belum lengkap"
    });
  }

  try {
    // Tes koneksi tanpa menambah jumlah kunjungan
    if (req.method === "GET") {
      const check = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(["PING"])
      });

      const result = await check.json();

      if (!check.ok || result.result !== "PONG") {
        throw new Error("Koneksi Redis gagal");
      }

      return res.status(200).json({
        status: "ok",
        redis: "connected"
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([
        "INCR",
        "kalkulator:total_kunjungan"
      ])
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error("Permintaan Redis gagal");
    }

    const total = Number(data.result);

    if (!Number.isSafeInteger(total) || total < 1) {
      throw new Error("Respons Redis tidak valid");
    }

    return res.status(200).json({ total });
  } catch (error) {
    console.error("Upstash Redis error:", error);

    return res.status(500).json({
      error: "Koneksi atau permintaan Redis gagal"
    });
  }
};
