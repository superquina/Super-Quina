import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  roundFindMany: vi.fn(),
  purchaseCount: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: mocks.getSessionUser,
  authPrisma: {
    round: { findMany: mocks.roundFindMany },
    purchase: { count: mocks.purchaseCount },
  },
  SESSION_COOKIE: "superquina_session",
}));

import { GET } from "./route";

function request(token = "session-token") {
  return new NextRequest("https://example.test/api/admin/rounds", {
    headers: token ? { cookie: "superquina_session=" + token } : {},
  });
}

describe("GET /api/admin/rounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({
      id: "admin-1", username: "admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: false,
    });
    mocks.roundFindMany.mockResolvedValue([{
      id: "round-123456", code: "R-12:30",
      startsAt: new Date("2035-01-01T12:00:00Z"),
      cutoffAt: new Date("2035-01-01T12:29:00Z"),
      resultAt: new Date("2035-01-01T12:30:00Z"),
      status: "SCHEDULED", resultNumber: null,
      _count: { participations: 4 },
    }]);
    mocks.purchaseCount.mockResolvedValueOnce(2).mockResolvedValueOnce(8);
  });

  it("requires an authenticated session", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const result = await GET(request());
    expect(result.status).toBe(401);
    expect(mocks.roundFindMany).not.toHaveBeenCalled();
  });

  it.each(["PLAYER", "CASHIER"])("denies role %s", async (role) => {
    mocks.getSessionUser.mockResolvedValue({
      id: "user-1", username: "user", role, status: "ACTIVE", mustChangePassword: false,
    });
    const result = await GET(request());
    expect(result.status).toBe(403);
    expect(mocks.roundFindMany).not.toHaveBeenCalled();
  });

  it("returns the round overview and aggregate purchase counts without caching", async () => {
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store, private");
    expect(await result.json()).toMatchObject({
      rounds: [{ id: "round-123456", participationCount: 4, status: "SCHEDULED" }],
      summary: { pendingPayments: 2, confirmedPurchases: 8 },
    });
    expect(mocks.roundFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    expect(mocks.purchaseCount).toHaveBeenCalledTimes(2);
  });
});

