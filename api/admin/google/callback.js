
const crypto = require("crypto");

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

    try {
        if (!stateMatch || !returnedState) {
            res.setHeader("Set-Cookie", clearStateCookie);
            return redirectError("google_login_failed");
        }

        const expectedState = Buffer.from(stateMatch[1]);
        const actualState = Buffer.from(returnedState);

        if (
            expectedState.length !== actualState.length ||
            !crypto.timingSafeEqual(expectedState, actualState)
        ) {
            res.setHeader("Set-Cookie", clearStateCookie);
            return redirectError("google_login_failed");
        }

        res.setHeader("Set-Cookie", clearStateCookie);

        if (req.query.error || typeof req.query.code !== "string") {
            return redirectError("google_login_failed");
        }

        // Tukarkan authorization code dengan token Google.
        const tokenResponse = await fetch(
            "https://oauth2.googleapis.com/token",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
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
            console.error("GOOGLE_TOKEN_EXCHANGE_FAILED");
            return redirectError("google_login_failed");
        }

        // Ambil identitas dari endpoint resmi Google.
        const profileResponse = await fetch(
            "https://openidconnect.googleapis.com/v1/userinfo",
            {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`
                },
                cache: "no-store"
            }
        );

        const profile = await profileResponse.json();

        if (
            !profileResponse.ok ||
            typeof profile.email !== "string" ||
            profile.email_verified !== true
        ) {
            console.error("GOOGLE_PROFILE_INVALID");
            return redirectError("google_login_failed");
        }

        const email = profile.email.trim().toLowerCase();
        const normalizedRedisUrl = redisUrl.replace(/\/+$/, "");

        // Hanya izinkan email yang sudah terdaftar sebagai admin.
        const userResponse = await fetch(normalizedRedisUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${redisToken}`,
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
            throw new Error("Redis GET admin gagal");
        }

        if (!userData.result) {
            return redirectError("google_not_authorized");
        }

        const user = JSON.parse(userData.result);

        if (
            user.role !== "admin" ||
            typeof user.email !== "string" ||
            user.email.trim().toLowerCase() !== email
        ) {
            return redirectError("google_not_authorized");
        }

        // Format sesi sama dengan login email/password.
        const sessionToken = crypto.randomBytes(32).toString("hex");

        const session = JSON.stringify({
            email: user.email,
            role: "admin",
            createdAt: new Date().toISOString()
        });

        const sessionResponse = await fetch(normalizedRedisUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${redisToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify([
                "SET",
                `admin_session:${sessionToken}`,
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
            throw new Error("Gagal membuat sesi admin");
        }

        res.setHeader(
            "Set-Cookie",
            `admin_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
        );

        return res.redirect(302, "/dashboard.html");

    } catch (error) {
        console.error("GOOGLE_CALLBACK_ERROR:", error);
        return redirectError("google_login_failed");
    }
};
