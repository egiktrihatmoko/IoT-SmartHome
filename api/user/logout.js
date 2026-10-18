
module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({
            success: false,
            message: "Method tidak diizinkan."
        });
    }

    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        return res.status(500).json({
            success: false,
            message: "Konfigurasi database belum lengkap."
        });
    }

    try {
        const cookie = req.headers.cookie || "";
        const match = cookie.match(
            /(?:^|;\s*)user_session=([a-f0-9]{64})(?:;|$)/
        );

        if (match) {
            const redisUrl = url.replace(/\/+$/, "");

            const response = await fetch(redisUrl, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify([
                    "DEL",
                    `user_session:${match[1]}`
                ]),
                cache: "no-store"
            });

            const data = await response.json();

            if (!response.ok || data.error) {
                throw new Error("Redis DEL gagal");
            }
        }

        res.setHeader(
            "Set-Cookie",
            "user_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
        );

        return res.status(200).json({
            success: true,
            message: "Logout berhasil."
        });
    } catch (error) {
        console.error("USER_LOGOUT_ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Logout gagal karena kesalahan server."
        });
    }
};
