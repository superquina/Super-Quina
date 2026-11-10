import { afterEach, describe, expect, it } from "vitest";

const original = process.env.WALLET_PIX_ENCRYPTION_KEY;

afterEach(() => {
  if (original === undefined) delete process.env.WALLET_PIX_ENCRYPTION_KEY;
  else process.env.WALLET_PIX_ENCRYPTION_KEY = original;
});

describe("Pix key encryption", () => {
  it("accepts common Pix key formats and rejects malformed keys", async () => {
    process.env.WALLET_PIX_ENCRYPTION_KEY = "44".repeat(32);
    const { isPlausiblePixKey } = await import("./pix-key-crypto");
    expect(isPlausiblePixKey("jogador@example.com")).toBe(true);
    expect(isPlausiblePixKey("+55 (11) 99999-9999")).toBe(true);
    expect(isPlausiblePixKey("123.456.789-01")).toBe(true);
    expect(isPlausiblePixKey("12345678000195")).toBe(true);
    expect(isPlausiblePixKey("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
    expect(isPlausiblePixKey("not a pix key")).toBe(false);
  });

  it("round-trips keys and produces randomized ciphertext", async () => {
    process.env.WALLET_PIX_ENCRYPTION_KEY = "11".repeat(32);
    const { encryptPixKey, decryptPixKey, maskPixKey } = await import("./pix-key-crypto");
    const key = "123e4567-e89b-12d3-a456-426614174000";
    const encryptedA = encryptPixKey(key);
    const encryptedB = encryptPixKey(key);
    expect(encryptedA).not.toBe(key);
    expect(encryptedA).not.toBe(encryptedB);
    expect(decryptPixKey(encryptedA)).toBe(key);
    expect(maskPixKey(key)).toBe("••••••4000");
  });

  it("masks email-like Pix keys", async () => {
    process.env.WALLET_PIX_ENCRYPTION_KEY = "22".repeat(32);
    const { maskPixKey } = await import("./pix-key-crypto");
    expect(maskPixKey("jogador@example.com")).toBe("jo***@example.com");
  });

  it("fails closed if the encryption key is missing or malformed", async () => {
    delete process.env.WALLET_PIX_ENCRYPTION_KEY;
    const { encryptPixKey } = await import("./pix-key-crypto");
    expect(() => encryptPixKey("pix@example.com")).toThrow("WALLET_PIX_ENCRYPTION_KEY_MISSING");
    process.env.WALLET_PIX_ENCRYPTION_KEY = "too-short";
    expect(() => encryptPixKey("pix@example.com")).toThrow("WALLET_PIX_ENCRYPTION_KEY_INVALID");
  });

  it("rejects tampered ciphertext", async () => {
    process.env.WALLET_PIX_ENCRYPTION_KEY = "33".repeat(32);
    const { encryptPixKey, decryptPixKey } = await import("./pix-key-crypto");
    const encrypted = encryptPixKey("pix@example.com");
    const pieces = encrypted.split(".");
    pieces[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptPixKey(pieces.join("."))).toThrow();
  });
});
