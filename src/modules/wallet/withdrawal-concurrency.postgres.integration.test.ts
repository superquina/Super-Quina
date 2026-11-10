import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../../generated/prisma/client";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;

suite("PostgreSQL wallet withdrawal concurrency", () => {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (enabled) {
    if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");
    const parsed = new URL(databaseUrl);
    if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(parsed.hostname) ||
        parsed.pathname.replace(/^\//, "").split("?")[0] !== "superquina_test") {
      throw new Error("Refusing to run withdrawal integration tests outside the local superquina_test database");
    }
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const playerId = `it-wallet-player-${suffix}`;
  const adminId = `it-wallet-admin-${suffix}`;
  const adminRacePlayerId = `it-wallet-admin-race-player-${suffix}`;
  const withdrawalIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({ data: [
      { id: playerId, username: `it-wallet-player-${suffix}`, passwordHash: "integration-test", role: "PLAYER" },
      { id: adminId, username: `it-wallet-admin-${suffix}`, passwordHash: "integration-test", role: "ADMIN" },
      { id: adminRacePlayerId, username: `it-wallet-admin-race-player-${suffix}`, passwordHash: "integration-test", role: "PLAYER" },
    ] });
  });

  afterAll(async () => {
    if (withdrawalIds.length) {
      await prisma.auditEvent.deleteMany({ where: { entityType: "Withdrawal", entityId: { in: withdrawalIds } } });
      await prisma.withdrawalStatusHistory.deleteMany({ where: { withdrawalId: { in: withdrawalIds } } });
      await prisma.ledgerEntry.deleteMany({ where: { withdrawalId: { in: withdrawalIds } } });
      await prisma.withdrawal.deleteMany({ where: { id: { in: withdrawalIds } } });
    }
    await prisma.ledgerEntry.deleteMany({ where: { userId: playerId } });
    await prisma.ledgerEntry.deleteMany({ where: { userId: adminRacePlayerId } });
    await prisma.user.deleteMany({ where: { id: { in: [playerId, adminId, adminRacePlayerId] } } });
    await prisma.$disconnect();
  });

  it("reserves a player's full balance only once when two withdrawal requests overlap", async () => {
    await prisma.ledgerEntry.create({ data: {
      userId: playerId, type: "DEPOSIT", amountCents: 7500,
      idempotencyKey: `it-wallet-deposit-${suffix}`, description: "Integration test funding",
    } });

    const requestWithdrawal = () => prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT "id" FROM "User" WHERE "id" = $1 FOR UPDATE', playerId);
      const balance = await tx.ledgerEntry.aggregate({ where: { userId: playerId }, _sum: { amountCents: true } });
      const amountCents = balance._sum.amountCents ?? 0;
      if (amountCents <= 0) throw new Error("INSUFFICIENT_BALANCE");
      const withdrawal = await tx.withdrawal.create({ data: {
        userId: playerId, amountCents, pixKeyEncrypted: "integration-test-encrypted",
        idempotencyKey: `it-wallet-withdrawal-${randomUUID()}`,
      } });
      withdrawalIds.push(withdrawal.id);
      await tx.ledgerEntry.create({ data: {
        userId: playerId, withdrawalId: withdrawal.id, type: "WITHDRAWAL_RESERVE",
        amountCents: -amountCents, idempotencyKey: `withdrawal-reserve:${withdrawal.id}`,
        description: "Integration test withdrawal reserve",
      } });
      await tx.withdrawalStatusHistory.create({ data: {
        withdrawalId: withdrawal.id, fromStatus: null, toStatus: "PENDING", actorId: playerId,
        note: "Integration test request",
      } });
      return withdrawal.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const outcomes = await Promise.allSettled([requestWithdrawal(), requestWithdrawal()]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);

    const [balance, withdrawals, reservations] = await Promise.all([
      prisma.ledgerEntry.aggregate({ where: { userId: playerId }, _sum: { amountCents: true } }),
      prisma.withdrawal.count({ where: { userId: playerId, status: "PENDING" } }),
      prisma.ledgerEntry.count({ where: { userId: playerId, type: "WITHDRAWAL_RESERVE" } }),
    ]);
    expect(balance._sum.amountCents).toBe(0);
    expect(withdrawals).toBe(1);
    expect(reservations).toBe(1);
  });

  it("allows only one administrator action to close a pending withdrawal", async () => {
    await prisma.ledgerEntry.create({ data: {
      userId: adminRacePlayerId, type: "DEPOSIT", amountCents: 7500,
      idempotencyKey: `it-wallet-admin-deposit-${suffix}`, description: "Integration test funding",
    } });
    const withdrawal = await prisma.withdrawal.create({ data: {
      userId: adminRacePlayerId, amountCents: 7500, pixKeyEncrypted: "integration-test-encrypted",
      idempotencyKey: `it-wallet-admin-race-${suffix}`,
    } });
    withdrawalIds.push(withdrawal.id);
    await prisma.ledgerEntry.create({ data: {
      userId: adminRacePlayerId, withdrawalId: withdrawal.id, type: "WITHDRAWAL_RESERVE",
      amountCents: -7500, idempotencyKey: `withdrawal-reserve:${withdrawal.id}`,
      description: "Integration test withdrawal reserve",
    } });

    const markPaid = () => prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT "id" FROM "Withdrawal" WHERE "id" = $1 FOR UPDATE', withdrawal.id);
      const current = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } });
      if (current.status !== "PENDING") throw new Error("INVALID_STATE");
      await tx.withdrawal.update({ where: { id: withdrawal.id }, data: { status: "PAID", reviewedById: adminId } });
      await tx.ledgerEntry.create({ data: {
        userId: adminRacePlayerId, withdrawalId: withdrawal.id, type: "WITHDRAWAL_PAID",
        amountCents: 0, idempotencyKey: `withdrawal-paid:${withdrawal.id}`,
        description: "Integration test external payout record",
      } });
      await tx.withdrawalStatusHistory.create({ data: {
        withdrawalId: withdrawal.id, fromStatus: "PENDING", toStatus: "PAID",
        actorId: adminId, note: "Integration test payment confirmed",
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const outcomes = await Promise.allSettled([markPaid(), markPaid()]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(await prisma.withdrawal.count({ where: { id: withdrawal.id, status: "PAID" } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { withdrawalId: withdrawal.id, type: "WITHDRAWAL_RESERVE" } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { withdrawalId: withdrawal.id, type: "WITHDRAWAL_PAID" } })).toBe(1);
    expect(await prisma.ledgerEntry.aggregate({ where: { userId: adminRacePlayerId }, _sum: { amountCents: true } })).toMatchObject({ _sum: { amountCents: 0 } });
    expect(await prisma.withdrawalStatusHistory.count({ where: { withdrawalId: withdrawal.id, toStatus: "PAID" } })).toBe(1);
  });
});
