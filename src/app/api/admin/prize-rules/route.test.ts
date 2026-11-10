import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(), settingFindUnique: vi.fn(), settingUpsert: vi.fn(),
  settingChangeCreate: vi.fn(), auditCreate: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: mocks.getSessionUser, SESSION_COOKIE: "superquina_session",
  authPrisma: {
    setting: { findUnique: mocks.settingFindUnique },
    $transaction: mocks.transaction,
  },
}));
import { GET, PUT } from "./route";

function request(method = "GET", body?: unknown, origin = "https://example.test") {
  return new NextRequest("https://example.test/api/admin/prize-rules", {
    method, headers: { cookie: "superquina_session=session-token", ...(method === "PUT" ? { origin, host: "example.test", "content-type": "application/json" } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const valid = { unit: 1, tens: 2, hundreds: 3, thousands: 4, quina: 5 };

describe("admin prize rules API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: "admin-1", role: "ADMIN", mustChangePassword: false });
    mocks.settingFindUnique.mockResolvedValue(null);
    mocks.settingUpsert.mockResolvedValue({ updatedAt: new Date("2026-01-01T00:00:00Z") });
    mocks.settingChangeCreate.mockResolvedValue({});
    mocks.auditCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback) => callback({
      setting: { findUnique: mocks.settingFindUnique, upsert: mocks.settingUpsert },
      settingChange: { create: mocks.settingChangeCreate },
      auditEvent: { create: mocks.auditCreate },
    }));
  });

  it("rejects unauthenticated and non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await GET(request()))!.status).toBe(401);
    mocks.getSessionUser.mockResolvedValue({ id: "player", role: "PLAYER", mustChangePassword: false });
    expect((await GET(request()))!.status).toBe(403);
    expect(mocks.settingFindUnique).not.toHaveBeenCalled();
  });


  it("blocks admins who must change their password", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "admin-1", role: "ADMIN", mustChangePassword: true });
    const response = (await PUT(request("PUT", valid)))!;
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects updates without a same-origin header", async () => {
    const response = (await PUT(new NextRequest("https://example.test/api/admin/prize-rules", {
      method: "PUT",
      headers: { host: "example.test", "content-type": "application/json" },
      body: JSON.stringify(valid),
    })))!;
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("fails closed when the stored multiplier configuration is malformed", async () => {
    mocks.settingFindUnique.mockResolvedValue({ value: "{not-json", updatedAt: new Date() });
    const response = (await GET(request()))!;
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Não foi possível carregar os multiplicadores salvos." });
  });

  it("returns defaults when no saved configuration exists", async () => {
    const response = (await GET(request()))!;
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ multipliers: { unit: 5, tens: 20, hundreds: 200, thousands: 2000, quina: 20000 }, updatedAt: null });
  });

  it("rejects cross-origin and invalid multiplier updates", async () => {
    expect((await PUT(request("PUT", valid, "https://attacker.test")))!.status).toBe(403);
    expect((await PUT(request("PUT", { ...valid, extra: true })))!.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("persists valid multipliers with change history and audit", async () => {
    const response = (await PUT(request("PUT", valid)))!;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ multipliers: valid });
    expect(mocks.settingUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: "numeric_prize_multipliers" },
      create: { key: "numeric_prize_multipliers", value: JSON.stringify(valid) },
    }));
    expect(mocks.settingChangeCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ settingKey: "numeric_prize_multipliers", changedById: "admin-1" }) });
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: "admin-1", action: "NUMERIC_PRIZE_MULTIPLIERS_UPDATED" }) });
  });
});
