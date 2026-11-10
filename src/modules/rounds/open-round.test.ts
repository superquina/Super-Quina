import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}));
import { openRound, RoundOpenError } from "./open-round";

const start = new Date("2035-01-01T12:00:00.000Z");
const cutoff = new Date("2035-01-01T12:29:00.000Z");
const baseRound = { id: "round-123456", code: "JP-20350101-1200", startsAt: start, cutoffAt: cutoff, resultAt: new Date("2035-01-01T12:30:00.000Z"), status: "SCHEDULED" };

function prisma() {
  return {
    $transaction: mocks.transaction,
  } as unknown as PrismaClient;
}

describe("openRound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValueOnce([{ id: baseRound.id }]).mockResolvedValueOnce([{ databaseNow: new Date("2035-01-01T12:01:00.000Z") }]);
    mocks.findUnique.mockResolvedValue(baseRound);
    mocks.update.mockResolvedValue({ ...baseRound, status: "OPEN" });
    mocks.auditCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback) => callback({
      $queryRaw: mocks.queryRaw,
      round: { findUnique: mocks.findUnique, update: mocks.update },
      auditEvent: { create: mocks.auditCreate },
    }));
  });

  it("opens and audits a scheduled round once its start time arrives", async () => {
    const result = await openRound(prisma(), baseRound.id);
    expect(result.status).toBe("OPEN");
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: baseRound.id }, data: { status: "OPEN" } });
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: "ROUND_OPENED_AUTOMATICALLY", entityId: baseRound.id,
    }) });
  });

  it("does not open a round before its scheduled start", async () => {
    mocks.queryRaw.mockReset();
    mocks.queryRaw.mockResolvedValueOnce([{ id: baseRound.id }]).mockResolvedValueOnce([{ databaseNow: new Date("2035-01-01T11:59:00.000Z") }]);
    await expect(openRound(prisma(), baseRound.id)).rejects.toMatchObject({ code: "ROUND_NOT_STARTED" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not open a round after cutoff", async () => {
    mocks.queryRaw.mockReset();
    mocks.queryRaw.mockResolvedValueOnce([{ id: baseRound.id }]).mockResolvedValueOnce([{ databaseNow: cutoff }]);
    await expect(openRound(prisma(), baseRound.id)).rejects.toMatchObject({ code: "ROUND_CUTOFF_REACHED" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("treats an already open round as an idempotent no-op", async () => {
    mocks.findUnique.mockResolvedValue({ ...baseRound, status: "OPEN" });
    expect((await openRound(prisma(), baseRound.id)).status).toBe("OPEN");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
