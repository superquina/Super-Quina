import { describe, expect, it } from "vitest";
import { allocateNumberStake } from "./allocate-number-stake";

describe("allocateNumberStake", () => {
  it("splits R$1.00 into five equal category allocations", () => {
    expect(allocateNumberStake(100)).toEqual({
      unitCents: 20, tensCents: 20, hundredsCents: 20, thousandsCents: 20, quinaCents: 20,
    });
  });

  it("splits R$3.00 equally because 300 cents divide exactly by five", () => {
    expect(allocateNumberStake(300)).toEqual({
      unitCents: 60, tensCents: 60, hundredsCents: 60, thousandsCents: 60, quinaCents: 60,
    });
  });

  it("assigns all indivisible cents to unit, as required by the numeric game rules", () => {
    expect(allocateNumberStake(302)).toEqual({
      unitCents: 62, tensCents: 60, hundredsCents: 60, thousandsCents: 60, quinaCents: 60,
    });
  });

  it("preserves every cent and assigns the remainder only to unit", () => {
    for (let totalCents = 100; totalCents <= 1_000; totalCents += 1) {
      const allocation = allocateNumberStake(totalCents);
      expect(Object.values(allocation).reduce((sum, value) => sum + value, 0)).toBe(totalCents);
      const base = Math.floor(totalCents / 5);
      expect(allocation.unitCents).toBe(base + (totalCents % 5));
      expect([allocation.tensCents, allocation.hundredsCents, allocation.thousandsCents, allocation.quinaCents])
        .toEqual([base, base, base, base]);
    }
  });

  it.each([0, 99, 100.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid total %s", (value) => {
    expect(() => allocateNumberStake(value)).toThrow(/at least 100 cents/i);
  });
});
