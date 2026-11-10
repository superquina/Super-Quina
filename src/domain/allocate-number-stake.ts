export type NumberStakeAllocation = {
  unitCents: number;
  tensCents: number;
  hundredsCents: number;
  thousandsCents: number;
  quinaCents: number;
};

/** Splits the stake equally across five categories; any remainder goes to unit. */
export function allocateNumberStake(totalCents: number): NumberStakeAllocation {
  if (!Number.isSafeInteger(totalCents) || totalCents < 100) {
    throw new Error("Number stake must be a safe integer of at least 100 cents");
  }

  const baseCents = Math.floor(totalCents / 5);
  const remainderCents = totalCents % 5;
  return {
    unitCents: baseCents + remainderCents,
    tensCents: baseCents,
    hundredsCents: baseCents,
    thousandsCents: baseCents,
    quinaCents: baseCents,
  };
}
