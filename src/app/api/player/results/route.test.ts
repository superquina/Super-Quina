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
  return new NextRequest("https://example.test/api/player/results", {
    headers: token ? { cookie: "superquina_session=" + token } : {},
  });
}

describe("GET /api/player/results", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: "player-1", username: "player", role: "PLAYER", status: "ACTIVE", mustChangePassword: false });
    mocks.roundFindMany.mockResolvedValue([{
      id: "round-1", code: "R-2030", resultAt: new Date("2030-01-01T12:30:00.000Z"),
      resultNumber: "01234",
    }]);
  });

  it("requires an authenticated player session", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await GET(request(""))).status).toBe(401);
    expect(mocks.roundFindMany).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "CASHIER"])("allows role %s to view recent results", async (role) => {
    mocks.getSessionUser.mockResolvedValue({ id: "user-1", username: "user", role, status: "ACTIVE", mustChangePassword: false });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.roundFindMany).toHaveBeenCalledOnce();
  });


  it("allows ADMIN to view the same recent published results", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "admin-1", username: "admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: false });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.roundFindMany).toHaveBeenCalledOnce();
  });

  it("blocks every role while the initial password change is required", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "admin-1", username: "admin", role: "ADMIN", status: "ACTIVE", mustChangePassword: true });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(mocks.roundFindMany).not.toHaveBeenCalled();
  });

  it("returns the single numeric result from the last 24 hours without caching", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(mocks.roundFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "COMPLETED", resultAt: { gte: expect.any(Date) }, resultNumber: { not: null } },
      orderBy: { resultAt: "desc" }, take: 50,
    }));
    expect(await response.json()).toEqual({ results: [{
      id: "round-1", code: "R-2030", resultAt: "2030-01-01T12:30:00.000Z", number: "01234",
    }] });
  });

  it("returns a generic error if the database query fails", async () => {
    mocks.roundFindMany.mockRejectedValue(new Error("private database details"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Não foi possível carregar os resultados agora." });
  });
});
