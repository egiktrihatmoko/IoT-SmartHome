
const bcrypt = require("bcryptjs");

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
        if (typeof body === "string") body = JSON.parse(body);

        const email = typeof body.email === "string"
            ? body.email.trim().toLowerCase()
            : "";
        const password = typeof body.password === "string"
            ? body.password
            : "";

        if (
            !email ||
            email.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ) {
            return res.status(400).json({
                success: false,
                message: "Format email tidak valid."
            });
        }

        if (password.length < 12 || password.length > 128) {
            return res.status(400).json({
                success: false,
                message: "Password harus terdiri dari 12 sampai 128 karakter."
            });
        }

        const redisUrl = url.replace(/\/+$/, "");
        const passwordHash = await bcrypt.hash(password, 12);

        const user = {
            email,
            passwordHash,
            role: "user",
            createdAt: new Date().toISOString()
        };

        const response = await fetch(redisUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify([
                "SET",
                `user_account:${email}`,
                JSON.stringify(user),
                "NX"
            ]),
            cache: "no-store"
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error("Redis SET gagal");
        }

        if (data.result !== "OK") {
            return res.status(409).json({
                success: false,
                message: "Email sudah terdaftar."
            });
        }

        return res.status(201).json({
            success: true,
            message: "Pendaftaran berhasil. Silakan login.",
            user: { email, role: "user" }
        });
    } catch (error) {
        console.error("USER_REGISTER_ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Pendaftaran gagal karena kesalahan server."
        });
    }
};
      
