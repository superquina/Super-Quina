import "server-only";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

export type PrintJobFailureCode =
  | "PERMISSION_DENIED"
  | "DEVICE_UNAVAILABLE"
  | "CONNECTION_FAILED"
  | "WRITE_FAILED"
  | "ENCODING_FAILED"
  | "UNKNOWN_TRANSPORT_RESULT";

export class PrintJobServiceError extends Error {
  constructor(
    message: string,
    readonly code: "RECEIPT_NOT_READY" | "PURCHASE_NOT_FOUND" | "ACTOR_NOT_ALLOWED" | "JOB_NOT_FOUND" | "INVALID_TRANSITION",
  ) {
    super(message);
    this.name = "PrintJobServiceError";
  }
}

const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function assertReceiptReady(tx: Prisma.TransactionClient, purchaseId: string) {
  const purchase = await tx.purchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      playerId: true,
      cashierId: true,
      createdAt: true,
      status: true,
      paymentMethod: true,
      receiptCode: true,
      confirmedAt: true,
      payment: { select: { status: true, confirmedAt: true } },
    },
  });
  if (!purchase) throw new PrintJobServiceError("Compra não encontrada.", "PURCHASE_NOT_FOUND");
  const paymentConfirmed = purchase.paymentMethod !== "PIX"
    || (purchase.payment?.status === "CONFIRMED" && Boolean(purchase.payment.confirmedAt));
  const ready = purchase.status === "CONFIRMED"
    && Boolean(purchase.receiptCode && purchase.confirmedAt)
    && paymentConfirmed;
  if (!ready || Date.now() >= purchase.createdAt.getTime() + RECEIPT_TTL_MS) {
    throw new PrintJobServiceError("O recibo ainda não está disponível para impressão.", "RECEIPT_NOT_READY");
  }
  return purchase;
}

/**
 * Reserves at most one automatic receipt job per purchase. The nullable unique
 * key allows any number of separately audited manual reprints.
 */
export async function reserveAutomaticReceiptPrint(prisma: PrismaClient, purchaseId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      await assertReceiptReady(tx, purchaseId);
      const existing = await tx.printJob.findUnique({ where: { autoReceiptKey: purchaseId } });
      if (existing) return { created: false as const, job: existing };
      const job = await tx.printJob.create({
        data: {
          purchaseId,
          purpose: "AUTO_RECEIPT",
          autoReceiptKey: purchaseId,
          status: "RESERVED",
        },
      });
      return { created: true as const, job };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    const retryableConflict = error instanceof Prisma.PrismaClientKnownRequestError
      && (error.code === "P2002" || error.code === "P2034"
        || (error.code === "P2010" && error.meta?.code === "40001"));
    if (!retryableConflict) throw error;
    const existing = await prisma.printJob.findUnique({ where: { autoReceiptKey: purchaseId } });
    if (existing) return { created: false as const, job: existing };
    throw error;
  }
}

/** Creates a new audit record for each explicit manual reprint. */
export async function createManualReceiptReprint(prisma: PrismaClient, input: { purchaseId: string; actorId: string }) {
  return prisma.$transaction(async (tx) => {
    const [actor, purchase] = await Promise.all([
      tx.user.findUnique({ where: { id: input.actorId }, select: { id: true, role: true, status: true } }),
      assertReceiptReady(tx, input.purchaseId),
    ]);
    if (!actor || actor.status !== "ACTIVE") throw new PrintJobServiceError("Acesso não permitido.", "ACTOR_NOT_ALLOWED");
    const ownsPurchase = actor.role === "ADMIN"
      || (actor.role === "PLAYER" && purchase.playerId === actor.id)
      || (actor.role === "CASHIER" && purchase.cashierId === actor.id);
    if (!ownsPurchase) throw new PrintJobServiceError("Compra não encontrada.", "PURCHASE_NOT_FOUND");
    return tx.printJob.create({
      data: {
        purchaseId: input.purchaseId,
        purpose: "MANUAL_REPRINT",
        requestedById: actor.id,
        status: "RESERVED",
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Enforces one-way delivery states. SENDING/SENT/UNKNOWN are never reset to
 * RESERVED, so a possibly delivered receipt is not automatically duplicated.
 */
export async function transitionPrintJob(
  prisma: PrismaClient,
  input: {
    jobId: string;
    nextStatus: "SENDING" | "SENT" | "FAILED" | "UNKNOWN";
    deviceName?: string | null;
    errorCode?: PrintJobFailureCode | null;
  },
) {
  const now = new Date();
  const deviceName = input.deviceName?.replace(/[\r\n\t]+/g, " ").trim().slice(0, 120) || null;
  const errorCode = input.errorCode ?? null;
  if (input.nextStatus === "SENDING" && errorCode) {
    throw new PrintJobServiceError("Transição inválida.", "INVALID_TRANSITION");
  }
  if ((input.nextStatus === "FAILED" || input.nextStatus === "UNKNOWN") && !errorCode) {
    throw new PrintJobServiceError("É necessário informar um código de falha.", "INVALID_TRANSITION");
  }
  if (input.nextStatus === "SENT" && errorCode) {
    throw new PrintJobServiceError("Transição inválida.", "INVALID_TRANSITION");
  }
  const result = await prisma.printJob.updateMany({
    where: {
      id: input.jobId,
      status: input.nextStatus === "SENDING"
        ? "RESERVED"
        : input.nextStatus === "FAILED"
          ? { in: ["RESERVED", "SENDING"] }
          : "SENDING",
    },
    data: {
      status: input.nextStatus,
      ...(input.nextStatus === "SENDING" ? { sendingAt: now, deviceName } : { completedAt: now, deviceName, errorCode }),
    },
  });
  if (result.count !== 1) throw new PrintJobServiceError("Trabalho de impressão inexistente ou já processado.", "INVALID_TRANSITION");
  return prisma.printJob.findUniqueOrThrow({ where: { id: input.jobId } });
}
