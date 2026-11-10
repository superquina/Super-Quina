import { randomBytes } from "node:crypto";
import { Prisma, RoundStatus, type PrismaClient } from "../../generated/prisma/client";
import { calculateCommissionCents } from "../../domain/cashier-commission";
import { selectNextValidRounds } from "./select-next-valid-rounds";

export type ConfirmPaymentResult =
  | { outcome: "confirmed"; receiptCode: string }
  | { outcome: "already_confirmed"; receiptCode: string }
  | { outcome: "late_or_unavailable"; reason: string }
  | { outcome: "not_pending" };

export async function confirmPixPayment(
  prisma: PrismaClient,
  input: { paymentId: string; providerStatus: string; providerStatusDetail: string | null },
): Promise<ConfirmPaymentResult> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT p."id" FROM "Purchase" p JOIN "Payment" pay ON pay."purchaseId" = p."id" WHERE pay."id" = ${input.paymentId} FOR UPDATE OF p, pay`;
        const paymentRow = await tx.payment.findUnique({
          where: { id: input.paymentId },
          select: {
            id: true, purchaseId: true, status: true, amountCents: true,
            purchase: { select: { status: true, totalCents: true, receiptCode: true, cashierId: true,
              numericIntent: { select: { roundCount: true, numbers: true, allocation: true, ruleVersion: true, ruleSnapshot: true } },
            } },
          },
        });
        if (!paymentRow) return { outcome: "not_pending" } as const;
        if (paymentRow.status === "CONFIRMED" && paymentRow.purchase.status === "CONFIRMED" && paymentRow.purchase.receiptCode) {
          return { outcome: "already_confirmed", receiptCode: paymentRow.purchase.receiptCode } as const;
        }
        if (paymentRow.status !== "PENDING" || paymentRow.purchase.status !== "PENDING_PAYMENT") return { outcome: "not_pending" } as const;
        // The cashier row is the shared lock used by settlement and cashier sales.
        if (paymentRow.purchase.cashierId) {
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${paymentRow.purchase.cashierId} AND "role" = 'CASHIER' FOR UPDATE`;
        }
        if (paymentRow.amountCents !== paymentRow.purchase.totalCents) throw new Error("Persisted payment and purchase totals do not match");

        const participations = await tx.purchaseParticipation.findMany({
          where: { purchaseId: paymentRow.purchaseId, status: "PENDING" },
          select: { id: true, roundId: true, totalCents: true },
          orderBy: [{ round: { resultAt: "asc" } }, { id: "asc" }],
        });
        const intent = paymentRow.purchase.numericIntent;
        const requiredCount = participations.length || intent?.roundCount || 0;
        if (!requiredCount || (intent && participations.length)) throw new Error("Purchase intent and provisional participations are inconsistent");

        const originalRoundIds = [...new Set(participations.map((item) => item.roundId))].sort();
        const lockedRoundRows = originalRoundIds.length
          ? await tx.$queryRaw<Array<{ id: string }>>`
              WITH target_rounds AS (
                SELECT "id" FROM "Round"
                WHERE "status" IN ('OPEN', 'SCHEDULED')
                  AND "startsAt" < "cutoffAt"
                  AND "cutoffAt" < "resultAt"
                  AND "cutoffAt" > clock_timestamp()
                  AND "resultAt" > clock_timestamp()
                ORDER BY "resultAt" ASC, "id" ASC
                LIMIT ${requiredCount}
              ),
              original_rounds AS (
                SELECT "id" FROM "Round" WHERE "id" IN (${Prisma.join(originalRoundIds)})
              )
              SELECT r."id" FROM "Round" r
              WHERE r."id" IN (
                SELECT "id" FROM target_rounds
                UNION
                SELECT "id" FROM original_rounds
              )
              ORDER BY r."id" FOR UPDATE OF r
            `
          : await tx.$queryRaw<Array<{ id: string }>>`
              SELECT "id" FROM "Round"
              WHERE "status" IN ('OPEN', 'SCHEDULED')
                AND "startsAt" < "cutoffAt"
                AND "cutoffAt" < "resultAt"
                AND "cutoffAt" > clock_timestamp()
                AND "resultAt" > clock_timestamp()
              ORDER BY "resultAt" ASC, "id" ASC
              LIMIT ${requiredCount}
              FOR UPDATE
            `;
        const lockedRoundIds = lockedRoundRows.map((round) => round.id);
        const decisionTime = (await tx.$queryRaw<Array<{ decisionTime: Date }>>`
          SELECT clock_timestamp() AS "decisionTime"
        `)[0]!.decisionTime;

        const [originalRounds, availableRounds] = await Promise.all([
          originalRoundIds.length ? tx.round.findMany({ where: { id: { in: originalRoundIds } } }) : Promise.resolve([]),
          tx.round.findMany({
            where: { id: { in: lockedRoundIds }, status: { in: [RoundStatus.OPEN, RoundStatus.SCHEDULED] }, cutoffAt: { gt: decisionTime } },
            orderBy: [{ resultAt: "asc" }, { id: "asc" }],
          }),
        ]);
        const targetRounds = selectNextValidRounds(availableRounds, requiredCount, decisionTime);
        if (targetRounds.length !== requiredCount) {
          await tx.payment.update({ where: { id: paymentRow.id }, data: { providerStatus: input.providerStatus, providerStatusDetail: input.providerStatusDetail } });
          const prior = await tx.auditEvent.findFirst({
            where: { action: "PIX_PAYMENT_APPROVED_WITHOUT_AVAILABLE_ROUNDS", entityType: "Purchase", entityId: paymentRow.purchaseId },
            select: { id: true },
          });
          if (!prior) await tx.auditEvent.create({
            data: {
              action: "PIX_PAYMENT_APPROVED_WITHOUT_AVAILABLE_ROUNDS", entityType: "Purchase", entityId: paymentRow.purchaseId,
              metadata: {
                paymentId: paymentRow.id, decisionTime: decisionTime.toISOString(),
                requiredParticipations: requiredCount, availableParticipations: targetRounds.length,
                originalRounds: originalRounds.map((round) => ({ code: round.code, startsAt: round.startsAt.toISOString(), cutoffAt: round.cutoffAt.toISOString(), resultAt: round.resultAt.toISOString() })),
                outcome: "automatic_reconciliation_pending",
              },
            },
          });
          return { outcome: "late_or_unavailable", reason: "NO_NEXT_VALID_ROUND" } as const;
        }

        if (intent) {
          const numbersValue: unknown = intent.numbers;
          const allocationValue: unknown = intent.allocation;
          if (!Array.isArray(numbersValue) || numbersValue.length === 0 ||
              !allocationValue || typeof allocationValue !== "object" || Array.isArray(allocationValue)) {
            throw new Error("Persisted numeric purchase intent is invalid");
          }
          const numbers = numbersValue as string[];
          const allocation = allocationValue as { unitCents: number; tensCents: number; hundredsCents: number; thousandsCents: number; quinaCents: number };
          const ruleSnapshot = intent.ruleSnapshot as Prisma.InputJsonValue;
          const allocationValues = [allocation.unitCents, allocation.tensCents, allocation.hundredsCents, allocation.thousandsCents, allocation.quinaCents];
          if (numbers.some((number) => typeof number !== "string" || !/^\d{5}$/.test(number)) ||
              allocationValues.some((value) => !Number.isSafeInteger(value) || value < 0) ||
              allocationValues.reduce((sum, value) => sum + value, 0) < 100) {
            throw new Error("Persisted numeric purchase intent is invalid");
          }
          const perRoundCents = numbers.length * allocationValues.reduce((sum, value) => sum + value, 0);
          if (!Number.isSafeInteger(perRoundCents) || !Number.isSafeInteger(perRoundCents * requiredCount) ||
              perRoundCents * requiredCount !== paymentRow.purchase.totalCents) {
            throw new Error("Persisted numeric purchase intent total does not match payment");
          }
          for (const round of targetRounds) {
            await tx.purchaseParticipation.create({
              data: {
                purchaseId: paymentRow.purchaseId, roundId: round.id, status: "PENDING",
                totalCents: perRoundCents,
                numericLines: { create: numbers.map((numberValue) => ({
                  numberValue, ...allocation, ruleVersion: intent.ruleVersion, ruleSnapshot,
                })) },
              },
            });
          }
        } else {
          for (let index = participations.length - 1; index >= 0; index -= 1) {
            const participation = participations[index]!;
            const target = targetRounds[index]!;
            if (participation.roundId !== target.id) {
              await tx.purchaseParticipation.update({ where: { id: participation.id }, data: { roundId: target.id, totalCents: participation.totalCents } });
            }
          }
        }

        const receiptCode = "SQ-" + randomBytes(8).toString("hex").toUpperCase();
        await tx.payment.update({
          where: { id: paymentRow.id },
          data: { status: "CONFIRMED", providerStatus: input.providerStatus, providerStatusDetail: input.providerStatusDetail, confirmedAt: decisionTime },
        });
        const confirmedParts = await tx.purchaseParticipation.updateMany({
          where: { purchaseId: paymentRow.purchaseId, status: "PENDING" },
          data: { status: "CONFIRMED", confirmedAt: decisionTime },
        });
        if (confirmedParts.count !== requiredCount) throw new Error("Confirmed participation count does not match the purchase intent");
        await tx.purchase.update({
          where: { id: paymentRow.purchaseId },
          data: { status: "CONFIRMED", confirmedAt: decisionTime, receiptCode },
        });
        if (paymentRow.purchase.cashierId) {
          const cashier = await tx.user.findFirst({
            where: { id: paymentRow.purchase.cashierId, role: "CASHIER" },
            select: { commissionRateBasisPoints: true },
          });
          if (!cashier) throw new Error("Cashier commission owner is invalid");
          await tx.cashierCommission.create({
            data: {
              purchaseId: paymentRow.purchaseId, cashierId: paymentRow.purchase.cashierId,
              rateBasisPoints: cashier.commissionRateBasisPoints,
              amountCents: calculateCommissionCents(paymentRow.purchase.totalCents, cashier.commissionRateBasisPoints),
            },
          });
        }
        await tx.auditEvent.create({
          data: {
            action: "PIX_PAYMENT_CONFIRMED", entityType: "Purchase", entityId: paymentRow.purchaseId,
            metadata: {
              paymentId: paymentRow.id, receiptCode, providerStatus: input.providerStatus, decisionTime: decisionTime.toISOString(),
              originalRounds: originalRounds.map((round) => ({ code: round.code, startsAt: round.startsAt.toISOString(), cutoffAt: round.cutoffAt.toISOString(), resultAt: round.resultAt.toISOString() })),
              assignedRounds: targetRounds.map((round) => ({ code: round.code, startsAt: round.startsAt.toISOString(), cutoffAt: round.cutoffAt.toISOString(), resultAt: round.resultAt.toISOString() })),
            },
          },
        });
        return { outcome: "confirmed", receiptCode } as const;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const serializationConflict = error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || (error.code === "P2010" && (error.meta?.code === "40001" || error.message.toLowerCase().includes("could not serialize access"))));
      if (serializationConflict && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}
