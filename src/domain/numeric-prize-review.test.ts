import { describe, expect, it } from "vitest";
import { allocateNumberStake } from "./allocate-number-stake";
import { createNumericPrizeRuleSnapshot, NUMERIC_PRIZE_RULE_VERSION } from "./numeric-prize-rules";
import { getNumericPrizeReview } from "./numeric-prize-review";

function line(numberValue: string, totalCents = 100) {
  return {
    numberValue,
    ...allocateNumberStake(totalCents),
    ruleVersion: NUMERIC_PRIZE_RULE_VERSION,
    ruleSnapshot: createNumericPrizeRuleSnapshot(),
  };
}

describe("getNumericPrizeReview", () => {
  it("identifies only the highest matching category and its stake", () => {
    const review = getNumericPrizeReview(line("12345"), "99335");
    expect(review).toMatchObject({ category: "unit", stakeCents: 20, multiplier: 5, calculatedPrizeCents: 100, calculationConsistent: true });
  });

  it("identifies tens, hundreds, thousands and quina correctly", () => {
    expect(getNumericPrizeReview(line("12345"), "99445")?.category).toBe("tens");
    expect(getNumericPrizeReview(line("12345"), "99345")?.category).toBe("hundreds");
    expect(getNumericPrizeReview(line("12345"), "92345")?.category).toBe("thousands");
    expect(getNumericPrizeReview(line("12345"), "12345")?.category).toBe("quina");
  });

  it("returns null when there is no match or no result", () => {
    expect(getNumericPrizeReview(line("12345"), "99336")).toBeNull();
    expect(getNumericPrizeReview(line("12345"), null)).toBeNull();
  });

  it("marks invalid historical rule snapshots as inconsistent", () => {
    expect(getNumericPrizeReview({ ...line("12345"), ruleSnapshot: null }, "99335")?.calculationConsistent).toBe(false);
  });
});
