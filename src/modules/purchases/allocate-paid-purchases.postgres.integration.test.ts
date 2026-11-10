import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, PaymentMethod, PurchaseStatus, RoundStatus } from "../../generated/prisma/client";
import { createNumericPrizeRuleSnapshot, NUMERIC_PRIZE_RULE_VERSION } from "../../domain/numeric-prize-rules";
import { allocatePaidPurchases } from "./allocate-paid-purchases";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
const ALLOCATION_CURSOR_KEY = "paid_purchase_allocation_cursor";

suite("PostgreSQL paid purchase allocation concurrency", () => {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (enabled) {
    if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");
    const parsed = new URL(databaseUrl);
    if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(parsed.hostname) ||
        parsed.pathname.replace(/^\//, "").split("?")[0] !== "superquina_test") {
      throw new Error("Refusing to run allocation integration tests outside the local superquina_test database");
    }
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const purchaseIds: string[] = [];
  const roundIds: string[] = [];
  let originalCursorValue: string | null = null;

  beforeAll(async () => {
    await prisma.$connect();
    const originalCursor = await prisma.setting.findUnique({
      where: { key: ALLOCATION_CURSOR_KEY },
      select: { value: true },
    });
    originalCursorValue = originalCursor?.value ?? null;
  });

  afterAll(async () => {
    if (purchaseIds.length) {
      await prisma.auditEvent.deleteMany({ where: { entityType: "Purchase", entityId: { in: purchaseIds } } });
      await prisma.numericParticipationLine.deleteMany({ where: { participation: { purchaseId: { in: purchaseIds } } } });
      await prisma.purchaseParticipation.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
      await prisma.numericPurchaseIntent.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
      await prisma.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
    }
    if (roundIds.length) await prisma.round.deleteMany({ where: { id: { in: roundIds } } });

    // Keep the shared scheduler cursor at its original value. An empty value is
    // the neutral initial state when the test database had no cursor beforehand.
    await prisma.setting.upsert({
      where: { key: ALLOCATION_CURSOR_KEY },
      create: { key: ALLOCATION_CURSOR_KEY, value: originalCursorValue ?? "" },
      update: { value: originalCursorValue ?? "" },
    });
    await prisma.$disconnect();
  });

  it("allocates one pending cash purchase only once when scheduler executions overlap", async () => {
    const now = Date.now();
    const round = await prisma.round.create({
      data: {
        code: `IT-ALLOC-${suffix.slice(0, 12)}`,
        startsAt: new Date(now - 60_000),
        cutoffAt: new Date(now + 10 * 60_000),
        resultAt: new Date(now + 20 * 60_000),
        status: RoundStatus.SCHEDULED,
      },
    });
    roundIds.push(round.id);

    const purchase = await prisma.purchase.create({
      data: {
        status: PurchaseStatus.PENDING_PAYMENT,
        paymentMethod: PaymentMethod.CASH,
        totalCents: 100,
        idempotencyKey: `it-alloc-race-${suffix}`,
        numericIntent: {
          create: {
            roundCount: 1,
            numbers: ["12345"],
            allocation: { unitCents: 20, tensCents: 20, hundredsCents: 20, thousandsCents: 20, quinaCents: 20 },
            ruleVersion: NUMERIC_PRIZE_RULE_VERSION,
            ruleSnapshot: createNumericPrizeRuleSnapshot(),
          },
        },
      },
    });
    purchaseIds.push(purchase.id);

    const results = await Promise.all([
      allocatePaidPurchases(prisma, 50),
      allocatePaidPurchases(prisma, 50),
    ]);
    const totalAllocated = results.reduce((sum, result) => sum + result.allocated, 0);
    if (totalAllocated === 0) {
      const retry = await allocatePaidPurchases(prisma, 50);
      expect(retry.allocated).toBe(1);
    } else {
      expect(totalAllocated).toBe(1);
    }

    const [savedPurchase, participations, lines, audits] = await Promise.all([
      prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id }, select: { status: true, receiptCode: true } }),
      prisma.purchaseParticipation.count({ where: { purchaseId: purchase.id } }),
      prisma.numericParticipationLine.count({ where: { participation: { purchaseId: purchase.id } } }),
      prisma.auditEvent.count({
        where: { entityType: "Purchase", entityId: purchase.id, action: "PAID_PURCHASE_ALLOCATED_TO_ROUNDS" },
      }),
    ]);
    expect(savedPurchase.status).toBe(PurchaseStatus.CONFIRMED);
    expect(savedPurchase.receiptCode).toMatch(/^SQ-[A-F0-9]{16}$/);
    expect(participations).toBe(1);
    expect(lines).toBe(1);
    expect(audits).toBe(1);
  });

  it("reproduces a stale cursor overwrite when overlapping runs checkpoint out of order", async () => {
    const testPurchases = await Promise.all([0, 1].map((index) => prisma.purchase.create({
      data: {
        status: PurchaseStatus.PENDING_PAYMENT,
        paymentMethod: PaymentMethod.CASH,
        totalCents: 100,
        idempotencyKey: `it-alloc-cursor-race-${suffix}-${index}`,
        numericIntent: {
          create: {
            roundCount: 1,
            numbers: ["12345"],
            allocation: { unitCents: 20, tensCents: 20, hundredsCents: 20, thousandsCents: 20, quinaCents: 20 },
            ruleVersion: NUMERIC_PRIZE_RULE_VERSION,
            ruleSnapshot: createNumericPrizeRuleSnapshot(),
          },
        },
      },
    })));
    purchaseIds.push(...testPurchases.map((purchase) => purchase.id));

    const orderedIds = testPurchases.map((purchase) => purchase.id).sort();
    const shortCursor = orderedIds[0]!;
    const wideCursor = orderedIds[1]!;

    await prisma.setting.upsert({
      where: { key: ALLOCATION_CURSOR_KEY },
      create: { key: ALLOCATION_CURSOR_KEY, value: "" },
      update: { value: "" },
    });

    let cursorReads = 0;
    let releaseCursorReads!: () => void;
    const bothCursorReads = new Promise<void>((resolve) => { releaseCursorReads = resolve; });
    let releaseWideCheckpoint!: () => void;
    const wideCheckpointWritten = new Promise<void>((resolve) => { releaseWideCheckpoint = resolve; });

    const makeExecutionClient = (kind: "short" | "wide"): PrismaClient => {
      let checkpointWritten = false;
      let interrupted = false;

      const setting = new Proxy(prisma.setting, {
        get(delegate, method) {
          if (method === "findUnique") {
            return async (args: Parameters<typeof prisma.setting.findUnique>[0]) => {
              const result = await prisma.setting.findUnique(args);
              cursorReads += 1;
              if (cursorReads === 2) releaseCursorReads();
              await bothCursorReads;
              return result;
            };
          }
          if (method === "updateMany") {
            return async (args: Parameters<typeof prisma.setting.updateMany>[0]) => {
              const value = args.data.value;
              if (kind === "wide" && value === wideCursor) {
                const result = await prisma.setting.updateMany(args);
                checkpointWritten = result.count === 1;
                releaseWideCheckpoint();
                return result;
              }
              if (kind === "short" && value === shortCursor) {
                await wideCheckpointWritten;
                return prisma.setting.updateMany(args);
              }
              return prisma.setting.updateMany(args);
            };
          }
          const value = Reflect.get(delegate, method, delegate);
          return typeof value === "function" ? value.bind(delegate) : value;
        },
      });

      const purchase = new Proxy(prisma.purchase, {
        get(delegate, method) {
          if (method === "findMany") {
            return async (args: Parameters<typeof prisma.purchase.findMany>[0]) => {
              if (checkpointWritten && !interrupted) {
                interrupted = true;
                throw new Error("Deterministic test interruption after cursor checkpoint");
              }
              return prisma.purchase.findMany(args);
            };
          }
          const value = Reflect.get(delegate, method, delegate);
          return typeof value === "function" ? value.bind(delegate) : value;
        },
      });

      return new Proxy(prisma, {
        get(target, property) {
          if (property === "setting") return setting;
          if (property === "purchase") return purchase;
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as PrismaClient;
    };

    const outcomes = await Promise.allSettled([
      allocatePaidPurchases(makeExecutionClient("short"), 1),
      allocatePaidPurchases(makeExecutionClient("wide"), 2),
    ]);

    expect(outcomes[0]?.status).toBe("fulfilled");
    expect(outcomes[1]?.status).toBe("rejected");
    const savedCursor = await prisma.setting.findUnique({
      where: { key: ALLOCATION_CURSOR_KEY },
      select: { value: true },
    });
    // The wider run checkpoints the later ID first. The shorter run's
    // compare-and-set must fail rather than overwrite that newer checkpoint.
    expect(savedCursor?.value).toBe(wideCursor);
  }, 30_000);

});
