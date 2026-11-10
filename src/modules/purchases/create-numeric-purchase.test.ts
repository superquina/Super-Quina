import { describe, expect, it, vi } from "vitest";
import { createNumericPurchase } from "./create-numeric-purchase";

describe("createNumericPurchase pending Pix intent", () => {

  it("snapshots the current admin multipliers into a new pending Pix bet", async () => {
    const configured = { unit: 7, tens: 30, hundreds: 250, thousands: 2500, quina: 25000 };
    const purchaseCreate = vi.fn().mockResolvedValue({
      id: "purchase-custom-rules", status: "PENDING_PAYMENT", paymentMethod: "PIX", totalCents: 100,
      receiptCode: null, confirmedAt: null, participations: [],
      numericIntent: { roundCount: 1, numbers: ["00007"], allocation: { unitCents: 20, tensCents: 20, hundredsCents: 20, thousandsCents: 20, quinaCents: 20 } },
      payment: { id: "payment-custom", status: "PENDING" },
    });
    const tx = {
      purchase: { findUnique: vi.fn().mockResolvedValue(null), create: purchaseCreate },
      setting: { findUnique: vi.fn().mockResolvedValue({ value: JSON.stringify(configured) }) },
      $queryRaw: vi.fn(),
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(tx)),
    };

    await createNumericPurchase(prisma as never, {
      idempotencyKey: "pending-custom-rules-0001",
      playerId: "player-1", paymentMethod: "PIX", roundCount: 1,
      numbers: ["00007"], stakeCents: 100,
    });

    expect(purchaseCreate.mock.calls[0]![0].data.numericIntent.create.ruleSnapshot).toEqual({
      version: "numeric-admin-v1", multipliers: configured,
    });
  });

  it("stores the bet intent without selecting or creating round participations", async () => {
    const purchaseCreate = vi.fn().mockResolvedValue({
      id: "purchase-12345678", status: "PENDING_PAYMENT", paymentMethod: "PIX", totalCents: 200,
      receiptCode: null, confirmedAt: null, participations: [],
      numericIntent: { roundCount: 2, numbers: ["00007"], allocation: { unitCents: 20, tensCents: 20, hundredsCents: 20, thousandsCents: 20, quinaCents: 20 } },
      payment: { id: "payment-1", status: "PENDING" },
    });
    const tx = {
      purchase: { findUnique: vi.fn().mockResolvedValue(null), create: purchaseCreate },
      setting: { findUnique: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn(),
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(tx)),
    };

    const result = await createNumericPurchase(prisma as never, {
      idempotencyKey: "pending-intent-key-0001",
      playerId: "player-1",
      paymentMethod: "PIX",
      roundCount: 2,
      numbers: ["00007"],
      stakeCents: 100,
    });

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(purchaseCreate).toHaveBeenCalledOnce();
    const data = purchaseCreate.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty("participations");
    expect(data.numericIntent.create).toMatchObject({
      roundCount: 2, numbers: ["00007"], ruleVersion: "numeric-admin-v1",
      ruleSnapshot: { version: "numeric-admin-v1", multipliers: { unit: 5, tens: 20, hundreds: 200, thousands: 2000, quina: 20000 } },
    });
    expect(data.payment.create.amountCents).toBe(200);
    expect(result).toMatchObject({ status: "PENDING_PAYMENT", receiptCode: null, participations: [] });
  });
});


describe("createNumericPurchase paid allocation queue", () => {
  it("records a cash sale and commission when no complete round sequence is available", async () => {
    const purchaseCreate = vi.fn().mockResolvedValue({
      id: "purchase-cash-123", status: "PENDING_PAYMENT", paymentMethod: "CASH", totalCents: 200,
      receiptCode: null, confirmedAt: null, participations: [],
      numericIntent: { roundCount: 2, numbers: ["00007"], allocation: { unitCents: 20, tensCents: 20, hundredsCents: 20, thousandsCents: 20, quinaCents: 20 } },
      payment: null,
    });
    const commissionCreate = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      purchase: { findUnique: vi.fn().mockResolvedValue(null), create: purchaseCreate },
      setting: { findUnique: vi.fn().mockResolvedValue(null) },
      round: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findFirst: vi.fn().mockResolvedValue({ commissionRateBasisPoints: 500 }) },
      cashierCommission: { create: commissionCreate },
      auditEvent: { create: auditCreate },
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ decisionTime: new Date("2026-11-03T18:00:00.000Z") }]),
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(tx)),
    };

    const result = await createNumericPurchase(prisma as never, {
      idempotencyKey: "cash-allocation-key-0001",
      cashierId: "cashier-1",
      paymentMethod: "CASH",
      roundCount: 2,
      numbers: ["00007"],
      stakeCents: 100,
    });

    const roundLockCall = tx.$queryRaw.mock.calls.find(([query]) => query.join(" ").includes('FROM "Round"'));
    expect(roundLockCall).toBeDefined();
    const roundLockSql = roundLockCall![0].join(" ");
    expect(roundLockSql).toContain("LIMIT");
    expect(roundLockSql).toContain("FOR UPDATE");
    const data = purchaseCreate.mock.calls[0]![0].data;
    expect(data.status).toBe("PENDING_PAYMENT");
    expect(data.receiptCode).toBeNull();
    expect(data).not.toHaveProperty("participations");
    expect(data.numericIntent.create.roundCount).toBe(2);
    expect(data).not.toHaveProperty("payment");
    expect(commissionCreate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "NUMERIC_CASH_PURCHASE_CONFIRMED",
        metadata: expect.objectContaining({ allocationPending: true }),
      }),
    }));
    expect(result).toMatchObject({ status: "PENDING_PAYMENT", receiptCode: null, participations: [] });
  });
});
