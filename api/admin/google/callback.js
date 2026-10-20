
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    function redirectError(type) {
        return res.redirect(
            302,
            `/login.html?error=${encodeURIComponent(type)}`
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
    const redirectUri =
        process.env.GOOGLE_USER_REDIRECT_URI;
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (
        !clientId ||
        !clientSecret ||
        !redirectUri ||
        !redisUrl ||
        !redisToken
    ) {
        console.error("USER_GOOGLE_CALLBACK_CONFIG_MISSING");

        return res.status(500).send(
            "Konfigurasi login Google user belum lengkap."
        );
    }

    const cookieHeader = req.headers.cookie || "";

    const stateMatch = cookieHeader.match(
        /(?:^|;\s*)google_user_oauth_state=([a-f0-9]{64})(?:;|$)/
    );

    const returnedState =
        typeof req.query.state === "string"
            ? req.query.state
            : "";

    const clearStateCookie =
        "google_user_oauth_state=; Path=/api/admin/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0";

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

        // 2. Validasi respons Google.
        if (
            req.query.error ||
            typeof req.query.code !== "string"
        ) {
            return redirectError("google_login_failed");
        }

        // 3. Tukarkan authorization code dengan token.
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

        // 4. Ambil profil Google.
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

        const nama =
            typeof profile.name === "string" &&
            profile.name.trim()
                ? profile.name.trim()
                : email.split("@")[0];

        const foto =
            typeof profile.picture === "string" &&
            /^https:\/\//i.test(profile.picture)
                ? profile.picture
                : null;

        // 5. Cari akun user di Redis.
        // Sesuaikan prefix dengan API registrasi user kamu.
        const userKey = `user:${email}`;

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
                Array.isArray(user) ||
                (
                    typeof user.email === "string" &&
                    user.email.trim().toLowerCase() !== email
                )
            ) {
                throw new Error("Data akun tidak cocok");
            }

            // Jangan izinkan akun admin masuk lewat callback user.
            if (user.role === "admin") {
                return redirectError("account_conflict");
            }

            // Tolak jika akun sudah terhubung ke Google berbeda.
            if (
                user.googleSub &&
                user.googleSub !== profile.sub
            ) {
                return redirectError("account_conflict");
            }

            user.email = email;
            user.nama = nama;
            user.role = "user";
            user.googleSub = profile.sub;
            user.authProvider = "google";

            if (foto) {
                user.foto = foto;
                user.picture = foto;
            } else {
                user.foto = user.foto || null;
                user.picture = user.picture || user.foto;
            }

            // Jangan mengubah password akun lama.
            if (typeof user.passwordHash !== "string") {
                user.passwordHash = await bcrypt.hash(
                    crypto.randomBytes(48).toString("hex"),
                    12
                );
            }

            user.updatedAt = new Date().toISOString();

        } else {
            // 6. Buat akun user baru.
            const randomPassword =
                crypto.randomBytes(48).toString("hex");

            const passwordHash = await bcrypt.hash(
                randomPassword,
                12
            );

            user = {
                email,
                nama,
                foto,
                picture: foto,
                passwordHash,
                role: "user",
                googleSub: profile.sub,
                authProvider: "google",
                createdAt: new Date().toISOString()
            };
        }

        // 7. Simpan akun ke Redis.
        await redisCommand([
            "SET",
            userKey,
            JSON.stringify(user)
        ]);

        // 8. Buat sesi user selama 24 jam.
        const sessionToken = crypto
            .randomBytes(32)
            .toString("hex");

        const session = JSON.stringify({
            email,
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

        // 9. Pasang cookie sesi khusus user.
        res.setHeader("Set-Cookie", [
            clearStateCookie,
            `user_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
        ]);

        // 10. Arahkan ke dashboard user.
        return res.redirect(
            302,
            "/dashboard-user.html"
        );

    } catch (error) {
        console.error(
            "USER_GOOGLE_CALLBACK_ERROR:",
            error.message
        );

        return redirectError("google_login_failed");
    }
};
