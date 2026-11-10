import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyPixOrderStatus, createPixOrder, parseVerifiedPixOrder, syntheticPayerEmail, verifyMercadoPagoWebhookSignature } from "./mercado-pago";

describe("Mercado Pago webhook signature", () => {
  const secret = "test-webhook-secret";
  const dataId = "order-123";
  const requestId = "request-456";
  const nowMs = Date.now();
  const timestamp = String(Math.floor(nowMs / 1000));
  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  const signatureHeader = `ts=${timestamp},v1=${v1}`;

  it("accepts a matching signature within the timestamp window", () => {
    expect(verifyMercadoPagoWebhookSignature({
      dataId, requestId, signatureHeader, secret, nowMs,
    })).toBe(true);
  });

  it("rejects a modified resource ID", () => {
    expect(verifyMercadoPagoWebhookSignature({
      dataId: "order-other", requestId, signatureHeader, secret, nowMs,
    })).toBe(false);
  });

  it("rejects a modified request ID", () => {
    expect(verifyMercadoPagoWebhookSignature({
      dataId, requestId: "request-other", signatureHeader, secret, nowMs,
    })).toBe(false);
  });

  it("rejects malformed signatures and stale timestamps", () => {
    expect(verifyMercadoPagoWebhookSignature({
      dataId, requestId, signatureHeader: "ts=bad,v1=not-a-signature", secret, nowMs,
    })).toBe(false);
    expect(verifyMercadoPagoWebhookSignature({
      dataId, requestId, signatureHeader, secret, nowMs: nowMs + 6 * 60 * 1000,
    })).toBe(false);
  });
});


describe("Mercado Pago order parsing", () => {
  it("parses the order, Pix copy-and-paste and amounts into integer cents", () => {
    expect(parseVerifiedPixOrder({
      id: "order-123",
      status: "processed",
      status_detail: "accredited",
      total_amount: "12.50",
      currency: "BRL",
      external_reference: "superquina_purchase_purchase123",
      transactions: {
        payments: [{
          amount: "12.50",
          status: "approved",
          payment_method: {
            id: "pix",
            type: "bank_transfer",
            qr_code: "000201pix-copy-paste",
            qr_code_base64: "aGVsbG8=",
            ticket_url: "https://example.invalid/ticket",
          },
        }],
      },
    })).toMatchObject({
      orderId: "order-123",
      status: "processed",
      statusDetail: "accredited",
      qrCode: "000201pix-copy-paste",
      qrCodeBase64: "aGVsbG8=",
      externalReference: "superquina_purchase_purchase123",
      currency: "BRL",
      amountCents: 1250,
      paymentStatus: "approved",
      paymentAmountCents: 1250,
      paymentMethodId: "pix",
      paymentMethodType: "bank_transfer",
    });
  });

  it("uses a deterministic synthetic payer email without asking for a real address", () => {
    const originalDomain = process.env.MERCADOPAGO_PAYER_EMAIL_DOMAIN;
    delete process.env.MERCADOPAGO_PAYER_EMAIL_DOMAIN;
    try {
      const first = syntheticPayerEmail("player-123");
      expect(first).toBe(syntheticPayerEmail("player-123"));
      expect(first).toMatch(/^jogador-[a-f0-9]{20}@superquina\.com$/);
      expect(first).not.toContain("player-123");
    } finally {
      if (originalDomain === undefined) delete process.env.MERCADOPAGO_PAYER_EMAIL_DOMAIN;
      else process.env.MERCADOPAGO_PAYER_EMAIL_DOMAIN = originalDomain;
    }
  });

  it("rejects an invalid synthetic payer email domain", () => {
    const originalDomain = process.env.MERCADOPAGO_PAYER_EMAIL_DOMAIN;
    process.env.MERCADOPAGO_PAYER_EMAIL_DOMAIN = "not a domain";
    try {
      expect(() => syntheticPayerEmail("player-123")).toThrow("MERCADOPAGO_PAYER_EMAIL_DOMAIN is invalid");
    } finally {
      if (originalDomain === undefined) delete process.env.MERCADOPAGO_PAYER_EMAIL_DOMAIN;
      else process.env.MERCADOPAGO_PAYER_EMAIL_DOMAIN = originalDomain;
    }
  });
});


describe("Mercado Pago order status classification", () => {
  it("requires a processed order, processed Pix transaction, and accredited detail", () => {
    expect(classifyPixOrderStatus({ status: "processed", paymentStatus: "processed", statusDetail: "accredited" })).toMatchObject({
      providerStatus: "processed",
      normalizedStatus: "processed",
      approved: true,
    });
    expect(classifyPixOrderStatus({ status: "created", paymentStatus: "processed", statusDetail: "accredited" }).approved).toBe(false);
    expect(classifyPixOrderStatus({ status: "processed", paymentStatus: "pending", statusDetail: "accredited" }).approved).toBe(false);
    expect(classifyPixOrderStatus({ status: "processed", paymentStatus: "processed", statusDetail: "pending" }).approved).toBe(false);
  });

  it("does not mistake a refunded order for an approved payment", () => {
    expect(classifyPixOrderStatus({ status: "refunded", paymentStatus: "processed", statusDetail: "accredited" })).toMatchObject({
      providerStatus: "refunded",
      normalizedStatus: "refunded",
      approved: false,
    });
  });
});


describe("Mercado Pago Pix order creation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns and preserves the provider order ID when QR data is not ready yet", async () => {
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "test-access-token");
    vi.stubEnv("MERCADOPAGO_PAYER_EMAIL_DOMAIN", "superquina.com");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "order-created-without-qr",
        status: "created",
        total_amount: "1.00",
        currency: "BRL",
        transactions: { payments: [{ amount: "1.00", payment_method: { id: "pix", type: "bank_transfer" } }] },
      }),
    }));

    const checkout = await createPixOrder({
      purchaseId: "purchase-123",
      paymentIdempotencyKey: "stable-payment-key-123",
      playerId: "player-123",
      amountCents: 100,
    });

    expect(checkout).toMatchObject({
      orderId: "order-created-without-qr",
      status: "created",
      qrCode: null,
    });
  });
});
