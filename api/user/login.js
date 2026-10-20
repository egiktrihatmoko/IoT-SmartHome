const bcrypt = require("bcryptjs");
const crypto = require("crypto");

/*
==================================================
KONFIGURASI REDIS
==================================================
*/

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const SESSION_DURATION = 86400; // 24 jam

/*
==================================================
FUNGSI BANTUAN: RESPONS JSON
==================================================
*/

function sendJson(res, status, data) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(data);
}

/*
==================================================
FUNGSI BANTUAN: KONEKSI REDIS
==================================================
*/

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
    throw new Error("Perintah Redis gagal dijalankan.");
  }

  return data.result;
}

/*
==================================================
FUNGSI BANTUAN: MEMBACA BODY REQUEST
==================================================
*/

function getBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return {};
}

/*
==================================================
FUNGSI BANTUAN: MEMBACA COOKIE
==================================================
*/

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";

  const cookie = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));

  return cookie ? cookie.substring(name.length + 1) : null;
}

/*
==================================================
FUNGSI BANTUAN: COOKIE SESI PENGGUNA
==================================================
*/

function setUserCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `user_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DURATION}`
  );
}

function clearUserCookie(res) {
  res.setHeader(
    "Set-Cookie",
    "user_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
  );
}

/*
==================================================
API 1: REGISTER / DAFTAR AKUN
==================================================
*/

