
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
const MAX_PHOTO_SIZE = 200 * 1024; // Maksimal 200 KB

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
FUNGSI BANTUAN: MEMBACA ACTION REQUEST
==================================================
*/

function getAction(req) {
  // Utamakan action dari body untuk POST.
  if (req.method !== "GET") {
    const body = getBody(req);

    if (typeof body.action === "string" && body.action) {
      return body.action;
    }
  }

  // Baca query dari Vercel.
  if (
    req.query &&
    typeof req.query.action === "string" &&
    req.query.action
  ) {
    return req.query.action;
  }

  // Cadangan jika req.query tidak tersedia.
  try {
    const parsedUrl = new URL(
      req.url || "/",
      `https://${req.headers.host || "localhost"}`
    );

    return parsedUrl.searchParams.get("action") || "";
  } catch {
    return "";
  }
}

/*
==================================================
FUNGSI BANTUAN: PARSE DATA REDIS
==================================================
*/

function parseRedisJson(value) {
  if (!value) return null;

  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
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
API 2: LOGIN EMAIL DAN PASSWORD
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

  const account = parseRedisJson(savedAccount);

  if (!account) {
    return sendJson(res, 401, {
      success: false,
      message: "Email atau password salah.",
    });
  }

  if (account.role !== "user" || !account.passwordHash) {
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
API 3: CEK SESI PENGGUNA
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

  const session = parseRedisJson(savedSession);

  if (!session || session.role !== "user" || !session.email) {
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
API 5: SIMPAN / HAPUS FOTO PROFIL
==================================================
*/

async function profilePhoto(req, res) {
  const { pictureAction, picture } = getBody(req);

  if (!["save", "delete"].includes(pictureAction)) {
    return sendJson(res, 400, {
      success: false,
      message: "Aksi foto profil tidak valid.",
    });
  }

  const token = getCookie(req, "user_session");

  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    clearUserCookie(res);

    return sendJson(res, 401, {
      success: false,
      message: "Silakan login terlebih dahulu.",
    });
  }

  const sessionKey = `user_session:${token}`;
  const savedSession = await redisCommand("GET", sessionKey);
  const session = parseRedisJson(savedSession);

  if (!session || session.role !== "user" || !session.email) {
    clearUserCookie(res);

    return sendJson(res, 401, {
      success: false,
      message: "Sesi tidak valid. Silakan login kembali.",
    });
  }

  const accountKey = `user_account:${session.email}`;
  const savedAccount = await redisCommand("GET", accountKey);
  const account = parseRedisJson(savedAccount);

  if (!account || account.role !== "user") {
    return sendJson(res, 404, {
      success: false,
      message: "Data akun pengguna tidak ditemukan.",
    });
  }

  let newPicture = "";

  if (pictureAction === "save") {
    if (typeof picture !== "string") {
      return sendJson(res, 400, {
        success: false,
        message: "Data foto tidak ditemukan.",
      });
    }

    const match = picture.match(
      /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/
    );

    if (!match) {
      return sendJson(res, 400, {
        success: false,
        message: "Format foto harus JPG, PNG, atau WebP.",
      });
    }

    const imageType = match[1];
    const base64Data = match[2];
    const imageBuffer = Buffer.from(base64Data, "base64");

    if (
      imageBuffer.length === 0 ||
      imageBuffer.toString("base64") !== base64Data
    ) {
      return sendJson(res, 400, {
        success: false,
        message: "Data foto tidak valid.",
      });
    }

    if (imageBuffer.length > MAX_PHOTO_SIZE) {
      return sendJson(res, 413, {
        success: false,
        message: "Ukuran foto maksimal 200 KB.",
      });
    }

    const isJpeg =
      imageBuffer.length >= 3 &&
      imageBuffer[0] === 0xff &&
      imageBuffer[1] === 0xd8 &&
      imageBuffer[2] === 0xff;

    const isPng =
      imageBuffer.length >= 8 &&
      imageBuffer.subarray(0, 8).equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
      );

    const isWebp =
      imageBuffer.length >= 12 &&
      imageBuffer.toString("ascii", 0, 4) === "RIFF" &&
      imageBuffer.toString("ascii", 8, 12) === "WEBP";

    const validImage =
      (imageType === "jpeg" && isJpeg) ||
      (imageType === "png" && isPng) ||
      (imageType === "webp" && isWebp);

    if (!validImage) {
      return sendJson(res, 400, {
        success: false,
        message: "Isi file tidak sesuai dengan format gambar.",
      });
    }

    newPicture = picture;
  }

  // Simpan foto pada akun pengguna.
  account.picture = newPicture;

  await redisCommand(
    "SET",
    accountKey,
    JSON.stringify(account)
  );

  // Perbarui foto pada sesi aktif.
  session.picture = newPicture;

  const ttl = Number(await redisCommand("TTL", sessionKey));

  if (ttl === -2) {
    return sendJson(res, 401, {
      success: false,
      message: "Sesi login sudah berakhir. Silakan login kembali.",
    });
  }

  if (ttl > 0) {
    await redisCommand(
      "SET",
      sessionKey,
      JSON.stringify(session),
      "EX",
      ttl
    );
  } else {
    await redisCommand(
      "SET",
      sessionKey,
      JSON.stringify(session)
    );
  }

  return sendJson(res, 200, {
    success: true,
    message:
      pictureAction === "save"
        ? "Foto profil berhasil disimpan."
        : "Foto profil berhasil dihapus.",
    picture: newPicture,
  });
}

/*
==================================================
API 6: GOOGLE OAUTH - START
==================================================
*/

async function googleStart(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  const redirectUri =
    `${protocol}://${host}/api/user/google/callback`;

  if (!clientId) {
    return sendJson(res, 500, {
      success: false,
      message: "GOOGLE_CLIENT_ID belum diatur.",
    });
  }

  const state = crypto.randomBytes(16).toString("hex");

  res.setHeader(
    "Set-Cookie",
    `google_auth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );

  const googleAuthUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code&scope=email%20profile&state=${state}`;

  res.writeHead(302, { Location: googleAuthUrl });
  res.end();
}

/*
==================================================
API 7: GOOGLE OAUTH - CALLBACK
==================================================
*/

async function googleCallback(req, res) {
  try {
    const { code, state } = req.query || {};
    const savedState = getCookie(req, "google_auth_state");

    if (!state || state !== savedState) {
      return res
        .status(400)
        .send("Sesi verifikasi Google tidak valid atau kedaluwarsa.");
    }

    if (!code) {
      return res
        .status(400)
        .send("Kode otorisasi Google tidak ditemukan.");
    }

    if (
      !process.env.GOOGLE_CLIENT_ID ||
      !process.env.GOOGLE_CLIENT_SECRET
    ) {
      return res
        .status(500)
        .send("Konfigurasi Google OAuth belum lengkap.");
    }

    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;
    const redirectUri =
      `${protocol}://${host}/api/user/google/callback`;

    const tokenResponse = await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      return res
        .status(400)
        .send("Gagal mendapatkan token akses dari Google.");
    }

    const userResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      }
    );

    const googleUser = await userResponse.json();

    if (
      !userResponse.ok ||
      !googleUser.email ||
      googleUser.verified_email === false
    ) {
      return res
        .status(400)
        .send("Gagal memverifikasi informasi profil dari Google.");
    }

    const normalizedEmail = googleUser.email.trim().toLowerCase();
    const googleName = googleUser.name || "User Google";
    const googlePicture = googleUser.picture || "";

    const existingAccountValue = await redisCommand(
      "GET",
      `user_account:${normalizedEmail}`
    );

    let account = parseRedisJson(existingAccountValue);

    if (account) {
      account.name = googleName || account.name;
      account.picture = account.picture || googlePicture;
      account.role = "user";

      await redisCommand(
        "SET",
        `user_account:${normalizedEmail}`,
        JSON.stringify(account)
      );
    } else {
      account = {
        name: googleName,
        email: normalizedEmail,
        passwordHash: "",
        picture: googlePicture,
        role: "user",
        createdAt: new Date().toISOString(),
      };

      await redisCommand(
        "SET",
        `user_account:${normalizedEmail}`,
        JSON.stringify(account)
      );
    }

    const sessionToken = crypto.randomBytes(32).toString("hex");

    const session = {
      email: normalizedEmail,
      name: account.name,
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
      `user_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DURATION}`,
      "google_auth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    ]);

    res.writeHead(302, {
      Location: "/gabung-foto.html",
    });
    res.end();
  } catch (error) {
    console.error("Google Callback Error:", error);

    return res
      .status(500)
      .send("Terjadi kesalahan server saat memproses login Google.");
  }
}

