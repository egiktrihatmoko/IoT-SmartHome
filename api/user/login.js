
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

/*
==================================================
KONFIGURASI REDIS
==================================================
Pastikan kedua Environment Variables ini sudah ada
di Vercel:
- UPSTASH_REDIS_REST_URL
- UPSTASH_REDIS_REST_TOKEN
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

Endpoint:
POST /api/user

Body:
{
  "action": "register",
  "email": "email@example.com",
  "password": "password123456"
}
==================================================
*/

async function registerUser(req, res) {
  const { email, password } = getBody(req);

  if (
    typeof email !== "string" ||
    typeof password !== "string"
  ) {
    return sendJson(res, 400, {
      success: false,
      message: "Email dan password wajib diisi.",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
  ) {
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
    email: normalizedEmail,
    passwordHash,
    role: "user",
    createdAt: new Date().toISOString(),
  };

  // NX mencegah email yang sama didaftarkan dua kali.
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
API 2: LOGIN PENGGUNA
==================================================

Endpoint:
POST /api/user

Body:
{
  "action": "login",
  "email": "email@example.com",
  "password": "password123456"
}
==================================================
*/

async function loginUser(req, res) {
  const { email, password } = getBody(req);

  if (
    typeof email !== "string" ||
    typeof password !== "string"
  ) {
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

  if (
    account.role !== "user" ||
    !account.passwordHash
  ) {
    return sendJson(res, 401, {
      success: false,
      message: "Akun pengguna tidak valid.",
    });
  }

  const passwordMatch = await bcrypt.compare(
    password,
    account.passwordHash
  );

  if (!passwordMatch) {
    return sendJson(res, 401, {
      success: false,
      message: "Email atau password salah.",
    });
  }

  // Membuat token acak untuk sesi login.
  const token = crypto.randomBytes(32).toString("hex");

  const session = {
    email: normalizedEmail,
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
  });
}


/*
==================================================
API 3: CHECK SESSION / CEK LOGIN
==================================================

Endpoint:
GET /api/user?action=check

Mengecek apakah pengguna masih memiliki sesi aktif.
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
      email: session.email,
      role: session.role,
    },
  });
}


/*
==================================================
API 4: LOGOUT / KELUAR
==================================================

Endpoint:
POST /api/user

Body:
{
  "action": "logout"
}

Menghapus sesi Redis dan cookie pengguna.
==================================================
*/

async function logoutUser(req, res) {
  const token = getCookie(req, "user_session");

  if (token && /^[a-f0-9]{64}$/.test(token)) {
    await redisCommand(
      "DEL",
      `user_session:${token}`
    );
  }

  clearUserCookie(res);

  return sendJson(res, 200, {
    success: true,
    message: "Logout berhasil.",
  });
}


/*
==================================================
ROUTER UTAMA
==================================================

Semua API pengguna diarahkan melalui file ini.
API admin tidak diubah.
==================================================
*/

module.exports = async function handler(req, res) {
  try {
    const action =
      req.method === "GET"
        ? req.query?.action
        : getBody(req).action;

    // Cek sesi hanya menggunakan GET.
    if (action === "check") {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");

        return sendJson(res, 405, {
          success: false,
          message: "Gunakan metode GET untuk cek sesi.",
        });
      }

      return await checkUserSession(req, res);
    }

    // Aksi lainnya menggunakan POST.
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, GET");

      return sendJson(res, 405, {
        success: false,
        message: "Metode request tidak didukung.",
      });
    }

    switch (action) {
      case "register":
        return await registerUser(req, res);

      case "login":
        return await loginUser(req, res);

      case "logout":
        return await logoutUser(req, res);

      default:
        return sendJson(res, 400, {
          success: false,
          message: "Aksi API tidak dikenal.",
        });
    }
  } catch (error) {
    // Detail error disimpan di log Vercel, bukan dikirim ke browser.
    console.error("User API error:", error);

    return sendJson(res, 500, {
      success: false,
      message: "Terjadi kesalahan server. Silakan coba lagi.",
    });
  }
};
