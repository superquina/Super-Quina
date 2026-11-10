import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authPrisma } from "@/lib/auth/session";
import { classifyPixOrderStatus, getVerifiedPixOrder, verifyMercadoPagoWebhookSignature } from "@/modules/payments/mercado-pago";
import { confirmPixPayment } from "@/modules/payments/confirm-payment";
import { recordUnexpectedExternalRefund } from "@/modules/payments/record-unexpected-refund";
import { cancelPendingPixPurchase } from "@/modules/payments/cancel-pending-pix-purchase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

type MercadoPagoWebhookBody = {
  id?: string | number;
  type?: string;
  action?: string;
  data?: { id?: string | number };
};

function response(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers });
}

/**
 * Authenticates the notification, reconciles canonical provider state, and sends
 * approved payments through the domain's cutoff-aware confirmation transaction.
 * The webhook payload itself is never treated as proof of payment.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim();
  if (!secret) return response({ error: "Webhook is not configured." }, 503);

  const dataId = request.nextUrl.searchParams.get("data.id")
    ?? request.nextUrl.searchParams.get("id");
  const requestId = request.headers.get("x-request-id");
  const signature = request.headers.get("x-signature");
  if (!dataId || !requestId || !signature ||
    !verifyMercadoPagoWebhookSignature({ dataId, requestId, signatureHeader: signature, secret })) {
    return response({ error: "Invalid webhook signature." }, 401);
  }

  let rawBody: string;
  let body: MercadoPagoWebhookBody;
  try {
    rawBody = await request.text();
    body = JSON.parse(rawBody) as MercadoPagoWebhookBody;
  } catch {
    return response({ error: "Invalid webhook payload." }, 400);
  }

  const resourceId = String(body.data?.id ?? dataId);
  if (resourceId !== dataId) return response({ error: "Webhook resource mismatch." }, 400);

  let claimedEventId: string | null = null;
  let claimToken: string | null = null;

  try {
    // Fetch canonical state from the provider; the body itself is never trusted
    // as evidence that money was received.
    const order = await getVerifiedPixOrder(resourceId);
    if (order.orderId !== resourceId) return response({ error: "Provider resource mismatch." }, 400);

    const payment = await authPrisma.payment.findFirst({
      where: { provider: "MERCADO_PAGO", providerPaymentId: resourceId },
      select: { id: true, purchaseId: true, amountCents: true, purchase: { select: { totalCents: true } } },
    });
    if (!payment) {
      // The provider may notify before the checkout request persisted its order ID.
      // Return retryable status instead of acknowledging an event we cannot reconcile.
      return response({ error: "Payment mapping not found yet." }, 503);
    }

    const expectedReference = "superquina_purchase_" + payment.purchaseId;
    const { providerStatus, normalizedStatus, approved } = classifyPixOrderStatus(order);
    const methodMismatch = (order.paymentMethodId !== null && order.paymentMethodId.toLowerCase() !== "pix")
      || (order.paymentMethodType !== null && order.paymentMethodType.toLowerCase() !== "bank_transfer");
    const approvedPaymentMismatch = approved && (
      order.paymentAmountCents !== payment.amountCents
      || order.paymentMethodId?.toLowerCase() !== "pix"
      || order.paymentMethodType?.toLowerCase() !== "bank_transfer"
    );
    if (order.externalReference !== expectedReference
      || order.currency !== "BRL"
      || order.amountCents !== payment.amountCents
      || order.amountCents !== payment.purchase.totalCents
      || methodMismatch
      || approvedPaymentMismatch) {
      return response({ error: "Provider payment does not match the recorded purchase." }, 422);
    }

    const eventId = String(body.id ?? `${body.type ?? "unknown"}:${resourceId}:${requestId}`);
    const digest = createHash("sha256").update(rawBody).digest("hex");
    const eventState = await authPrisma.$transaction(async (tx) => {
      const existing = await tx.webhookEvent.findUnique({
        where: { provider_providerEventId: { provider: "MERCADO_PAGO", providerEventId: eventId } },
        select: { id: true, processedAt: true, processingError: true },
      });
      if (existing?.processedAt) return { alreadyProcessed: true, eventId: existing.id, processingError: null };

      const event = existing ?? await tx.webhookEvent.create({
        data: {
          provider: "MERCADO_PAGO",
          providerEventId: eventId,
          eventType: String(body.type ?? body.action ?? "unknown").slice(0, 100),
          payloadDigest: digest,
          paymentId: payment.id,
        },
        select: { id: true, processedAt: true, processingError: true },
      });

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          providerStatus: order.status,
          providerStatusDetail: order.statusDetail,
        },
      });
      return { alreadyProcessed: false, eventId: event.id, processingError: event.processingError };
    });
    if (eventState.alreadyProcessed) return response({ received: true, duplicate: true }, 200);

    // Claim an unprocessed event with compare-and-set. A recent claim is left
    // alone so overlapping deliveries cannot execute the same side effects.
    // Claims older than five minutes can be recovered after a crashed process.
    const claimAgeMs = 5 * 60_000;
    const currentClaimAt = eventState.processingError?.startsWith("processing:")
      ? Number(eventState.processingError.slice("processing:".length).split(":", 1)[0])
      : Number.NaN;
    if (Number.isFinite(currentClaimAt) && Date.now() - currentClaimAt < claimAgeMs) {
      return response({ error: "Webhook event is already being processed." }, 503);
    }

    claimToken = `processing:${Date.now()}:${requestId}`;
    const claim = await authPrisma.webhookEvent.updateMany({
      where: { id: eventState.eventId, processedAt: null, processingError: eventState.processingError },
      data: { processingError: claimToken },
    });
    if (claim.count !== 1) {
      return response({ error: "Webhook event is already being processed." }, 503);
    }
    claimedEventId = eventState.eventId;

    const markEventProcessed = async () => {
      const marked = await authPrisma.webhookEvent.updateMany({
        where: { id: eventState.eventId, processedAt: null, processingError: claimToken },
        data: { processedAt: new Date(), processingError: null },
      });
      if (marked.count !== 1) throw new Error("Webhook event processing claim was lost.");
      claimedEventId = null;
      claimToken = null;
    };

    // An order-level terminal state (especially refunded) takes precedence over
    // an older transaction-level "approved" state. Confirmation requires both
    // the order and its Pix transaction to be in their successful states.
    if (approved) {
      const confirmation = await confirmPixPayment(authPrisma, {
        paymentId: payment.id,
        providerStatus,
        providerStatusDetail: order.statusDetail,
      });
      if (confirmation.outcome === "late_or_unavailable") {
        // Acknowledge the provider event but leave purchase/receipt pending for
        // an explicit refund/reconciliation decision; never confirm retroactively.
        await markEventProcessed();
        return response({ received: true, reconciliationRequired: true }, 200);
      }
    } else {
      // A provider-final negative result must close the pending purchase without
      // issuing a receipt. Only pending records may transition; delayed duplicate
      // notifications must never undo a previously confirmed purchase.
      if (normalizedStatus === "refunded") {
        // Refunds are not part of the game's commercial flow. Treat an external
        // refund notification as an administrative incident; never undo a ticket.
        await recordUnexpectedExternalRefund(authPrisma, {
          purchaseId: payment.purchaseId, paymentId: payment.id, providerStatus, source: "webhook",
        });
      } else {
        const terminalStatus = ["rejected", "failure", "failed"].includes(normalizedStatus)
          ? "FAILED"
          : ["cancelled", "canceled"].includes(normalizedStatus)
            ? "CANCELLED"
            : normalizedStatus === "expired"
              ? "EXPIRED"
              : null;
        if (terminalStatus) {
          await cancelPendingPixPurchase(authPrisma, {
            paymentId: payment.id,
            purchaseId: payment.purchaseId,
            terminalStatus,
            providerStatus,
            providerStatusDetail: order.statusDetail,
            source: "webhook",
          });
        }
      }
    }

    await markEventProcessed();
    return response({ received: true }, 200);
  } catch {
    // Release only this execution's claim. The provider can safely retry the
    // unprocessed event; a different concurrent execution's claim is untouched.
    if (claimedEventId && claimToken) {
      await authPrisma.webhookEvent.updateMany({
        where: { id: claimedEventId, processedAt: null, processingError: claimToken },
        data: { processingError: null },
      }).catch(() => undefined);
    }
    // Do not leak provider responses, payloads, database details or credentials.
    return response({ error: "Webhook reconciliation temporarily unavailable." }, 503);
  }
}
