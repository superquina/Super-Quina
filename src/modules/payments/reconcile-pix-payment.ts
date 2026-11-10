import { type PrismaClient } from "@/generated/prisma/client";
import { classifyPixOrderStatus, getVerifiedPixOrder } from "@/modules/payments/mercado-pago";
import { confirmPixPayment } from "@/modules/payments/confirm-payment";
import { recordUnexpectedExternalRefund } from "@/modules/payments/record-unexpected-refund";
import { cancelPendingPixPurchase } from "@/modules/payments/cancel-pending-pix-purchase";

export type PixReconciliationOutcome =
  | "confirmed"
  | "already_confirmed"
  | "late_or_unavailable"
  | "not_pending"
  | "still_pending"
  | "terminal";

/**
 * Rechecks the canonical Mercado Pago order. Used by the authenticated status
 * endpoints as a fallback when a webhook is delayed or missed. Both channels
 * converge on confirmPixPayment, which is transactional and idempotent.
 */
export async function reconcilePixPaymentFromProvider(
  prisma: PrismaClient,
  paymentId: string,
): Promise<PixReconciliationOutcome> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      purchaseId: true,
      provider: true,
      providerPaymentId: true,
      amountCents: true,
      status: true,
      purchase: { select: { totalCents: true, status: true } },
    },
  });
  if (!payment || payment.provider !== "MERCADO_PAGO" || !payment.providerPaymentId) return "not_pending";
  if (payment.status === "CONFIRMED" && payment.purchase.status === "CONFIRMED") return "already_confirmed";
  if (payment.status !== "PENDING" || payment.purchase.status !== "PENDING_PAYMENT") return "not_pending";

  const order = await getVerifiedPixOrder(payment.providerPaymentId);
  const { providerStatus, normalizedStatus, approved } = classifyPixOrderStatus(order);
  const methodMismatch = (order.paymentMethodId !== null && order.paymentMethodId.toLowerCase() !== "pix")
    || (order.paymentMethodType !== null && order.paymentMethodType.toLowerCase() !== "bank_transfer");
  const approvedPaymentMismatch = approved && (
    order.paymentAmountCents !== payment.amountCents
    || order.paymentMethodId?.toLowerCase() !== "pix"
    || order.paymentMethodType?.toLowerCase() !== "bank_transfer"
  );
  if (order.orderId !== payment.providerPaymentId
    || order.externalReference !== "superquina_purchase_" + payment.purchaseId
    || order.currency !== "BRL"
    || order.amountCents !== payment.amountCents
    || order.amountCents !== payment.purchase.totalCents
    || methodMismatch
    || approvedPaymentMismatch) {
    throw new Error("Mercado Pago order does not match the pending Pix purchase");
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { providerStatus, providerStatusDetail: order.statusDetail },
  });

  if (approved) {
    const result = await confirmPixPayment(prisma, {
      paymentId: payment.id,
      providerStatus,
      providerStatusDetail: order.statusDetail,
    });
    return result.outcome;
  }

  if (normalizedStatus === "refunded") {
    await recordUnexpectedExternalRefund(prisma, {
      purchaseId: payment.purchaseId, paymentId: payment.id, providerStatus, source: "status_fallback",
    });
    return "still_pending";
  }

  const terminalStatus = ["rejected", "failure", "failed"].includes(normalizedStatus)
    ? "FAILED"
    : ["cancelled", "canceled"].includes(normalizedStatus)
      ? "CANCELLED"
      : normalizedStatus === "expired"
        ? "EXPIRED"
        : null;
  if (!terminalStatus) return "still_pending";

  const cancelled = await cancelPendingPixPurchase(prisma, {
    paymentId: payment.id,
    purchaseId: payment.purchaseId,
    terminalStatus,
    providerStatus,
    providerStatusDetail: order.statusDetail,
    source: "status_fallback",
  });
  if (cancelled) return "terminal";

  // Approval may have won the lock race. Report the committed state rather
  // than claiming a cancellation that the conditional transition did not make.
  const latest = await prisma.payment.findUnique({
    where: { id: payment.id },
    select: { status: true, purchase: { select: { status: true } } },
  });
  if (latest?.status === "CONFIRMED" && latest.purchase.status === "CONFIRMED") return "already_confirmed";
  return "not_pending";
}
