import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const API_BASE = "https://api.mercadopago.com";

type MercadoPagoOrder = {
  id?: string;
  status?: string;
  status_detail?: string;
  total_amount?: string | number;
  currency?: string;
  external_reference?: string;
  transactions?: {
    payments?: Array<{
      amount?: string | number;
      status?: string;
      status_detail?: string;
      payment_method?: {
        id?: string;
        type?: string;
        qr_code?: string;
        qr_code_base64?: string;
        ticket_url?: string;
      };
    }>;
  };
};

export type PixCheckout = {
  orderId: string;
  status: string;
  statusDetail: string | null;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
};

export type VerifiedPixOrder = PixCheckout & {
  externalReference: string | null;
  currency: string | null;
  amountCents: number | null;
  paymentStatus: string | null;
  paymentAmountCents: number | null;
  paymentMethodId: string | null;
  paymentMethodType: string | null;
};

export function parseVerifiedPixOrder(payload: MercadoPagoOrder): VerifiedPixOrder {
  const checkout = parseOrder(payload);
  const payment = payload.transactions?.payments?.[0];
  const amount = Number(payload.total_amount);
  const paymentAmount = Number(payment?.amount);
  return {
    ...checkout,
    externalReference: payload.external_reference ?? null,
    currency: payload.currency ?? null,
    amountCents: Number.isFinite(amount) ? Math.round(amount * 100) : null,
    paymentStatus: payment?.status ?? null,
    paymentAmountCents: Number.isFinite(paymentAmount) ? Math.round(paymentAmount * 100) : null,
    paymentMethodId: payment?.payment_method?.id ?? null,
    paymentMethodType: payment?.payment_method?.type ?? null,
  };
}


export function classifyPixOrderStatus(order: Pick<VerifiedPixOrder, "status" | "statusDetail" | "paymentStatus">): {
  providerStatus: string;
  normalizedStatus: string;
  approved: boolean;
} {
  const orderStatus = order.status.trim().toLowerCase();
  const transactionStatus = order.paymentStatus?.trim().toLowerCase() ?? null;
  const statusDetail = order.statusDetail?.trim().toLowerCase() ?? null;
  const terminalStatuses = ["refunded", "cancelled", "canceled", "expired", "rejected", "failed", "failure"];
  // Order-level terminal states take precedence over a transaction status that
  // might still reflect an earlier successful state.
  const providerStatus = terminalStatuses.includes(orderStatus)
    ? order.status
    : order.paymentStatus ?? order.status;

  return {
    providerStatus,
    normalizedStatus: providerStatus.trim().toLowerCase(),
    // Orders API uses processed + accredited for a successfully credited Pix.
    // Do not use the Payments API's "approved" vocabulary for Orders.
    approved: orderStatus === "processed"
      && transactionStatus === "processed"
      && statusDetail === "accredited",
  };
}

export function verifyMercadoPagoWebhookSignature(input: {
  dataId: string;
  requestId: string;
  signatureHeader: string;
  secret: string;
  nowMs?: number;
}): boolean {
  const fields = Object.fromEntries(input.signatureHeader.split(",").map((part) => {
    const [key, ...value] = part.trim().split("=");
    return [key, value.join("=")];
  }));
  const timestamp = fields.ts;
  const supplied = fields.v1;
  if (!timestamp || !supplied || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  if (!/^\d+$/.test(timestamp)) return false;
  const timestampValue = Number(timestamp);
  // Mercado Pago's webhook formats differ by product/API: some send Unix
  // seconds (10 digits), while Orders notifications can send Unix milliseconds
  // (13 digits). Normalize both to milliseconds before applying the replay window.
  const timestampMs = timestampValue >= 1_000_000_000_000
    ? timestampValue
    : timestampValue * 1000;
  const nowMs = input.nowMs ?? Date.now();
  // Reject stale/future signed requests to limit replay; provider retries can
  // be retried normally while inside this bounded acceptance window.
  if (!Number.isSafeInteger(timestampMs) || Math.abs(nowMs - timestampMs) > 5 * 60 * 1000) return false;
  const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.requestId};ts:${timestamp};`;
  const expected = createHmac("sha256", input.secret).update(manifest).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const suppliedBuffer = Buffer.from(supplied, "hex");
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export async function getVerifiedPixOrder(orderId: string): Promise<VerifiedPixOrder> {
  const payload = await requestOrder(orderId);
  return parseVerifiedPixOrder(payload);
}

/**
 * The player is not asked for or required to provide an email.
 * Mercado Pago's Orders API requires payer.email, so mirror the legacy
 * operational fallback with a deterministic synthetic address. It is not
 * used for contact and must never be presented as the player's real email.
 */
export function syntheticPayerEmail(playerId: string): string {
  const digest = createHash("sha256").update(playerId).digest("hex").slice(0, 20);
  const domain = (process.env.MERCADOPAGO_PAYER_EMAIL_DOMAIN || "superquina.com")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    throw new Error("MERCADOPAGO_PAYER_EMAIL_DOMAIN is invalid");
  }
  return `jogador-${digest}@${domain}`;
}

function getAccessToken() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  return token || null;
}

function parseOrder(payload: MercadoPagoOrder): PixCheckout {
  const payment = payload.transactions?.payments?.[0];
  if (!payload.id) throw new Error("Mercado Pago returned an order without an ID");
  return {
    orderId: payload.id,
    status: payload.status ?? "unknown",
    statusDetail: payload.status_detail ?? payment?.status_detail ?? null,
    qrCode: payment?.payment_method?.qr_code ?? null,
    qrCodeBase64: payment?.payment_method?.qr_code_base64 ?? null,
    ticketUrl: payment?.payment_method?.ticket_url ?? null,
  };
}

async function requestOrder(orderId: string): Promise<MercadoPagoOrder> {
  const token = getAccessToken();
  if (!token) throw new Error("Mercado Pago is not configured");
  const response = await fetch(`${API_BASE}/v1/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Mercado Pago order lookup failed (${response.status})`);
  }
  return await response.json() as MercadoPagoOrder;
}

export async function createPixOrder(input: {
  purchaseId: string;
  paymentIdempotencyKey: string;
  playerId: string;
  amountCents: number;
}): Promise<PixCheckout | null> {
  const token = getAccessToken();
  if (!token) return null;
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1) {
    throw new Error("Invalid Pix amount");
  }

  const amount = (input.amountCents / 100).toFixed(2);
  const response = await fetch(`${API_BASE}/v1/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": input.paymentIdempotencyKey,
    },
    body: JSON.stringify({
      type: "online",
      processing_mode: "automatic",
      total_amount: amount,
      external_reference: `superquina_purchase_${input.purchaseId}`,
      payer: { email: syntheticPayerEmail(input.playerId) },
      transactions: {
        payments: [{
          amount,
          payment_method: { id: "pix", type: "bank_transfer" },
        }],
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    // Do not log provider bodies or credentials. The persisted idempotency key is
    // reused on retry, including when the network outcome was ambiguous.
    throw new Error(`Mercado Pago could not create the Pix order (${response.status})`);
  }

  // Persist the provider order ID even if the immediate response omits QR data.
  // A later retry can retrieve the same order by ID instead of creating a new one.
  return parseOrder(await response.json() as MercadoPagoOrder);
}

export async function getPixOrder(orderId: string): Promise<PixCheckout> {
  return parseOrder(await requestOrder(orderId));
}
