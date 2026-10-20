
const crypto = require("crypto");

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const SESSION_DURATION = 86400;

async function redisCommand(...command) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error("Konfigurasi Redis belum tersedia.");
  }

  const response = await fetch(REDIS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error("Perintah Redis gagal.");
  }

  return data.result;
}

function getCookie(req, name) {
  const cookies = (req.headers.cookie || "").split(";");

  const item = cookies
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`));

  return item ? item.substring(name.length + 1) : null;
}

function parseAccount(value) {
  if (!value) return null;

  return typeof value === "string" ? JSON.parse(value) : value;
}

function clearStateCookie() {
  return [
    "google_auth_state=",
    "Path=/api/admin/google",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

function redirectError(res, message) {
  res.setHeader("Set-Cookie", clearStateCookie());

  return res.redirect(
    302,
    `/login.html?error=${encodeURIComponent(message)}`
  );
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Metode tidak diizinkan.");
  }

  try {
    const { code, state, error } = req.query || {};

    if (error) {
      return redirectError(res, "google_cancelled");
    }

    const savedState = getCookie(req, "google_auth_state");

    if (
      typeof state !== "string" ||
      typeof savedState !== "string" ||
      !/^[a-f0-9]{64}$/.test(state) ||
      !/^[a-f0-9]{64}$/.test(savedState)
    ) {
      return redirectError(res, "invalid_google_state");
    }

    const stateMatches = crypto.timingSafeEqual(
      Buffer.from(state, "hex"),
      Buffer.from(savedState, "hex")
    );

    if (!stateMatches || typeof code !== "string" || !code) {
      return redirectError(res, "invalid_google_state");
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_USER_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error("Konfigurasi Google OAuth belum lengkap.");
    }

    // Tukar authorization code dengan token Google.
    const tokenResponse = await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      return redirectError(res, "google_token_failed");
    }

    // Ambil profil Google.
    const profileResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      }
    );

    const profile = await profileResponse.json();

    if (
      !profileResponse.ok ||
      profile.email_verified !== true ||
      typeof profile.email !== "string" ||
      typeof profile.sub !== "string"
    ) {
      return redirectError(res, "google_profile_invalid");
    }

    const email = profile.email.trim().toLowerCase();
    const name =
      typeof profile.name === "string" && profile.name.trim()
        ? profile.name.trim()
        : email.split("@")[0];

    const picture =
      typeof profile.picture === "string" &&
      profile.picture.startsWith("https://")
        ? profile.picture
        : "";

    // Gunakan key akun yang sama dengan API register/login.
    const accountKey = `user_account:${email}`;
    const savedAccount = await redisCommand("GET", accountKey);

    let account;

    if (savedAccount) {
      try {
        account = parseAccount(savedAccount);
      } catch {
        return redirectError(res, "account_data_invalid");
      }

      // Jangan mengizinkan akun dengan role selain user.
      if (!account || account.role !== "user") {
        return redirectError(res, "account_not_allowed");
      }

      // Jangan menimpa kredensial login email/password.
      account.name = name || account.name || "";
      account.picture = picture || account.picture || "";
      account.googleSub = profile.sub;
      account.updatedAt = new Date().toISOString();
    } else {
      // Buat akun baru bagi pengguna Google yang belum terdaftar.
      account = {
        name,
        email,
        passwordHash: "",
        picture,
        role: "user",
        googleSub: profile.sub,
        createdAt: new Date().toISOString(),
      };
    }

    await redisCommand(
      "SET",
      accountKey,
      JSON.stringify(account)
    );

    // Buat sesi dengan format yang dipakai API login kamu.
    const sessionToken = crypto.randomBytes(32).toString("hex");

    const session = {
      email,
      name: account.name || name,
      picture: account.picture || "",
      role: "user",
      createdAt: new Date().toISOString(),
    };

    await redisCommand(
      "SET",
      `user_session:${sessionToken}`,
      JSON.stringify(session),
      "EX",
      SESSION_DURATION
    );

    res.setHeader("Set-Cookie", [
      clearStateCookie(),
      [
        `user_session=${sessionToken}`,
        "Path=/",
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        `Max-Age=${SESSION_DURATION}`,
      ].join("; "),
    ]);

    return res.redirect(302, "/gabung-foto.html");
  } catch (error) {
    console.error("Google user callback error:", error);

    res.setHeader("Set-Cookie", clearStateCookie());

    return res.redirect(
      302,
      "/login.html?error=google_login_failed"
    );
  }
};
