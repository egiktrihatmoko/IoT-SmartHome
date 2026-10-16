
module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({
            success: false,
            message: "Method tidak diizinkan."
        });
    }

    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!redisUrl || !redisToken) {
        return res.status(500).json({
            success: false,
            message: "Konfigurasi database belum lengkap."
        });
    }

    const cookies = req.headers.cookie || "";
    const match = cookies.match(
        /(?:^|;\s*)admin_session=([a-f0-9]{64})(?:;|$)/
    );

    try {
        if (match) {
            const sessionKey = `admin_session:${match[1]}`;

            const response = await fetch(
                redisUrl.replace(/\/+$/, ""),
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${redisToken}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(["DEL", sessionKey]),
                    cache: "no-store"
                }
            );

            const result = await response.json();

            if (!response.ok || result.error) {
                throw new Error("Gagal menghapus sesi Redis");
            }
        }

        res.setHeader("Set-Cookie",
            "admin_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
        );

        return res.status(200).json({
            success: true,
            message: "Logout berhasil."
        });
    } catch (error) {
        console.error("ADMIN_LOGOUT_ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Logout gagal. Silakan coba lagi."
        });
    }
};
