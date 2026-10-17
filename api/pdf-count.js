
export default async function handler(req, res) {
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    const key = "gabungpdf:total_berhasil";

    if (!redisUrl || !redisToken) {
        return res.status(500).json({
            error: "Konfigurasi Redis belum tersedia"
        });
    }

    if (req.method !== "GET" && req.method !== "POST") {
        res.setHeader("Allow", "GET, POST");
        return res.status(405).json({
            error: "Method tidak diizinkan"
        });
    }

    try {
        const command = req.method === "POST" ? "incr" : "get";

        const response = await fetch(
            `${redisUrl.replace(/\/+$/, "")}/${command}/${encodeURIComponent(key)}`,
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${redisToken}`
                },
                cache: "no-store"
            }
        );

        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error("Gagal mengakses Redis");
        }

        return res.status(200).json({
            total: Number(data.result) || 0
        });
    } catch (error) {
        console.error("PDF counter error:", error);

        return res.status(500).json({
            error: "Gagal memperbarui total PDF"
        });
    }
}
