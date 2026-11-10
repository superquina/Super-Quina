import { Prisma, RoundStatus, type PrismaClient } from "../../generated/prisma/client";
import { calculateNumberPrizeCents } from "../numbers/calculate-number-prize";
import { RoundSettlementError } from "./round-settlement-error";

function isSerializationConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === "P2034" ||
    (error.code === "P2010" && (error.meta?.code === "40001" || error.message.toLowerCase().includes("could not serialize access")));
}

/** Settle only confirmed numeric lines and credit player prizes idempotently in the same transaction. */
export async function settleNumericRoundPrizes(prisma: PrismaClient, roundId: string, actorId?: string) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT "id" FROM "Round" WHERE "id" = $1 FOR UPDATE', roundId,
        );
        if (locked.length === 0) throw new RoundSettlementError("Round not found", "ROUND_NOT_FOUND");

        const round = await tx.round.findUnique({ where: { id: roundId } });
        if (!round) throw new RoundSettlementError("Round not found", "ROUND_NOT_FOUND");
        if (round.status !== RoundStatus.COMPLETED || !round.resultNumber) {
          throw new RoundSettlementError("A completed numeric result is required", "ROUND_NOT_DRAWN");
        }

        await tx.$queryRawUnsafe(
          'SELECT nl."id" FROM "NumericParticipationLine" nl JOIN "PurchaseParticipation" pp ON pp."id" = nl."participationId" JOIN "Purchase" p ON p."id" = pp."purchaseId" WHERE pp."roundId" = $1 AND pp."status" = \'CONFIRMED\' AND p."status" = \'CONFIRMED\' ORDER BY nl."id" FOR UPDATE OF nl',
          roundId,
        );

        const lines = await tx.numericParticipationLine.findMany({
          where: { participation: { is: { roundId, status: "CONFIRMED", purchase: { is: { status: "CONFIRMED" } } } } },
          include: { participation: { include: { purchase: true } } },
          orderBy: { id: "asc" },
        });

        let creditedLines = 0;
        let pendingManualPayouts = 0;
        let totalPrizeCents = 0;
        for (const line of lines) {
          let prize: number;
          try {
            prize = calculateNumberPrizeCents({
              numberValue: line.numberValue,
              unitCents: line.unitCents,
              tensCents: line.tensCents,
              hundredsCents: line.hundredsCents,
              thousandsCents: line.thousandsCents,
              quinaCents: line.quinaCents,
              ruleVersion: line.ruleVersion,
              ruleSnapshot: line.ruleSnapshot,
            }, round.resultNumber);
          } catch {
            throw new RoundSettlementError("Numeric bet or saved rule snapshot is invalid", "INVALID_RULE_SNAPSHOT");
          }

          if (line.prizeCents !== null && line.prizeCents !== prize) {
            throw new RoundSettlementError("Stored numeric prize differs from deterministic recalculation for line " + line.id, "INCONSISTENT_SETTLEMENT");
          }
          if (line.prizeCents === null) {
            await tx.numericParticipationLine.update({ where: { id: line.id }, data: { prizeCents: prize } });
          }
          totalPrizeCents += prize;
          if (!Number.isSafeInteger(totalPrizeCents)) {
            throw new RoundSettlementError("Round prize total exceeds safe integer range", "INCONSISTENT_SETTLEMENT");
          }
          if (prize === 0) continue;

          const purchase = line.participation.purchase;
          const playerId = purchase.playerId;
          if (!playerId || purchase.cashierId !== null) {
            pendingManualPayouts += 1;
            continue;
          }

          const idempotencyKey = "numeric-prize-credit:" + line.id;
          const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey } });
          if (existing) {
            if (existing.userId !== playerId || existing.amountCents !== prize ||
                existing.type !== "PRIZE_CREDIT" || existing.participationId !== line.participationId) {
              throw new RoundSettlementError("Existing numeric prize ledger entry conflicts with calculated award", "INCONSISTENT_SETTLEMENT");
            }
          } else {
            await tx.ledgerEntry.create({
              data: {
                userId: playerId,
                purchaseId: line.participation.purchaseId,
                participationId: line.participationId,
                type: "PRIZE_CREDIT",
                amountCents: prize,
                currency: purchase.currency,
                idempotencyKey,
                description: "Prêmio numérico da rodada " + round.code + " — linha " + line.id,
              },
            });
          }
          if (line.prizeCreditedAt === null) {
            await tx.numericParticipationLine.update({ where: { id: line.id }, data: { prizeCreditedAt: new Date() } });
          }
          creditedLines += 1;
        }

        const settlementAction = actorId
          ? "NUMERIC_ROUND_PRIZES_SETTLED"
          : "NUMERIC_ROUND_PRIZES_SETTLED_AUTOMATICALLY";
        const priorSettlementAudit = await tx.auditEvent.findFirst({
          where: { action: settlementAction, entityType: "Round", entityId: roundId },
          select: { id: true },
        });
        if (!priorSettlementAudit) {
          await tx.auditEvent.create({
            data: {
              ...(actorId ? { actorId } : {}),
              action: settlementAction,
              entityType: "Round",
              entityId: roundId,
              metadata: { eligibleLines: lines.length, creditedLines, pendingManualPayouts, totalPrizeCents },
            },
          });
        }

        return {
          roundId,
          status: "settled" as const,
          eligibleLines: lines.length,
          creditedLines,
          pendingManualPayouts,
          totalPrizeCents,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isSerializationConflict(error) && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}
