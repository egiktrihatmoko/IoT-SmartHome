
const crypto = require("crypto");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Metode tidak diizinkan.");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    return res.status(500).send("GOOGLE_CLIENT_ID belum diatur.");
  }

  const state = crypto.randomBytes(32).toString("hex");

  const cookieOptions = [
    `google_auth_state=${state}`,
    "Path=/api/admin/google",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=600",
  ];

  res.setHeader("Set-Cookie", cookieOptions.join("; "));

  const redirectUri = process.env.GOOGLE_USER_REDIRECT_URI;

  if (!redirectUri) {
    return res.status(500).send(
      "GOOGLE_USER_REDIRECT_URI belum diatur."
    );
  }

  const googleUrl = new URL(
    "https://accounts.google.com/o/oauth2/v2/auth"
  );

  googleUrl.searchParams.set("client_id", clientId);
  googleUrl.searchParams.set("redirect_uri", redirectUri);
  googleUrl.searchParams.set("response_type", "code");
  googleUrl.searchParams.set("scope", "openid email profile");
  googleUrl.searchParams.set("state", state);
  googleUrl.searchParams.set("prompt", "select_account");

  return res.redirect(302, googleUrl.toString());
};
