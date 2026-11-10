import { Prisma } from "@/generated/prisma/client";
import { getNumericPrizeReview, NUMERIC_PRIZE_CATEGORY_LABELS } from "@/domain/numeric-prize-review";

export type NumericPrizePayoutChannel = "PLATFORM_PIX" | "CASHIER_CASH";

export class NumericPrizePayoutError extends Error {
  constructor(public readonly code: "LINE_NOT_FOUND" | "NOT_ELIGIBLE" | "NOT_OWNED" | "ALREADY_PAID" | "INCONSISTENT_PRIZE") {
    super(code);
  }
}

export async function registerNumericPrizePayout(
  tx: Prisma.TransactionClient,
  input: {
    lineId: string;
    actorId: string;
    channel: NumericPrizePayoutChannel;
    cashierId?: string;
    reference?: string | null;
  },
) {
  if (input.channel === "CASHIER_CASH" && input.cashierId) {
    const cashierRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" = ${input.cashierId} AND "role" = 'CASHIER' FOR UPDATE`;
    if (cashierRows.length === 0) throw new NumericPrizePayoutError("NOT_OWNED");
  }
  await tx.$queryRaw`SELECT "id" FROM "NumericParticipationLine" WHERE "id" = ${input.lineId} FOR UPDATE`;
  const line = await tx.numericParticipationLine.findUnique({
    where: { id: input.lineId },
    select: {
      id: true,
      numberValue: true,
      prizeCents: true,
      prizeCreditedAt: true,
      unitCents: true, tensCents: true, hundredsCents: true, thousandsCents: true, quinaCents: true,
      ruleVersion: true, ruleSnapshot: true,
      participation: {
        select: {
          status: true,
          purchase: { select: { id: true, receiptCode: true, cashierId: true, playerId: true, status: true, confirmedAt: true } },
          round: { select: { id: true, code: true, status: true, resultNumber: true } },
        },
      },
      prizePayout: { select: { id: true } },
    },
  });
  if (!line) throw new NumericPrizePayoutError("LINE_NOT_FOUND");
  if (line.prizePayout || line.prizeCreditedAt) throw new NumericPrizePayoutError("ALREADY_PAID");

  const purchase = line.participation.purchase;
  const isCashierTicket = Boolean(purchase.cashierId) && purchase.playerId === null;
  // Both external payout channels are reserved for cashier-issued physical receipts.
  // Online-player prizes belong to the wallet and must never be paid through this flow.
  if (
    !isCashierTicket ||
    purchase.status !== "CONFIRMED" ||
    !purchase.confirmedAt ||
    line.participation.status !== "CONFIRMED" ||
    line.participation.round.status !== "COMPLETED" ||
    !line.prizeCents ||
    line.prizeCents <= 0
  ) throw new NumericPrizePayoutError("NOT_ELIGIBLE");

  if (input.channel === "CASHIER_CASH" && (!input.cashierId || purchase.cashierId !== input.cashierId)) {
    throw new NumericPrizePayoutError("NOT_OWNED");
  }

  const prizeReview = getNumericPrizeReview({
    numberValue: line.numberValue,
    unitCents: line.unitCents, tensCents: line.tensCents,
    hundredsCents: line.hundredsCents, thousandsCents: line.thousandsCents,
    quinaCents: line.quinaCents, ruleVersion: line.ruleVersion,
    ruleSnapshot: line.ruleSnapshot,
  }, line.participation.round.resultNumber);
  if (!prizeReview?.calculationConsistent || prizeReview.calculatedPrizeCents !== line.prizeCents) {
    throw new NumericPrizePayoutError("INCONSISTENT_PRIZE");
  }

  const payout = await tx.numericPrizePayout.create({
    data: {
      participationLineId: line.id,
      channel: input.channel,
      amountCents: line.prizeCents,
      actorId: input.actorId,
      cashierId: input.channel === "CASHIER_CASH" ? input.cashierId : null,
      reference: input.reference?.trim() || null,
    },
    select: {
      id: true,
      participationLineId: true,
      channel: true,
      amountCents: true,
      paidAt: true,
      reference: true,
    },
  });

  await tx.auditEvent.create({
    data: {
      actorId: input.actorId,
      action: input.channel === "CASHIER_CASH" ? "CASHIER_PRIZE_PAID_CASH" : "PLATFORM_PRIZE_PAID_PIX",
      entityType: "NumericPrizePayout",
      entityId: payout.id,
      metadata: {
        participationLineId: line.id,
        numberValue: line.numberValue,
        resultNumber: line.participation.round.resultNumber,
        prizeCategory: prizeReview.category,
        prizeCategoryLabel: NUMERIC_PRIZE_CATEGORY_LABELS[prizeReview.category],
        categoryStakeCents: prizeReview.stakeCents,
        multiplier: prizeReview.multiplier,
        calculatedPrizeCents: prizeReview.calculatedPrizeCents,
        receiptCode: purchase.receiptCode,
        purchaseId: purchase.id,
        roundId: line.participation.round.id,
        roundCode: line.participation.round.code,
        cashierId: purchase.cashierId,
        channel: input.channel,
        amountCents: payout.amountCents,
        reference: payout.reference,
        paidAt: payout.paidAt.toISOString(),
      },
    },
  });
  return payout;
}
