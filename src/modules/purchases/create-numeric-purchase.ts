import { randomBytes } from "node:crypto";
import { Prisma, PaymentMethod, RoundStatus, type PrismaClient } from "../../generated/prisma/client";
import { calculateCommissionCents } from "../../domain/cashier-commission";
import { allocateNumberStake } from "../../domain/allocate-number-stake";
import { DEFAULT_NUMERIC_PRIZE_MULTIPLIERS, createNumericPrizeRuleSnapshot, NUMERIC_PRIZE_RULE_VERSION, parseNumericPrizeMultipliers } from "../../domain/numeric-prize-rules";
import { normalizeNumber } from "../numbers/normalize-number";
import { selectNextValidRounds } from "../payments/select-next-valid-rounds";
import { PurchaseServiceError } from "./purchase-service-error";

export type NumericPurchaseInput = {
  idempotencyKey: string;
  playerId?: string;
  cashierId?: string;
  customerId?: string;
  paymentMethod?: "PIX" | "WALLET" | "CASH";
  roundIds?: string[];
  roundCount?: number;
  numbers: string[];
  stakeCents: number;
};

export async function createNumericPurchase(prisma: PrismaClient, input: NumericPurchaseInput, decisionTimeOverride?: Date) {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 200) throw new PurchaseServiceError("A valid idempotency key is required", "INVALID_IDEMPOTENCY_KEY");
  const roundCount = input.roundCount ?? input.roundIds?.length ?? 0;
  if (!Number.isInteger(roundCount) || roundCount < 1 || roundCount > 10) throw new PurchaseServiceError("Choose between 1 and 10 upcoming rounds", "INVALID_PURCHASE");
  if (input.roundIds && (input.roundIds.length !== roundCount || new Set(input.roundIds).size !== input.roundIds.length)) throw new PurchaseServiceError("Invalid round count", "INVALID_PURCHASE");
  if (!Array.isArray(input.numbers) || input.numbers.length < 1 || input.numbers.length > 100) throw new PurchaseServiceError("Enter at least one five-digit number", "INVALID_PURCHASE");
  if (!Number.isSafeInteger(input.stakeCents) || input.stakeCents < 100 || input.stakeCents > 2_000_000_000) throw new PurchaseServiceError("Each number must have a stake of at least R$1.00", "INVALID_PURCHASE");

  let numbers: string[];
  try { numbers = input.numbers.map(normalizeNumber); }
  catch { throw new PurchaseServiceError("Every entry must contain exactly five digits from 00000 to 99999", "INVALID_PURCHASE"); }

  const paymentMethod = input.paymentMethod === "CASH" ? PaymentMethod.CASH : input.paymentMethod === "WALLET" ? PaymentMethod.WALLET : PaymentMethod.PIX;
  if (paymentMethod === PaymentMethod.CASH && (!input.cashierId || input.playerId)) throw new PurchaseServiceError("Cash sales must be created by an authenticated cashier", "INVALID_ACTOR");
  if (paymentMethod === PaymentMethod.WALLET && (!input.playerId || input.cashierId)) throw new PurchaseServiceError("Wallet purchases must belong to the authenticated player", "INVALID_ACTOR");
  if (Boolean(input.playerId) === Boolean(input.cashierId)) throw new PurchaseServiceError("Exactly one player or cashier must own the purchase", "INVALID_ACTOR");

  const allocation = allocateNumberStake(input.stakeCents);
  const perRoundCents = numbers.length * input.stakeCents;
  const totalCents = perRoundCents * roundCount;
  if (!Number.isSafeInteger(perRoundCents) || perRoundCents > 2_147_483_647 || totalCents > 2_147_483_647) throw new PurchaseServiceError("Purchase total exceeds the database integer limit", "INVALID_PURCHASE");

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Coordinate cashier sales with the administrator's settlement boundary.
        if (input.cashierId) {
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.cashierId} AND "role" = 'CASHIER' FOR UPDATE`;
        }
        const existing = await tx.purchase.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: { participations: { include: { numericLines: true } }, payment: true, numericIntent: true },
        });
        if (existing) {
          const sameOwner = existing.paymentMethod === paymentMethod && existing.playerId === (input.playerId ?? null) &&
            existing.cashierId === (input.cashierId ?? null) && existing.customerId === (input.customerId ?? null);
          const intent = existing.numericIntent;
          const sameIntent = intent
            ? intent.roundCount === roundCount && JSON.stringify(intent.numbers) === JSON.stringify(numbers) &&
              JSON.stringify(intent.allocation) === JSON.stringify(allocation) && existing.totalCents === totalCents
            : existing.participations.length === roundCount &&
              existing.participations.every((part) => part.numericLines.length === numbers.length) &&
              existing.participations.flatMap((part) => part.numericLines.map((line) => line.numberValue + "|" +
                (line.unitCents + line.tensCents + line.hundredsCents + line.thousandsCents + line.quinaCents)))
                .sort().join("\n") === Array.from({ length: roundCount }, () => numbers.map((n) => n + "|" + input.stakeCents))
                .flat().sort().join("\n");
          if (!sameOwner || !sameIntent) throw new PurchaseServiceError("The idempotency key was already used for a different purchase", "IDEMPOTENCY_CONFLICT");
          return existing;
        }

        const configuredRules = await tx.setting.findUnique({ where: { key: "numeric_prize_multipliers" } });
        let currentMultipliers = DEFAULT_NUMERIC_PRIZE_MULTIPLIERS;
        if (configuredRules) {
          let parsedValue: unknown;
          try { parsedValue = JSON.parse(configuredRules.value); }
          catch { throw new PurchaseServiceError("A configuração de multiplicadores está inválida. Contate o administrador.", "INVALID_PRIZE_CONFIGURATION"); }
          const validated = parseNumericPrizeMultipliers(parsedValue);
          if (!validated) throw new PurchaseServiceError("A configuração de multiplicadores está inválida. Contate o administrador.", "INVALID_PRIZE_CONFIGURATION");
          currentMultipliers = validated;
        }
        const snapshot = createNumericPrizeRuleSnapshot(currentMultipliers);
        const maximumLinePrizeCents = Math.max(
          allocation.unitCents * currentMultipliers.unit,
          allocation.tensCents * currentMultipliers.tens,
          allocation.hundredsCents * currentMultipliers.hundreds,
          allocation.thousandsCents * currentMultipliers.thousands,
          allocation.quinaCents * currentMultipliers.quina,
        );
        if (!Number.isSafeInteger(maximumLinePrizeCents) || maximumLinePrizeCents > 2_147_483_647) {
          throw new PurchaseServiceError("Os multiplicadores atuais tornam o prêmio máximo maior que o limite financeiro suportado.", "INVALID_PURCHASE");
        }

        const isCash = paymentMethod === PaymentMethod.CASH;
        const isWallet = paymentMethod === PaymentMethod.WALLET;
        const isConfirmed = isCash || isWallet;
        let selectedRounds: Array<{ id: string }> = [];
        let decisionTime: Date | null = null;

        if (isConfirmed) {
          const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "Round"
            WHERE "status" IN ('OPEN', 'SCHEDULED')
              AND "startsAt" < "cutoffAt"
              AND "cutoffAt" < "resultAt"
              AND "cutoffAt" > clock_timestamp()
              AND "resultAt" > clock_timestamp()
            ORDER BY "resultAt" ASC, "id" ASC
            LIMIT ${roundCount}
            FOR UPDATE
          `;
          decisionTime = decisionTimeOverride ?? (await tx.$queryRaw<Array<{ decisionTime: Date }>>`
            SELECT clock_timestamp() AS "decisionTime"
          `)[0]!.decisionTime;
          const available = await tx.round.findMany({
            where: { id: { in: lockedRows.map((row) => row.id) }, status: { in: [RoundStatus.OPEN, RoundStatus.SCHEDULED] }, cutoffAt: { gt: decisionTime } },
            orderBy: [{ resultAt: "asc" }, { id: "asc" }],
          });
          selectedRounds = selectNextValidRounds(available, roundCount, decisionTime);
          // Paid cash/wallet purchases remain recorded if the scheduler is between rounds.
        }

        if (isWallet && input.playerId) {
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.playerId} FOR UPDATE`;
          const ledger = await tx.ledgerEntry.aggregate({ where: { userId: input.playerId }, _sum: { amountCents: true } });
          if ((ledger._sum.amountCents ?? 0) < totalCents) throw new PurchaseServiceError("Saldo insuficiente para esta compra.", "INSUFFICIENT_BALANCE");
        }

        
        const allocationPending = isConfirmed && selectedRounds.length !== roundCount;
        const allocatedNow = isConfirmed && !allocationPending;
        const receiptCode = allocatedNow ? "SQ-" + randomBytes(8).toString("hex").toUpperCase() : null;
        const created = await tx.purchase.create({
          data: {
            playerId: input.playerId ?? null, cashierId: input.cashierId ?? null, customerId: input.customerId ?? null,
            status: allocatedNow ? "CONFIRMED" : "PENDING_PAYMENT", paymentMethod, totalCents, currency: "BRL",
            receiptCode, confirmedAt: allocatedNow ? decisionTime : null, idempotencyKey: input.idempotencyKey,
            ...(allocatedNow ? {
              participations: { create: selectedRounds.map((round) => ({
                roundId: round.id, status: "CONFIRMED", totalCents: perRoundCents, confirmedAt: decisionTime!,
                numericLines: { create: numbers.map((numberValue) => ({
                  numberValue, ...allocation, ruleVersion: NUMERIC_PRIZE_RULE_VERSION, ruleSnapshot: snapshot,
                })) },
              })) },
            } : {
              numericIntent: { create: {
                roundCount, numbers, allocation, ruleVersion: NUMERIC_PRIZE_RULE_VERSION, ruleSnapshot: snapshot,
              } },
              ...(!isConfirmed ? {
                payment: { create: { provider: "MERCADO_PAGO", status: "PENDING", amountCents: totalCents, idempotencyKey: "pix-payment:" + input.idempotencyKey } },
              } : {}),
            }),
          },
          include: { participations: { include: { numericLines: true } }, payment: true, numericIntent: true },
        });

        if (isWallet && input.playerId) {
          await tx.ledgerEntry.create({ data: {
            userId: input.playerId, purchaseId: created.id, type: "PURCHASE_DEBIT", amountCents: -totalCents,
            currency: "BRL", idempotencyKey: "purchase-debit:" + created.id,
            description: "Pagamento de aposta numérica com saldo da conta " + created.id,
          } });
          await tx.auditEvent.create({ data: {
            actorId: input.playerId, action: "NUMERIC_WALLET_PURCHASE_CONFIRMED", entityType: "Purchase", entityId: created.id,
            metadata: { receiptCode, totalCents, paymentMethod: "WALLET", allocationPending },
          } });
        }
        if (isCash && input.cashierId) {
          const cashier = await tx.user.findFirst({ where: { id: input.cashierId, role: "CASHIER", status: "ACTIVE" }, select: { commissionRateBasisPoints: true } });
          if (!cashier) throw new PurchaseServiceError("Cashier is not active", "INVALID_ACTOR");
          await tx.cashierCommission.create({ data: {
            purchaseId: created.id, cashierId: input.cashierId, rateBasisPoints: cashier.commissionRateBasisPoints,
            amountCents: calculateCommissionCents(totalCents, cashier.commissionRateBasisPoints),
          } });
          await tx.auditEvent.create({ data: {
            actorId: input.cashierId, action: "NUMERIC_CASH_PURCHASE_CONFIRMED", entityType: "Purchase", entityId: created.id,
            metadata: { receiptCode, totalCents, allocationPending },
          } });
        }
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const known = error instanceof Prisma.PrismaClientKnownRequestError;
      const serialization = known && (error.code === "P2034" ||
        (error.code === "P2010" && (error.meta?.code === "40001" || error.message.toLowerCase().includes("could not serialize access"))));
      const target = known ? error.meta?.target : undefined;
      const idempotencyRace = known && error.code === "P2002" && attempt === 0 &&
        ((Array.isArray(target) && target.includes("idempotencyKey")) || (typeof target === "string" && target.toLowerCase().includes("idempotencykey")));
      if ((serialization && attempt < 3) || idempotencyRace) {
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}