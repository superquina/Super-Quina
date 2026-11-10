import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  ParticipationStatus,
  Prisma,
  PaymentMethod,
  PrismaClient,
  PurchaseStatus,
  RoundStatus,
  UserRole,
} from "../../generated/prisma/client";
import { createNumericPrizeRuleSnapshot, NUMERIC_PRIZE_RULE_VERSION } from "../../domain/numeric-prize-rules";
import { closeRound } from "./close-round";
import { drawRoundResults } from "./draw-round-results";
import { settleNumericRoundPrizes } from "./settle-numeric-round-prizes";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;

suite("PostgreSQL numeric round lifecycle", () => {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (enabled) {
    if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");
    const parsed = new URL(databaseUrl);
    if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(parsed.hostname) ||
        parsed.pathname.replace(/^\//, "").split("?")[0] !== "superquina_test") {
      throw new Error("Refusing to run round integration tests outside the local superquina_test database");
    }
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const roundIds: string[] = [];
  const purchaseIds: string[] = [];
  let playerId = "";

  async function createRound(status: RoundStatus, resultNumber: string | null = null) {
    const round = await prisma.round.create({
      data: {
        code: `IT-${suffix}-${roundIds.length}`,
        startsAt: new Date(Date.now() - 60_000),
        cutoffAt: new Date(Date.now() - 30_000),
        resultAt: new Date(Date.now() - 10_000),
        status,
        resultNumber,
      },
    });
    roundIds.push(round.id);
    return round;
  }

  async function createLine(roundId: string, snapshot: unknown) {
    const purchase = await prisma.purchase.create({
      data: {
        playerId,
        status: PurchaseStatus.CONFIRMED,
        paymentMethod: PaymentMethod.CASH,
        totalCents: 100,
        idempotencyKey: `it-round-${suffix}-${purchaseIds.length}`,
        confirmedAt: new Date(),
      },
    });
    purchaseIds.push(purchase.id);
    const participation = await prisma.purchaseParticipation.create({
      data: {
        purchaseId: purchase.id,
        roundId,
        status: ParticipationStatus.CONFIRMED,
        totalCents: 100,
        confirmedAt: new Date(),
      },
    });
    const line = await prisma.numericParticipationLine.create({
      data: {
        participationId: participation.id,
        numberValue: "12345",
        unitCents: 20,
        tensCents: 20,
        hundredsCents: 20,
        thousandsCents: 20,
        quinaCents: 20,
        ruleVersion: NUMERIC_PRIZE_RULE_VERSION,
        ruleSnapshot: snapshot as Prisma.InputJsonValue,
      },
    });
    return { purchase, line };
  }

  beforeAll(async () => {
    await prisma.$connect();
    const player = await prisma.user.create({
      data: {
        username: `it-round-${suffix}`,
        passwordHash: "integration-test-not-a-real-password",
        role: UserRole.PLAYER,
      },
    });
    playerId = player.id;
  });

  afterAll(async () => {
    if (roundIds.length) {
      await prisma.auditEvent.deleteMany({ where: { entityType: "Round", entityId: { in: roundIds } } });
      await prisma.numericParticipationLine.deleteMany({ where: { participation: { roundId: { in: roundIds } } } });
      await prisma.ledgerEntry.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
      await prisma.purchaseParticipation.deleteMany({ where: { roundId: { in: roundIds } } });
    }
    if (purchaseIds.length) await prisma.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
    if (roundIds.length) await prisma.round.deleteMany({ where: { id: { in: roundIds } } });
    if (playerId) await prisma.user.delete({ where: { id: playerId } });
    await prisma.$disconnect();
  });

  it("closes a round only once when scheduler executions race", async () => {
    const round = await createRound(RoundStatus.SCHEDULED);
    const [first, second] = await Promise.all([
      closeRound(prisma, round.id),
      closeRound(prisma, round.id),
    ]);

    expect(first.status).toBe(RoundStatus.CLOSED);
    expect(second.status).toBe(RoundStatus.CLOSED);
    expect(await prisma.auditEvent.count({
      where: { entityType: "Round", entityId: round.id, action: "ROUND_CLOSED_AUTOMATICALLY" },
    })).toBe(1);
  });

  it("returns one persisted result for simultaneous draw requests", async () => {
    const round = await createRound(RoundStatus.CLOSED);
    const [first, second] = await Promise.all([
      drawRoundResults(prisma, round.id),
      drawRoundResults(prisma, round.id),
    ]);
    expect(first.resultNumber).toMatch(/^\d{5}$/);
    expect(second.resultNumber).toBe(first.resultNumber);
    expect(first.status).toBe(RoundStatus.COMPLETED);
    expect(second.status).toBe(RoundStatus.COMPLETED);
    expect(await prisma.auditEvent.count({
      where: { entityType: "Round", entityId: round.id, action: "NUMERIC_ROUND_DRAWN_AUTOMATICALLY" },
    })).toBe(1);
  });

  it("credits a simultaneous settlement once using the saved prize rules", async () => {
    const round = await createRound(RoundStatus.COMPLETED, "12345");
    const { line } = await createLine(round.id, createNumericPrizeRuleSnapshot());
    const results = await Promise.all([
      settleNumericRoundPrizes(prisma, round.id),
      settleNumericRoundPrizes(prisma, round.id),
    ]);
    expect(results.every((result) => result.status === "settled")).toBe(true);
    expect(await prisma.ledgerEntry.count({
      where: { idempotencyKey: `numeric-prize-credit:${line.id}` },
    })).toBe(1);
    const saved = await prisma.numericParticipationLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(saved.prizeCents).toBe(400_000);
    expect(saved.prizeCreditedAt).not.toBeNull();
    expect(await prisma.auditEvent.count({
      where: { entityType: "Round", entityId: round.id, action: "NUMERIC_ROUND_PRIZES_SETTLED_AUTOMATICALLY" },
    })).toBe(1);
  });

  it("rolls back prize and ledger writes when the saved rule snapshot is invalid", async () => {
    const round = await createRound(RoundStatus.COMPLETED, "12345");
    const { line, purchase } = await createLine(round.id, {
      version: "invalid-version",
      multipliers: { unit: 5, tens: 20, hundreds: 200, thousands: 2000, quina: 20000 },
    });
    await expect(settleNumericRoundPrizes(prisma, round.id)).rejects.toMatchObject({
      code: "INVALID_RULE_SNAPSHOT",
    });
    expect(await prisma.ledgerEntry.count({ where: { purchaseId: purchase.id } })).toBe(0);
    const saved = await prisma.numericParticipationLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(saved.prizeCents).toBeNull();
    expect(saved.prizeCreditedAt).toBeNull();
  });
});
