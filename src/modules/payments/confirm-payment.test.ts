import { describe, expect, it, vi } from "vitest";
import { confirmPixPayment } from "./confirm-payment";

const now = new Date("2026-10-30T15:35:00.123Z");
const oldRound = {
  id: "round-old",
  code: "JN-20261030-1230",
  startsAt: new Date("2026-10-30T15:01:00.000Z"),
  cutoffAt: new Date("2026-10-30T15:29:00.000Z"),
  resultAt: new Date("2026-10-30T15:30:00.000Z"),
  status: "CLOSED",
};
const nextRound = {
  id: "round-next",
  code: "JN-20261030-1300",
  startsAt: new Date("2026-10-30T15:31:00.000Z"),
  cutoffAt: new Date("2026-10-30T15:59:00.000Z"),
  resultAt: new Date("2026-10-30T16:00:00.000Z"),
  status: "SCHEDULED",
};

function setup(availableRounds = [nextRound]) {
  const paymentUpdate = vi.fn().mockResolvedValue({});
  const participationUpdate = vi.fn().mockResolvedValue({});
  const participationUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const purchaseUpdate = vi.fn().mockResolvedValue({});
  const auditCreate = vi.fn().mockResolvedValue({});
  const auditFindFirst = vi.fn().mockResolvedValue(null);
  const roundFindMany = vi.fn()
    .mockResolvedValueOnce([oldRound])
    .mockResolvedValueOnce(availableRounds);
  const tx = {
    payment: { findUnique: vi.fn().mockResolvedValue({
      id: "payment-1",
      purchaseId: "purchase-1",
      status: "PENDING",
      amountCents: 200,
      purchase: { status: "PENDING_PAYMENT", totalCents: 200, receiptCode: null, cashierId: null },
    }), update: paymentUpdate },
    purchaseParticipation: {
      findMany: vi.fn().mockResolvedValue([
        { id: "participation-1", roundId: "round-old", totalCents: 200 },
      ]),
      update: participationUpdate,
      updateMany: participationUpdateMany,
    },
    round: { findMany: roundFindMany },
    purchase: { update: purchaseUpdate },
    auditEvent: { create: auditCreate, findFirst: auditFindFirst },
    $queryRaw: vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "round-old" }, { id: "round-next" }])
      .mockResolvedValueOnce([{ decisionTime: now }]),
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(tx)),
  };
  return { prisma, tx, paymentUpdate, participationUpdate, participationUpdateMany, purchaseUpdate, auditCreate, auditFindFirst };
}

describe("confirmPixPayment next-valid-round allocation", () => {
  it("moves a late-paid purchase to the next valid round and records both schedules", async () => {
    const mocks = setup();
    const result = await confirmPixPayment(mocks.prisma as never, {
      paymentId: "payment-1",
      providerStatus: "processed",
      providerStatusDetail: "accredited",
    });

    expect(result).toMatchObject({ outcome: "confirmed", receiptCode: expect.stringMatching(/^SQ-[A-F0-9]{16}$/) });
    expect(mocks.tx.$queryRaw.mock.calls[1]![0].join(" ")).toContain("LIMIT");
    expect(mocks.tx.$queryRaw.mock.calls[1]![0].join(" ")).toContain("FOR UPDATE");
    expect(mocks.participationUpdate).toHaveBeenCalledWith({
      where: { id: "participation-1" },
      data: { roundId: "round-next", totalCents: 200 },
    });
    expect(mocks.participationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { purchaseId: "purchase-1", status: "PENDING" },
      data: expect.objectContaining({ status: "CONFIRMED", confirmedAt: now }),
    }));
    expect(mocks.purchaseUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "purchase-1" },
      data: expect.objectContaining({ status: "CONFIRMED", confirmedAt: now }),
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "PIX_PAYMENT_CONFIRMED",
        metadata: expect.objectContaining({
          decisionTime: now.toISOString(),
          originalRounds: [expect.objectContaining({ code: oldRound.code, cutoffAt: oldRound.cutoffAt.toISOString() })],
          assignedRounds: [expect.objectContaining({ code: nextRound.code, cutoffAt: nextRound.cutoffAt.toISOString() })],
        }),
      }),
    }));
  });

  it("does not issue a receipt or participation when no valid round is available", async () => {
    const mocks = setup([]);
    const result = await confirmPixPayment(mocks.prisma as never, {
      paymentId: "payment-1",
      providerStatus: "processed",
      providerStatusDetail: "accredited",
    });

    expect(result).toMatchObject({ outcome: "late_or_unavailable", reason: "NO_NEXT_VALID_ROUND" });
    expect(mocks.participationUpdate).not.toHaveBeenCalled();
    expect(mocks.participationUpdateMany).not.toHaveBeenCalled();
    expect(mocks.purchaseUpdate).not.toHaveBeenCalled();
    expect(mocks.paymentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "payment-1" },
      data: expect.objectContaining({ providerStatus: "processed" }),
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "PIX_PAYMENT_APPROVED_WITHOUT_AVAILABLE_ROUNDS" }),
    }));
  });

  it("creates final round participations from the stored intent only after Pix approval", async () => {
    const createParticipation = vi.fn().mockResolvedValue({});
    const paymentUpdate = vi.fn().mockResolvedValue({});
    const purchaseUpdate = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      payment: { findUnique: vi.fn().mockResolvedValue({
        id: "payment-1", purchaseId: "purchase-1", status: "PENDING", amountCents: 100,
        purchase: {
          status: "PENDING_PAYMENT", totalCents: 100, receiptCode: null, cashierId: null,
          numericIntent: {
            roundCount: 1, numbers: ["00007"],
            allocation: { unitCents: 20, tensCents: 20, hundredsCents: 20, thousandsCents: 20, quinaCents: 20 },
            ruleVersion: "numeric-v1", ruleSnapshot: { version: "numeric-v1" },
          },
        },
      }), update: paymentUpdate },
      purchaseParticipation: {
        findMany: vi.fn().mockResolvedValue([]),
        create: createParticipation,
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      round: { findMany: vi.fn().mockResolvedValue([nextRound]) },
      purchase: { update: purchaseUpdate },
      auditEvent: { create: auditCreate, findFirst: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "round-next" }])
        .mockResolvedValueOnce([{ decisionTime: now }]),
    };
    const prisma = { $transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(tx)) };

    const result = await confirmPixPayment(prisma as never, {
      paymentId: "payment-1", providerStatus: "processed", providerStatusDetail: "accredited",
    });

    expect(result).toMatchObject({ outcome: "confirmed", receiptCode: expect.stringMatching(/^SQ-[A-F0-9]{16}$/) });
    expect(createParticipation).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        purchaseId: "purchase-1", roundId: "round-next", totalCents: 100,
        numericLines: { create: [expect.objectContaining({ numberValue: "00007", unitCents: 20 })] },
      }),
    }));
    expect(purchaseUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "CONFIRMED", confirmedAt: now }),
    }));
  });

});
