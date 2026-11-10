import { describe, expect, it } from "vitest";
import { calculateCommissionCents } from "./cashier-commission";

describe("calculateCommissionCents", () => {
  it("calculates a 20% commission on R$100 as R$20", () => {
    expect(calculateCommissionCents(10_000, 2_000)).toBe(2_000);
  });

  it("rounds half up to the nearest cent", () => {
    expect(calculateCommissionCents(1, 5_000)).toBe(1);
    expect(calculateCommissionCents(1, 4_999)).toBe(0);
  });

  it("supports zero and 100 percent", () => {
    expect(calculateCommissionCents(10_000, 0)).toBe(0);
    expect(calculateCommissionCents(10_000, 10_000)).toBe(10_000);
  });

  it.each([
    [-1, 1],
    [1.5, 1],
    [Number.MAX_SAFE_INTEGER + 1, 1],
    [100, -1],
    [100, 10_001],
    [100, 12.5],
  ])("rejects invalid total/rate (%s, %s)", (totalCents, rateBasisPoints) => {
    expect(() => calculateCommissionCents(totalCents, rateBasisPoints)).toThrow(RangeError);
  });
});
