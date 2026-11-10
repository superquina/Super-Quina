import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn(), purchaseFindMany: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  authPrisma: { purchase: { findMany: mocks.purchaseFindMany } },
  getSessionUser: mocks.getSessionUser,
  SESSION_COOKIE: "superquina_session",
}));
import { GET } from "./route";
function request(token = "session-token") {
  return new NextRequest("https://example.test/api/player/history", { headers: token ? { cookie: "superquina_session=" + token } : {} });
}
describe("GET /api/player/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: "player-1", username: "player", role: "PLAYER", status: "ACTIVE", mustChangePassword: false });
    mocks.purchaseFindMany.mockResolvedValue([]);
  });
  it("requires a logged-in player and does not query history otherwise", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await GET(request(""))).status).toBe(401);
    expect(mocks.purchaseFindMany).not.toHaveBeenCalled();
  });
  it.each(["CASHIER", "ADMIN"])("rejects role %s", async (role) => {
    mocks.getSessionUser.mockResolvedValue({ id: "other", username: "other", role, status: "ACTIVE", mustChangePassword: false });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.purchaseFindMany).not.toHaveBeenCalled();
  });
  it("queries only the authenticated player's last seven days", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(mocks.purchaseFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { playerId: "player-1", createdAt: { gte: expect.any(Date) } },
      orderBy: { createdAt: "desc" }, take: 100,
    }));
    expect(await response.json()).toEqual({ history: [] });
  });
  it("returns five-digit numeric bets and a single numeric result", async () => {
    mocks.purchaseFindMany.mockResolvedValue([{
      id: "purchase-numeric-1", receiptCode: "JP-ABC12345", status: "CONFIRMED",
      createdAt: new Date("2035-01-01T12:00:00.000Z"), totalCents: 100,
      participations: [{
        id: "participation-1", status: "CONFIRMED", totalCents: 100,
        round: {
          code: "JN-20350101-1230", status: "COMPLETED",
          resultAt: new Date("2035-01-01T12:30:00.000Z"), resultNumber: "00123",
        },
        numericLines: [{
          id: "numeric-line-1", numberValue: "00123", prizeCents: 120, prizeCreditedAt: new Date("2035-01-01T12:31:00.000Z"),
        }],
      }],
    }]);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      history: [{
        participations: [{
          resultNumber: "00123",
          lines: [{
            numberValue: "00123",
            resultStatus: "PREMIADA",
            prizeCents: 120,
          }],
        }],
      }],
    });
  });

});
