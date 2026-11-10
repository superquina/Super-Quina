import { describe, expect, it } from "vitest";
import {
  APPROVED_NUMERIC_PRIZE_MULTIPLIERS,
  createNumericPrizeRuleSnapshot,
  NUMERIC_PRIZE_RULE_VERSION,
  readNumericPrizeMultipliers,
} from "./numeric-prize-rules";

describe("numeric prize rules", () => {
  it("defines the five approved categories and multipliers", () => {
    expect(APPROVED_NUMERIC_PRIZE_MULTIPLIERS).toEqual({
      unit: 3, tens: 30, hundreds: 300, thousands: 3_000, quina: 30_000,
    });
  });

  it("creates and reads a versioned immutable-at-purchase snapshot", () => {
    const snapshot = createNumericPrizeRuleSnapshot();
    expect(snapshot.version).toBe(NUMERIC_PRIZE_RULE_VERSION);
    expect(readNumericPrizeMultipliers(snapshot.version, snapshot)).toEqual(snapshot.multipliers);
  });

  it("keeps the previous version readable for purchases already saved with its snapshot", () => {
    const historical = { version: "numeric-approved-v1", multipliers: { unit: 6, tens: 30, hundreds: 300, thousands: 3_000, quina: 300_000 } };
    expect(readNumericPrizeMultipliers("numeric-approved-v1", historical)).toEqual(historical.multipliers);
  });

  it("rejects missing, mismatched, or malformed historical snapshots", () => {
    const valid = createNumericPrizeRuleSnapshot();
    expect(readNumericPrizeMultipliers("other", valid)).toBeNull();
    expect(readNumericPrizeMultipliers(valid.version, null)).toBeNull();
    expect(readNumericPrizeMultipliers(valid.version, {
      version: valid.version, multipliers: { ...valid.multipliers, quina: -1 },
    })).toBeNull();
  });
});
