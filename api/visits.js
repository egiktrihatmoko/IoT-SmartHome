

module.exports = async function handler(req, res) {
    res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
    );

    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");

        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        return res.status(500).json({
            error: "Konfigurasi Redis belum lengkap"
        });
    }

    try {
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

        if (!response.ok) {
            throw new Error("Redis request gagal");
        }

        const data = await response.json();

        if (data.error || !Number.isSafeInteger(Number(data.result))) {
            throw new Error("Respons Redis tidak valid");
        }

        return res.status(200).json({
            total: Number(data.result)
        });

    } catch (error) {
        console.error("Upstash Redis error:", error);

        return res.status(500).json({
            error: "Gagal memperbarui total kunjungan"
        });
    }
};
