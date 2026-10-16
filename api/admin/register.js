
import { Redis } from "@upstash/redis";
import bcrypt from "bcryptjs";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  // Hanya menerima request POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      message: "Method tidak diizinkan. Gunakan POST.",
    });
  }

  try {
    const { email, password } = req.body || {};

    // Validasi input
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Email dan password wajib diisi.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (
      normalizedEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ) {
      return res.status(400).json({
        success: false,
        message: "Format email tidak valid.",
      });
    }

    if (password.length < 12) {
      return res.status(400).json({
        success: false,
        message: "Password minimal 12 karakter.",
      });
    }

    if (password.length > 128) {
      return res.status(400).json({
        success: false,
        message: "Password terlalu panjang.",
      });
    }

    const userKey = `admin_user:${normalizedEmail}`;

    // Cek apakah email sudah terdaftar
    const existingUser = await redis.get(userKey);

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email sudah terdaftar.",
      });
    }

    // Hash password sebelum disimpan ke Redis
    const passwordHash = await bcrypt.hash(password, 12);

    // Sesuai permintaanmu: semua akun yang mendaftar mendapat role admin.
    // Perhatian: siapa pun yang bisa mendaftar akan memperoleh hak admin.
    const user = {
      email: normalizedEmail,
      passwordHash,
      role: "admin",
      createdAt: new Date().toISOString(),
    };

    // Simpan hanya jika email belum ada agar tidak menimpa akun lama
    const result = await redis.set(userKey, user, { nx: true });

    if (result !== "OK") {
      return res.status(409).json({
        success: false,
        message: "Email sudah terdaftar.",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Pendaftaran berhasil. Silakan login.",
      user: {
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Register error:", error);

    return res.status(500).json({
      success: false,
      message: "Pendaftaran gagal karena kesalahan server.",
    });
  }
}
