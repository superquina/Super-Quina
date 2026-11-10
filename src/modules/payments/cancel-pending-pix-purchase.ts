import { Prisma, type PrismaClient } from "@/generated/prisma/client";

export type PixTerminalStatus = "FAILED" | "CANCELLED" | "EXPIRED";
export type PixTerminalSource = "webhook" | "status_fallback";

/**
 * Applies a definitive negative provider state to a still-pending Pix purchase.
 * The same lock, conditional writes and serializable retry policy are shared by
 * webhook and polling so concurrent approval/cancellation cannot split states.
 */
export async function cancelPendingPixPurchase(
  prisma: PrismaClient,
  input: {
    paymentId: string;
    purchaseId: string;
    terminalStatus: PixTerminalStatus;
    providerStatus: string;
    providerStatusDetail: string | null;
    source: PixTerminalSource;
  },
): Promise<boolean> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT p."id" FROM "Purchase" p JOIN "Payment" pay ON pay."purchaseId" = p."id" WHERE pay."id" = ${input.paymentId} FOR UPDATE OF p, pay`;

        const changed = await tx.payment.updateMany({
          where: { id: input.paymentId, purchaseId: input.purchaseId, status: "PENDING" },
          data: {
            status: input.terminalStatus,
            providerStatus: input.providerStatus,
            providerStatusDetail: input.providerStatusDetail,
          },
        });
        if (changed.count !== 1) return false;

        const cancelledPurchase = await tx.purchase.updateMany({
          where: { id: input.purchaseId, status: "PENDING_PAYMENT" },
          data: { status: "CANCELLED" },
        });
        if (cancelledPurchase.count !== 1) {
          throw new Error("Pending Pix payment could not cancel its pending purchase");
        }

        await tx.purchaseParticipation.updateMany({
          where: { purchaseId: input.purchaseId, status: "PENDING" },
          data: { status: "CANCELLED" },
        });
        await tx.auditEvent.create({
          data: {
            action: "PIX_PAYMENT_TERMINAL_FAILURE",
            entityType: "Purchase",
            entityId: input.purchaseId,
            metadata: {
              paymentId: input.paymentId,
              providerStatus: input.providerStatus,
              terminalStatus: input.terminalStatus,
              source: input.source,
            },
          },
        });
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const serializationConflict = error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || (error.code === "P2010" &&
          (error.meta?.code === "40001" || error.message.toLowerCase().includes("could not serialize access"))));
      if (serializationConflict && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}
