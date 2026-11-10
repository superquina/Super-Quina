import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  findPayment: vi.fn(),
  findEvent: vi.fn(),
  createEvent: vi.fn(),
  updatePayment: vi.fn(),
  updateEventMany: vi.fn(),
  getVerifiedPixOrder: vi.fn(),
  confirmPixPayment: vi.fn(),
  recordUnexpectedExternalRefund: vi.fn(),
  cancelPendingPixPurchase: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  authPrisma: {
    payment: { findFirst: mocks.findPayment, update: mocks.updatePayment },
    webhookEvent: {
      findUnique: mocks.findEvent,
      create: mocks.createEvent,
      updateMany: mocks.updateEventMany,
    },
    $transaction: (callback: (tx: unknown) => unknown) => callback({
      webhookEvent: { findUnique: mocks.findEvent, create: mocks.createEvent },
      payment: { update: mocks.updatePayment },
    }),
  },
}));
vi.mock("@/modules/payments/mercado-pago", () => ({
  getVerifiedPixOrder: mocks.getVerifiedPixOrder,
  classifyPixOrderStatus: () => ({
    providerStatus: "processed",
    normalizedStatus: "processed",
    approved: true,
  }),
  verifyMercadoPagoWebhookSignature: ({ dataId, requestId, signatureHeader, secret }: {
    dataId: string; requestId: string; signatureHeader: string; secret: string;
  }) => {
    const fields = Object.fromEntries(signatureHeader.split(",").map((part) => part.trim().split("=")));
    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${fields.ts};`;
    const expected = createHmac("sha256", secret).update(manifest).digest("hex");
    return fields.v1 === expected;
  },
}));
vi.mock("@/modules/payments/confirm-payment", () => ({
  confirmPixPayment: mocks.confirmPixPayment,
}));
vi.mock("@/modules/payments/record-unexpected-refund", () => ({
  recordUnexpectedExternalRefund: mocks.recordUnexpectedExternalRefund,
}));
vi.mock("@/modules/payments/cancel-pending-pix-purchase", () => ({
  cancelPendingPixPurchase: mocks.cancelPendingPixPurchase,
}));

import { POST } from "./route";

const secret = "webhook-test-secret";
const dataId = "order-123";
const requestId = "request-123";
const body = JSON.stringify({ id: "event-123", type: "order", data: { id: dataId } });
const timestamp = String(Date.now());
const signature = createHmac("sha256", secret)
  .update(`id:${dataId};request-id:${requestId};ts:${timestamp};`)
  .digest("hex");

function request(signatureValue = `ts=${timestamp},v1=${signature}`) {
  return new NextRequest(`https://superquina.test/api/payments/mercadopago/webhook?data.id=${dataId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
      "x-signature": signatureValue,
    },
    body,
  });
}

