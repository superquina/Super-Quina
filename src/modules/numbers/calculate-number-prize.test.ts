import { describe, expect, it } from "vitest";
import { allocateNumberStake } from "../../domain/allocate-number-stake";
import { createNumericPrizeRuleSnapshot, NUMERIC_PRIZE_RULE_VERSION } from "../../domain/numeric-prize-rules";
import { calculateNumberPrizeCents } from "./calculate-number-prize";

function line(numberValue: string) {
  return {
    numberValue,
    ...allocateNumberStake(100),
    ruleVersion: NUMERIC_PRIZE_RULE_VERSION,
    ruleSnapshot: createNumericPrizeRuleSnapshot(),
  };
}

describe("calculateNumberPrizeCents", () => {
  it("pays only the highest matching category when lower suffixes also match", () => {
    // Final three digits match; unit and tens are included in the match but not paid separately.
    expect(calculateNumberPrizeCents(line("12345"), "99345")).toBe(20 * 500);
  });

  it("pays only quina on an exact five-digit match", () => {
    expect(calculateNumberPrizeCents(line("01234"), "01234")).toBe(20 * 50_000);
  });

  it("pays only quadra when the final four digits match", () => {
    expect(calculateNumberPrizeCents(line("12345"), "92345")).toBe(20 * 5_000);
  });

  it("pays only terno when the final three digits match", () => {
    expect(calculateNumberPrizeCents(line("12345"), "99345")).toBe(20 * 500);
  });

  it("pays only dezena when only the final two digits match", () => {
    expect(calculateNumberPrizeCents(line("12345"), "99445")).toBe(20 * 50);
  });

  it("pays only unidade when only the final digit matches", () => {
    expect(calculateNumberPrizeCents(line("12345"), "99335")).toBe(20 * 5);
  });

  it("returns zero when no suffix matches", () => {
    expect(calculateNumberPrizeCents(line("12345"), "99336")).toBe(0);
  });

  it("uses leading zeroes literally", () => {
    expect(calculateNumberPrizeCents(line("00007"), "12307")).toBe(20 * 50);
  });

  it("rejects invalid snapshots and allocations", () => {
    const valid = line("12345");
    expect(() => calculateNumberPrizeCents({ ...valid, ruleSnapshot: null }, "12345")).toThrow(/snapshot/i);
    expect(() => calculateNumberPrizeCents({ ...valid, quinaCents: -1 }, "12345")).toThrow(/allocation/i);
  });
});
