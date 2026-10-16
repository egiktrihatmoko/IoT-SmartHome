import { Redis } from "@upstash/redis";
import bcrypt from "bcryptjs";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method tidak diizinkan" });
  }

  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        message: "Email dan password wajib diisi",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    if (
      normalizedEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ) {
      return res.status(400).json({ message: "Format email tidak valid" });
    }

    if (typeof password !== "string" || password.length < 12) {
      return res.status(400).json({
        message: "Password minimal 12 karakter",
      });
    }

    if (password.length > 128) {
      return res.status(400).json({ message: "Password terlalu panjang" });
    }

    const userKey = `admin_user:${normalizedEmail}`;

    const existingUser = await redis.get(userKey);

    if (existingUser) {
      return res.status(409).json({
        message: "Email sudah terdaftar",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const role =
      normalizedEmail === String(process.env.ADMIN_EMAIL || "").trim().toLowerCase()
        ? "admin"
        : "user";

    const user = {
      email: normalizedEmail,
      passwordHash,
      role,
      createdAt: new Date().toISOString(),
    };

    // Mencegah dua pendaftaran dengan email sama secara bersamaan.
    const result = await redis.set(userKey, user, { nx: true });

    if (result !== "OK") {
      return res.status(409).json({
        message: "Email sudah terdaftar",
      });
    }

    return res.status(201).json({
      message: "Pendaftaran berhasil",
      user: {
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Register error:", error.message);

    return res.status(500).json({
      message: "Terjadi kesalahan server",
    });
  }
}
