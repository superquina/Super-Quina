import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, PrismaClient, RoundStatus } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createNumericPurchase } from "./purchases/create-numeric-purchase";
import { allocatePaidPurchases } from "./purchases/allocate-paid-purchases";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;

suite("PostgreSQL cashier settlement concurrency", () => {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (enabled) {
    if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");
    const parsed = new URL(databaseUrl);
    if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(parsed.hostname) ||
        parsed.pathname.replace(/^\//, "").split("?")[0] !== "superquina_test") {
      throw new Error("Refusing to run cashier settlement tests outside local superquina_test");
    }
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const cashierId = `it-settlement-cashier-${suffix}`;
  const adminId = `it-settlement-admin-${suffix}`;
  const roundIds: string[] = [];
  const purchaseIds: string[] = [];
  const settlementIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({ data: [
      { id: cashierId, username: `it-settlement-cashier-${suffix}`, passwordHash: "integration-test", role: "CASHIER", commissionRateBasisPoints: 500 },
      { id: adminId, username: `it-settlement-admin-${suffix}`, passwordHash: "integration-test", role: "ADMIN" },
    ] });
  });

  afterAll(async () => {
    if (settlementIds.length) await prisma.cashierSettlement.deleteMany({ where: { id: { in: settlementIds } } });
    if (purchaseIds.length) {
      await prisma.auditEvent.deleteMany({ where: { entityType: "Purchase", entityId: { in: purchaseIds } } });
      await prisma.cashierCommission.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
      await prisma.numericParticipationLine.deleteMany({ where: { participation: { purchaseId: { in: purchaseIds } } } });
      await prisma.purchaseParticipation.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
      await prisma.numericPurchaseIntent.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
      await prisma.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
    }
    if (roundIds.length) await prisma.round.deleteMany({ where: { id: { in: roundIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [cashierId, adminId] } } });
    await prisma.$disconnect();
  });

  it("places a cash sale after the settlement cutoff and includes its commission in the next settlement", async () => {
    // Create a CASH sale while no round is available: its commission exists,
    // but the purchase is not yet confirmed and must not enter a settlement.
    const sale = await createNumericPurchase(prisma, {
      idempotencyKey: `it-settlement-cash-sale-${suffix}`,
      cashierId, paymentMethod: "CASH", roundCount: 1, numbers: ["12345"], stakeCents: 100,
    });
    purchaseIds.push(sale.id);
    expect(sale.status).toBe("PENDING_PAYMENT");
    expect(await prisma.cashierCommission.count({ where: { purchaseId: sale.id } })).toBe(1);

    let releaseSettlement!: () => void;
    let signalSettlementLocked!: () => void;
    const settlementLocked = new Promise<void>((resolve) => { signalSettlementLocked = resolve; });
    const allowSettlementCommit = new Promise<void>((resolve) => { releaseSettlement = resolve; });

    const firstSettlement = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${cashierId} AND "role" = 'CASHIER' FOR UPDATE`;
      const cutoff = (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0]!.now;
      const sales = await tx.purchase.aggregate({
        where: { cashierId, status: "CONFIRMED", confirmedAt: { lte: cutoff }, paymentMethod: "CASH" },
        _sum: { totalCents: true }, _count: { _all: true },
      });
      const commission = await tx.cashierCommission.aggregate({
        where: { cashierId, purchase: { is: { status: "CONFIRMED", confirmedAt: { lte: cutoff } } } },
        _sum: { amountCents: true },
      });
      signalSettlementLocked();
      await allowSettlementCommit;
      const saved = await tx.cashierSettlement.create({ data: {
        cashierId, adminId, settledAt: cutoff, cashSalesCents: sales._sum.totalCents ?? 0,
        pixSalesCents: 0, totalSalesCents: sales._sum.totalCents ?? 0,
        salesCount: sales._count._all, gamesCount: 0, commissionCents: commission._sum.amountCents ?? 0,
      } });
      settlementIds.push(saved.id);
      return saved;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await settlementLocked;
    // The allocator locks the purchase and then the same cashier row. It must
    // wait for the settlement cutoff before confirming this delayed CASH sale.
    const now = Date.now();
    const round = await prisma.round.create({ data: {
      code: `IT-SETTLE-${suffix.slice(0, 12)}`,
      startsAt: new Date(now - 60_000),
      cutoffAt: new Date(now + 10 * 60_000),
      resultAt: new Date(now + 20 * 60_000),
      status: RoundStatus.SCHEDULED,
    } });
    roundIds.push(round.id);
    const allocationPromise = allocatePaidPurchases(prisma, 50);
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseSettlement();
    const [first, initialAllocation] = await Promise.all([firstSettlement, allocationPromise]);
    let allocated = initialAllocation.allocated;
    // A serializable retry can be deferred to the next cursor cycle after a
    // settlement lock race; allow the scheduler's normal bounded retry cycle.
    for (let attempt = 0; allocated === 0 && attempt < 3; attempt += 1) {
      allocated += (await allocatePaidPurchases(prisma, 50)).allocated;
    }
    expect(allocated).toBe(1);

    expect(first.totalSalesCents).toBe(0);
    expect(first.commissionCents).toBe(0);

    const confirmed = await prisma.purchase.findUniqueOrThrow({
      where: { id: sale.id }, select: { status: true, confirmedAt: true, totalCents: true },
    });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.confirmedAt!.getTime()).toBeGreaterThan(first.settledAt.getTime());

    const next = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${cashierId} AND "role" = 'CASHIER' FOR UPDATE`;
      const sales = await tx.purchase.aggregate({
        where: { cashierId, status: "CONFIRMED", confirmedAt: { gt: first.settledAt }, paymentMethod: "CASH" },
        _sum: { totalCents: true }, _count: { _all: true },
      });
      const commission = await tx.cashierCommission.aggregate({
        where: { cashierId, purchase: { is: { status: "CONFIRMED", confirmedAt: { gt: first.settledAt } } } },
        _sum: { amountCents: true },
      });
      return { sales, commission };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    expect(next.sales._sum.totalCents).toBe(confirmed.totalCents);
    expect(next.sales._count._all).toBe(1);
    expect(next.commission._sum.amountCents).toBeGreaterThan(0);
  });
});
