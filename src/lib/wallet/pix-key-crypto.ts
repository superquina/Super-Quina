import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyBytes() {
  const configured = process.env.WALLET_PIX_ENCRYPTION_KEY;
  if (!configured) throw new Error("WALLET_PIX_ENCRYPTION_KEY_MISSING");
  const key = /^[a-fA-F0-9]{64}$/.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) throw new Error("WALLET_PIX_ENCRYPTION_KEY_INVALID");
  return key;
}

export function encryptPixKey(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptPixKey(value: string) {
  const [version, ivText, tagText, dataText] = value.split(".");
  if (version !== "v1" || !ivText || !tagText || !dataText) throw new Error("PIX_KEY_CIPHERTEXT_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64")), decipher.final()]).toString("utf8");
}

export function maskPixKey(value: string) {
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    return (local.length <= 2 ? local[0] ?? "*" : local.slice(0, 2) + "***") + "@" + domain;
  }
  return value.length <= 4 ? "••••" : "••••••" + value.slice(-4);
}

/** Basic format validation for the four common Pix key families. */
export function isPlausiblePixKey(value: string) {
  const key = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) return true;
  const digits = key.replace(/\D/g, "");
  if (/^\+?[0-9() .-]+$/.test(key) && digits.length >= 10 && digits.length <= 13) return true;
  if (/^[0-9.\/-]+$/.test(key) && (digits.length === 11 || digits.length === 14)) return true;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key);
}
