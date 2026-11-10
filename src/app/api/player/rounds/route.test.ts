import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn(), roundFindMany: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  authPrisma: { round: { findMany: mocks.roundFindMany } },
  getSessionUser: mocks.getSessionUser,
  SESSION_COOKIE: "superquina_session",
}));

import { GET } from "./route";

function request(token = "session-token") {
  return new NextRequest("https://example.test/api/player/rounds", {
    headers: token ? { cookie: `superquina_session=${token}` } : {},
  });
}

describe("GET /api/player/rounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({
      id: "player-1", username: "player", role: "PLAYER", status: "ACTIVE", mustChangePassword: false,
    });
    mocks.roundFindMany.mockResolvedValue([{
      id: "round-1", code: "R-2030", startsAt: new Date("2030-01-01T12:00:00.000Z"),
      cutoffAt: new Date("2030-01-01T11:55:00.000Z"), resultAt: new Date("2030-01-01T12:30:00.000Z"),
      status: "OPEN",
    }]);
  });

  it("requires a valid session", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const response = await GET(request(""));
    expect(response.status).toBe(401);
    expect(mocks.roundFindMany).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "CASHIER"])("rejects role %s", async (role) => {
    mocks.getSessionUser.mockResolvedValue({
      id: "user-1", username: "user", role, status: "ACTIVE", mustChangePassword: false,
    });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(mocks.roundFindMany).not.toHaveBeenCalled();
  });

  it("returns only future scheduled/open rounds without caching", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(mocks.roundFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: ["SCHEDULED", "OPEN"] }, cutoffAt: { gt: expect.any(Date) } },
      orderBy: [{ startsAt: "asc" }, { code: "asc" }],
      take: 100,
    }));
    expect(await response.json()).toEqual({
      rounds: [{
        id: "round-1", code: "R-2030",
        startsAt: "2030-01-01T12:00:00.000Z",
        cutoffAt: "2030-01-01T11:55:00.000Z",
        resultAt: "2030-01-01T12:30:00.000Z",
        status: "OPEN",
      }],
    });
  });
});
