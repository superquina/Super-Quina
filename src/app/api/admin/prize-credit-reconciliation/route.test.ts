import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(), queryRaw: vi.fn(), lineFindMany: vi.fn(), ledgerFindUnique: vi.fn(),
  transaction: vi.fn(), lineFindUnique: vi.fn(), ledgerCreate: vi.fn(), lineUpdate: vi.fn(), auditCreate: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: mocks.getSessionUser, SESSION_COOKIE: "superquina_session",
  authPrisma: {
    $queryRaw: mocks.queryRaw,
    numericParticipationLine: { findMany: mocks.lineFindMany },
    ledgerEntry: { findUnique: mocks.ledgerFindUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/generated/prisma/client", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" }, PrismaClientKnownRequestError: class extends Error { code = "P2002"; } },
}));
vi.mock("@/modules/numbers/calculate-number-prize", () => ({ calculateNumberPrizeCents: vi.fn(() => 1000) }));
import { GET, POST } from "./route";

function request(method = "GET", body?: unknown, origin = "https://example.test") {
  return new NextRequest("https://example.test/api/admin/prize-credit-reconciliation", {
    method, headers: { cookie: "superquina_session=session-token", ...(method === "POST" ? { origin, host: "example.test", "content-type": "application/json" } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const line = {
  id: "line-123", participationId: "participation-1", numberValue: "1234", prizeCents: 1000, unitCents: 1, tensCents: 2, hundredsCents: 3, thousandsCents: 4, quinaCents: 5, ruleVersion: "v1", ruleSnapshot: {}, prizeCreditedAt: null, prizePayout: null, createdAt: new Date("2026-01-01T00:00:00Z"),
  participation: {
    id: "participation-1", status: "CONFIRMED",
    round: { id: "round-1", code: "R-01", status: "COMPLETED", resultAt: new Date("2026-01-02T00:00:00Z"), resultNumber: "1234" },
    purchase: { id: "purchase-1", status: "CONFIRMED", cashierId: null, currency: "BRL", createdAt: new Date("2026-01-01T00:00:00Z"), playerId: "player-1", player: { username: "player" } },
  },
};

describe("admin prize credit reconciliation API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: "admin-1", role: "ADMIN", mustChangePassword: false });
    mocks.queryRaw.mockResolvedValue([{ id: "line-123" }]);
    mocks.lineFindMany.mockResolvedValue([line]);
    mocks.ledgerFindUnique.mockResolvedValue(null);
    mocks.lineFindUnique.mockResolvedValue(line);
    mocks.ledgerCreate.mockResolvedValue({});
    mocks.lineUpdate.mockResolvedValue({});
    mocks.auditCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback) => callback({
      numericParticipationLine: { findUnique: mocks.lineFindUnique, update: mocks.lineUpdate },
      ledgerEntry: { findUnique: mocks.ledgerFindUnique, create: mocks.ledgerCreate },
      auditEvent: { create: mocks.auditCreate },
    }));
  });

  it("requires an authenticated admin before listing pending credits", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    mocks.getSessionUser.mockResolvedValue({ id: "cashier", role: "CASHIER", mustChangePassword: false });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.lineFindMany).not.toHaveBeenCalled();
  });

  it("lists eligible lines and flags missing ledger entries", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(await response.json()).toMatchObject({
      count: 1, limit: 200,
      items: [{ lineId: "line-123", playerId: "player-1", username: "player", ledgerEntryExists: false, ledgerMatches: false, payoutExists: false, prizeCreditedAt: null }],
    });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    const sql = mocks.queryRaw.mock.calls[0][0].join("");
    expect(sql).toContain('line."prizeCreditedAt" IS NULL');
    expect(sql).toContain('ledger."amountCents" IS DISTINCT FROM line."prizeCents"');
    expect(sql).toContain('payout."id" IS NULL');
    expect(mocks.lineFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["line-123"] } } }));
    expect(mocks.ledgerFindUnique).toHaveBeenCalledWith({ where: { idempotencyKey: "numeric-prize-credit:line-123" } });
  });


  it("surfaces timestamped credits when the idempotent ledger entry is missing", async () => {
    const timestampedLine = { ...line, prizeCreditedAt: new Date("2026-01-03T00:00:00Z") };
    mocks.lineFindMany.mockResolvedValue([timestampedLine]);
    mocks.ledgerFindUnique.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      count: 1,
      items: [{ lineId: "line-123", prizeCreditedAt: "2026-01-03T00:00:00.000Z", ledgerEntryExists: false, ledgerMatches: false }],
    });
  });

  it("does not offer paid prizes for corrective credit", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    mocks.lineFindMany.mockResolvedValue([]);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ count: 0, items: [] });
    expect(mocks.lineFindMany).not.toHaveBeenCalled();
  });

  it("flags an existing but financially mismatched ledger entry", async () => {
    mocks.ledgerFindUnique.mockResolvedValue({
      userId: "player-1", purchaseId: "purchase-1", amountCents: 999, currency: "BRL",
      type: "PRIZE_CREDIT", participationId: "participation-1",
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [{ ledgerEntryExists: true, ledgerMatches: false }],
    });
  });

  it("rejects invalid origins before processing a repair", async () => {
    expect((await POST(request("POST", { lineId: "line-123", reason: "Motivo de auditoria" }, "https://attacker.test"))).status).toBe(403);
    expect((await POST(request("POST", { lineId: "line-123", reason: "curto" }))).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated repair requests", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await POST(request("POST", { lineId: "line-123", reason: "Motivo de auditoria válido" }))).status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("credits an eligible line and records the audit reason", async () => {
    const response = await POST(request("POST", { lineId: "line-123", reason: "Correção validada pela auditoria" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, player: "player", roundCode: "R-01", prizeCents: 1000, creditedNow: true });
    expect(mocks.ledgerCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: "player-1", purchaseId: "purchase-1", participationId: "participation-1",
      type: "PRIZE_CREDIT", amountCents: 1000, idempotencyKey: "numeric-prize-credit:line-123",
    }) });
    expect(mocks.lineUpdate).toHaveBeenCalledWith({ where: { id: "line-123" }, data: { prizeCreditedAt: expect.any(Date) } });
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: "admin-1", action: "PLAYER_PRIZE_CREDIT_REPAIRED",
      metadata: expect.objectContaining({ reason: "Correção validada pela auditoria", creditedNow: true }),
    }) });
  });

  it("blocks an ineligible line without creating a ledger credit", async () => {
    mocks.lineFindUnique.mockResolvedValue({
      ...line,
      participation: { ...line.participation, purchase: { ...line.participation.purchase, cashierId: "cashier-1" } },
    });
    const response = await POST(request("POST", { lineId: "line-123", reason: "Registro não elegível" }));
    expect(response.status).toBe(409);
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
    expect(mocks.lineUpdate).not.toHaveBeenCalled();
  });

  it("reconciles an existing matching ledger entry without duplicating the credit", async () => {
    mocks.ledgerFindUnique.mockResolvedValue({
      userId: "player-1", purchaseId: "purchase-1", amountCents: 1000, currency: "BRL", type: "PRIZE_CREDIT", participationId: "participation-1",
    });
    const response = await POST(request("POST", { lineId: "line-123", reason: "Conferência de crédito existente" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, creditedNow: false, prizeCents: 1000 });
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
    expect(mocks.lineUpdate).toHaveBeenCalledWith({ where: { id: "line-123" }, data: { prizeCreditedAt: expect.any(Date) } });
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: "admin-1", action: "PLAYER_PRIZE_CREDIT_RECONCILED",
      metadata: expect.objectContaining({ reason: "Conferência de crédito existente", creditedNow: false }),
    }) });
  });

  it("blocks reconciliation when the prize was already paid through a payout channel", async () => {
    mocks.lineFindUnique.mockResolvedValue({
      ...line,
      prizePayout: { id: "payout-1", channel: "CASHIER_CASH", paidAt: new Date("2026-01-03T00:00:00Z") },
    });
    const response = await POST(request("POST", { lineId: "line-123", reason: "Pagamento em dinheiro já registrado" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("pagamento registrado") });
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
    expect(mocks.lineUpdate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("blocks lines without a positive calculated prize", async () => {
    mocks.lineFindUnique.mockResolvedValue({ ...line, prizeCents: 0 });
    const response = await POST(request("POST", { lineId: "line-123", reason: "Linha sem prêmio positivo" }));
    expect(response.status).toBe(409);
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
    expect(mocks.lineUpdate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

});
