
const crypto = require("crypto");

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).send("Method tidak diizinkan.");
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        return res.status(500).send(
            "Konfigurasi Google OAuth belum lengkap."
        );
    }

    try {
        const state = crypto.randomBytes(32).toString("hex");

        res.setHeader("Set-Cookie",
            `google_oauth_state=${state}; Path=/api/admin/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
        );

        const googleUrl = new URL(
            "https://accounts.google.com/o/oauth2/v2/auth"
        );

        googleUrl.searchParams.set("client_id", clientId);
        googleUrl.searchParams.set("redirect_uri", redirectUri);
        googleUrl.searchParams.set("response_type", "code");
        googleUrl.searchParams.set(
            "scope",
            "openid email profile"
        );
        googleUrl.searchParams.set("state", state);
        googleUrl.searchParams.set("prompt", "select_account");

        return res.redirect(302, googleUrl.toString());
    } catch (error) {
        console.error("GOOGLE_START_ERROR:", error);
        return res.status(500).send(
            "Gagal memulai login Google."
        );
    }
};