describe("POST /api/payments/mercadopago/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
    mocks.getVerifiedPixOrder.mockResolvedValue({
      orderId: dataId,
      status: "processed",
      statusDetail: "accredited",
      externalReference: "superquina_purchase_purchase-123",
      currency: "BRL",
      amountCents: 100,
      paymentAmountCents: 100,
      paymentMethodId: "pix",
      paymentMethodType: "bank_transfer",
      paymentStatus: "processed",
    });
    mocks.findPayment.mockResolvedValue({
      id: "payment-123",
      purchaseId: "purchase-123",
      amountCents: 100,
      purchase: { totalCents: 100 },
    });
    mocks.findEvent.mockResolvedValue(null);
    mocks.createEvent.mockResolvedValue({ id: "event-row-123", processedAt: null, processingError: null });
    mocks.updatePayment.mockResolvedValue({});
    mocks.updateEventMany.mockResolvedValue({ count: 1 });
    mocks.confirmPixPayment.mockResolvedValue({ outcome: "confirmed" });
  });

  it("rejects an invalid signature before querying provider or database", async () => {
    const response = await POST(request(`ts=${timestamp},v1=${"0".repeat(64)}`));
    expect(response.status).toBe(401);
    expect(mocks.getVerifiedPixOrder).not.toHaveBeenCalled();
    expect(mocks.findPayment).not.toHaveBeenCalled();
  });

  it("acknowledges a previously processed duplicate without confirming twice", async () => {
    mocks.findEvent.mockResolvedValue({ id: "event-row-123", processedAt: new Date() });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: true, duplicate: true });
    expect(mocks.confirmPixPayment).not.toHaveBeenCalled();
  });

  it("returns retryable 503 when processing fails and retries an unprocessed event", async () => {
    mocks.confirmPixPayment
      .mockRejectedValueOnce(new Error("temporary database outage"))
      .mockResolvedValueOnce({ outcome: "confirmed" });

    const first = await POST(request());
    expect(first.status).toBe(503);
    expect(mocks.updateEventMany).toHaveBeenCalledTimes(2);
    expect(mocks.updateEventMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "event-row-123", processedAt: null }),
      data: { processingError: null },
    }));

    // The event exists but its claim was released after the transient failure.
    mocks.findEvent.mockResolvedValue({ id: "event-row-123", processedAt: null, processingError: null });
    const retry = await POST(request());
    expect(retry.status).toBe(200);
    expect(mocks.confirmPixPayment).toHaveBeenCalledTimes(2);
    expect(mocks.updateEventMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "event-row-123", processedAt: null, processingError: expect.stringMatching(/^processing:/) }),
      data: expect.objectContaining({ processedAt: expect.any(Date), processingError: null }),
    }));
  });

  it("returns retryable 503 when the payment mapping has not been persisted yet", async () => {
    mocks.findPayment.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.confirmPixPayment).not.toHaveBeenCalled();
  });
  it("returns retryable 503 while another delivery holds a recent claim", async () => {
    mocks.findEvent.mockResolvedValue({
      id: "event-row-123",
      processedAt: null,
      processingError: `processing:${Date.now()}:other-request`,
    });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.updateEventMany).not.toHaveBeenCalled();
    expect(mocks.confirmPixPayment).not.toHaveBeenCalled();
  });

  it("reclaims an abandoned claim after the lease expires", async () => {
    const expiredClaim = `processing:${Date.now() - 10 * 60_000}:previous-request`;
    mocks.findEvent.mockResolvedValue({
      id: "event-row-123",
      processedAt: null,
      processingError: expiredClaim,
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.updateEventMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "event-row-123", processedAt: null, processingError: expiredClaim }),
      data: { processingError: expect.stringMatching(/^processing:/) },
    }));
    expect(mocks.confirmPixPayment).toHaveBeenCalledTimes(1);
  });

  it("allows only one concurrent delivery to claim an existing unprocessed event", async () => {
    let claimAcquired = false;
    mocks.findEvent.mockResolvedValue({ id: "event-row-123", processedAt: null, processingError: null });
    mocks.updateEventMany.mockImplementation(async (args: {
      where: { processingError?: string | null };
      data: { processingError?: string | null; processedAt?: Date };
    }) => {
      if (typeof args.data.processingError === "string" && args.data.processingError.startsWith("processing:")) {
        if (claimAcquired) return { count: 0 };
        claimAcquired = true;
        return { count: 1 };
      }
      return { count: 1 };
    });

    const [first, concurrent] = await Promise.all([POST(request()), POST(request())]);
    expect([first.status, concurrent.status].sort()).toEqual([200, 503]);
    expect(mocks.confirmPixPayment).toHaveBeenCalledTimes(1);
  });

  it("does not confirm twice when concurrent deliveries race to create the same event", async () => {
    let createAttempts = 0;
    mocks.createEvent.mockImplementation(async () => {
      createAttempts += 1;
      if (createAttempts === 1) return { id: "event-row-123", processedAt: null };
      const conflict = Object.assign(new Error("Unique constraint violation"), { code: "P2002" });
      throw conflict;
    });

    const [first, concurrent] = await Promise.all([POST(request()), POST(request())]);
    const statuses = [first.status, concurrent.status].sort();
    expect(statuses).toEqual([200, 503]);
    expect(mocks.confirmPixPayment).toHaveBeenCalledTimes(1);
    expect(createAttempts).toBe(2);
  });

});
