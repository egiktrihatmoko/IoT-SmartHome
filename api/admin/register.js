
const bcrypt = require("bcryptjs");

module.exports = async function handler(req, res) {
    res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
    );

    // Hanya menerima POST dari formulir pendaftaran
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");

        return res.status(405).json({
            success: false,
            message: "Method tidak diizinkan."
        });
    }

    // Mengambil konfigurasi Redis dari Vercel
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        console.error("Environment variable Upstash belum lengkap.");

        return res.status(500).json({
            success: false,
            message: "Konfigurasi database belum lengkap."
        });
    }

    try {
        // Membaca data dari formulir
        let body = req.body || {};

        if (typeof body === "string") {
            body = JSON.parse(body);
        }

        const email = body.email;
        const password = body.password;

        if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                message: "Email dan password wajib diisi."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Validasi email
        if (
            normalizedEmail.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
        ) {
            return res.status(400).json({
                success: false,
                message: "Format email tidak valid."
            });
        }

        // Validasi password
        if (password.length < 12 || password.length > 128) {
            return res.status(400).json({
                success: false,
                message: "Password harus terdiri dari 12 sampai 128 karakter."
            });
        }

        const redisUrl = url.replace(/\/+$/, "");
        const userKey = `admin_user:${normalizedEmail}`;

        // Hash password sebelum disimpan
        const passwordHash = await bcrypt.hash(password, 12);

        const user = {
            email: normalizedEmail,
            passwordHash: passwordHash,
            role: "admin",
            createdAt: new Date().toISOString()
        };

        // Simpan akun secara atomik.
        // NX mencegah email yang sudah ada ditimpa.
        const saveResponse = await fetch(redisUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify([
                "SET",
                userKey,
                JSON.stringify(user),
                "NX"
            ]),
            cache: "no-store"
        });

        const saveData = await saveResponse.json().catch(() => ({}));

        if (!saveResponse.ok || saveData.error) {
            console.error(
                "Upstash SET error:",
                saveData.error || `HTTP ${saveResponse.status}`
            );

            return res.status(502).json({
                success: false,
                message: "Gagal menyimpan akun ke database."
            });
        }

        if (saveData.result !== "OK") {
            return res.status(409).json({
                success: false,
                message: "Email sudah terdaftar."
            });
        }

        // Pendaftaran berhasil
        return res.status(201).json({
            success: true,
            message: "Pendaftaran berhasil. Silakan login.",
            user: {
                email: normalizedEmail,
                role: "admin"
            }
        });

    } catch (error) {
        console.error("REGISTER_API_ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Pendaftaran gagal karena kesalahan server."
        });
    }
};
