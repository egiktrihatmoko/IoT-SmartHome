
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({
            success: false,
            message: "Metode tidak diizinkan."
        });
    }

    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!redisUrl || !redisToken) {
        console.error("USER_LOGIN_ERROR: Konfigurasi Redis belum lengkap.");

        return res.status(500).json({
            success: false,
            message: "Konfigurasi database belum lengkap."
        });
    }

    try {
        let body = req.body || {};

        if (typeof body === "string") {
            try {
                body = JSON.parse(body);
            } catch {
                return res.status(400).json({
                    success: false,
                    message: "Format permintaan tidak valid."
                });
            }
        }

        const email = typeof body.email === "string"
            ? body.email.trim().toLowerCase()
            : "";

        const password = typeof body.password === "string"
            ? body.password
            : "";

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email dan password wajib diisi."
            });
        }

        const redisEndpoint = redisUrl.replace(/\/+$/, "");

        async function redisCommand(command) {
            const response = await fetch(redisEndpoint, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${redisToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(command),
                cache: "no-store"
            });

            const result = await response.json();

            if (!response.ok || result.error) {
                console.error(
                    "USER_LOGIN_REDIS_ERROR:",
                    response.status,
                    result.error || "Permintaan Redis gagal"
                );
                throw new Error("DATABASE_ERROR");
            }

            return result.result;
        }

        const savedUser = await redisCommand([
            "GET",
            `user_account:${email}`
        ]);

        if (!savedUser) {
            return res.status(401).json({
                success: false,
                message: "Email atau password salah."
            });
        }

        let user;

        try {
            user = JSON.parse(savedUser);
        } catch {
            console.error("USER_LOGIN_ERROR: Data akun tidak valid.");

            return res.status(500).json({
                success: false,
                message: "Data akun tidak valid. Periksa data pendaftaran."
            });
        }

        if (
            !user ||
            user.role !== "user" ||
            typeof user.passwordHash !== "string"
        ) {
            console.error("USER_LOGIN_ERROR: Format akun tidak sesuai.");

            return res.status(500).json({
                success: false,
                message: "Format akun tidak sesuai. Periksa API pendaftaran."
            });
        }

        const passwordMatch = await bcrypt.compare(
            password,
            user.passwordHash
        );

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: "Email atau password salah."
            });
        }

        const sessionToken = crypto.randomBytes(32).toString("hex");

        const session = JSON.stringify({
            email: user.email || email,
            role: "user",
            createdAt: new Date().toISOString()
        });

        await redisCommand([
            "SET",
            `user_session:${sessionToken}`,
            session,
            "EX",
            "86400"
        ]);

        res.setHeader(
            "Set-Cookie",
            `user_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
        );

        return res.status(200).json({
            success: true,
            message: "Login berhasil.",
            user: {
                email: user.email || email,
                role: "user"
            }
        });

    } catch (error) {
        console.error("USER_LOGIN_ERROR:", error.message);

        return res.status(500).json({
            success: false,
            message: error.message === "DATABASE_ERROR"
                ? "Database sedang bermasalah. Silakan coba lagi."
                : "Terjadi kesalahan server saat login."
        });
    }
};
                  
