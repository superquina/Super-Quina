import { Prisma, RoundStatus, type PrismaClient } from "../../generated/prisma/client";

export class RoundClosureError extends Error {
  constructor(
    message: string,
    public readonly code: "ROUND_NOT_FOUND" | "ROUND_NOT_CLOSABLE" | "CUTOFF_NOT_REACHED",
  ) {
    super(message);
    this.name = "RoundClosureError";
  }
}

function isSerializationConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === "P2034" ||
    (error.code === "P2010" &&
      (error.meta?.code === "40001" ||
        error.message.toLowerCase().includes("could not serialize access")));
}

/**
 * Closes a round after its cutoff. This shares the row-lock protocol used by
 * createPendingPixPurchase. Serialization failures are retried because the
 * decision is safe to repeat and every attempt rereads the locked round.
 */
export async function closeRound(
  prisma: PrismaClient,
  roundId: string,
  decisionTimeOverride?: Date,
  actorId?: string,
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Round" WHERE "id" = ${roundId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new RoundClosureError("Round was not found", "ROUND_NOT_FOUND");
        }

        const round = await tx.round.findUnique({ where: { id: roundId } });
        if (!round) {
          throw new RoundClosureError("Round was not found", "ROUND_NOT_FOUND");
        }

        if (round.status === RoundStatus.CLOSED) {
          if (actorId) {
            await tx.auditEvent.create({
              data: {
                actorId,
                action: "ROUND_CLOSE_ALREADY_CLOSED",
                entityType: "Round",
                entityId: round.id,
                metadata: { outcome: "idempotent_noop" },
              },
            });
          }
          return round;
        }
        if (round.status !== RoundStatus.SCHEDULED && round.status !== RoundStatus.OPEN) {
          throw new RoundClosureError("Round is not in a closable state", "ROUND_NOT_CLOSABLE");
        }

        const decisionTime = decisionTimeOverride ?? (
          await tx.$queryRaw<Array<{ decisionTime: Date }>>`
            SELECT clock_timestamp() AS "decisionTime"
          `
        )[0]!.decisionTime;

        if (decisionTime.getTime() < round.cutoffAt.getTime()) {
          throw new RoundClosureError("Round cutoff has not been reached", "CUTOFF_NOT_REACHED");
        }

        const updated = await tx.round.update({
          where: { id: roundId },
          data: { status: RoundStatus.CLOSED },
        });
        await tx.auditEvent.create({
          data: {
            ...(actorId ? { actorId } : {}),
            action: actorId ? "ROUND_CLOSED" : "ROUND_CLOSED_AUTOMATICALLY",
            entityType: "Round",
            entityId: updated.id,
            metadata: { previousStatus: round.status, status: updated.status, source: actorId ? "admin" : "scheduler" },
          },
        });
        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isSerializationConflict(error) && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}
