import { Prisma, RoundStatus, type PrismaClient } from "../../generated/prisma/client";
import { drawNumber } from "../numbers/draw-number";

export class RoundDrawError extends Error {
  constructor(message: string, public readonly code: "ROUND_NOT_FOUND" | "ROUND_NOT_CLOSED" | "DRAW_NOT_DUE" | "INCONSISTENT_DRAW") {
    super(message);
    this.name = "RoundDrawError";
  }
}

function isSerializationConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === "P2034" ||
    (error.code === "P2010" &&
      (error.meta?.code === "40001" ||
        error.message.toLowerCase().includes("could not serialize access")));
}

/** Persist one five-digit numeric result exactly once for a closed round. */
export async function drawRoundResults(prisma: PrismaClient, roundId: string, actorId?: string) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Round" WHERE "id" = ${roundId} FOR UPDATE
        `;
        if (locked.length === 0) throw new RoundDrawError("Round was not found", "ROUND_NOT_FOUND");
        const round = await tx.round.findUnique({ where: { id: roundId } });
        if (!round) throw new RoundDrawError("Round was not found", "ROUND_NOT_FOUND");
        if (round.resultNumber !== null) {
          if (round.status !== RoundStatus.COMPLETED) throw new RoundDrawError("A numeric result exists but the round is not completed", "INCONSISTENT_DRAW");
          return round;
        }
        if (round.status !== RoundStatus.CLOSED) throw new RoundDrawError("Round must be closed before drawing results", "ROUND_NOT_CLOSED");
        const [{ databaseNow }] = await tx.$queryRaw<Array<{ databaseNow: Date }>>`
          SELECT clock_timestamp() AS "databaseNow"
        `;
        if (databaseNow.getTime() < round.resultAt.getTime()) throw new RoundDrawError("Scheduled result time has not been reached", "DRAW_NOT_DUE");
        const resultNumber = drawNumber();
        const completed = await tx.round.update({ where: { id: roundId }, data: { resultNumber, status: RoundStatus.COMPLETED } });
        await tx.auditEvent.create({ data: {
          ...(actorId ? { actorId } : {}),
          action: actorId ? "NUMERIC_ROUND_DRAWN" : "NUMERIC_ROUND_DRAWN_AUTOMATICALLY",
          entityType: "Round", entityId: roundId,
          metadata: { resultNumber, method: "uniform_secure_random_00000_99999", source: actorId ? "admin" : "scheduler" },
        } });
        return completed;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      // A serialization retry rereads the locked row; an already completed draw
      // returns its persisted result rather than generating a second number.
      if (isSerializationConflict(error) && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}
