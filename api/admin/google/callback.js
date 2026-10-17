
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    function redirectError(type) {
        return res.redirect(
            302,
            `/admin.html?error=${encodeURIComponent(type)}`
        );
    }

    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).send(
            "Method tidak diizinkan."
        );
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (
        !clientId ||
        !clientSecret ||
        !redirectUri ||
        !redisUrl ||
        !redisToken
    ) {
        console.error("GOOGLE_CALLBACK_CONFIG_MISSING");
        return res.status(500).send(
            "Konfigurasi login belum lengkap."
        );
    }

    const cookieHeader = req.headers.cookie || "";

    const stateMatch = cookieHeader.match(
        /(?:^|;\s*)google_oauth_state=([a-f0-9]{64})(?:;|$)/
    );

    const returnedState =
        typeof req.query.state === "string"
            ? req.query.state
            : "";

    const clearStateCookie =
        "google_oauth_state=; Path=/api/admin/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0";

    const normalizedRedisUrl = redisUrl.replace(/\/+$/, "");

    async function redisCommand(command) {
        const response = await fetch(normalizedRedisUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${redisToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(command),
            cache: "no-store"
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            throw new Error("Operasi Redis gagal");
        }

        return data.result;
    }

    try {
        // 1. Validasi OAuth state.
        if (!stateMatch || !returnedState) {
            res.setHeader("Set-Cookie", clearStateCookie);
            return redirectError("google_login_failed");
        }

        const expectedState = Buffer.from(stateMatch[1]);
        const actualState = Buffer.from(returnedState);

        if (
            expectedState.length !== actualState.length ||
            !crypto.timingSafeEqual(
                expectedState,
                actualState
            )
        ) {
            res.setHeader("Set-Cookie", clearStateCookie);
            return redirectError("google_login_failed");
        }

        res.setHeader("Set-Cookie", clearStateCookie);

        if (
            req.query.error ||
            typeof req.query.code !== "string"
        ) {
            return redirectError("google_login_failed");
        }

        // 2. Tukarkan authorization code dengan token Google.
        const tokenResponse = await fetch(
            "https://oauth2.googleapis.com/token",
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded"
                },
                body: new URLSearchParams({
                    code: req.query.code,
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: redirectUri,
                    grant_type: "authorization_code"
                }),
                cache: "no-store"
            }
        );

        const tokenData = await tokenResponse.json();

        if (
            !tokenResponse.ok ||
            typeof tokenData.access_token !== "string"
        ) {
            throw new Error("Google token exchange gagal");
        }

        // 3. Ambil profil dari endpoint resmi Google.
        const profileResponse = await fetch(
            "https://openidconnect.googleapis.com/v1/userinfo",
            {
                headers: {
                    Authorization:
                        `Bearer ${tokenData.access_token}`
                },
                cache: "no-store"
            }
        );

        const profile = await profileResponse.json();

        if (
            !profileResponse.ok ||
            typeof profile.email !== "string" ||
            profile.email_verified !== true ||
            typeof profile.sub !== "string"
        ) {
            throw new Error("Profil Google tidak valid");
        }

        const email = profile.email.trim().toLowerCase();

        if (!email) {
            throw new Error("Email Google kosong");
        }

        // 4. Cari akun di Redis.
        const userKey = `admin_user:${email}`;
        const existingData = await redisCommand([
            "GET",
            userKey
        ]);

        let user;

        if (existingData) {
            try {
                user = JSON.parse(existingData);
            } catch {
                throw new Error("Data akun Redis tidak valid");
            }

            if (
                !user ||
                typeof user !== "object" ||
                (
                    typeof user.email === "string" &&
                    user.email.trim().toLowerCase() !== email
                )
            ) {
                throw new Error("Data akun tidak cocok");
            }

            // Sesuai permintaan: akun Google diberi role admin.
            user.email = email;
            user.role = "admin";
            user.googleSub = profile.sub;
            user.authProvider = "google";

            if (typeof user.passwordHash !== "string") {
                user.passwordHash = await bcrypt.hash(
                    crypto.randomBytes(48).toString("hex"),
                    12
                );
            }
        } else {
            // 5. Daftarkan akun Google baru secara otomatis.
            // Password acak tidak diketahui oleh pengguna.
            const randomPassword =
                crypto.randomBytes(48).toString("hex");

            const passwordHash = await bcrypt.hash(
                randomPassword,
                12
            );

            user = {
                email,
                passwordHash,
                role: "admin",
                googleSub: profile.sub,
                authProvider: "google",
                createdAt: new Date().toISOString()
            };
        }

        // Simpan akun ke Redis.
        await redisCommand([
            "SET",
            userKey,
            JSON.stringify(user)
        ]);

        // 6. Buat sesi admin selama 24 jam.
        const sessionToken = crypto
            .randomBytes(32)
            .toString("hex");

        const session = JSON.stringify({
            email,
            role: "admin",
            createdAt: new Date().toISOString()
        });

        await redisCommand([
            "SET",
            `admin_session:${sessionToken}`,
            session,
            "EX",
            "86400"
        ]);

        // Hapus cookie OAuth dan pasang cookie sesi.
        res.setHeader("Set-Cookie", [
            clearStateCookie,
            `admin_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
        ]);

        // 7. Masuk ke dashboard.
        return res.redirect(302, "/dashboard.html");

    } catch (error) {
        console.error(
            "GOOGLE_CALLBACK_ERROR:",
            error.message
        );

        return redirectError("google_login_failed");
    }
};
