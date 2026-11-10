export type RoundWindow = {
  startsAt: Date;
  cutoffAt: Date;
  resultAt: Date;
};

/**
 * A bet may enter a round only before its configured cutoff instant.
 * The caller must use server/database time and persist the decision in the
 * same transaction that creates the participation.
 */
export function canAcceptBet(round: RoundWindow, now: Date): boolean {
  if (
    Number.isNaN(round.startsAt.getTime()) ||
    Number.isNaN(round.cutoffAt.getTime()) ||
    Number.isNaN(round.resultAt.getTime()) ||
    Number.isNaN(now.getTime())
  ) {
    return false;
  }

  if (
    round.startsAt.getTime() >= round.cutoffAt.getTime() ||
    round.cutoffAt.getTime() >= round.resultAt.getTime()
  ) {
    return false;
  }

  return now.getTime() < round.cutoffAt.getTime();
}

export function assertValidRoundWindow(round: RoundWindow): void {
  if (
    Number.isNaN(round.startsAt.getTime()) ||
    Number.isNaN(round.cutoffAt.getTime()) ||
    Number.isNaN(round.resultAt.getTime())
  ) {
    throw new Error("Os horários da rodada devem ser datas válidas.");
  }

  if (
    round.startsAt.getTime() >= round.cutoffAt.getTime() ||
    round.cutoffAt.getTime() >= round.resultAt.getTime()
  ) {
    throw new Error("A rodada deve iniciar antes do fechamento, que deve ocorrer antes do resultado.");
  }
}
