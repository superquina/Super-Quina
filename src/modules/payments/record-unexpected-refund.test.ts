import { describe, expect, it, vi } from "vitest";
import { recordUnexpectedExternalRefund } from "./record-unexpected-refund";

function makePrisma(prior: { id: string } | null) {
  const tx = {
    auditEvent: {
      findFirst: vi.fn().mockResolvedValue(prior),
      create: vi.fn().mockResolvedValue({ id: "audit-1" }),
    },
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<void>, options: unknown) => {
        expect(options).toMatchObject({ isolationLevel: "Serializable" });
        return callback(tx);
      }),
    },
  };
}

describe("recordUnexpectedExternalRefund", () => {
  it("records a single manual-review incident for a purchase", async () => {
    const { prisma, tx } = makePrisma(null);
    await recordUnexpectedExternalRefund(prisma as never, {
      purchaseId: "purchase-1",
      paymentId: "payment-1",
      providerStatus: "refunded",
      source: "webhook",
    });
    expect(tx.auditEvent.findFirst).toHaveBeenCalledWith({
      where: {
        action: "UNEXPECTED_EXTERNAL_REFUND_REPORTED",
        entityType: "Purchase",
        entityId: "purchase-1",
      },
      select: { id: true },
    });
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "UNEXPECTED_EXTERNAL_REFUND_REPORTED",
        entityType: "Purchase",
        entityId: "purchase-1",
        metadata: expect.objectContaining({
          paymentId: "payment-1",
          providerStatus: "refunded",
          source: "webhook",
        }),
      }),
    });
  });

  it("does not create a duplicate incident when one already exists", async () => {
    const { prisma, tx } = makePrisma({ id: "audit-existing" });
    await recordUnexpectedExternalRefund(prisma as never, {
      purchaseId: "purchase-1",
      paymentId: "payment-1",
      providerStatus: "refunded",
      source: "status_fallback",
    });
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });
});
