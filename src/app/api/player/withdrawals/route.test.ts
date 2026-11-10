import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(), aggregate: vi.fn(), findMany: vi.fn(), transaction: vi.fn(),
  queryRaw: vi.fn(), withdrawalCreate: vi.fn(), ledgerCreate: vi.fn(), historyCreate: vi.fn(), auditCreate: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  authPrisma: { ledgerEntry: { aggregate: mocks.aggregate }, withdrawal: { findMany: mocks.findMany }, $transaction: mocks.transaction },
  getSessionUser: mocks.getSessionUser, SESSION_COOKIE: "superquina_session",
}));
vi.mock("@/lib/wallet/pix-key-crypto", () => ({ encryptPixKey: vi.fn(() => "encrypted-key"), isPlausiblePixKey: vi.fn(() => true), maskPixKey: vi.fn(() => "••••4000") }));
import { GET, POST } from "./route";

function request(path = "/api/player/withdrawals", body?: unknown, origin = "https://example.test") {
  return new NextRequest("https://example.test" + path, {
    ...(body === undefined ? {} : { method: "POST", headers: { origin, host: "example.test", "content-type": "application/json", cookie: "superquina_session=session-token" }, body: JSON.stringify(body) }),
    ...(body === undefined ? { headers: { cookie: "superquina_session=session-token" } } : {}),
  });
}
function tx() {
  return {
    $queryRawUnsafe: mocks.queryRaw,
    ledgerEntry: { aggregate: mocks.aggregate, create: mocks.ledgerCreate },
    withdrawal: { create: mocks.withdrawalCreate },
    withdrawalStatusHistory: { create: mocks.historyCreate },
    auditEvent: { create: mocks.auditCreate },
  };
}
describe("player withdrawals API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: "player-1", username: "player", role: "PLAYER", status: "ACTIVE", mustChangePassword: false });
    mocks.aggregate.mockResolvedValue({ _sum: { amountCents: 5000 } });
    mocks.findMany.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([]);
    mocks.withdrawalCreate.mockResolvedValue({ id: "withdrawal-1", amountCents: 5000, status: "PENDING", createdAt: new Date("2026-01-01T00:00:00Z") });
    mocks.ledgerCreate.mockResolvedValue({});
    mocks.historyCreate.mockResolvedValue({});
    mocks.auditCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback) => callback(tx()));
  });

  it("requires the player's own authenticated role", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    mocks.getSessionUser.mockResolvedValue({ id: "admin-1", role: "ADMIN", mustChangePassword: false });
    expect((await GET(request())).status).toBe(403);
  });

  it("reserves the full available balance atomically and records an audit event", async () => {
    const response = await POST(request("/api/player/withdrawals", { pixKey: "pix@example.com" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ success: true, withdrawal: { id: "withdrawal-1", amountCents: 5000, availableCents: 0, status: "PENDING" } });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.ledgerCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: "player-1", withdrawalId: "withdrawal-1", type: "WITHDRAWAL_RESERVE",
      amountCents: -5000, idempotencyKey: "withdrawal-reserve:withdrawal-1",
    }) });
    expect(mocks.historyCreate).toHaveBeenCalledOnce();
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: "player-1", action: "WITHDRAWAL_REQUESTED", entityType: "Withdrawal",
    }) });
  });

  it("rejects a withdrawal when no balance is available", async () => {
    mocks.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } });
    const response = await POST(request("/api/player/withdrawals", { pixKey: "pix@example.com" }));
    expect(response.status).toBe(409);
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
    expect(mocks.withdrawalCreate).not.toHaveBeenCalled();
  });

  it("accepts the public host behind a reverse proxy", async () => {
    const proxyRequest = new NextRequest("http://internal-service:3000/api/player/withdrawals", {
      method: "POST",
      headers: {
        origin: "https://example.test",
        host: "example.test",
        cookie: "superquina_session=session-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ pixKey: "pix@example.com" }),
    });
    expect((await POST(proxyRequest)).status).toBe(201);
  });

  it("rejects cross-origin requests", async () => {
    const response = await POST(request("/api/player/withdrawals", { amountCents: 1000, pixKey: "pix@example.com" }, "https://attacker.test"));
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
