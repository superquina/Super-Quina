/**
 * Calculates a cashier's commission in integer cents using the rate snapshot
 * that was active when the sale was confirmed. Rounds half up to one cent.
 */
export function calculateCommissionCents(totalCents: number, rateBasisPoints: number): number {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    throw new RangeError("totalCents must be a non-negative safe integer");
  }
  if (!Number.isInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 10000) {
    throw new RangeError("rateBasisPoints must be an integer between 0 and 10000");
  }
  return Math.floor((totalCents * rateBasisPoints + 5000) / 10000);
}
