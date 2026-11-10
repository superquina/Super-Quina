import { Prisma, type PrismaClient } from "@/generated/prisma/client";

type RefundAuditInput = {
  purchaseId: string;
  paymentId: string;
  providerStatus: string;
  source: "webhook" | "status_fallback";
};

/**
 * Records an unexpected provider refund once per purchase. Refunds are handled
 * as informational reconciliation events only; this never initiates a refund
 * or changes a confirmed purchase, allocated tickets, prizes, or commissions.
 */
export async function recordUnexpectedExternalRefund(
  prisma: PrismaClient,
  input: RefundAuditInput,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const prior = await tx.auditEvent.findFirst({
      where: {
        action: "UNEXPECTED_EXTERNAL_REFUND_REPORTED",
        entityType: "Purchase",
        entityId: input.purchaseId,
      },
      select: { id: true },
    });
    if (prior) return;
    await tx.auditEvent.create({
      data: {
        action: "UNEXPECTED_EXTERNAL_REFUND_REPORTED",
        entityType: "Purchase",
        entityId: input.purchaseId,
        metadata: {
          paymentId: input.paymentId,
          providerStatus: input.providerStatus,
          source: input.source,
          note: "Informational provider event only; no internal refund or reversal is performed.",
        },
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
