export type EligibleRoundCandidate = {
  id: string;
  status: string;
  startsAt: Date;
  cutoffAt: Date;
  resultAt: Date;
};

/**
 * Select the earliest rounds that still accept participation at the decision
 * instant. Canceled/closed rounds and rounds whose cutoff has arrived are skipped.
 * Gaps are allowed: a canceled or missing slot does not invalidate later rounds.
 */
export function selectNextValidRounds<T extends EligibleRoundCandidate>(
  rounds: readonly T[],
  count: number,
  decisionTime: Date,
): T[] {
  if (!Number.isInteger(count) || count < 1 || Number.isNaN(decisionTime.getTime())) return [];
  return [...rounds]
    .filter((round) =>
      (round.status === "OPEN" || round.status === "SCHEDULED")
      && round.startsAt instanceof Date
      && round.cutoffAt instanceof Date
      && round.resultAt instanceof Date
      && !Number.isNaN(round.startsAt.getTime())
      && !Number.isNaN(round.cutoffAt.getTime())
      && !Number.isNaN(round.resultAt.getTime())
      && round.startsAt.getTime() < round.cutoffAt.getTime()
      && round.cutoffAt.getTime() < round.resultAt.getTime()
      && round.cutoffAt.getTime() > decisionTime.getTime()
      && round.resultAt.getTime() > decisionTime.getTime(),
    )
    .sort((a, b) => a.resultAt.getTime() - b.resultAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, count);
}
