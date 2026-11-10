import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(), queryRaw: vi.fn(), userFindFirst: vi.fn(), settlementFindFirst: vi.fn(),
  purchaseAggregate: vi.fn(), purchaseFindMany: vi.fn(), commissionAggregate: vi.fn(), lineCount: vi.fn(),
  payoutAggregate: vi.fn(), settlementCreate: vi.fn(), payoutUpdateMany: vi.fn(),
  auditCreate: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: mocks.getSessionUser, SESSION_COOKIE: "superquina_session",
  authPrisma: { $transaction: mocks.transaction },
}));
import { POST } from "./route";

const cashierId = "cashier-123456";
const cutoff = new Date("2026-11-04T15:00:00.000Z");
const since = new Date("2026-11-03T15:00:00.000Z");
const snapshot = {
  id: "settlement-1", cashierId, adminId: "admin-1", settledAt: cutoff,
  cashSalesCents: 10000, pixSalesCents: 5000, totalSalesCents: 15000,
  salesCount: 3, gamesCount: 7, commissionCents: 900,
  cashPrizePayoutCount: 2, cashPrizePayoutCents: 2500,
};
function request(origin = "https://example.test") {
  return new NextRequest(`https://example.test/api/admin/cashiers/${cashierId}/settlements`, {
    method: "POST",
    headers: { cookie: "superquina_session=session-token", origin, host: "example.test" },
  });
}
const context = { params: Promise.resolve({ cashierId }) };

