import { Prisma, RoundStatus, type PrismaClient } from "../../generated/prisma/client";

export class RoundOpenError extends Error {
  constructor(
    message: string,
    public readonly code: "ROUND_NOT_FOUND" | "ROUND_NOT_OPENABLE" | "ROUND_NOT_STARTED" | "ROUND_CUTOFF_REACHED",
  ) {
    super(message);
    this.name = "RoundOpenError";
  }
}

/** Opens a scheduled round once its start time arrives, using database time and row locking. */
export async function openRound(prisma: PrismaClient, roundId: string) {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Round" WHERE "id" = ${roundId} FOR UPDATE
    `;
    if (locked.length === 0) throw new RoundOpenError("Round was not found", "ROUND_NOT_FOUND");

    const round = await tx.round.findUnique({ where: { id: roundId } });
    if (!round) throw new RoundOpenError("Round was not found", "ROUND_NOT_FOUND");
    if (round.status === RoundStatus.OPEN) return round;
    if (round.status !== RoundStatus.SCHEDULED) {
      throw new RoundOpenError("Round is not scheduled", "ROUND_NOT_OPENABLE");
    }

    const [{ databaseNow }] = await tx.$queryRaw<Array<{ databaseNow: Date }>>`
      SELECT clock_timestamp() AS "databaseNow"
    `;
    if (databaseNow.getTime() < round.startsAt.getTime()) {
      throw new RoundOpenError("Round start time has not been reached", "ROUND_NOT_STARTED");
    }
    if (databaseNow.getTime() >= round.cutoffAt.getTime()) {
      throw new RoundOpenError("Round cutoff has already been reached", "ROUND_CUTOFF_REACHED");
    }

    const opened = await tx.round.update({
      where: { id: roundId },
      data: { status: RoundStatus.OPEN },
    });
    await tx.auditEvent.create({
      data: {
        action: "ROUND_OPENED_AUTOMATICALLY",
        entityType: "Round",
        entityId: roundId,
        metadata: { previousStatus: round.status, status: opened.status },
      },
    });
    return opened;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
