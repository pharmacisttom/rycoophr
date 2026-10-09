import {
  randomBytes,
  createHmac,
  createHash,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newSecret() {
  const bytes = randomBytes(20);
  let bits = 0,
    value = 0,
    out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(value >>> bits) & 31];
    }
  }
  return out;
}
function decode(secret) {
  let bits = 0,
    value = 0,
    out = [];
  for (const c of secret) {
    const n = alphabet.indexOf(c);
    if (n < 0) throw Error("Invalid secret");
    value = (value << 5) | n;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 255);
    }
  }
  return Buffer.from(out);
}
export function totp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", decode(secret)).update(msg).digest();
  const o = mac[19] & 15;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, "0");
}
export function verifyTotp(secret, code, lastCounter = -1, now = Date.now()) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const c of [current, current - 1, current + 1])
    if (
      c > lastCounter &&
      timingSafeEqual(Buffer.from(totp(secret, c)), Buffer.from(code))
    )
      return c;
  return null;
}
export function encryptSecret(secret, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32)
    throw Error("2FA encryption key must contain 32 bytes");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
export function decryptSecret(value, key) {
  const b = Buffer.from(value, "base64");
  const cipher = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  cipher.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([
    cipher.update(b.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
export function recoveryDigest(code) {
  return createHash("sha256")
    .update(String(code).trim().toUpperCase())
    .digest("hex");
}
export function recoveryCodes() {
  return Array.from({ length: 10 }, () =>
    randomBytes(10).toString("hex").toUpperCase(),
  );
}
