import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(), findMany: vi.fn(), userCount: vi.fn(), userCreate: vi.fn(), auditCreate: vi.fn(),
  transaction: vi.fn(), hashPassword: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: mocks.getSessionUser, SESSION_COOKIE: "superquina_session",
  authPrisma: { user: { findMany: mocks.findMany, count: mocks.userCount }, $transaction: mocks.transaction },
}));
vi.mock("@/lib/auth/password", () => ({ hashPassword: mocks.hashPassword }));
import { GET, POST } from "./route";

function request(method = "GET", body?: unknown, origin = "https://example.test") {
  return new NextRequest("https://example.test/api/admin/cashiers", {
    method, headers: { cookie: "superquina_session=session-token", ...(method === "POST" ? { origin, host: "example.test", "content-type": "application/json" } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const profile = { fullName: "Cashier Test", username: "Cashier.One", password: "secret123", whatsapp: "+55 (77) 99123-4567", commissionPercent: 5.5 };
const created = { id: "cashier-123456", username: "cashier.one", fullName: "Cashier Test", whatsapp: "5577991234567", commissionRateBasisPoints: 550, status: "ACTIVE", createdAt: new Date("2026-01-01T00:00:00Z") };

describe("admin cashiers collection API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: "admin-1", role: "ADMIN", mustChangePassword: false });
    mocks.findMany.mockResolvedValue([{ ...created, mustChangePassword: true }]);
    mocks.userCount.mockResolvedValue(1);
    mocks.hashPassword.mockResolvedValue("hashed-password");
    mocks.userCreate.mockResolvedValue(created);
    mocks.auditCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback) => callback({ user: { create: mocks.userCreate }, auditEvent: { create: mocks.auditCreate } }));
  });

  it("requires an authenticated admin", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    mocks.getSessionUser.mockResolvedValue({ id: "player", role: "PLAYER", mustChangePassword: false });
    expect((await POST(request("POST", profile))).status).toBe(403);
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it("lists cashiers with normalized commission percentages and no caching", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(await response.json()).toMatchObject({ cashiers: [{ id: created.id, commissionPercent: 5.5 }], pagination: { page: 1, limit: 50, total: 1, totalPages: 1, hasPreviousPage: false, hasNextPage: false } });
    expect(mocks.userCount).toHaveBeenCalledWith({ where: { role: "CASHIER" } });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { role: "CASHIER" }, skip: 0, take: 50, orderBy: [{ status: "asc" }, { username: "asc" }, { id: "asc" }] }));
  });

  it("validates pagination parameters", async () => {
    expect((await GET(new NextRequest("https://example.test/api/admin/cashiers?page=0"))).status).toBe(400);
    expect((await GET(new NextRequest("https://example.test/api/admin/cashiers?limit=101"))).status).toBe(400);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("returns requested page and stable pagination metadata", async () => {
    mocks.userCount.mockResolvedValue(121);
    const response = await GET(new NextRequest("https://example.test/api/admin/cashiers?page=3&limit=50", { headers: { cookie: "superquina_session=session-token" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ pagination: { page: 3, limit: 50, total: 121, totalPages: 3, hasPreviousPage: true, hasNextPage: false } });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 100, take: 50 }));
  });

  it("rejects cross-origin and invalid profiles", async () => {
    expect((await POST(request("POST", profile, "https://attacker.test"))).status).toBe(403);
    expect((await POST(request("POST", { ...profile, commissionPercent: 5.555 }))).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("creates a cashier with normalized username and WhatsApp and records audit", async () => {
    const response = await POST(request("POST", profile));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ cashier: { id: created.id, commissionPercent: 5.5 } });
    expect(mocks.hashPassword).toHaveBeenCalledWith(profile.password);
    expect(mocks.userCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      username: "cashier.one", passwordHash: "hashed-password", role: "CASHIER",
      whatsapp: "5577991234567", commissionRateBasisPoints: 550, mustChangePassword: true,
    }), select: expect.any(Object) });
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: "admin-1", action: "CASHIER_CREATED" }) });
  });
});