async function registerUser(req, res) {
  const { name, email, password } = getBody(req);

  if (
    typeof name !== "string" ||
    typeof email !== "string" ||
    typeof password !== "string"
  ) {
    return sendJson(res, 400, {
      success: false,
      message: "Nama, email, dan password wajib diisi.",
    });
  }

  const normalizedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedName) {
    return sendJson(res, 400, {
      success: false,
      message: "Nama lengkap tidak boleh kosong.",
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return sendJson(res, 400, {
      success: false,
      message: "Format email tidak valid.",
    });
  }

  if (password.length < 12 || password.length > 128) {
    return sendJson(res, 400, {
      success: false,
      message: "Password harus terdiri dari 12–128 karakter.",
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const account = {
    name: normalizedName,
    email: normalizedEmail,
    passwordHash,
    picture: "",
    role: "user",
    createdAt: new Date().toISOString(),
  };

  const result = await redisCommand(
    "SET",
    `user_account:${normalizedEmail}`,
    JSON.stringify(account),
    "NX"
  );

  if (result !== "OK") {
    return sendJson(res, 409, {
      success: false,
      message: "Email sudah terdaftar.",
    });
  }

  return sendJson(res, 201, {
    success: true,
    message: "Pendaftaran berhasil. Silakan login.",
  });
}

/*
==================================================
API 2: LOGIN PENGGUNA (Lokal Email & Password)
==================================================
*/

async function loginUser(req, res) {
  const { email, password } = getBody(req);

  if (typeof email !== "string" || typeof password !== "string") {
    return sendJson(res, 400, {
      success: false,
      message: "Email dan password wajib diisi.",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const savedAccount = await redisCommand(
    "GET",
    `user_account:${normalizedEmail}`
  );

  if (!savedAccount) {
    return sendJson(res, 401, {
      success: false,
      message: "Email atau password salah.",
    });
  }

  let account;

  try {
    account =
      typeof savedAccount === "string"
        ? JSON.parse(savedAccount)
        : savedAccount;
  } catch {
    return sendJson(res, 500, {
      success: false,
      message: "Data akun tidak dapat dibaca.",
    });
  }

  if (account.role !== "user" || !account.passwordHash) {
    return sendJson(res, 401, {
      success: false,
      message: "Akun pengguna tidak valid.",
    });
  }

  const passwordMatch = await bcrypt.compare(password, account.passwordHash);

  if (!passwordMatch) {
    return sendJson(res, 401, {
      success: false,
      message: "Email atau password salah.",
    });
  }

  const token = crypto.randomBytes(32).toString("hex");

  const session = {
    email: normalizedEmail,
    name: account.name || "",
    picture: account.picture || "",
    role: "user",
    createdAt: new Date().toISOString(),
  };

  await redisCommand(
    "SET",
    `user_session:${token}`,
    JSON.stringify(session),
    "EX",
    SESSION_DURATION
  );

  setUserCookie(res, token);

  return sendJson(res, 200, {
    success: true,
    message: "Login berhasil.",
    user: {
      name: session.name,
      email: session.email,
      picture: session.picture,
    },
  });
}

/*
==================================================
API 3: CEK SESI (CHECK SESSION)
==================================================
*/

async function checkUserSession(req, res) {
  const token = getCookie(req, "user_session");

  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return sendJson(res, 200, {
      success: true,
      authenticated: false,
      message: "Belum login.",
    });
  }

  const savedSession = await redisCommand(
    "GET",
    `user_session:${token}`
  );

  if (!savedSession) {
    clearUserCookie(res);

    return sendJson(res, 200, {
      success: true,
      authenticated: false,
      message: "Sesi login sudah berakhir.",
    });
  }

  let session;

  try {
    session =
      typeof savedSession === "string"
        ? JSON.parse(savedSession)
        : savedSession;
  } catch {
    clearUserCookie(res);

    return sendJson(res, 200, {
      success: true,
      authenticated: false,
      message: "Sesi tidak valid.",
    });
  }

  if (session.role !== "user" || !session.email) {
    clearUserCookie(res);

    return sendJson(res, 200, {
      success: true,
      authenticated: false,
      message: "Sesi tidak valid.",
    });
  }

  return sendJson(res, 200, {
    success: true,
    authenticated: true,
    user: {
      name: session.name || "",
      email: session.email,
      picture: session.picture || "",
      role: session.role,
    },
  });
}

/*
==================================================
API 4: LOGOUT
==================================================
*/

async function logoutUser(req, res) {
  const token = getCookie(req, "user_session");

  if (token && /^[a-f0-9]{64}$/.test(token)) {
    await redisCommand("DEL", `user_session:${token}`);
  }

  clearUserCookie(res);

  return sendJson(res, 200, {
    success: true,
    message: "Logout berhasil.",
  });
}

/*
==================================================
API 5: GOOGLE OAUTH - START
==================================================
*/

async function googleStart(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  const redirectUri = `${protocol}://${host}/api/user/google/callback`;

  if (!clientId) {
    return sendJson(res, 500, { success: false, message: "GOOGLE_CLIENT_ID belum diatur." });
  }

  const state = crypto.randomBytes(16).toString("hex");

  res.setHeader(
    "Set-Cookie",
    `google_auth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&response_type=code&scope=email%20profile&state=${state}`;

  res.writeHead(302, { Location: googleAuthUrl });
  res.end();
}

/*
==================================================
API 6: GOOGLE OAUTH - CALLBACK
==================================================
*/

async function googleCallback(req, res) {
  try {
    const { code, state } = req.query;
    const savedState = getCookie(req, "google_auth_state");

    if (!state || state !== savedState) {
      return res.status(400).send("Sesi verifikasi Google tidak valid atau kedaluwarsa.");
    }

    if (!code) {
      return res.status(400).send("Kode otorisasi Google tidak ditemukan.");
    }

    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;
    const redirectUri = `${protocol}://${host}/api/user/google/callback`;

    // 1. Tukar code dengan token Google
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(400).send("Gagal mendapatkan token akses dari Google.");
    }

    // 2. Ambil profil Google (Nama, Email, Foto Profil)
    const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const googleUser = await userResponse.json();
    if (!userResponse.ok || !googleUser.email) {
      return res.status(400).send("Gagal mengambil informasi profil dari Google.");
    }

    const normalizedEmail = googleUser.email.toLowerCase();
    const name = googleUser.name || "User Google";
    const picture = googleUser.picture || "";

    // 3. Simpan atau perbarui akun di Redis beserta foto profilnya
    const existingAccountStr = await redisCommand("GET", `user_account:${normalizedEmail}`);

    let account;
    if (existingAccountStr) {
      try {
        account = typeof existingAccountStr === "string" ? JSON.parse(existingAccountStr) : existingAccountStr;
        account.picture = picture || account.picture;
        account.name = name || account.name;
        await redisCommand("SET", `user_account:${normalizedEmail}`, JSON.stringify(account));
      } catch {
        account = null;
      }
    }

    if (!account) {
      account = {
        name: name,
        email: normalizedEmail,
        passwordHash: "",
        picture: picture, // Foto profil tersimpan di sini!
        role: "user",
        createdAt: new Date().toISOString(),
      };
      await redisCommand("SET", `user_account:${normalizedEmail}`, JSON.stringify(account));
    }

    // 4. Buat sesi login
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const session = {
      email: normalizedEmail,
      name: account.name,
      picture: account.picture, // Foto profil ikut masuk ke sesi
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
      `user_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DURATION}`,
      `google_auth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
    ]);

    // 5. Redirect ke halaman tujuan setelah berhasil login
    res.writeHead(302, { Location: "/gabung-foto.html" });
    res.end();

  } catch (error) {
    console.error("Google Callback Error:", error);
    res.status(500).send("Terjadi kesalahan pada server saat memproses login Google.");
  }
}

/*
==================================================
ROUTER UTAMA
==================================================
*/

module.exports = async function handler(req, res) {
  try {
    const action =
      req.method === "GET"
        ? req.query?.action
        : getBody(req).action;

    // Cek sesi menggunakan GET
    if (action === "check") {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return sendJson(res, 405, { success: false, message: "Gunakan metode GET untuk cek sesi." });
      }
      return await checkUserSession(req, res);
    }

    // Google Start route (bisa diakses via GET ?action=google-start atau langsung)
    if (action === "google-start" || req.url.includes("/google/start")) {
      return await googleStart(req, res);
    }

    // Google Callback route (diakses otomatis oleh Google)
    if (action === "google-callback" || req.url.includes("/google/callback")) {
      return await googleCallback(req, res);
    }

    // Aksi lainnya menggunakan POST
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, GET");
      return sendJson(res, 405, { success: false, message: "Metode request tidak didukung." });
    }

    switch (action) {
      case "register":
        return await registerUser(req, res);

      case "login":
        return await loginUser(req, res);

      case "logout":
        return await logoutUser(req, res);

      default:
        return sendJson(res, 400, { success: false, message: "Aksi API tidak dikenal." });
    }
  } catch (error) {
    console.error("User API error:", error);
    return sendJson(res, 500, { success: false, message: "Terjadi kesalahan server. Silakan coba lagi." });
  }
};
