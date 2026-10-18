
module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
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

        if (!match) {
            return res.status(401).json({
                success: false,
                message: "Belum login."
            });
        }

        const redisUrl = url.replace(/\/+$/, "");

        const response = await fetch(redisUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify([
                "GET",
                `user_session:${match[1]}`
            ]),
            cache: "no-store"
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error("Redis GET gagal");
        }

        if (!data.result) {
            return res.status(401).json({
                success: false,
                message: "Sesi login sudah berakhir."
            });
        }

        const session = JSON.parse(data.result);

        if (
            session.role !== "user" ||
            typeof session.email !== "string"
        ) {
            return res.status(401).json({
                success: false,
                message: "Sesi tidak valid."
            });
        }

        return res.status(200).json({
            success: true,
            user: {
                email: session.email,
                role: "user"
            }
        });
    } catch (error) {
        console.error("USER_CHECK_ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Gagal memeriksa sesi login."
        });
    }
};
              
