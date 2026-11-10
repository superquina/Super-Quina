import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  transaction: vi.fn(),
  getSessionUser: vi.fn(),
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
  hashSessionToken: vi.fn(),
  userUpdate: vi.fn(),
  sessionUpdateMany: vi.fn(),
  sessionCreate: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  authPrisma: { user: { findUnique: mocks.findUnique }, $transaction: mocks.transaction },
  getSessionUser: mocks.getSessionUser,
  hashSessionToken: mocks.hashSessionToken,
  SESSION_COOKIE: "superquina_session",
  SESSION_TTL_MS: 43_200_000,
}));
vi.mock("@/lib/auth/password", () => ({
  verifyPassword: mocks.verifyPassword,
  hashPassword: mocks.hashPassword,
}));

import { POST } from "./route";

function request(body: unknown, origin = "https://example.test", token = "current-token") {
  return new NextRequest("https://example.test/api/auth/change-password", {
    method: "POST",
    headers: { "content-type": "application/json", origin, host: "example.test", ...(token ? { cookie: `superquina_session=${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/change-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: "user-1", role: "ADMIN", status: "ACTIVE", mustChangePassword: true });
    mocks.findUnique.mockResolvedValue({ passwordHash: "old-hash", status: "ACTIVE" });
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.hashPassword.mockResolvedValue("new-hash");
    mocks.hashSessionToken.mockReturnValue("hashed-next-token");
    mocks.userUpdate.mockResolvedValue({});
    mocks.sessionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.sessionCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      user: { update: mocks.userUpdate },
      session: { updateMany: mocks.sessionUpdateMany, create: mocks.sessionCreate },
    }));
  });

  it("rejects cross-origin requests before reading the session", async () => {
    const response = await POST(request({ currentPassword: "old-password", newPassword: "new-password-long" }, "https://attacker.test"));
    expect(response.status).toBe(403);
    expect(mocks.getSessionUser).not.toHaveBeenCalled();
  });

  it("requires a valid active session", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const response = await POST(request({ currentPassword: "old-password", newPassword: "new-password-long" }));
    expect(response.status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects weak or malformed new passwords", async () => {
    const response = await POST(request({ currentPassword: "old-password", newPassword: "short" }));
    expect(response.status).toBe(400);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("requires the current password to match", async () => {
    mocks.verifyPassword.mockResolvedValue(false);
    const response = await POST(request({ currentPassword: "wrong-password", newPassword: "new-password-long" }));
    expect(response.status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("updates the password, revokes old sessions, and rotates the cookie transactionally", async () => {
    const response = await POST(request({ currentPassword: "old-password", newPassword: "new-password-long" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: true, passwordChanged: true });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "new-hash", mustChangePassword: false },
    });
    expect(mocks.sessionUpdateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mocks.sessionCreate).toHaveBeenCalledWith({
      data: { userId: "user-1", tokenHash: "hashed-next-token", expiresAt: expect.any(Date) },
    });
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
