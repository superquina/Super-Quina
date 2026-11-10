import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(), findMany: vi.fn(), transaction: vi.fn(), queryRaw: vi.fn(),
  withdrawalFindUnique: vi.fn(), withdrawalUpdate: vi.fn(), ledgerCreate: vi.fn(),
  historyCreate: vi.fn(), auditCreate: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  authPrisma: { withdrawal: { findMany: mocks.findMany }, $transaction: mocks.transaction },
  getSessionUser: mocks.getSessionUser, SESSION_COOKIE: "superquina_session",
}));
vi.mock("@/lib/wallet/pix-key-crypto", () => ({
  decryptPixKey: vi.fn(() => "pix@example.com"), maskPixKey: vi.fn(() => "pi***@example.com"),
}));
import { GET, POST } from "./route";

function request(body?: unknown, origin = "https://example.test") {
  return new NextRequest("https://example.test/api/admin/withdrawals", {
    ...(body === undefined ? {} : { method: "POST", headers: { origin, host: "example.test", "content-type": "application/json", cookie: "superquina_session=session-token" }, body: JSON.stringify(body) }),
    ...(body === undefined ? { headers: { cookie: "superquina_session=session-token" } } : {}),
  });
}
const withdrawal = {
  id: "withdrawal-1", userId: "player-1", amountCents: 2500, pixKeyEncrypted: "encrypted-key",
  status: "PENDING", providerRef: null, reviewedById: null, createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"), user: { username: "player" },
};
function tx() {
  return {
    $queryRawUnsafe: mocks.queryRaw,
    withdrawal: { findUnique: mocks.withdrawalFindUnique, update: mocks.withdrawalUpdate },
    ledgerEntry: { create: mocks.ledgerCreate },
    withdrawalStatusHistory: { create: mocks.historyCreate },
    auditEvent: { create: mocks.auditCreate },
  };
}
describe("admin withdrawals API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: "admin-1", username: "admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: false });
    mocks.findMany.mockResolvedValue([]);
    mocks.transaction.mockImplementation(async (callback) => callback(tx()));
    mocks.queryRaw.mockResolvedValue([{ id: "withdrawal-1" }]);
    mocks.withdrawalFindUnique.mockResolvedValue(withdrawal);
    mocks.withdrawalUpdate.mockImplementation(async ({ data }: { data: { status: string } }) => ({ ...withdrawal, status: data.status }));
    mocks.ledgerCreate.mockResolvedValue({});
    mocks.historyCreate.mockResolvedValue({});
    mocks.auditCreate.mockResolvedValue({});
  });

  it("requires an authenticated admin", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    mocks.getSessionUser.mockResolvedValue({ id: "player-1", role: "PLAYER", mustChangePassword: false });
    expect((await GET(request())).status).toBe(403);
  });

  it("loads every pending withdrawal separately from the capped historical list", async () => {
    await GET(request());
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
    }));
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: ["APPROVED", "PROCESSING", "PAID", "REJECTED"] } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }));
  });

  it("pays a pending withdrawal directly and records an idempotent audit trail", async () => {
    const response = await POST(request({
      withdrawalId: "withdrawal-1", action: "mark-paid", note: "Pagamento Pix confirmado manualmente",
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, withdrawal: { id: "withdrawal-1", status: "PAID", amountCents: 2500 } });
    expect(mocks.withdrawalUpdate).toHaveBeenCalledWith({ where: { id: "withdrawal-1" }, data: { status: "PAID", reviewedById: "admin-1" } });
    expect(mocks.ledgerCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: "player-1", withdrawalId: "withdrawal-1", type: "WITHDRAWAL_PAID",
      amountCents: 0, idempotencyKey: "withdrawal-paid:withdrawal-1",
    }) });
    expect(mocks.historyCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ fromStatus: "PENDING", toStatus: "PAID", actorId: "admin-1" }) });
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: "admin-1", action: "WITHDRAWAL_MARKED_PAID" }) });
  });

  it("releases reserved balance when a pending withdrawal is rejected", async () => {
    const response = await POST(request({ withdrawalId: "withdrawal-1", action: "reject", note: "Chave Pix divergente" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, withdrawal: { status: "REJECTED", amountCents: 2500 } });
    expect(mocks.withdrawalUpdate).toHaveBeenCalledWith({ where: { id: "withdrawal-1" }, data: { status: "REJECTED", reviewedById: "admin-1" } });
    expect(mocks.ledgerCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: "player-1", withdrawalId: "withdrawal-1", type: "WITHDRAWAL_RELEASE",
      amountCents: 2500, idempotencyKey: "withdrawal-release:withdrawal-1",
    }) });
    expect(mocks.historyCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ fromStatus: "PENDING", toStatus: "REJECTED", actorId: "admin-1" }) });
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "WITHDRAWAL_REJECTED" }) });
  });

  it("does not allow rejection after a withdrawal has been paid", async () => {
    mocks.withdrawalFindUnique.mockResolvedValue({ ...withdrawal, status: "PAID" });
    const response = await POST(request({ withdrawalId: "withdrawal-1", action: "reject", note: "Rejeição tardia" }));
    expect(response.status).toBe(409);
    expect(mocks.withdrawalUpdate).not.toHaveBeenCalled();
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
  });

  it("does not allow a second action after the withdrawal is closed", async () => {
    mocks.withdrawalFindUnique.mockResolvedValue({ ...withdrawal, status: "PAID" });
    const response = await POST(request({
      withdrawalId: "withdrawal-1", action: "mark-paid", note: "Pagamento Pix confirmado manualmente",
    }));
    expect(response.status).toBe(409);
    expect(mocks.withdrawalUpdate).not.toHaveBeenCalled();
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("accepts the public host behind a reverse proxy", async () => {
    const proxyRequest = new NextRequest("http://internal-service:3000/api/admin/withdrawals", {
      method: "POST",
      headers: {
        origin: "https://example.test",
        host: "example.test",
        cookie: "superquina_session=session-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ withdrawalId: "withdrawal-1", action: "reject", note: "Chave Pix divergente" }),
    });
    expect((await POST(proxyRequest)).status).toBe(200);
  });

  it("rejects cross-origin actions", async () => {
    const response = await POST(request({ withdrawalId: "withdrawal-1", action: "reject", note: "Motivo suficiente" }, "https://attacker.test"));
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
