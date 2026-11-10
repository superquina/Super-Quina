import { describe, expect, it } from "vitest";
import { normalizeNumber } from "./normalize-number";

describe("normalizeNumber", () => {
  it.each(["00000", "00001", "12345", "99999"])("accepts %s without dropping leading zeroes", (value) => {
    expect(normalizeNumber(value)).toBe(value);
  });

  it.each(["1234", "123456", "12A45", " 12 45 "])("rejects invalid value %s", (value) => {
    expect(() => normalizeNumber(value)).toThrow();
  });
});
