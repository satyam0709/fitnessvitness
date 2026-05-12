const crypto = require("crypto");

const ALGO = "aes-256-gcm";
const KEY_HEX_LEN = 64; // 32 bytes
const DERIVE_CONTEXT = "rnd-crm|tenant-db-credential-encryption|v1";

/**
 * Prefer TENANT_DB_ENCRYPTION_KEY (explicit rotation boundary for BYOD secrets).
 * If unset, derive a stable 32-byte key from JWT_SECRET so local/dev does not need a second secret.
 * Rotating JWT_SECRET will invalidate previously encrypted BYOD passwords unless you re-enter them.
 */
function getKey() {
  const raw = String(process.env.TENANT_DB_ENCRYPTION_KEY || "").trim();
  if (raw.length > 0) {
    if (raw.length !== KEY_HEX_LEN) {
      throw new Error(
        `TENANT_DB_ENCRYPTION_KEY must be exactly ${KEY_HEX_LEN} hex characters (32 bytes), or leave it unset to derive from JWT_SECRET.`
      );
    }
    const key = Buffer.from(raw, "hex");
    if (key.length !== 32) {
      throw new Error("TENANT_DB_ENCRYPTION_KEY is not valid hexadecimal for 32 bytes.");
    }
    return key;
  }

  const jwt = String(process.env.JWT_SECRET || "").trim();
  if (jwt) {
    return crypto.createHash("sha256").update(`${DERIVE_CONTEXT}|${jwt}`, "utf8").digest();
  }

  throw new Error(
    `Set JWT_SECRET, or set TENANT_DB_ENCRYPTION_KEY (64-char hex). ` +
      `Generate a dedicated key with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  );
}

/**
 * Encrypt a plaintext string.
 * @param {string} plaintext
 * @returns {string} "iv_hex:authTag_hex:encrypted_hex"
 */
function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

/**
 * Decrypt a ciphertext string produced by encrypt().
 * @param {string} ciphertext "iv_hex:authTag_hex:encrypted_hex"
 * @returns {string} plaintext
 */
function decrypt(ciphertext) {
  const key = getKey();
  const parts = String(ciphertext || "").split(":");
  if (parts.length !== 3) {
    throw new Error("tenantCrypto.decrypt: invalid ciphertext format (expected iv:authTag:data)");
  }
  const [ivHex, authTagHex, encHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encHex, "hex");

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

module.exports = { encrypt, decrypt };