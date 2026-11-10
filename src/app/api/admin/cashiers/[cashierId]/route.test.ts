import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(), userFindFirst: vi.fn(), userUpdate: vi.fn(), auditCreate: vi.fn(),
  transaction: vi.fn(), hashPassword: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: mocks.getSessionUser, SESSION_COOKIE: "superquina_session",
  authPrisma: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/auth/password", () => ({ hashPassword: mocks.hashPassword }));
import { PATCH } from "./route";

const profile = { fullName: "Cashier Updated", username: "cashier.updated", password: "", whatsapp: "77991234567", suppliesMaterial: true, status: "ACTIVE" };
const previous = { id: "cashier-123456", username: "cashier", fullName: "Cashier", whatsapp: "77990000000", suppliesMaterial: false, commissionRateBasisPoints: 2000, status: "ACTIVE" };
const updated = { ...previous, username: "cashier.updated", fullName: "Cashier Updated", whatsapp: "77991234567", commissionRateBasisPoints: 1000, suppliesMaterial: true, createdAt: new Date("2026-01-01T00:00:00Z") };
function request(body: unknown, origin = "https://example.test") {
  return new NextRequest("https://example.test/api/admin/cashiers/cashier-123456", {
    method: "PATCH", headers: { cookie: "superquina_session=session-token", origin, host: "example.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const context = { params: Promise.resolve({ cashierId: "cashier-123456" }) };

describe("PATCH /api/admin/cashiers/[cashierId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: "admin-1", role: "ADMIN", mustChangePassword: false });
    mocks.hashPassword.mockResolvedValue("hashed-password");
    mocks.userFindFirst.mockResolvedValue(previous);
    mocks.userUpdate.mockResolvedValue(updated);
    mocks.auditCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback) => callback({ user: { findFirst: mocks.userFindFirst, update: mocks.userUpdate }, auditEvent: { create: mocks.auditCreate } }));
  });

  it("rejects unauthenticated and non-admin requests", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await PATCH(request(profile), context)).status).toBe(401);
    mocks.getSessionUser.mockResolvedValue({ id: "player", role: "PLAYER", mustChangePassword: false });
    expect((await PATCH(request(profile), context)).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests and malformed cashier identifiers", async () => {
    expect((await PATCH(request(profile, "https://attacker.test"), context)).status).toBe(403);
    expect((await PATCH(request(profile), { params: Promise.resolve({ cashierId: "bad" }) })).status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns not found without updating a non-cashier", async () => {
    mocks.userFindFirst.mockResolvedValue(null);
    expect((await PATCH(request(profile), context)).status).toBe(404);
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it("updates the cashier and records the before/after audit", async () => {
    const response = await PATCH(request(profile), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cashier: { id: updated.id, commissionPercent: 10 } });
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: previous.id }, data: expect.objectContaining({
      username: "cashier.updated", whatsapp: "77991234567", suppliesMaterial: true, commissionRateBasisPoints: 1000, status: "ACTIVE",
    }) }));
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: "admin-1", action: "CASHIER_UPDATED", entityId: previous.id }) });
    expect(mocks.hashPassword).not.toHaveBeenCalled();
  });
});
