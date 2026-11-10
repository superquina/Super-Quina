import { describe, expect, it } from "vitest";
import { assertValidRoundWindow, canAcceptBet } from "./round-window";

const round = {
  startsAt: new Date("2026-10-23T12:00:00.000Z"),
  cutoffAt: new Date("2026-10-23T12:29:00.000Z"),
  resultAt: new Date("2026-10-23T12:30:00.000Z"),
};

describe("canAcceptBet", () => {
  it("accepts a bet before cutoff", () => {
    expect(canAcceptBet(round, new Date("2026-10-23T12:28:59.999Z"))).toBe(true);
  });

  it("rejects a bet exactly at or after cutoff", () => {
    expect(canAcceptBet(round, round.cutoffAt)).toBe(false);
    expect(canAcceptBet(round, new Date("2026-10-23T12:29:01.000Z"))).toBe(false);
  });

  it("rejects malformed round windows and invalid dates", () => {
    expect(canAcceptBet({ ...round, cutoffAt: round.startsAt }, new Date())).toBe(false);
    expect(canAcceptBet(round, new Date(Number.NaN))).toBe(false);
  });
});

describe("assertValidRoundWindow", () => {
  it("accepts an ordered round window", () => {
    expect(() => assertValidRoundWindow(round)).not.toThrow();
  });

  it("rejects cutoff after result", () => {
    expect(() =>
      assertValidRoundWindow({ ...round, cutoffAt: new Date("2026-10-23T12:31:00.000Z") }),
    ).toThrow();
  });
});
