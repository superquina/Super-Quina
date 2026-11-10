import { describe, expect, it } from "vitest";
import { selectNextValidRounds } from "./select-next-valid-rounds";

const instant = new Date("2026-10-30T15:00:00.000Z");
const round = (id: string, resultAt: string, status = "SCHEDULED", cutoffAt?: string) => ({
  id,
  status,
  startsAt: new Date(new Date(resultAt).getTime() - 29 * 60_000),
  cutoffAt: new Date(cutoffAt ?? new Date(new Date(resultAt).getTime() - 60_000).toISOString()),
  resultAt: new Date(resultAt),
});

describe("selectNextValidRounds", () => {
  it("selects the earliest eligible rounds using the decision instant", () => {
    const rounds = [
      round("later", "2026-10-30T16:00:00.000Z"),
      round("first", "2026-10-30T15:30:00.000Z", "OPEN"),
      round("closed", "2026-10-30T15:10:00.000Z", "CLOSED"),
    ];
    expect(selectNextValidRounds(rounds, 2, instant).map((item) => item.id)).toEqual(["first", "later"]);
  });

  it("skips a round whose cutoff has arrived and continues to the next valid round", () => {
    const cutoffPassed = {
      ...round("cutoff-passed", "2026-10-30T15:30:00.000Z", "OPEN", "2026-10-30T15:00:00.000Z"),
      startsAt: new Date("2026-10-30T14:31:00.000Z"),
    };
    const rounds = [cutoffPassed, round("next", "2026-10-30T16:00:00.000Z")];
    expect(selectNextValidRounds(rounds, 1, instant).map((item) => item.id)).toEqual(["next"]);
  });

  it("accepts sales during the close-draw-open gap into the next scheduled round", () => {
    const previousRound = round("just-closed", "2026-10-30T15:30:00.000Z", "CLOSED", "2026-10-30T15:29:00.000Z");
    const nextScheduledRound = round("next-opening", "2026-10-30T16:00:00.000Z");

    // 12:29, 12:30 and 12:30:59 in Brasília (UTC-03:00).
    for (const decisionTime of [
      new Date("2026-10-30T15:29:00.000Z"),
      new Date("2026-10-30T15:30:00.000Z"),
      new Date("2026-10-30T15:30:59.000Z"),
    ]) {
      expect(selectNextValidRounds([previousRound, nextScheduledRound], 1, decisionTime).map((item) => item.id))
        .toEqual(["next-opening"]);
    }
  });

  it("returns fewer rounds when the requested repetition count cannot be satisfied", () => {
    expect(selectNextValidRounds([round("only", "2026-10-30T15:30:00.000Z")], 2, instant)).toHaveLength(1);
  });

  it("rejects invalid counts and invalid decision timestamps", () => {
    const rounds = [round("one", "2026-10-30T15:30:00.000Z")];
    expect(selectNextValidRounds(rounds, 0, instant)).toEqual([]);
    expect(selectNextValidRounds(rounds, 1, new Date("invalid"))).toEqual([]);
  });
});