describe("POST admin cashier settlements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: "admin-1", role: "ADMIN", mustChangePassword: false });
    mocks.queryRaw.mockResolvedValue([{ now: cutoff }]);
    mocks.userFindFirst.mockResolvedValue({ id: cashierId });
    mocks.settlementFindFirst.mockResolvedValue({ settledAt: since });
    mocks.purchaseAggregate
      .mockResolvedValueOnce({ _sum: { totalCents: 10000 }, _count: { _all: 2 } })
      .mockResolvedValueOnce({ _sum: { totalCents: 5000 }, _count: { _all: 1 } });
    mocks.purchaseFindMany.mockResolvedValue([
      { id: "cash-1", totalCents: 5000, commission: { cashierId, rateBasisPoints: 600, amountCents: 300 } },
      { id: "cash-2", totalCents: 5000, commission: { cashierId, rateBasisPoints: 600, amountCents: 300 } },
      { id: "pix-1", totalCents: 5000, commission: { cashierId, rateBasisPoints: 600, amountCents: 300 } },
    ]);
    mocks.commissionAggregate.mockResolvedValue({ _sum: { amountCents: 900 } });
    mocks.lineCount.mockResolvedValue(7);
    mocks.payoutAggregate.mockResolvedValue({ _sum: { amountCents: 2500 }, _count: { _all: 2 } });
    mocks.settlementCreate.mockResolvedValue(snapshot);
    mocks.payoutUpdateMany.mockResolvedValue({ count: 2 });
    mocks.auditCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback) => callback({
      $queryRaw: mocks.queryRaw,
      user: { findFirst: mocks.userFindFirst },
      cashierSettlement: { findFirst: mocks.settlementFindFirst, create: mocks.settlementCreate },
      purchase: { aggregate: mocks.purchaseAggregate, findMany: mocks.purchaseFindMany },
      cashierCommission: { aggregate: mocks.commissionAggregate },
      numericParticipationLine: { count: mocks.lineCount },
      numericPrizePayout: { aggregate: mocks.payoutAggregate, updateMany: mocks.payoutUpdateMany },
      auditEvent: { create: mocks.auditCreate },
    }));
  });

  it("requires a valid active ADMIN session and blocks mandatory password changes", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await POST(request(), context)).status).toBe(401);
    mocks.getSessionUser.mockResolvedValue({ id: "player", role: "PLAYER", mustChangePassword: false });
    expect((await POST(request(), context)).status).toBe(403);
    mocks.getSessionUser.mockResolvedValue({ id: "admin-1", role: "ADMIN", mustChangePassword: true });
    expect((await POST(request(), context)).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before opening a transaction", async () => {
    expect((await POST(request("https://attacker.test"), context)).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns 404 when the target user is not a cashier", async () => {
    mocks.userFindFirst.mockResolvedValue(null);
    expect((await POST(request(), context)).status).toBe(404);
    expect(mocks.settlementCreate).not.toHaveBeenCalled();
  });

  it("creates one financial snapshot with CASH, confirmed PIX, commission, games and unpaid-association payouts", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ settlement: { id: snapshot.id, totalSalesCents: 15000, commissionCents: 900 } });
    expect(mocks.settlementFindFirst).toHaveBeenCalledWith({
      where: { cashierId }, orderBy: { settledAt: "desc" }, select: { settledAt: true },
    });
    expect(mocks.purchaseAggregate).toHaveBeenNthCalledWith(1, { where: {
      cashierId, status: "CONFIRMED", confirmedAt: { gt: since, lte: cutoff }, paymentMethod: "CASH",
    }, _sum: { totalCents: true }, _count: { _all: true } });
    expect(mocks.purchaseAggregate).toHaveBeenNthCalledWith(2, { where: {
      cashierId, status: "CONFIRMED", confirmedAt: { gt: since, lte: cutoff },
      paymentMethod: "PIX", payment: { is: { status: "CONFIRMED" } },
    }, _sum: { totalCents: true }, _count: { _all: true } });
    expect(mocks.purchaseFindMany).toHaveBeenCalledWith({
      where: { cashierId, status: "CONFIRMED", confirmedAt: { gt: since, lte: cutoff }, OR: [
        { paymentMethod: "CASH" }, { paymentMethod: "PIX", payment: { is: { status: "CONFIRMED" } } },
      ] },
      select: { id: true, totalCents: true, commission: { select: { cashierId: true, rateBasisPoints: true, amountCents: true } } },
    });
    expect(mocks.commissionAggregate).toHaveBeenCalledWith({ where: {
      cashierId, purchase: { is: { cashierId, status: "CONFIRMED", confirmedAt: { gt: since, lte: cutoff }, OR: [
        { paymentMethod: "CASH" }, { paymentMethod: "PIX", payment: { is: { status: "CONFIRMED" } } },
      ] } },
    }, _sum: { amountCents: true } });
    expect(mocks.lineCount).toHaveBeenCalledWith({ where: {
      participation: { is: { status: "CONFIRMED", purchase: { is: {
        cashierId, status: "CONFIRMED", confirmedAt: { gt: since, lte: cutoff },
      } } } },
    } });
    expect(mocks.payoutAggregate).toHaveBeenCalledWith({ where: {
      cashierId, channel: "CASHIER_CASH", settlementId: null, paidAt: { gt: since, lte: cutoff },
    }, _sum: { amountCents: true }, _count: { _all: true } });
    expect(mocks.settlementCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      cashierId, adminId: "admin-1", settledAt: cutoff, cashSalesCents: 10000, pixSalesCents: 5000,
      totalSalesCents: 15000, salesCount: 3, gamesCount: 7, commissionCents: 900,
      cashPrizePayoutCount: 2, cashPrizePayoutCents: 2500,
    }) });
    expect(mocks.payoutUpdateMany).toHaveBeenCalledWith({ where: {
      cashierId, channel: "CASHIER_CASH", settlementId: null, paidAt: { gt: since, lte: cutoff },
    }, data: { settlementId: snapshot.id } });
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: "admin-1", action: "CASHIER_SETTLEMENT_RECORDED",
      entityType: "CashierSettlement", entityId: snapshot.id,
    }) });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });

  it("blocks settlement when a confirmed sale has no commission and creates no snapshot", async () => {
    mocks.purchaseFindMany.mockResolvedValueOnce([
      { id: "cash-without-commission", totalCents: 5000, commission: null },
    ]);
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Acerto bloqueado: existe venda confirmada sem comissão ou com comissão inconsistente. Corrija os dados antes de fechar." });
    expect(mocks.settlementCreate).not.toHaveBeenCalled();
    expect(mocks.payoutUpdateMany).not.toHaveBeenCalled();
  });

  it("blocks a commission with the wrong cashier or an incorrect historical amount", async () => {
    mocks.purchaseFindMany.mockResolvedValueOnce([
      { id: "wrong-cashier", totalCents: 5000, commission: { cashierId: "other-cashier", rateBasisPoints: 600, amountCents: 300 } },
    ]);
    expect((await POST(request(), context)).status).toBe(409);
    mocks.purchaseFindMany.mockResolvedValueOnce([
      { id: "wrong-amount", totalCents: 5000, commission: { cashierId, rateBasisPoints: 600, amountCents: 299 } },
    ]);
    expect((await POST(request(), context)).status).toBe(409);
    expect(mocks.settlementCreate).not.toHaveBeenCalled();
  });

  it("uses the epoch as the first settlement boundary and keeps the cutoff from the database clock", async () => {
    mocks.settlementFindFirst.mockResolvedValue(null);
    await POST(request(), context);
    expect(mocks.purchaseAggregate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ confirmedAt: { gt: new Date(0), lte: cutoff } }),
    }));
  });

  it("returns a generic error and relies on transaction rollback when persistence fails", async () => {
    mocks.settlementCreate.mockRejectedValue(new Error("database detail"));
    const response = await POST(request(), context);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Não foi possível registrar o acerto. Atualize a página e tente novamente." });
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
