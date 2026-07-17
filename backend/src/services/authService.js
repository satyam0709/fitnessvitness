const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");

const BCRYPT_ROUNDS = 12;

const ACCESS_COOKIE = "access_token";
const REFRESH_COOKIE = "refresh_token";

function sha256hex(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function jwtAccessSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || String(s).trim() === "") {
    throw new Error("JWT_SECRET is not set");
  }
  return s;
}

function jwtRefreshSecret() {
  const s = process.env.JWT_REFRESH_SECRET;
  if (!s || String(s).trim() === "") {
    throw new Error("JWT_REFRESH_SECRET is not set");
  }
  return s;
}

async function hashPassword(password) {
  return bcrypt.hash(String(password), BCRYPT_ROUNDS);
}

async function comparePassword(plain, hash) {
  if (plain == null || hash == null) return false;
  return bcrypt.compare(String(plain), String(hash));
}

/**
 * @param {{ userId: number, role: string, is_platform_admin: number | boolean }} payload
 */
function generateAccessToken(payload) {
  const { userId, role, is_platform_admin } = payload;
  return jwt.sign(
    {
      userId: Number(userId),
      role: String(role || "staff").toLowerCase(),
      is_platform_admin: Number(is_platform_admin) === 1 ? 1 : 0,
    },
    jwtAccessSecret(),
    { expiresIn: "2h" }
  );
}

/** @param {{ userId: number }} payload */
function generateRefreshToken(payload) {
  const userId = payload.userId ?? payload.sub;
  return jwt.sign({ sub: String(userId) }, jwtRefreshSecret(), { expiresIn: "7d" });
}

async function saveRefreshToken(userId, token) {
  const decoded = jwt.decode(token);
  const expSec = decoded?.exp;
  const expiresAt = expSec ? new Date(expSec * 1000) : new Date(Date.now() + 7 * 864e5);
  const tokenHash = sha256hex(token);
  await prisma.refresh_tokens.create({
    data: {
      user_id: Number(userId),
      token_hash: tokenHash,
      expires_at: expiresAt
    }
  });
}

async function revokeRefreshToken(tokenHash) {
  await prisma.refresh_tokens.deleteMany({
    where: { token_hash: tokenHash }
  });
}

async function revokeAllUserTokens(userId) {
  await prisma.refresh_tokens.deleteMany({
    where: { user_id: Number(userId) }
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, jwtAccessSecret());
}

function verifyRefreshToken(token) {
  return jwt.verify(token, jwtRefreshSecret());
}

function getCookie(req, name) {
  const raw = req.headers?.cookie;
  if (!raw) return null;
  const parts = raw.split(";");
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    if (k !== name) continue;
    try {
      return decodeURIComponent(p.slice(idx + 1).trim());
    } catch {
      return p.slice(idx + 1).trim();
    }
  }
  return null;
}

module.exports = {
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  saveRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  sha256hex,
  verifyAccessToken,
  verifyRefreshToken,
  getCookie,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
};
