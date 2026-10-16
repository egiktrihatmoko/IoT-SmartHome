
module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

    // Pastikan environment variable tersedia di Vercel.
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        return res.status(500).json({
            error: "Environment variable Upstash belum diatur di Vercel."
        });
    }

    // GET hanya mengetes koneksi, tidak menambah kunjungan.
    // POST menambah total kunjungan global.
    if (req.method !== "GET" && req.method !== "POST") {
        res.setHeader("Allow", "GET, POST");
        return res.status(405).json({
            error: "Method tidak diizinkan."
        });
    }

    try {
        const command = req.method === "GET"
            ? ["PING"]
            : ["INCR", "kalkulator:total_kunjungan"];

        const response = await fetch(
            url.replace(/\/+$/, ""),
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(command),
                cache: "no-store"
            }
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok || data.error) {
            console.error("Upstash Redis error:", data.error || response.status);

            return res.status(502).json({
                error: "Perintah Redis gagal dijalankan.",
                detail: data.error || `HTTP ${response.status}`
            });
        }

        if (req.method === "GET") {
            return res.status(200).json({
                status: "ok",
                redis: "connected"
            });
        }

        const total = Number(data.result);

        if (!Number.isSafeInteger(total) || total < 1) {
            return res.status(502).json({
                error: "Redis tidak mengembalikan total kunjungan yang valid."
            });
        }

        return res.status(200).json({ total });

    } catch (error) {
        console.error("Kesalahan API kunjungan:", error);

        return res.status(500).json({
            error: "Koneksi ke Redis gagal.",
            detail: error.message
        });
    }
};
