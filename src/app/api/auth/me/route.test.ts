import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn(),
  SESSION_COOKIE: "superquina_session",
}));

import { GET } from "./route";
import { getSessionUser } from "@/lib/auth/session";

const sessionUser = vi.mocked(getSessionUser);

function request(token?: string) {
  return new NextRequest("https://example.test/api/auth/me", {
    headers: token ? { cookie: `superquina_session=${token}` } : {},
  });
}

describe("GET /api/auth/me", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without an authenticated session and disables caching", async () => {
    sessionUser.mockResolvedValue(null);
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ authenticated: false });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(sessionUser).toHaveBeenCalledWith(undefined);
  });

  it("returns only the current user's safe session identity", async () => {
    sessionUser.mockResolvedValue({
      id: "user-1",
      username: "player-one",
      role: "PLAYER",
      status: "ACTIVE",
      mustChangePassword: false,
    } as never);
    const response = await GET(request("opaque-token"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(await response.json()).toEqual({
      authenticated: true,
      user: {
        id: "user-1",
        username: "player-one",
        role: "PLAYER",
        mustChangePassword: false,
      },
    });
    expect(sessionUser).toHaveBeenCalledWith("opaque-token");
  });

  it("does not expose account status or credentials in the response", async () => {
    sessionUser.mockResolvedValue({
      id: "admin-1",
      username: "administrator",
      role: "ADMIN",
      status: "ACTIVE",
      mustChangePassword: true,
      passwordHash: "must-never-leak",
    } as never);
    const response = await GET(request("opaque-token"));
    const body = await response.text();

    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain("must-never-leak");
    expect(body).not.toContain("ACTIVE");
    expect(body).toContain('"mustChangePassword":true');
  });
});
