
const crypto = require("crypto");

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).send(
            "Method tidak diizinkan."
        );
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri =
        process.env.GOOGLE_USER_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        console.error("USER_GOOGLE_START_CONFIG_MISSING");

        return res.status(500).send(
            "Konfigurasi Google OAuth user belum lengkap."
        );
    }

    try {
        // Buat state acak untuk mencegah CSRF.
        const state = crypto.randomBytes(32).toString("hex");

        // Cookie khusus login Google user.
        // Tidak menggunakan cookie state milik admin.
        res.setHeader(
            "Set-Cookie",
            `google_user_oauth_state=${state}; Path=/api/admin/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
        );

        // Buat URL autentikasi Google.
        const googleUrl = new URL(
            "https://accounts.google.com/o/oauth2/v2/auth"
        );

        googleUrl.searchParams.set(
            "client_id",
            clientId
        );

        googleUrl.searchParams.set(
            "redirect_uri",
            redirectUri
        );

        googleUrl.searchParams.set(
            "response_type",
            "code"
        );

        googleUrl.searchParams.set(
            "scope",
            "openid email profile"
        );

        googleUrl.searchParams.set(
            "state",
            state
        );

        googleUrl.searchParams.set(
            "prompt",
            "select_account"
        );

        // Arahkan pengguna ke halaman autentikasi Google.
        return res.redirect(
            302,
            googleUrl.toString()
        );

    } catch (error) {
        console.error(
            "USER_GOOGLE_START_ERROR:",
            error.message
        );

        return res.status(500).send(
            "Gagal memulai login Google user."
        );
    }
};
