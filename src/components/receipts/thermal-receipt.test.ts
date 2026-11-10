import { describe, expect, it } from "vitest";
import { getReceiptRepetitionNumbers } from "./receipt-repetition";
import type { ThermalReceiptEntry } from "./thermal-receipt-types";
const line = (roundCode: string, numberValue = "00007"): ThermalReceiptEntry => ({
  numberValue, roundCode, resultAt: "2026-10-28T04:00:00.000Z", stakeCents: 100,
});
describe("getReceiptRepetitionNumbers", () => {
  it("assigns one sequential number per distinct round while keeping multiple numbers together", () => {
    expect(getReceiptRepetitionNumbers([
      line("JN-ROUND-01", "00001"), line("JN-ROUND-01", "00002"),
      line("JN-ROUND-02", "00003"), line("JN-ROUND-03", "00004"),
    ])).toEqual([1, 1, 2, 3]);
  });
  it("supports ten consecutive repetitions without skipping numbers", () => {
    const entries = Array.from({ length: 10 }, (_, index) => line("JN-ROUND-" + String(index + 1).padStart(2, "0")));
    expect(getReceiptRepetitionNumbers(entries)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
  it("preserves leading zeroes in numeric entries", () => {
    expect(getReceiptRepetitionNumbers([line("JN-ROUND-01", "00007")])).toEqual([1]);
  });
  it("returns an empty sequence for an empty receipt", () => { expect(getReceiptRepetitionNumbers([])).toEqual([]); });
});
