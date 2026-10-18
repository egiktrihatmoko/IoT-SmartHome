
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

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
        let body = req.body || {};

        if (typeof body === "string") {
            body = JSON.parse(body);
        }

        const email = typeof body.email === "string"
            ? body.email.trim().toLowerCase()
            : "";

        const password = typeof body.password === "string"
            ? body.password
            : "";

        if (!email || !password || password.length > 128) {
            return res.status(400).json({
                success: false,
                message: "Email dan password wajib diisi."
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
                `user_account:${email}`
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
                message: "Email atau password salah."
            });
        }

        const user = JSON.parse(data.result);

        if (
            user.role !== "user" ||
            typeof user.passwordHash !== "string" ||
            !(await bcrypt.compare(password, user.passwordHash))
        ) {
            return res.status(401).json({
                success: false,
                message: "Email atau password salah."
            });
        }

        const sessionToken = crypto.randomBytes(32).toString("hex");
        const sessionKey = `user_session:${sessionToken}`;

        const session = JSON.stringify({
            email: user.email,
            role: "user",
            createdAt: new Date().toISOString()
        });

        const saveResponse = await fetch(redisUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify([
                "SET",
                sessionKey,
                session,
                "EX",
                "86400"
            ]),
            cache: "no-store"
        });

        const saveData = await saveResponse.json();

        if (
            !saveResponse.ok ||
            saveData.error ||
            saveData.result !== "OK"
        ) {
            throw new Error("Gagal membuat sesi user");
        }

        res.setHeader(
            "Set-Cookie",
            `user_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
        );

        return res.status(200).json({
            success: true,
            message: "Login berhasil.",
            user: {
                email: user.email,
                role: "user"
            }
        });

    } catch (error) {
        console.error("USER_LOGIN_ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Terjadi kesalahan server saat login."
        });
    }
};