/*
==================================================
ROUTER UTAMA
==================================================
*/

module.exports = async function handler(req, res) {
  try {
    const requestUrl = req.url || "";
    const action = getAction(req);

    // Cek sesi pengguna.
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

    // Simpan atau hapus foto profil.
    if (action === "profile-photo") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");

        return sendJson(res, 405, {
          success: false,
          message: "Gunakan metode POST untuk mengubah foto profil.",
        });
      }

      return await profilePhoto(req, res);
    }

    // Google OAuth start.
    if (
      action === "google-start" ||
      requestUrl.includes("/google/start")
    ) {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");

        return sendJson(res, 405, {
          success: false,
          message: "Gunakan metode GET untuk memulai login Google.",
        });
      }

      return await googleStart(req, res);
    }

    // Google OAuth callback.
    if (
      action === "google-callback" ||
      requestUrl.includes("/google/callback")
    ) {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");

        return sendJson(res, 405, {
          success: false,
          message: "Callback Google harus menggunakan GET.",
        });
      }

      return await googleCallback(req, res);
    }

    // Aksi lainnya harus menggunakan POST.
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
    console.error("User API error:", error);

    return sendJson(res, 500, {
      success: false,
      message: "Terjadi kesalahan server. Silakan coba lagi.",
    });
  }
};
