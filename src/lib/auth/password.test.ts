import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies the original password but not a different password", async () => {
    const encoded = await hashPassword("correct-horse-battery-staple");
    expect(await verifyPassword("correct-horse-battery-staple", encoded)).toBe(true);
    expect(await verifyPassword("wrong-password-value", encoded)).toBe(false);
  });
  it("uses a different salt for each password hash", async () => {
    const first = await hashPassword("correct-horse-battery-staple");
    const second = await hashPassword("correct-horse-battery-staple");
    expect(first).not.toBe(second);
  });
  it("rejects weak passwords", async () => {
    await expect(hashPassword("short")).rejects.toThrow();
  });
  it("rejects malformed or unsupported encoded hashes", async () => {
    expect(await verifyPassword("anything", "plain-text")).toBe(false);
    expect(await verifyPassword("anything", "scrypt$1$1$1$bad$bad")).toBe(false);
  });
});
