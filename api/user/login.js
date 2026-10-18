
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

        const email =
            typeof body.email === "string"
                ? body.email.trim().toLowerCase()
                : "";

        const password =
            typeof body.password === "string"
                ? body.password
                : "";

        if (!email || !password || password.length > 128) {
            return res.status(400).json({
                success: false,
                message: "Email dan password wajib diisi."
            });
        }

        const redisUrl = url.replace(/\/+$/, "");

        // Ambil data akun dari Redis
        const userResponse = await fetch(redisUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify([
                "GET",
                `admin_user:${email}`
            ]),
            cache: "no-store"
        });

        const userData = await userResponse.json();

        if (!userResponse.ok || userData.error) {
            throw new Error("Redis GET gagal");
        }

        if (!userData.result) {
            return res.status(401).json({
                success: false,
                message: "Email atau password salah."
            });
        }

        const user = JSON.parse(userData.result);

        const passwordValid = await bcrypt.compare(
            password,
            user.passwordHash
        );

        if (!passwordValid || user.role !== "admin") {
            return res.status(401).json({
                success: false,
                message: "Email atau password salah."
            });
        }

        // Buat token sesi acak yang sulit ditebak
        const sessionToken = crypto.randomBytes(32).toString("hex");
        const sessionKey = `admin_session:${sessionToken}`;

        // Sesi berlaku 24 jam
        const session = JSON.stringify({
            email: user.email,
            role: "admin",
            createdAt: new Date().toISOString()
        });

        const sessionResponse = await fetch(redisUrl, {
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

        const sessionData = await sessionResponse.json();

        if (
            !sessionResponse.ok ||
            sessionData.error ||
            sessionData.result !== "OK"
        ) {
            throw new Error("Gagal membuat sesi");
        }

        // Cookie tidak bisa dibaca JavaScript browser
        res.setHeader(
            "Set-Cookie",
            `admin_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
        );

        return res.status(200).json({
            success: true,
            message: "Login berhasil.",
            user: {
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error("ADMIN_LOGIN_ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Terjadi kesalahan server saat login."
        });
    }
};
