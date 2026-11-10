import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, PaymentMethod, PurchaseStatus, PaymentStatus, RoundStatus } from "../../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { confirmPixPayment } from "./confirm-payment";
import { cancelPendingPixPurchase } from "./cancel-pending-pix-purchase";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;

suite("PostgreSQL Pix confirmation/cancellation race", () => {
  const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/superquina_test?schema=public";
  if (enabled) {
    const parsed = new URL(databaseUrl);
    if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(parsed.hostname) ||
        parsed.pathname.replace(/^\//, "").split("?")[0] !== "superquina_test") {
      throw new Error("Refusing to run Pix integration tests outside the local superquina_test database");
    }
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  let purchaseId = "";
  let paymentId = "";
  let roundId = "";
  let participationId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const now = Date.now();
    const round = await prisma.round.create({
      data: {
        code: `IT-PX-${suffix.slice(0, 12)}`,
        startsAt: new Date(now + 5 * 60_000),
        cutoffAt: new Date(now + 15 * 60_000),
        resultAt: new Date(now + 25 * 60_000),
        status: RoundStatus.SCHEDULED,
      },
    });
    roundId = round.id;

    const purchase = await prisma.purchase.create({
      data: {
        status: PurchaseStatus.PENDING_PAYMENT,
        paymentMethod: PaymentMethod.PIX,
        totalCents: 100,
        idempotencyKey: `it-pix-race-${suffix}`,
      },
    });
    purchaseId = purchase.id;

    const payment = await prisma.payment.create({
      data: {
        purchaseId,
        provider: "MERCADO_PAGO",
        providerPaymentId: `it-order-${suffix}`,
        idempotencyKey: `it-pix-payment-${suffix}`,
        amountCents: 100,
        status: PaymentStatus.PENDING,
      },
    });
    paymentId = payment.id;

    const participation = await prisma.purchaseParticipation.create({
      data: { purchaseId, roundId, status: "PENDING", totalCents: 100 },
    });
    participationId = participation.id;
  });

  afterAll(async () => {
    if (participationId) await prisma.purchaseParticipation.delete({ where: { id: participationId } });
    if (paymentId) await prisma.payment.delete({ where: { id: paymentId } });
    if (purchaseId) await prisma.purchase.delete({ where: { id: purchaseId } });
    if (roundId) await prisma.round.delete({ where: { id: roundId } });
    await prisma.$disconnect();
  });

  it("runs the production confirmation and cancellation routines concurrently without split state", async () => {
    const results = await Promise.allSettled([
      confirmPixPayment(prisma, {
        paymentId,
        providerStatus: "processed",
        providerStatusDetail: "accredited",
      }),
      cancelPendingPixPurchase(prisma, {
        paymentId,
        purchaseId,
        terminalStatus: "CANCELLED",
        providerStatus: "cancelled",
        providerStatusDetail: "cancelled_by_provider",
        source: "status_fallback",
      }),
    ]);

    const unexpectedFailures = results.filter((result) => result.status === "rejected");
    expect(unexpectedFailures).toEqual([]);

    const [payment, purchase, participation] = await Promise.all([
      prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true } }),
      prisma.purchase.findUniqueOrThrow({ where: { id: purchaseId }, select: { status: true, receiptCode: true } }),
      prisma.purchaseParticipation.findUniqueOrThrow({ where: { id: participationId }, select: { status: true } }),
    ]);

    if (payment.status === "CONFIRMED") {
      expect(purchase.status).toBe("CONFIRMED");
      expect(purchase.receiptCode).toMatch(/^SQ-[A-F0-9]{16}$/);
      expect(participation.status).toBe("CONFIRMED");
      expect(results[0]!.status).toBe("fulfilled");
      expect(results[1]).toMatchObject({ status: "fulfilled", value: false });
    } else {
      expect(payment.status).toBe("CANCELLED");
      expect(purchase.status).toBe("CANCELLED");
      expect(purchase.receiptCode).toBeNull();
      expect(participation.status).toBe("CANCELLED");
      expect(results[1]).toMatchObject({ status: "fulfilled", value: true });
    }
  });
  it("confirms the same pending Pix payment concurrently only once", async () => {
    const testSuffix = randomUUID();
    let testPurchaseId = "";
    let testPaymentId = "";
    let testRoundId = "";
    let testParticipationId = "";

    try {
      const now = Date.now();
      const round = await prisma.round.create({
        data: {
          code: `IT-PX-DBL-${testSuffix.slice(0, 10)}`,
          startsAt: new Date(now + 5 * 60_000),
          cutoffAt: new Date(now + 15 * 60_000),
          resultAt: new Date(now + 25 * 60_000),
          status: RoundStatus.SCHEDULED,
        },
      });
      testRoundId = round.id;

      const purchase = await prisma.purchase.create({
        data: {
          status: PurchaseStatus.PENDING_PAYMENT,
          paymentMethod: PaymentMethod.PIX,
          totalCents: 100,
          idempotencyKey: `it-pix-double-${testSuffix}`,
        },
      });
      testPurchaseId = purchase.id;

      const payment = await prisma.payment.create({
        data: {
          purchaseId: testPurchaseId,
          provider: "MERCADO_PAGO",
          providerPaymentId: `it-order-double-${testSuffix}`,
          idempotencyKey: `it-pix-payment-double-${testSuffix}`,
          amountCents: 100,
          status: PaymentStatus.PENDING,
        },
      });
      testPaymentId = payment.id;

      const participation = await prisma.purchaseParticipation.create({
        data: { purchaseId: testPurchaseId, roundId: testRoundId, status: "PENDING", totalCents: 100 },
      });
      testParticipationId = participation.id;

      const results = await Promise.all([
        confirmPixPayment(prisma, {
          paymentId: testPaymentId,
          providerStatus: "processed",
          providerStatusDetail: "accredited",
        }),
        confirmPixPayment(prisma, {
          paymentId: testPaymentId,
          providerStatus: "processed",
          providerStatusDetail: "accredited",
        }),
      ]);

      expect(results.map((result) => result.outcome).sort()).toEqual(["already_confirmed", "confirmed"]);
      const successfulResults = results.filter(
        (result): result is Extract<typeof result, { outcome: "confirmed" | "already_confirmed" }> =>
          result.outcome === "confirmed" || result.outcome === "already_confirmed",
      );
      expect(successfulResults).toHaveLength(2);
      const receiptCodes = successfulResults.map((result) => result.receiptCode);
      expect(receiptCodes[0]).toBeTruthy();
      expect(receiptCodes[0]).toBe(receiptCodes[1]);

      const [savedPayment, savedPurchase, savedParticipation, confirmationAudits] = await Promise.all([
        prisma.payment.findUniqueOrThrow({ where: { id: testPaymentId }, select: { status: true } }),
        prisma.purchase.findUniqueOrThrow({ where: { id: testPurchaseId }, select: { status: true, receiptCode: true } }),
        prisma.purchaseParticipation.findUniqueOrThrow({ where: { id: testParticipationId }, select: { status: true } }),
        prisma.auditEvent.count({
          where: { action: "PIX_PAYMENT_CONFIRMED", entityType: "Purchase", entityId: testPurchaseId },
        }),
      ]);

      expect(savedPayment.status).toBe("CONFIRMED");
      expect(savedPurchase.status).toBe("CONFIRMED");
      expect(savedPurchase.receiptCode).toBe(receiptCodes[0]);
      expect(savedParticipation.status).toBe("CONFIRMED");
      expect(confirmationAudits).toBe(1);
      expect(await prisma.cashierCommission.count({ where: { purchaseId: testPurchaseId } })).toBe(0);
    } finally {
      if (testParticipationId) await prisma.purchaseParticipation.deleteMany({ where: { id: testParticipationId } });
      if (testPaymentId) await prisma.payment.deleteMany({ where: { id: testPaymentId } });
      if (testPurchaseId) await prisma.purchase.deleteMany({ where: { id: testPurchaseId } });
      if (testRoundId) await prisma.round.deleteMany({ where: { id: testRoundId } });
    }
  });

});
