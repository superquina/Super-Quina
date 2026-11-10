import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getVerifiedPixOrder: vi.fn(),
  classifyPixOrderStatus: vi.fn(),
  confirmPixPayment: vi.fn(),
}));

vi.mock("@/modules/payments/mercado-pago", () => ({
  getVerifiedPixOrder: mocks.getVerifiedPixOrder,
  classifyPixOrderStatus: mocks.classifyPixOrderStatus,
}));
vi.mock("@/modules/payments/confirm-payment", () => ({
  confirmPixPayment: mocks.confirmPixPayment,
}));

import { reconcilePixPaymentFromProvider } from "./reconcile-pix-payment";

function makePrisma() {
  return {
    payment: {
      findUnique: vi.fn().mockResolvedValue({
        id: "payment-1",
        purchaseId: "purchase-1",
        provider: "MERCADO_PAGO",
        providerPaymentId: "order-1",
        amountCents: 200,
        status: "PENDING",
        purchase: { totalCents: 200, status: "PENDING_PAYMENT" },
      }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(),
  };
}

describe("reconcilePixPaymentFromProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getVerifiedPixOrder.mockResolvedValue({
      orderId: "order-1",
      externalReference: "superquina_purchase_purchase-1",
      currency: "BRL",
      amountCents: 200,
      status: "created",
      statusDetail: null,
      paymentStatus: null,
      paymentAmountCents: null,
      paymentMethodId: null,
      paymentMethodType: null,
    });
    mocks.classifyPixOrderStatus.mockReturnValue({
      providerStatus: "created",
      normalizedStatus: "created",
      approved: false,
    });
    mocks.confirmPixPayment.mockResolvedValue({ outcome: "confirmed" });
  });

  it("keeps an ordinary pending order pending when payment transaction fields do not exist yet", async () => {
    const prisma = makePrisma();
    await expect(reconcilePixPaymentFromProvider(prisma as never, "payment-1")).resolves.toBe("still_pending");
    expect(prisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { providerStatus: "created", providerStatusDetail: null },
    }));
    expect(mocks.confirmPixPayment).not.toHaveBeenCalled();
  });

  it("uses the shared idempotent confirmation for a verified Pix approval", async () => {
    const prisma = makePrisma();
    mocks.getVerifiedPixOrder.mockResolvedValue({
      orderId: "order-1",
      externalReference: "superquina_purchase_purchase-1",
      currency: "BRL",
      amountCents: 200,
      status: "processed",
      statusDetail: "accredited",
      paymentStatus: "processed",
      paymentAmountCents: 200,
      paymentMethodId: "pix",
      paymentMethodType: "bank_transfer",
    });
    mocks.classifyPixOrderStatus.mockReturnValue({
      providerStatus: "processed",
      normalizedStatus: "processed",
      approved: true,
    });

    await expect(reconcilePixPaymentFromProvider(prisma as never, "payment-1")).resolves.toBe("confirmed");
    expect(mocks.confirmPixPayment).toHaveBeenCalledWith(prisma, {
      paymentId: "payment-1",
      providerStatus: "processed",
      providerStatusDetail: "accredited",
    });
  });

  it("rejects a provider order whose total differs from the persisted payment", async () => {
    const prisma = makePrisma();
    mocks.getVerifiedPixOrder.mockResolvedValue({
      orderId: "order-1", externalReference: "superquina_purchase_purchase-1", currency: "BRL", amountCents: 199,
      status: "created", statusDetail: null, paymentStatus: null, paymentAmountCents: null, paymentMethodId: null, paymentMethodType: null,
    });
    await expect(reconcilePixPaymentFromProvider(prisma as never, "payment-1")).rejects.toThrow("Mercado Pago order does not match the pending Pix purchase");
    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(mocks.confirmPixPayment).not.toHaveBeenCalled();
  });

  it("does not confirm an approved-looking order with a mismatched external reference", async () => {
    const prisma = makePrisma();
    mocks.getVerifiedPixOrder.mockResolvedValue({
      orderId: "order-1", externalReference: "superquina_purchase_another-purchase", currency: "BRL", amountCents: 200,
      status: "processed", statusDetail: "accredited", paymentStatus: "processed", paymentAmountCents: 200, paymentMethodId: "pix", paymentMethodType: "bank_transfer",
    });
    mocks.classifyPixOrderStatus.mockReturnValue({ providerStatus: "processed", normalizedStatus: "processed", approved: true });
    await expect(reconcilePixPaymentFromProvider(prisma as never, "payment-1")).rejects.toThrow("Mercado Pago order does not match the pending Pix purchase");
    expect(mocks.confirmPixPayment).not.toHaveBeenCalled();
  });

  it("cancels a rejected pending purchase without allocating or confirming it", async () => {
    const prisma = makePrisma();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      payment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      purchase: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      purchaseParticipation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    mocks.getVerifiedPixOrder.mockResolvedValue({
      orderId: "order-1",
      externalReference: "superquina_purchase_purchase-1",
      currency: "BRL",
      amountCents: 200,
      status: "rejected",
      statusDetail: "cc_rejected",
      paymentStatus: "rejected",
      paymentAmountCents: 200,
      paymentMethodId: "pix",
      paymentMethodType: "bank_transfer",
    });
    mocks.classifyPixOrderStatus.mockReturnValue({
      providerStatus: "rejected",
      normalizedStatus: "rejected",
      approved: false,
    });

    await expect(reconcilePixPaymentFromProvider(prisma as never, "payment-1")).resolves.toBe("terminal");
    expect(tx.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "payment-1", status: "PENDING" }),
      data: expect.objectContaining({ status: "FAILED" }),
    }));
    expect(tx.purchase.updateMany).toHaveBeenCalledWith({
      where: { id: "purchase-1", status: "PENDING_PAYMENT" },
      data: { status: "CANCELLED" },
    });
    expect(tx.purchaseParticipation.updateMany).toHaveBeenCalledWith({
      where: { purchaseId: "purchase-1", status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    expect(tx.auditEvent.create).toHaveBeenCalled();
    expect(mocks.confirmPixPayment).not.toHaveBeenCalled();
  });

  it("rolls back a terminal payment transition if the purchase is no longer pending", async () => {
    const prisma = makePrisma();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      payment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      purchase: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      purchaseParticipation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    mocks.getVerifiedPixOrder.mockResolvedValue({
      orderId: "order-1",
      externalReference: "superquina_purchase_purchase-1",
      currency: "BRL",
      amountCents: 200,
      status: "rejected",
      statusDetail: "cc_rejected",
      paymentStatus: "rejected",
      paymentAmountCents: 200,
      paymentMethodId: "pix",
      paymentMethodType: "bank_transfer",
    });
    mocks.classifyPixOrderStatus.mockReturnValue({
      providerStatus: "rejected",
      normalizedStatus: "rejected",
      approved: false,
    });

    await expect(reconcilePixPaymentFromProvider(prisma as never, "payment-1"))
      .rejects.toThrow("Pending Pix payment could not cancel its pending purchase");
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it("rejects an approved order that is not a Pix bank transfer", async () => {
    const prisma = makePrisma();
    mocks.getVerifiedPixOrder.mockResolvedValue({
      orderId: "order-1",
      externalReference: "superquina_purchase_purchase-1",
      currency: "BRL",
      amountCents: 200,
      status: "processed",
      statusDetail: "accredited",
      paymentStatus: "processed",
      paymentAmountCents: 200,
      paymentMethodId: "visa",
      paymentMethodType: "credit_card",
    });
    mocks.classifyPixOrderStatus.mockReturnValue({
      providerStatus: "processed",
      normalizedStatus: "processed",
      approved: true,
    });

    await expect(reconcilePixPaymentFromProvider(prisma as never, "payment-1")).rejects.toThrow(
      "Mercado Pago order does not match the pending Pix purchase",
    );
    expect(mocks.confirmPixPayment).not.toHaveBeenCalled();
  });

  it("keeps the purchase pending when Mercado Pago is unavailable", async () => {
    const prisma = makePrisma();
    mocks.getVerifiedPixOrder.mockRejectedValue(new Error("provider timeout"));

    await expect(reconcilePixPaymentFromProvider(prisma as never, "payment-1"))
      .rejects.toThrow("provider timeout");

    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.confirmPixPayment).not.toHaveBeenCalled();
  });

  it("does not downgrade an already confirmed purchase after a delayed terminal notification", async () => {
    const prisma = makePrisma();
    prisma.payment.findUnique.mockResolvedValue({
      id: "payment-1",
      purchaseId: "purchase-1",
      provider: "MERCADO_PAGO",
      providerPaymentId: "order-1",
      amountCents: 200,
      status: "CONFIRMED",
      purchase: { totalCents: 200, status: "CONFIRMED" },
    });

    await expect(reconcilePixPaymentFromProvider(prisma as never, "payment-1"))
      .resolves.toBe("already_confirmed");

    expect(mocks.getVerifiedPixOrder).not.toHaveBeenCalled();
    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
